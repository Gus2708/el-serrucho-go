import type { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { actAs, actAsAnon, actAsOwner, addUser, createMigratedDb } from './support/pgliteHarness';

// Fixture validate_session is a STUB: its production body is not in this repository,
// so the harness models it with the test.session_valid setting. These tests prove the
// SQL contract on an isolated PGlite engine, not on production Supabase, and PGlite
// cannot exercise real concurrent transactions.

jest.setTimeout(120_000);

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER_ADMIN = '22222222-2222-4222-8222-222222222222';
const SUPER = '33333333-3333-4333-8333-333333333333';
const EMPLEADO = '44444444-4444-4444-8444-444444444444';
const INACTIVO = '55555555-5555-4555-8555-555555555555';

const BUCKET = 'facturas_proveedores';
const SHA_A = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA_B = '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae';
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

type Json = Record<string, unknown>;

let db: PGlite;
let counter = 0;

function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function migrationSql(suffix: string): string {
  const file = readdirSync(MIGRATIONS_DIR).find(name => name.endsWith(suffix));
  if (!file) throw new Error(`Migration ${suffix} not found`);
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

async function actAsServiceRole(database: PGlite): Promise<void> {
  await database.exec('reset role');
  await database.query("select set_config('request.jwt.claim.role', 'service_role', false)");
  await database.query("select set_config('request.jwt.claim.sub', '', false)");
  await database.exec('set role service_role');
}

async function initTestDb(): Promise<PGlite> {
  const database = await createMigratedDb();
  await database.exec(`
    create role service_role nologin bypassrls;
    grant usage on schema public to service_role;
    grant usage on schema facturas_privado to service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant execute on functions to service_role;
  `);
  await database.exec(migrationSql('_facturas_proveedores_extracciones.sql'));
  await database.exec(migrationSql('_facturas_proveedores_revisiones.sql'));
  return database;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

async function seedInvoice(owner: string, invoiceId: string, withDoc = true): Promise<void> {
  await actAsOwner(db);
  let docPath: string | null = null;
  if (withDoc) {
    docPath = `${owner}/${invoiceId}/${uuid()}.pdf`;
    await db.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb)', [
      BUCKET,
      docPath,
      JSON.stringify({ size: 2048, mimetype: 'application/pdf' }),
    ]);
  }
  await db.query(
    `insert into public.facturas_proveedores (
       id, creado_por, proveedor_codigo, proveedor_nombre, numero_documento, version,
       documento_path, documento_nombre, documento_mime, documento_bytes, documento_sha256
     ) values ($1, $2, 'PROV-1', 'Proveedor Uno', 'DOC-001', 1, $3, $4, $5, $6, $7)`,
    [
      invoiceId,
      owner,
      docPath,
      withDoc ? 'factura.pdf' : null,
      withDoc ? 'application/pdf' : null,
      withDoc ? 2048 : null,
      withDoc ? SHA_A : null,
    ]
  );
}

// Realistic staged extraction result: lines 1 and 2 repeat the same printed supplier code.
function extractionResult(): Json {
  const line = (numeroLinea: number, codigoProveedor: string, cantidad: string, precioUnitario: string) => ({
    numeroLinea,
    pagina: 1,
    codigoProveedor,
    descripcion: `Articulo ${numeroLinea}`,
    cantidad,
    unidad: 'UND',
    precioUnitario,
    descuentos: [],
    tasaIva: '16',
    total: null,
    incertidumbre: null,
  });
  return {
    version: 1,
    cabecera: { proveedorNombre: 'Proveedor Uno', numeroDocumento: 'DOC-001', moneda: 'USD', total: null },
    lineas: [line(1, '00123', '10', '0.80'), line(2, '00123', '5', '0.95'), line(3, 'AB-9', '2', '3.10')],
    metadatos: { totalPaginas: 1, paginasProcesadas: [1], documentoCompleto: true, advertencias: [], confianzaGlobal: null },
  };
}

interface Scenario {
  facturaId: string;
  extraccionId: string;
  owner: string;
  // Stable line IDs for source lines 1..3 of the staged extraction.
  lineIds: [string, string, string];
}

// Reserves an extraction as the owner and finalizes it as service_role, through the real RPCs.
async function finalizeExtraction(
  facturaId: string,
  owner: string,
  outcome: 'completado' | 'fallido'
): Promise<string> {
  await actAs(db, owner, true);
  const requestId = uuid();
  const reserved = await db.query<{ r: { extraccion_id: string; factura_version: number } }>(
    'select public.reservar_extraccion_factura($1::uuid, $2::uuid, $3::int) as r',
    [facturaId, requestId, 1]
  );
  const extraccionId = reserved.rows[0].r.extraccion_id;
  await actAsServiceRole(db);
  await db.query('select public.completar_extraccion_factura($1::uuid, $2::uuid, $3::text, $4::jsonb, $5::text, null)', [
    facturaId,
    requestId,
    outcome,
    outcome === 'completado' ? JSON.stringify(extractionResult()) : null,
    outcome === 'fallido' ? 'timeout' : null,
  ]);
  await actAs(db, owner, true);
  return extraccionId;
}

async function scenario(owner = ADMIN): Promise<Scenario> {
  const facturaId = uuid();
  await seedInvoice(owner, facturaId);
  const extraccionId = await finalizeExtraction(facturaId, owner, 'completado');
  return { facturaId, extraccionId, owner, lineIds: [uuid(), uuid(), uuid()] };
}

async function manualSave(
  owner: string,
  facturaId: string,
  version: number,
  documento: Json | null
): Promise<void> {
  await actAs(db, owner, true);
  await db.query(
    'select public.guardar_factura_proveedor($1::uuid, $2::int, $3::uuid, $4::jsonb, $5::jsonb)',
    [facturaId, version, uuid(), JSON.stringify({ proveedor_nombre: 'Editado', documento }), '[]']
  );
}

async function currentDocumento(facturaId: string): Promise<Json> {
  await actAsOwner(db);
  const r = await db.query<{ documento_path: string; documento_nombre: string; documento_mime: string; documento_bytes: number; documento_sha256: string }>(
    'select documento_path, documento_nombre, documento_mime, documento_bytes, documento_sha256 from public.facturas_proveedores where id = $1',
    [facturaId]
  );
  const d = r.rows[0];
  return { path: d.documento_path, nombre: d.documento_nombre, mime: d.documento_mime, bytes: d.documento_bytes, sha256: d.documento_sha256 };
}

// Re-attaches the invoice with a different document (new path and SHA); bumps the invoice version.
async function reattachDocument(owner: string, facturaId: string, version: number): Promise<void> {
  await actAsOwner(db);
  const path = `${owner}/${facturaId}/${uuid()}.pdf`;
  await db.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb)', [
    BUCKET,
    path,
    JSON.stringify({ size: 4096, mimetype: 'application/pdf' }),
  ]);
  await manualSave(owner, facturaId, version, { path, nombre: 'nueva.pdf', mime: 'application/pdf', bytes: 4096, sha256: SHA_B });
}

interface LineaOpts {
  lineaId?: string;
  origen?: { numeroLinea: number } | null;
  correcciones?: Json;
  factorConversion?: string | null;
  asociacion?: Json;
  codigoBarras?: Json;
}

function linea(numeroLinea: number | null, opts: LineaOpts = {}): Json {
  return {
    lineaId: opts.lineaId ?? uuid(),
    origen: opts.origen !== undefined ? opts.origen : numeroLinea === null ? null : { numeroLinea },
    correcciones: opts.correcciones ?? {},
    factorConversion: opts.factorConversion !== undefined ? opts.factorConversion : '1',
    asociacion: opts.asociacion ?? { tipo: 'confirmado', codigoInterno: 'SKU-1', evidencia: 'sugerencia', motivo: null },
    codigoBarras: opts.codigoBarras ?? { usarCodigoFactura: true },
  };
}

function contenido(extraccionId: string | null, lineas: Json[], cabecera: Json = {}): Json {
  return {
    review_schema: 1,
    calculo_version: 'calc-v1',
    matching_version: 'matching-v1',
    extraccion_id: extraccionId,
    cabecera: {
      correcciones: {},
      tasaConfirmada: null,
      precioIncluyeIva: true,
      recepcionCompleta: true,
      documentoCompletoConfirmado: true,
      ...cabecera,
    },
    lineas,
  };
}

// Every raw source line exactly once, with the scenario's stable IDs.
function sourceLines(s: Scenario, extra: Record<number, LineaOpts> = {}): Json[] {
  return [1, 2, 3].map(n => linea(n, { lineaId: s.lineIds[n - 1], ...extra[n] }));
}

function fullContent(s: Scenario): Json {
  return contenido(s.extraccionId, sourceLines(s));
}

interface SaveArgs {
  id: string;
  expectedRevision?: number;
  key?: string;
  version?: number;
  extraccionId?: string | null;
  content: Json | unknown;
  motivo?: string | null;
}

async function save(a: SaveArgs): Promise<Json> {
  const r = await db.query<{ r: Json }>(
    'select public.guardar_revision_factura($1::uuid, $2::int, $3::uuid, $4::int, $5::uuid, $6::jsonb, $7::text) as r',
    [
      a.id,
      a.expectedRevision ?? 0,
      a.key ?? uuid(),
      a.version ?? 1,
      a.extraccionId === undefined ? ((a.content as Json)?.extraccion_id ?? null) : a.extraccionId,
      JSON.stringify(a.content),
      a.motivo === undefined ? 'Revision inicial' : a.motivo,
    ]
  );
  return r.rows[0].r;
}

async function approve(id: string, revision: number, fingerprint: string, version = 1): Promise<Json> {
  const r = await db.query<{ r: Json }>(
    'select public.aprobar_revision_factura($1::uuid, $2::int, $3::text, $4::int) as r',
    [id, revision, fingerprint, version]
  );
  return r.rows[0].r;
}

const TABLES = [
  'public.facturas_proveedores',
  'public.facturas_proveedores_lineas',
  'public.facturas_proveedores_operaciones',
  'public.facturas_proveedores_extracciones',
  'public.facturas_proveedores_revisiones',
  'storage.objects',
];

async function snapshot(tables = TABLES): Promise<string> {
  await actAsOwner(db);
  const parts: string[] = [];
  for (const t of tables) {
    const r = await db.query<{ h: string }>(
      `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from ${t} x`
    );
    parts.push(r.rows[0].h);
  }
  return parts.join(':');
}

async function revisions(facturaId: string) {
  await actAsOwner(db);
  const r = await db.query<Record<string, any>>(
    'select * from public.facturas_proveedores_revisiones where factura_id = $1 order by revision',
    [facturaId]
  );
  return r.rows;
}

// A rejected command must leave every relevant table byte-identical.
async function expectRejected(actor: () => Promise<void>, call: () => Promise<unknown>, code: string, message?: string) {
  const before = await snapshot();
  await actor();
  const failure = expect(call()).rejects;
  await failure.toMatchObject(message ? { code, message: expect.stringContaining(message) } : { code });
  expect(await snapshot()).toBe(before);
}

const as = (user: string, valid = true) => () => actAs(db, user, valid);

describe('facturas_proveedores_revisiones', () => {
  beforeAll(async () => {
    db = await initTestDb();
    await addUser(db, ADMIN, 'admin');
    await addUser(db, OTHER_ADMIN, 'admin');
    await addUser(db, SUPER, 'superempleado');
    await addUser(db, EMPLEADO, 'empleado');
    await addUser(db, INACTIVO, 'admin', false);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('guardar_revision_factura: persisted effects', () => {
    it('stores revision 1 with server fingerprint, bindings and no attestation', async () => {
      const s = await scenario();
      const content = fullContent(s);
      const before = await snapshot(TABLES.filter(t => !t.endsWith('revisiones')));
      const res = await save({ id: s.facturaId, content, motivo: 'Primera lectura' });

      expect(res).toMatchObject({ factura_id: s.facturaId, revision: 1, replay: false });
      expect(String(res.fingerprint)).toMatch(/^[0-9a-f]{64}$/);

      const rows = await revisions(s.facturaId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        factura_id: s.facturaId,
        revision: 1,
        factura_version: 1,
        extraccion_id: s.extraccionId,
        documento_sha256: SHA_A,
        creado_por: ADMIN,
        motivo: 'Primera lectura',
        fingerprint: res.fingerprint,
        aprobado_por: null,
        aprobado_en: null,
      });
      expect(rows[0].contenido).toEqual(content);
      expect(rows[0].creado_en).toBeTruthy();

      const expected = await db.query<{ f: string }>(
        "select encode(sha256(convert_to(contenido::text, 'UTF8')), 'hex') as f from public.facturas_proveedores_revisiones where factura_id = $1",
        [s.facturaId]
      );
      expect(expected.rows[0].f).toBe(res.fingerprint);

      // Original extraction, invoice, lines and ledger are untouched.
      expect(await snapshot(TABLES.filter(t => !t.endsWith('revisiones')))).toBe(before);
    });

    it('server fingerprint ignores client JSON key order', async () => {
      const s = await scenario();
      const a = fullContent(s);
      const reordered = JSON.parse(JSON.stringify(a), (_k, v) => v);
      const keys = Object.keys(reordered).reverse();
      const shuffled: Json = {};
      for (const k of keys) shuffled[k] = reordered[k];
      const first = await save({ id: s.facturaId, content: a });
      const second = await save({ id: s.facturaId, expectedRevision: 1, content: shuffled });
      expect(second.fingerprint).toBe(first.fingerprint);
    });

    it('appends revision 2 and leaves revision 1 byte-identical', async () => {
      const s = await scenario();
      await save({ id: s.facturaId, content: fullContent(s) });
      const [first] = await revisions(s.facturaId);
      await actAs(db, ADMIN, true);
      const next = contenido(
        s.extraccionId,
        sourceLines(s, { 1: { correcciones: { cantidad: { valor: '12', motivo: 'Cantidad ilegible' } } } })
      );
      const res = await save({ id: s.facturaId, expectedRevision: 1, content: next });
      expect(res).toMatchObject({ revision: 2, replay: false });
      const rows = await revisions(s.facturaId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(first);
      expect(rows[1].contenido).toEqual(next);
    });

    it('keeps repeated supplier codes as distinct stable lines and literal codes verbatim', async () => {
      const s = await scenario();
      await actAs(db, ADMIN, true);
      const [id1, id2, id3] = s.lineIds;
      const content = contenido(
        s.extraccionId,
        sourceLines(s, { 1: { correcciones: { codigoProveedor: { valor: '000123A', motivo: 'Codigo impreso' } } } })
      );
      await save({ id: s.facturaId, content });
      const [row] = await revisions(s.facturaId);
      expect(row.contenido.lineas.map((l: Json) => l.lineaId)).toEqual([id1, id2, id3]);
      expect(row.contenido.lineas[0].correcciones.codigoProveedor.valor).toBe('000123A');
    });

    it('stores a manual-only revision without extraction and a motivated manual line', async () => {
      const facturaId = uuid();
      await seedInvoice(ADMIN, facturaId, false);
      await actAs(db, ADMIN, true);
      const content = contenido(null, [
        linea(null, {
          correcciones: { descripcion: { valor: 'Tornillo', motivo: 'Linea agregada a mano' } },
          asociacion: { tipo: 'pendiente', codigoInterno: null, evidencia: null, motivo: null },
        }),
      ]);
      const res = await save({ id: facturaId, content });
      expect(res.revision).toBe(1);
      const [row] = await revisions(facturaId);
      expect(row.extraccion_id).toBeNull();
      expect(row.documento_sha256).toBeNull();
    });

    it('superempleado can save a revision for their invoice', async () => {
      const s = await scenario(SUPER);
      const res = await save({ id: s.facturaId, content: fullContent(s) });
      expect(res.revision).toBe(1);
    });
  });

  describe('guardar_revision_factura: actors', () => {
    let s: Scenario;
    beforeAll(async () => {
      s = await scenario();
    });
    const call = () => save({ id: s.facturaId, content: fullContent(s) });

    it('rejects empleado', async () => {
      await expectRejected(as(EMPLEADO), call, '42501');
    });
    it('rejects inactive admin', async () => {
      await expectRejected(as(INACTIVO), call, '42501');
    });
    it('rejects an invalid session', async () => {
      await expectRejected(as(ADMIN, false), call, '42501', 'no_autorizado');
    });
    it('rejects anon (no execute privilege)', async () => {
      await expectRejected(() => actAsAnon(db), call, '42501');
    });
    it('rejects service_role (no execute privilege)', async () => {
      await expectRejected(() => actAsServiceRole(db), call, '42501');
    });
    it('rejects another privileged user on a foreign invoice', async () => {
      await expectRejected(as(OTHER_ADMIN), call, '42501', 'no_autorizado');
    });
    it('reports an unknown invoice as not found', async () => {
      const missing = uuid();
      await expectRejected(as(ADMIN), () => save({ id: missing, content: fullContent(s) }), 'P0002');
    });
  });

  describe('direct DML, RLS and append-only', () => {
    let s: Scenario;
    beforeAll(async () => {
      s = await scenario();
      await save({ id: s.facturaId, content: fullContent(s) });
    });

    it.each([
      ['authenticated', as(ADMIN)],
      ['anon', () => actAsAnon(db)],
      ['service_role', () => actAsServiceRole(db)],
    ])('%s cannot insert, update or delete directly', async (_name, actor) => {
      const before = await snapshot();
      await actor();
      const values = [uuid(), s.facturaId, 1, uuid(), ADMIN];
      await expect(
        db.query(
          `insert into public.facturas_proveedores_revisiones
             (factura_id, revision, clave, factura_version, contenido, fingerprint, creado_por)
           values ($1, 7, $2, 1, '{}'::jsonb, 'x', $3)`,
          [s.facturaId, values[0], ADMIN]
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        db.query("update public.facturas_proveedores_revisiones set motivo = 'x' where factura_id = $1", [s.facturaId])
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        db.query('delete from public.facturas_proveedores_revisiones where factura_id = $1', [s.facturaId])
      ).rejects.toMatchObject({ code: '42501' });
      expect(await snapshot()).toBe(before);
    });

    it('anon and service_role hold no table privileges at all', async () => {
      await actAsOwner(db);
      const r = await db.query<{ role: string; priv: string; ok: boolean }>(
        `select r as role, p as priv, has_table_privilege(r, 'public.facturas_proveedores_revisiones', p) as ok
           from unnest(array['anon','service_role']) r,
                unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`
      );
      expect(r.rows.filter(x => x.ok)).toEqual([]);
      const auth = await db.query<{ p: string; ok: boolean }>(
        `select p, has_table_privilege('authenticated', 'public.facturas_proveedores_revisiones', p) as ok
           from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`
      );
      expect(auth.rows.filter(x => x.ok).map(x => x.p)).toEqual(['SELECT']);
    });

    it('RLS: only the privileged owner with a valid session reads', async () => {
      const count = async () =>
        (await db.query('select 1 from public.facturas_proveedores_revisiones where factura_id = $1', [s.facturaId])).rows.length;
      await actAs(db, ADMIN, true);
      expect(await count()).toBe(1);
      await actAs(db, OTHER_ADMIN, true);
      expect(await count()).toBe(0);
      await actAs(db, ADMIN, false);
      expect(await count()).toBe(0);
      await actAs(db, EMPLEADO, true);
      expect(await count()).toBe(0);
    });

    it('anon cannot read', async () => {
      await actAsAnon(db);
      await expect(db.query('select 1 from public.facturas_proveedores_revisiones')).rejects.toMatchObject({ code: '42501' });
    });

    it('rewriting or deleting a stored revision fails even for the table owner', async () => {
      const before = await snapshot();
      await actAsOwner(db);
      await expect(
        db.query("update public.facturas_proveedores_revisiones set contenido = '{}'::jsonb where factura_id = $1", [s.facturaId])
      ).rejects.toMatchObject({ message: expect.stringContaining('revision_inmutable') });
      await expect(
        db.query("update public.facturas_proveedores_revisiones set extraccion_id = null where factura_id = $1", [s.facturaId])
      ).rejects.toMatchObject({ message: expect.stringContaining('revision_inmutable') });
      await expect(
        db.query('delete from public.facturas_proveedores_revisiones where factura_id = $1', [s.facturaId])
      ).rejects.toMatchObject({ message: expect.stringContaining('revision_inmutable') });
      await expect(db.query('truncate public.facturas_proveedores_revisiones')).rejects.toMatchObject({
        message: expect.stringContaining('revision_inmutable'),
      });
      expect(await snapshot()).toBe(before);
    });
  });

  describe('versions, revisions and idempotency', () => {
    it('rejects a stale expected revision', async () => {
      const s = await scenario();
      await save({ id: s.facturaId, content: fullContent(s) });
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 0, content: fullContent(s) }), 'PR409', 'revision_obsoleta');
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 5, content: fullContent(s) }), 'PR409');
    });

    it('rejects a stale invoice version', async () => {
      const s = await scenario();
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, version: 2, content: fullContent(s) }), 'PV409', 'version_obsoleta');
    });

    it('exact replay returns the stored result without a duplicate row', async () => {
      const s = await scenario();
      const key = uuid();
      const content = fullContent(s);
      const first = await save({ id: s.facturaId, key, content });
      const before = await snapshot();
      const again = await save({ id: s.facturaId, key, content });
      expect(again).toMatchObject({ revision: 1, fingerprint: first.fingerprint, replay: true });
      expect(await snapshot()).toBe(before);
      expect(await revisions(s.facturaId)).toHaveLength(1);
      await actAs(db, ADMIN, true);
    });

    it('replay still resolves after a newer revision or a manual save', async () => {
      const s = await scenario();
      const key = uuid();
      const content = fullContent(s);
      await save({ id: s.facturaId, key, content });
      await save({
        id: s.facturaId,
        expectedRevision: 1,
        content: contenido(s.extraccionId, sourceLines(s, { 1: { factorConversion: '2' } })),
      });
      await manualSave(ADMIN, s.facturaId, 1, await currentDocumento(s.facturaId));
      await actAs(db, ADMIN, true);
      const again = await save({ id: s.facturaId, key, content });
      expect(again).toMatchObject({ revision: 1, replay: true });
      expect(await revisions(s.facturaId)).toHaveLength(2);
    });

    it.each([
      ['content', (s: Scenario, _c: Json) => ({ content: contenido(s.extraccionId, [linea(1)]) })],
      ['motivo', (_s: Scenario, c: Json) => ({ content: c, motivo: 'Otro motivo' })],
      ['invoice version', (_s: Scenario, c: Json) => ({ content: c, version: 2 })],
      ['extraction', (_s: Scenario, _c: Json) => ({ content: contenido(null, [linea(null, { correcciones: { descripcion: { valor: 'x', motivo: 'm' } } })]) })],
    ])('changed %s under the same key conflicts', async (_name, change) => {
      const s = await scenario();
      const key = uuid();
      const original = fullContent(s);
      await save({ id: s.facturaId, key, content: original });
      const args = change(s, original) as Partial<SaveArgs>;
      await expectRejected(
        as(ADMIN),
        () => save({ id: s.facturaId, key, content: args.content, version: args.version, motivo: args.motivo }),
        'PI409',
        'clave_idempotencia_reutilizada'
      );
    });

    it('the same key is scoped per invoice', async () => {
      const a = await scenario();
      const b = await scenario();
      const key = uuid();
      await save({ id: a.facturaId, key, content: fullContent(a) });
      const res = await save({ id: b.facturaId, key, content: fullContent(b) });
      expect(res).toMatchObject({ revision: 1, replay: false });
    });
  });

  describe('extraction binding', () => {
    it('rejects a foreign, unknown, in-progress, failed or quarantined extraction', async () => {
      const mine = await scenario();
      const foreign = await scenario(OTHER_ADMIN);

      const pendingId = uuid();
      await seedInvoice(ADMIN, pendingId);
      await actAs(db, ADMIN, true);
      const reserved = await db.query<{ r: { extraccion_id: string } }>(
        'select public.reservar_extraccion_factura($1::uuid, $2::uuid, 1) as r',
        [pendingId, uuid()]
      );
      const inProgress = reserved.rows[0].r.extraccion_id;

      const failedInvoice = uuid();
      await seedInvoice(ADMIN, failedInvoice);
      const failed = await finalizeExtraction(failedInvoice, ADMIN, 'fallido');

      // Quarantine: finalize after the invoice version moved.
      const quarantineInvoice = uuid();
      await seedInvoice(ADMIN, quarantineInvoice);
      await actAs(db, ADMIN, true);
      const quarantineRequest = uuid();
      const q = await db.query<{ r: { extraccion_id: string } }>(
        'select public.reservar_extraccion_factura($1::uuid, $2::uuid, 1) as r',
        [quarantineInvoice, quarantineRequest]
      );
      await manualSave(ADMIN, quarantineInvoice, 1, await currentDocumento(quarantineInvoice));
      await actAsServiceRole(db);
      await db.query('select public.completar_extraccion_factura($1::uuid, $2::uuid, $3::text, $4::jsonb, null, null)', [
        quarantineInvoice,
        quarantineRequest,
        'completado',
        JSON.stringify(extractionResult()),
      ]);
      const quarantined = q.rows[0].r.extraccion_id;
      await actAsOwner(db);
      const state = await db.query<{ estado: string }>(
        'select estado from public.facturas_proveedores_extracciones where id = $1',
        [quarantined]
      );
      expect(state.rows[0].estado).toBe('cuarentena');

      const cases: Array<[string, string, string, number]> = [
        ['foreign extraction', mine.facturaId, foreign.extraccionId, 1],
        ['unknown extraction', mine.facturaId, uuid(), 1],
        ['in progress', pendingId, inProgress, 1],
        ['failed', failedInvoice, failed, 1],
        ['quarantined', quarantineInvoice, quarantined, 2],
      ];
      for (const [, facturaId, extraccionId, version] of cases) {
        await expectRejected(
          as(ADMIN),
          () => save({ id: facturaId, version, extraccionId, content: contenido(extraccionId, [linea(1)]) }),
          '22023',
          'extraccion_invalida'
        );
      }
    });

    it('rejects an extraction whose source SHA no longer matches the attached document', async () => {
      const s = await scenario();
      await reattachDocument(ADMIN, s.facturaId, 1);
      await expectRejected(
        as(ADMIN),
        () => save({ id: s.facturaId, version: 2, content: fullContent(s) }),
        '22023',
        'extraccion_invalida'
      );
    });

    it('rejects an extraction when the invoice has no document', async () => {
      const s = await scenario();
      await manualSave(ADMIN, s.facturaId, 1, null);
      await expectRejected(
        as(ADMIN),
        () => save({ id: s.facturaId, version: 2, content: fullContent(s) }),
        '22023',
        'extraccion_invalida'
      );
    });

    it('rejects content.extraccion_id that differs from the p_extraccion_id argument', async () => {
      const s = await scenario();
      await expectRejected(
        as(ADMIN),
        () => save({ id: s.facturaId, extraccionId: s.extraccionId, content: contenido(null, [linea(1)]) }),
        '22023',
        'extraccion_id'
      );
    });
  });

  describe('content shape fails closed', () => {
    let s: Scenario;
    beforeAll(async () => {
      s = await scenario();
    });

    const mutate = (fn: (c: any) => void, lineas?: (s: Scenario) => Json[]) => () => {
      const c = contenido(s.extraccionId, lineas ? lineas(s) : sourceLines(s)) as any;
      fn(c);
      return c;
    };
    const corr = (valor: unknown, motivo: unknown = 'Motivo') => ({ valor, motivo });

    const cases: Array<[string, () => unknown]> = [
      ['array instead of object', () => []],
      ['unknown root key', mutate(c => { c.extra = 1; })],
      ['missing root key', mutate(c => { delete c.matching_version; })],
      ['review_schema 2', mutate(c => { c.review_schema = 2; })],
      ['review_schema as string', mutate(c => { c.review_schema = '1'; })],
      ['calculo_version other', mutate(c => { c.calculo_version = 'calc-v2'; })],
      ['matching_version other', mutate(c => { c.matching_version = 'x'; })],
      ['lineas not an array', mutate(c => { c.lineas = {}; })],
      ['501 lines', () => contenido(s.extraccionId, Array.from({ length: 501 }, (_x, i) => linea(null, { lineaId: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}` })))],
      ['cabecera extra key', mutate(c => { c.cabecera.total = '1'; })],
      ['cabecera missing key', mutate(c => { delete c.cabecera.recepcionCompleta; })],
      ['tasaConfirmada set', mutate(c => { c.cabecera.tasaConfirmada = '36.5'; })],
      ['precioIncluyeIva string', mutate(c => { c.cabecera.precioIncluyeIva = 'si'; })],
      ['recepcionCompleta string', mutate(c => { c.cabecera.recepcionCompleta = 1; })],
      ['unknown header correction field', mutate(c => { c.cabecera.correcciones = { descuentos: corr('1') }; })],
      ['non-allowed header field', mutate(c => { c.cabecera.correcciones = { aprobado: corr('1') }; })],
      ['correction value is a number', mutate(c => { c.cabecera.correcciones = { total: corr(5) }; })],
      ['correction without motivo', mutate(c => { c.cabecera.correcciones = { proveedorNombre: { valor: 'X' } }; })],
      ['correction with blank motivo', mutate(c => { c.cabecera.correcciones = { proveedorNombre: corr('X', '   ') }; })],
      ['correction motivo not a string', mutate(c => { c.cabecera.correcciones = { proveedorNombre: corr('X', 4) }; })],
      ['correction with extra key', mutate(c => { c.cabecera.correcciones = { proveedorNombre: { ...corr('X'), extra: 1 } }; })],
      ['correction as array', mutate(c => { c.cabecera.correcciones = []; })],
      ['invalid header decimal', mutate(c => { c.cabecera.correcciones = { total: corr('1,5') }; })],
      ['invalid header date', mutate(c => { c.cabecera.correcciones = { fechaEmision: corr('2026-02-30') }; })],
      ['invalid header currency', mutate(c => { c.cabecera.correcciones = { moneda: corr('usd') }; })],
      ['line extra key', mutate(c => { c.lineas[0].precio = '1'; })],
      ['line missing key', mutate(c => { delete c.lineas[0].codigoBarras; })],
      ['line forbidden field correction', mutate(c => { c.lineas[0].correcciones = { codigoProducto: corr('X') }; })],
      ['line invalid quantity', mutate(c => { c.lineas[0].correcciones = { cantidad: corr('diez') }; })],
      ['line correction value too long', mutate(c => { c.lineas[0].correcciones = { descripcion: corr('x'.repeat(501)) }; })],
      ['lineaId not a uuid', mutate(c => { c.lineas[0].lineaId = 'abc'; })],
      ['lineaId missing', mutate(c => { c.lineas[0].lineaId = null; })],
      ['duplicate lineaId', mutate(c => { c.lineas[1].lineaId = c.lineas[0].lineaId; })],
      ['unknown source line', mutate(c => { c.lineas[0].origen = { numeroLinea: 99 }; })],
      ['duplicate source line', mutate(c => { c.lineas[1].origen = { numeroLinea: 1 }; })],
      ['origen with extra key', mutate(c => { c.lineas[0].origen = { numeroLinea: 1, x: 1 }; })],
      ['origen numeroLinea string', mutate(c => { c.lineas[0].origen = { numeroLinea: '1' }; })],
      ['manual line without correction (no motive)', mutate(c => { c.lineas.push(linea(null)); })],
      ['factorConversion zero', mutate(c => { c.lineas[0].factorConversion = '0'; })],
      ['factorConversion negative', mutate(c => { c.lineas[0].factorConversion = '-1'; })],
      ['factorConversion text', mutate(c => { c.lineas[0].factorConversion = 'abc'; })],
      ['factorConversion number', mutate(c => { c.lineas[0].factorConversion = 1; })],
      ['asociacion unknown tipo', mutate(c => { c.lineas[0].asociacion.tipo = 'auto'; })],
      ['asociacion extra key', mutate(c => { c.lineas[0].asociacion.score = 1; })],
      ['pendiente with a product', mutate(c => { c.lineas[0].asociacion = { tipo: 'pendiente', codigoInterno: 'SKU-1', evidencia: null, motivo: null }; })],
      ['pendiente with evidence', mutate(c => { c.lineas[0].asociacion = { tipo: 'pendiente', codigoInterno: null, evidencia: 'manual', motivo: null }; })],
      ['confirmado without product', mutate(c => { c.lineas[0].asociacion = { tipo: 'confirmado', codigoInterno: null, evidencia: 'sugerencia', motivo: null }; })],
      ['confirmado without evidence', mutate(c => { c.lineas[0].asociacion = { tipo: 'confirmado', codigoInterno: 'SKU-1', evidencia: null, motivo: null }; })],
      ['confirmado with unknown evidence', mutate(c => { c.lineas[0].asociacion = { tipo: 'confirmado', codigoInterno: 'SKU-1', evidencia: 'auto', motivo: null }; })],
      ['confirmado manual without motivo', mutate(c => { c.lineas[0].asociacion = { tipo: 'confirmado', codigoInterno: 'SKU-1', evidencia: 'manual', motivo: null }; })],
      ['confirmado product too long', mutate(c => { c.lineas[0].asociacion = { tipo: 'confirmado', codigoInterno: 'x'.repeat(81), evidencia: 'sugerencia', motivo: null }; })],
      ['producto_nuevo with a product', mutate(c => { c.lineas[0].asociacion = { tipo: 'producto_nuevo', codigoInterno: 'SKU-1', evidencia: 'manual', motivo: 'Nuevo' }; })],
      ['producto_nuevo without motivo', mutate(c => { c.lineas[0].asociacion = { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: null }; })],
      ['producto_nuevo with suggestion evidence', mutate(c => { c.lineas[0].asociacion = { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'sugerencia', motivo: 'Nuevo' }; })],
      ['codigoBarras extra key', mutate(c => { c.lineas[0].codigoBarras = { usarCodigoFactura: true, codigo: '1' }; })],
      ['usarCodigoFactura string', mutate(c => { c.lineas[0].codigoBarras = { usarCodigoFactura: 'si' }; })],
      ['codigoBarras null', mutate(c => { c.lineas[0].codigoBarras = null; })],
    ];

    it.each(cases)('rejects %s', async (_name, build) => {
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, extraccionId: s.extraccionId, content: build() }), '22023', 'payload_invalido');
    });

    it('rejects source lines when there is no extraction', async () => {
      const facturaId = uuid();
      await seedInvoice(ADMIN, facturaId, false);
      await expectRejected(as(ADMIN), () => save({ id: facturaId, content: contenido(null, [linea(1)]) }), '22023', 'payload_invalido');
    });

    it('rejects a blank revision motive', async () => {
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, content: fullContent(s), motivo: '   ' }), '22023', 'payload_invalido');
    });

    it('rejects a null idempotency key and a null content', async () => {
      await expectRejected(
        as(ADMIN),
        async () => db.query('select public.guardar_revision_factura($1::uuid, 0, null, 1, $2::uuid, $3::jsonb, null)', [s.facturaId, s.extraccionId, JSON.stringify(fullContent(s))]),
        '22023'
      );
      await expectRejected(
        as(ADMIN),
        async () => db.query('select public.guardar_revision_factura($1::uuid, 0, $2::uuid, 1, $3::uuid, null, null)', [s.facturaId, uuid(), s.extraccionId]),
        '22023'
      );
    });

    it('accepts explicit decisions in every valid shape', async () => {
      const content = contenido(s.extraccionId, [
        linea(1, { asociacion: { tipo: 'pendiente', codigoInterno: null, evidencia: null, motivo: null }, factorConversion: null }),
        linea(2, { asociacion: { tipo: 'confirmado', codigoInterno: 'SKU-2', evidencia: 'manual', motivo: 'Mismo producto' } }),
        linea(3, { asociacion: { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'No existe en catalogo' }, codigoBarras: { usarCodigoFactura: false } }),
        linea(null, { correcciones: { descripcion: corr('Linea manual', 'Falta en el OCR'), cantidad: corr('1.5'), precioUnitario: corr(null) } }),
      ]);
      const res = await save({ id: s.facturaId, extraccionId: s.extraccionId, content });
      expect(res.replay).toBe(false);
    });
  });

  describe('typed discount and tax corrections', () => {
    let s: Scenario;
    beforeAll(async () => {
      s = await scenario();
    });

    const desc = (over: Json = {}) => ({ orden: 1, porcentaje: '5', monto: null, alcance: 'renglon', incluidoEnPrecio: false, ...over });
    const imp = (over: Json = {}) => ({ tasa: '16', base: '100.50', monto: '16.08', exento: false, ...over });
    const withHeader = (campo: string, valor: unknown, motivo: unknown = 'Lectura corregida') =>
      contenido(s.extraccionId, sourceLines(s), { correcciones: { [campo]: { valor, motivo } } });
    const withLine = (valor: unknown, motivo: unknown = 'Lectura corregida') =>
      contenido(s.extraccionId, sourceLines(s, { 1: { correcciones: { descuentos: { valor, motivo } } } }));

    it('stores real typed arrays, including an explicit empty array, without touching the raw extraction', async () => {
      const own = await scenario();
      const content = contenido(
        own.extraccionId,
        sourceLines(own, {
          1: { correcciones: { descuentos: { valor: [desc(), desc({ orden: 2, porcentaje: null, monto: '1.2500', alcance: null, incluidoEnPrecio: null })], motivo: 'Descuentos en cascada' } } },
          2: { correcciones: { descuentos: { valor: [], motivo: 'La extraccion invento un descuento' } } },
        }),
        {
          correcciones: {
            descuentos: { valor: [desc({ alcance: 'global' })], motivo: 'Descuento global impreso' },
            impuestos: { valor: [imp(), imp({ tasa: null, base: null, monto: null, exento: true })], motivo: 'Resumen de IVA' },
          },
        }
      );
      const rawTables = ['public.facturas_proveedores', 'public.facturas_proveedores_lineas', 'public.facturas_proveedores_extracciones'];
      const raw = await snapshot(rawTables);
      await actAs(db, ADMIN, true);
      await save({ id: own.facturaId, content });
      expect(await snapshot(rawTables)).toBe(raw);
      const [row] = await revisions(own.facturaId);
      expect(row.contenido).toEqual(content);
      expect(Array.isArray(row.contenido.cabecera.correcciones.impuestos.valor)).toBe(true);
      expect(row.contenido.lineas[1].correcciones.descuentos.valor).toEqual([]);
    });

    const bad: Array<[string, () => unknown]> = [
      ['line descuentos as JSON text', () => withLine(JSON.stringify([desc()]))],
      ['line descuentos null', () => withLine(null)],
      ['line descuentos as object', () => withLine(desc())],
      ['line descuentos without motivo', () => contenido(s.extraccionId, sourceLines(s, { 1: { correcciones: { descuentos: { valor: [] } } } }))],
      ['line descuentos blank motivo', () => withLine([], '  ')],
      ['discount member not an object', () => withLine([5])],
      ['discount unknown member key', () => withLine([desc({ extra: 1 })])],
      ['discount missing member key', () => withLine([{ orden: 1, porcentaje: '5', monto: null, alcance: null }])],
      ['discount orden zero', () => withLine([desc({ orden: 0 })])],
      ['discount orden string', () => withLine([desc({ orden: '1' })])],
      ['discount orden fractional', () => withLine([desc({ orden: 1.5 })])],
      ['duplicate discount orden', () => withLine([desc(), desc({ porcentaje: '3' })])],
      ['discount porcentaje numeric', () => withLine([desc({ porcentaje: 5 })])],
      ['discount porcentaje too many decimals', () => withLine([desc({ porcentaje: '5.12345' })])],
      ['discount porcentaje too many integer digits', () => withLine([desc({ porcentaje: '123456' })])],
      ['discount monto malformed', () => withLine([desc({ monto: '1.2.3' })])],
      ['discount monto blank', () => withLine([desc({ monto: '' })])],
      ['discount monto overflow', () => withLine([desc({ monto: '123456789012' })])],
      ['discount alcance unknown', () => withLine([desc({ alcance: 'total' })])],
      ['discount incluidoEnPrecio text', () => withLine([desc({ incluidoEnPrecio: 'si' })])],
      ['21 discounts', () => withLine(Array.from({ length: 21 }, (_x, i) => desc({ orden: i + 1 })))],
      ['header descuentos as JSON text', () => withHeader('descuentos', '[]')],
      ['header impuestos as object', () => withHeader('impuestos', imp())],
      ['header impuestos null', () => withHeader('impuestos', null)],
      ['tax unknown member key', () => withHeader('impuestos', [imp({ base2: '1' })])],
      ['tax missing member key', () => withHeader('impuestos', [{ tasa: '16', base: '1', monto: '1' }])],
      ['tax exento text', () => withHeader('impuestos', [imp({ exento: 'no' })])],
      ['tax tasa numeric', () => withHeader('impuestos', [imp({ tasa: 16 })])],
      ['tax tasa too precise', () => withHeader('impuestos', [imp({ tasa: '16.00001' })])],
      ['tax base malformed', () => withHeader('impuestos', [imp({ base: 'x' })])],
      ['21 taxes', () => withHeader('impuestos', Array.from({ length: 21 }, () => imp()))],
      ['impuestos on a line', () => contenido(s.extraccionId, sourceLines(s, { 1: { correcciones: { impuestos: { valor: [imp()], motivo: 'm' } } } }))],
      ['array given to a scalar field', () => withHeader('total', ['1'])],
      ['array given to a line scalar field', () => contenido(s.extraccionId, sourceLines(s, { 1: { correcciones: { cantidad: { valor: [], motivo: 'm' } } } }))],
    ];

    it.each(bad)('rejects %s', async (_name, build) => {
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, extraccionId: s.extraccionId, content: build() }), '22023', 'payload_invalido');
    });
  });

  describe('source line coverage and stable line IDs', () => {
    it('rejects an extraction revision that omits a raw source line', async () => {
      const s = await scenario();
      const partial = contenido(s.extraccionId, sourceLines(s).slice(0, 2));
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, content: partial }), '22023', 'renglones de la extraccion');
      const none = contenido(s.extraccionId, []);
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, content: none }), '22023', 'renglones de la extraccion');
    });

    it('does not let a manual row stand in for an omitted source line', async () => {
      const s = await scenario();
      const swapped = contenido(s.extraccionId, [
        ...sourceLines(s).slice(0, 2),
        linea(null, { correcciones: { descripcion: { valor: 'Reemplazo', motivo: 'Manual' } } }),
      ]);
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, content: swapped }), '22023', 'renglones de la extraccion');
    });

    it('accepts every source line once plus motivated manual rows, repeated SKUs unmerged', async () => {
      const s = await scenario();
      const content = contenido(s.extraccionId, [
        ...sourceLines(s),
        linea(null, { correcciones: { descripcion: { valor: 'Flete', motivo: 'Cargo impreso a mano' } } }),
      ]);
      await save({ id: s.facturaId, content });
      const [row] = await revisions(s.facturaId);
      expect(row.contenido.lineas).toHaveLength(4);
      expect(row.contenido.lineas.filter((l: Json) => l.origen !== null)).toHaveLength(3);
    });

    it('requires the same lineaId for each source line in a later revision of the same extraction', async () => {
      const s = await scenario();
      await save({ id: s.facturaId, content: fullContent(s) });
      const regenerated = contenido(s.extraccionId, [1, 2, 3].map(n => linea(n)));
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 1, content: regenerated }), '22023', 'lineaId');
      const oneRegenerated = contenido(s.extraccionId, sourceLines(s, { 3: { lineaId: uuid() } }));
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 1, content: oneRegenerated }), '22023', 'lineaId');
      const swapped = contenido(s.extraccionId, sourceLines(s, { 1: { lineaId: s.lineIds[1] }, 2: { lineaId: s.lineIds[0] } }));
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 1, content: swapped }), '22023');
    });

    it('accepts a later revision that keeps IDs and may add or drop manual rows', async () => {
      const s = await scenario();
      await save({
        id: s.facturaId,
        content: contenido(s.extraccionId, [...sourceLines(s), linea(null, { correcciones: { descripcion: { valor: 'A', motivo: 'm' } } })]),
      });
      const res = await save({ id: s.facturaId, expectedRevision: 1, content: fullContent(s) });
      expect(res.revision).toBe(2);
    });
  });

  describe('source line IDs stay stable across the whole history of an extraction', () => {
    const manual = (label: string) =>
      contenido(null, [linea(null, { correcciones: { descripcion: { valor: label, motivo: 'Sin extraccion' } } })]);
    const fresh = (extraccionId: string) => contenido(extraccionId, [1, 2, 3].map(n => linea(n)));

    it('rejects reapplying A after a motivated detach with new source UUIDs, then accepts the original ones', async () => {
      const s = await scenario();
      await save({ id: s.facturaId, content: fullContent(s), motivo: null });
      await save({ id: s.facturaId, expectedRevision: 1, extraccionId: null, content: manual('Solo manual'), motivo: 'Descartar extraccion' });

      await expectRejected(
        as(ADMIN),
        () => save({ id: s.facturaId, expectedRevision: 2, content: fresh(s.extraccionId), motivo: 'Reaplicar extraccion' }),
        '22023',
        'lineaId'
      );
      expect(await revisions(s.facturaId)).toHaveLength(2);

      await actAs(db, ADMIN, true);
      const res = await save({ id: s.facturaId, expectedRevision: 2, content: fullContent(s), motivo: 'Reaplicar extraccion' });
      expect(res).toMatchObject({ revision: 3, replay: false });
      const rows = await revisions(s.facturaId);
      expect(rows[2].contenido.lineas.map((l: Json) => l.lineaId)).toEqual(s.lineIds);
    });

    it('rejects A / B / A and B / A / B resets, while each extraction keeps its own IDs', async () => {
      const s = await scenario();
      const second = await finalizeExtraction(s.facturaId, s.owner, 'completado');
      await save({ id: s.facturaId, content: fullContent(s), motivo: null });

      const secondContent = fresh(second);
      await save({ id: s.facturaId, expectedRevision: 1, extraccionId: second, content: secondContent, motivo: 'Aplicar otra extraccion' });

      await expectRejected(
        as(ADMIN),
        () => save({ id: s.facturaId, expectedRevision: 2, content: fresh(s.extraccionId), motivo: 'Volver a la primera' }),
        '22023',
        'lineaId'
      );
      await actAs(db, ADMIN, true);
      await save({ id: s.facturaId, expectedRevision: 2, content: fullContent(s), motivo: 'Volver a la primera' });

      await expectRejected(
        as(ADMIN),
        () => save({ id: s.facturaId, expectedRevision: 3, extraccionId: second, content: fresh(second), motivo: 'Volver a la segunda' }),
        '22023',
        'lineaId'
      );
      await actAs(db, ADMIN, true);
      const res = await save({ id: s.facturaId, expectedRevision: 3, extraccionId: second, content: secondContent, motivo: 'Volver a la segunda' });
      expect(res.revision).toBe(4);
      expect(await revisions(s.facturaId)).toHaveLength(4);
    });
  });

  describe('replacing the extraction requires a motive', () => {
    async function twoExtractions() {
      const s = await scenario();
      const second = await finalizeExtraction(s.facturaId, s.owner, 'completado');
      await save({ id: s.facturaId, content: fullContent(s), motivo: null });
      return { s, second };
    }

    it('rejects switching to another extraction without a motive and persists nothing', async () => {
      const { s, second } = await twoExtractions();
      const content = contenido(second, [1, 2, 3].map(n => linea(n)));
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 1, extraccionId: second, content, motivo: null }), '22023', 'cambio de extraccion');
    });

    it('accepts the switch with a motive, then new source IDs are allowed', async () => {
      const { s, second } = await twoExtractions();
      const content = contenido(second, [1, 2, 3].map(n => linea(n)));
      const res = await save({ id: s.facturaId, expectedRevision: 1, extraccionId: second, content, motivo: 'Aplicar nueva extraccion' });
      expect(res.revision).toBe(2);
      const rows = await revisions(s.facturaId);
      expect(rows[1].extraccion_id).toBe(second);
      expect(rows[1].motivo).toBe('Aplicar nueva extraccion');
    });

    it('requires a motive to detach the previous extraction', async () => {
      const { s } = await twoExtractions();
      const manual = contenido(null, [linea(null, { correcciones: { descripcion: { valor: 'Solo manual', motivo: 'Sin extraccion' } } })]);
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 1, extraccionId: null, content: manual, motivo: null }), '22023', 'cambio de extraccion');
      const res = await save({ id: s.facturaId, expectedRevision: 1, extraccionId: null, content: manual, motivo: 'Descartar extraccion' });
      expect(res.revision).toBe(2);
    });

    it('requires a motive to attach an extraction to a manual-only history', async () => {
      const s = await scenario();
      const manual = contenido(null, [linea(null, { correcciones: { descripcion: { valor: 'M', motivo: 'm' } } })]);
      await save({ id: s.facturaId, extraccionId: null, content: manual, motivo: null });
      await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 1, content: fullContent(s), motivo: null }), '22023', 'cambio de extraccion');
    });

    it('keeps the same extraction free of the motive requirement', async () => {
      const { s } = await twoExtractions();
      const res = await save({ id: s.facturaId, expectedRevision: 1, content: fullContent(s), motivo: null });
      expect(res.revision).toBe(2);
    });
  });

  describe('aprobar_revision_factura', () => {
    async function saved(content?: (s: Scenario) => Json) {
      const s = await scenario();
      const res = await save({ id: s.facturaId, content: content ? content(s) : fullContent(s) });
      return { s, fingerprint: String(res.fingerprint) };
    }

    it('records a human attestation and nothing else', async () => {
      const { s, fingerprint } = await saved();
      const before = await snapshot(TABLES.filter(t => !t.endsWith('revisiones')));
      const res = await approve(s.facturaId, 1, fingerprint);
      expect(res).toMatchObject({ factura_id: s.facturaId, revision: 1, fingerprint, replay: false });
      const [row] = await revisions(s.facturaId);
      expect(row.aprobado_por).toBe(ADMIN);
      expect(row.aprobado_en).toBeTruthy();
      expect(row.fingerprint).toBe(fingerprint);
      // No other table changed: attestation is not purchase, stock or catalog authority.
      expect(await snapshot(TABLES.filter(t => !t.endsWith('revisiones')))).toBe(before);
      const tables = await db.query<{ n: string }>(
        "select table_name as n from information_schema.tables where table_schema = 'public' and table_name like 'compras%'"
      );
      for (const t of tables.rows) {
        const c = await db.query<{ c: number }>(`select count(*)::int as c from public.${t.n}`);
        expect(c.rows[0].c).toBe(0);
      }
      await actAs(db, ADMIN, true);
    });

    it('replays an identical approval without changing the attestation', async () => {
      const { s, fingerprint } = await saved();
      await approve(s.facturaId, 1, fingerprint);
      const [first] = await revisions(s.facturaId);
      await actAs(db, ADMIN, true);
      const again = await approve(s.facturaId, 1, fingerprint);
      expect(again).toMatchObject({ revision: 1, replay: true });
      expect((await revisions(s.facturaId))[0]).toEqual(first);
    });

    it('requires owner, privileged role and a valid session', async () => {
      const { s, fingerprint } = await saved();
      const call = () => approve(s.facturaId, 1, fingerprint);
      await expectRejected(as(EMPLEADO), call, '42501');
      await expectRejected(as(INACTIVO), call, '42501');
      await expectRejected(as(ADMIN, false), call, '42501', 'no_autorizado');
      await expectRejected(as(OTHER_ADMIN), call, '42501', 'no_autorizado');
      await expectRejected(() => actAsAnon(db), call, '42501');
      await expectRejected(() => actAsServiceRole(db), call, '42501');
    });

    it('rejects an unknown invoice or revision', async () => {
      const { s, fingerprint } = await saved();
      await expectRejected(as(ADMIN), () => approve(uuid(), 1, fingerprint), 'P0002');
      await expectRejected(as(ADMIN), () => approve(s.facturaId, 2, fingerprint), 'P0002', 'revision_no_encontrada');
    });

    it('rejects a wrong or stale fingerprint', async () => {
      const { s, fingerprint } = await saved();
      await expectRejected(as(ADMIN), () => approve(s.facturaId, 1, 'f'.repeat(64)), 'PI409', 'fingerprint');
      await expectRejected(as(ADMIN), () => approve(s.facturaId, 1, fingerprint.toUpperCase()), 'PI409');
    });

    it('rejects approving a revision that is no longer the latest', async () => {
      const { s, fingerprint } = await saved();
      await save({ id: s.facturaId, expectedRevision: 1, content: fullContent(s) });
      await expectRejected(as(ADMIN), () => approve(s.facturaId, 1, fingerprint), 'PR409', 'revision_obsoleta');
    });

    it('rejects a stale invoice version argument', async () => {
      const { s, fingerprint } = await saved();
      await expectRejected(as(ADMIN), () => approve(s.facturaId, 1, fingerprint, 2), 'PV409', 'version_obsoleta');
    });

    it('is invalidated by a later manual save', async () => {
      const { s, fingerprint } = await saved();
      await manualSave(ADMIN, s.facturaId, 1, await currentDocumento(s.facturaId));
      await expectRejected(as(ADMIN), () => approve(s.facturaId, 1, fingerprint, 1), 'PV409', 'version_obsoleta');
      await expectRejected(as(ADMIN), () => approve(s.facturaId, 1, fingerprint, 2), 'PV409', 'version_obsoleta');
    });

    it('is invalidated by a later attachment change', async () => {
      const { s, fingerprint } = await saved();
      await reattachDocument(ADMIN, s.facturaId, 1);
      await expectRejected(as(ADMIN), () => approve(s.facturaId, 1, fingerprint, 2), 'PV409', 'version_obsoleta');
    });

    it('is invalidated when the document is detached', async () => {
      const { s, fingerprint } = await saved();
      await manualSave(ADMIN, s.facturaId, 1, null);
      await expectRejected(as(ADMIN), () => approve(s.facturaId, 1, fingerprint, 2), 'PV409', 'version_obsoleta');
    });

    const incomplete: Array<[string, (s: Scenario) => Json]> = [
      ['a pending association', s => contenido(s.extraccionId, sourceLines(s, { 2: { asociacion: { tipo: 'pendiente', codigoInterno: null, evidencia: null, motivo: null } } }))],
      ['document completeness not confirmed', s => contenido(s.extraccionId, sourceLines(s), { documentoCompletoConfirmado: false })],
      ['document completeness unknown', s => contenido(s.extraccionId, sourceLines(s), { documentoCompletoConfirmado: null })],
      ['price/IVA inclusion unknown', s => contenido(s.extraccionId, sourceLines(s), { precioIncluyeIva: null })],
      ['receipt unknown', s => contenido(s.extraccionId, sourceLines(s), { recepcionCompleta: null })],
      ['unconfirmed unit conversion', s => contenido(s.extraccionId, sourceLines(s, { 2: { factorConversion: null } }))],
    ];

    it.each(incomplete)('refuses to attest with %s', async (_name, build) => {
      const { s, fingerprint } = await saved(build);
      await expectRejected(as(ADMIN), () => approve(s.facturaId, 1, fingerprint), '22023', 'aprobacion_incompleta');
    });

    it('refuses to attest a revision with no lines', async () => {
      const facturaId = uuid();
      await seedInvoice(ADMIN, facturaId, false);
      await actAs(db, ADMIN, true);
      const res = await save({ id: facturaId, content: contenido(null, []) });
      await expectRejected(as(ADMIN), () => approve(facturaId, 1, String(res.fingerprint)), '22023', 'aprobacion_incompleta');
    });

    it('attests a manual-only revision with every decision explicit', async () => {
      const facturaId = uuid();
      await seedInvoice(ADMIN, facturaId, false);
      await actAs(db, ADMIN, true);
      const res = await save({
        id: facturaId,
        content: contenido(null, [linea(null, { correcciones: { descripcion: { valor: 'Manual', motivo: 'Sin documento' } } })]),
      });
      expect(await approve(facturaId, 1, String(res.fingerprint))).toMatchObject({ revision: 1, replay: false });
    });
  });

  describe('security metadata', () => {
    it('implementations are SECURITY DEFINER with a fixed empty search_path in an unexposed schema', async () => {
      await actAsOwner(db);
      const rows = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
        `select proname, prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'facturas_privado' and proname in ('guardar_revision_factura', 'aprobar_revision_factura')`
      );
      expect(rows.rows).toHaveLength(2);
      for (const r of rows.rows) {
        expect(r.prosecdef).toBe(true);
        expect(r.proconfig).toContain('search_path=""');
      }
      const wrappers = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
        `select proname, prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and proname in ('guardar_revision_factura', 'aprobar_revision_factura')`
      );
      expect(wrappers.rows).toHaveLength(2);
      for (const r of wrappers.rows) {
        expect(r.prosecdef).toBe(false);
        expect(r.proconfig).toContain('search_path=""');
      }
    });

    it('only authenticated can execute the wrappers; helpers are not callable by app roles', async () => {
      await actAsOwner(db);
      const exec = async (role: string, fn: string) =>
        (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as ok`, [role, fn])).rows[0].ok;
      const wrappers = [
        'public.guardar_revision_factura(uuid, integer, uuid, integer, uuid, jsonb, text)',
        'public.aprobar_revision_factura(uuid, integer, text, integer)',
      ];
      for (const fn of wrappers) {
        expect(await exec('authenticated', fn)).toBe(true);
        expect(await exec('anon', fn)).toBe(false);
        expect(await exec('service_role', fn)).toBe(false);
      }
      const helpers = await db.query<{ sig: string }>(
        `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'facturas_privado'
            and (proname like '%revision%' or proname like '%contenido%' or proname like '%correcciones%')`
      );
      expect(helpers.rows.length).toBeGreaterThanOrEqual(3);
      for (const { sig } of helpers.rows) {
        expect(await exec('anon', sig)).toBe(false);
        expect(await exec('service_role', sig)).toBe(false);
      }
    });
  });
});
