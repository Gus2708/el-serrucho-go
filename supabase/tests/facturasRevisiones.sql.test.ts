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

// `withPvp` false stops at the revisions migration so a test can apply the PVP migration later in the same engine;
// `withFeedback` false keeps the matching-feedback migration out so a test can apply it later to a warmed session.
async function initTestDb(withPvp = true, withFeedback = true): Promise<PGlite> {
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
  if (withPvp) await database.exec(migrationSql('_facturas_revisiones_pvp.sql'));
  if (withPvp) await database.exec(migrationSql('_factura_revision_barcode_escaneado.sql'));
  if (withPvp && withFeedback) await database.exec(migrationSql('_factura_matching_feedback.sql'));
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
  outcome: 'completado' | 'fallido',
  result: Json = extractionResult()
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
    outcome === 'completado' ? JSON.stringify(result) : null,
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
    it('persists an optional captured physical barcode without changing supplier code', async () => {
      const s = await scenario();
      const content = fullContent(s) as any;
      content.lineas[0].codigoBarras.codigoEscaneado = '00123-A';
      await save({ id: s.facturaId, content });
      const stored = await db.query<{ contenido: Json }>(
        'select contenido from public.facturas_proveedores_revisiones where factura_id = $1', [s.facturaId]
      );
      expect((stored.rows[0].contenido.lineas as any[])[0].codigoBarras).toEqual({ usarCodigoFactura: true, codigoEscaneado: '00123-A' });
      expect((stored.rows[0].contenido.lineas as any[])[0].correcciones.codigoProveedor).toBeUndefined();
    });

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
      ['captured barcode numeric', mutate(c => { c.lineas[0].codigoBarras.codigoEscaneado = 123; })],
      ['captured barcode blank', mutate(c => { c.lineas[0].codigoBarras.codigoEscaneado = ' '; })],
      ['captured barcode control character', mutate(c => { c.lineas[0].codigoBarras.codigoEscaneado = 'ABC\n123'; })],
      ['captured barcode padded', mutate(c => { c.lineas[0].codigoBarras.codigoEscaneado = ' 123'; })],
      ['captured barcode too long', mutate(c => { c.lineas[0].codigoBarras.codigoEscaneado = 'A'.repeat(201); })],
      ['captured barcode unknown key', mutate(c => { c.lineas[0].codigoBarras.codigoEscaneado = '001-A'; c.lineas[0].codigoBarras.other = true; })],
      ['usarCodigoFactura string', mutate(c => { c.lineas[0].codigoBarras = { usarCodigoFactura: 'si' }; })],
      ['codigoBarras null', mutate(c => { c.lineas[0].codigoBarras = null; })],
      ['tipoDocumento unknown value', mutate(c => { c.cabecera.tipoDocumento = 'otro'; })],
      ['tipoDocumento null instead of omitted', mutate(c => { c.cabecera.tipoDocumento = null; })],
      ['tipoDocumento empty', mutate(c => { c.cabecera.tipoDocumento = ''; })],
      ['tipoDocumento wrong case', mutate(c => { c.cabecera.tipoDocumento = 'Factura'; })],
      ['tipoDocumento number', mutate(c => { c.cabecera.tipoDocumento = 1; })],
      ['tipoDocumento valid plus unknown header key', mutate(c => { c.cabecera.tipoDocumento = 'factura'; c.cabecera.otro = 1; })],
      ['precioVenta comma decimal', mutate(c => { c.lineas[0].precioVenta = '12,5'; })],
      ['precioVenta zero', mutate(c => { c.lineas[0].precioVenta = '0'; })],
      ['precioVenta zero with decimals', mutate(c => { c.lineas[0].precioVenta = '0.00'; })],
      ['precioVenta negative', mutate(c => { c.lineas[0].precioVenta = '-1'; })],
      ['precioVenta blank', mutate(c => { c.lineas[0].precioVenta = ''; })],
      ['precioVenta padded', mutate(c => { c.lineas[0].precioVenta = ' 20'; })],
      ['precioVenta null instead of omitted', mutate(c => { c.lineas[0].precioVenta = null; })],
      ['precioVenta number', mutate(c => { c.lineas[0].precioVenta = 20; })],
      ['precioVenta 13 integer digits', mutate(c => { c.lineas[0].precioVenta = '1234567890123'; })],
      ['precioVenta 9 decimals', mutate(c => { c.lineas[0].precioVenta = '1.123456789'; })],
      ['precioVenta exponent', mutate(c => { c.lineas[0].precioVenta = '1e3'; })],
      ['precioVenta valid plus unknown line key', mutate(c => { c.lineas[0].precioVenta = '20'; c.lineas[0].precio = '1'; })],
      ['manual line whose only content is a price (no motive)', mutate(c => { c.lineas.push({ ...linea(null), precioVenta: '5' }); })],
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

  describe('optional PVP keys: tipoDocumento and precioVenta', () => {
    const conPvp = (s: Scenario, tipoDocumento: string, precios: Array<string | undefined>): Json => {
      const base = fullContent(s) as { cabecera: Json; lineas: Json[] };
      return {
        ...base,
        cabecera: { ...base.cabecera, tipoDocumento },
        lineas: base.lineas.map((l, i) => (precios[i] === undefined ? l : { ...l, precioVenta: precios[i] })),
      };
    };

    it.each([
      ['factura', ['20.5', '0.01', undefined]],
      ['nota_entrega', ['123456789012', '12.12345678', '007']],
    ] as const)('stores %s with valid prices exactly and fingerprints the jsonb text', async (tipo, precios) => {
      const s = await scenario();
      const content = conPvp(s, tipo, [...precios]);
      const res = await save({ id: s.facturaId, content });
      expect(res).toMatchObject({ revision: 1, replay: false });
      const [row] = await revisions(s.facturaId);
      expect(row.contenido).toEqual(content);
      const expected = await db.query<{ f: string }>(
        "select encode(sha256(convert_to(contenido::text, 'UTF8')), 'hex') as f from public.facturas_proveedores_revisiones where factura_id = $1",
        [s.facturaId]
      );
      expect(expected.rows[0].f).toBe(res.fingerprint);
      expect(await approve(s.facturaId, 1, String(res.fingerprint))).toMatchObject({ revision: 1, replay: false });
    });

    it('content without the keys keeps the exact fingerprint it had before the keys existed', async () => {
      const s = await scenario();
      const legacy = fullContent(s);
      const first = await save({ id: s.facturaId, content: legacy });
      const second = await save({ id: s.facturaId, expectedRevision: 1, content: conPvp(s, 'factura', ['20', undefined, undefined]) });
      const third = await save({ id: s.facturaId, expectedRevision: 2, content: legacy });
      expect(second.fingerprint).not.toBe(first.fingerprint);
      expect(third.fingerprint).toBe(first.fingerprint);
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

    it('keeps a single non-executable content validator: no base or wrapper copy is left behind', async () => {
      await actAsOwner(db);
      const rows = await db.query<{ sig: string; proacl: string | null; proconfig: string[] | null }>(
        `select p.oid::regprocedure::text as sig, p.proacl::text as proacl, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'facturas_privado' and proname like 'validar_contenido_revision%'`
      );
      expect(rows.rows.map(r => r.sig)).toEqual(['facturas_privado.validar_contenido_revision(jsonb,uuid,jsonb)']);
      expect(rows.rows[0].proconfig).toContain('search_path=""');
      expect(rows.rows[0].proacl ?? '').not.toMatch(/(^\{|,)=X/);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const r = await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as ok`, [role, rows.rows[0].sig]);
        expect(r.rows[0].ok).toBe(false);
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

describe('facturas_proveedores_revisiones: PVP migration applied to a warmed session', () => {
  beforeAll(async () => {
    db = await initTestDb(false);
    await addUser(db, ADMIN, 'admin');
  });

  afterAll(async () => {
    await db.close();
  });

  const validatorOid = async (): Promise<string> => {
    await actAsOwner(db);
    const r = await db.query<{ oid: string }>("select 'facturas_privado.validar_contenido_revision(jsonb,uuid,jsonb)'::regprocedure::oid::text as oid");
    return r.rows[0].oid;
  };

  it('keeps stored revisions, fingerprints and warmed save/approve calls; accepts the new keys only afterwards', async () => {
    const s = await scenario();
    const legacy = fullContent(s) as { cabecera: Json; lineas: Json[] };
    const withKeys: Json = {
      ...legacy,
      cabecera: { ...legacy.cabecera, tipoDocumento: 'factura' },
      lineas: legacy.lineas.map((l, i) => (i === 0 ? { ...l, precioVenta: '20' } : l)),
    };
    const key = uuid();

    // Warm the public save and approve RPCs on the old validator.
    const first = await save({ id: s.facturaId, key, content: legacy });
    expect(first).toMatchObject({ revision: 1, replay: false });
    expect(await approve(s.facturaId, 1, String(first.fingerprint))).toMatchObject({ revision: 1, replay: false });
    // The old validator refuses the new keys and leaves every table untouched.
    await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 1, content: withKeys }), '22023', 'payload_invalido');
    const rowsBefore = await revisions(s.facturaId);
    const oidBefore = await validatorOid();

    await actAsOwner(db);
    await db.exec(migrationSql('_facturas_revisiones_pvp.sql'));
    await actAs(db, ADMIN, true);

    // Same function identity, stored revision byte-identical, same-key replay returns the old fingerprint.
    expect(await validatorOid()).toBe(oidBefore);
    expect(await revisions(s.facturaId)).toEqual(rowsBefore);
    expect(await save({ id: s.facturaId, key, content: legacy })).toMatchObject({ revision: 1, replay: true, fingerprint: first.fingerprint });

    // The very same session (no reconnect) now accepts the new keys through the warmed RPCs.
    const second = await save({ id: s.facturaId, expectedRevision: 1, content: withKeys });
    expect(second).toMatchObject({ revision: 2, replay: false });
    const [, row2] = await revisions(s.facturaId);
    expect(row2.contenido).toEqual(withKeys);
    expect(await approve(s.facturaId, 2, String(second.fingerprint))).toMatchObject({ revision: 2, replay: false });

    // Everything else is still refused, with the tables untouched.
    const broken = { ...withKeys, cabecera: { ...(withKeys.cabecera as Json), otro: 1 } };
    await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 2, content: broken }), '22023', 'payload_invalido');
  });
});

// ── T8.5a: saved human decisions are the search-feedback audit trail ────────────────────────────────────────
// The catalog fixture below MODELS productos/productos_view (their production bodies are not in this repository):
// a descriptive placeholder flag and negative stock are the only properties the contract relies on.
const CATALOG_FIXTURE = `
  create table public.productos (codigo_interno text primary key, descripcion text not null, existencia numeric);
  create view public.productos_view as
    select p.*, (btrim(p.descripcion) ~ '^[.]+$') as es_placeholder from public.productos p;
  grant select on public.productos, public.productos_view to authenticated;
  insert into public.productos (codigo_interno, descripcion, existencia) values
    ('SKU-A', 'Anclaje A', 1), ('SKU-B', 'Anclaje B', -3), ('SKU-C', 'Anclaje C', 0), ('SKU-NEW', 'Producto recien creado', 0),
    ('00123-A', 'Tornillo con ceros', 5), ('SKU-DEL', 'Producto por borrar', 0), ('PLACEHOLDER', '..', 0);
`;

type PrintedLine = [codigo: string | null, descripcion: string | null, unidad: string | null];
const DEFAULT_PRINTED: PrintedLine[] = [['00123', 'Articulo 1', 'UND'], ['00123', 'Articulo 2', 'UND'], ['AB-9', 'Articulo 3', 'UND']];
const FEEDBACK_TABLES = [...TABLES, 'public.productos'];

function printedResult(lines: PrintedLine[]): Json {
  return {
    ...extractionResult(),
    lineas: lines.map(([codigoProveedor, descripcion, unidad], i) => ({
      numeroLinea: i + 1, pagina: 1, codigoProveedor, descripcion, cantidad: '1', unidad,
      precioUnitario: '1', descuentos: [], tasaIva: '16', total: null, incertidumbre: null,
    })),
  };
}

interface FeedbackScenario {
  facturaId: string;
  extraccionId: string;
  owner: string;
  lineIds: string[];
}

let supplierCounter = 0;
const newSupplier = (): string => `SUP-${(supplierCounter += 1)}`;

// Each scenario is a real invoice with a real completed extraction; `supplier` is the invoice's own proveedor_codigo.
async function feedbackScenario(opts: { owner?: string; supplier?: string | null; lines?: PrintedLine[] } = {}): Promise<FeedbackScenario> {
  const owner = opts.owner ?? ADMIN;
  const lines = opts.lines ?? DEFAULT_PRINTED;
  const facturaId = uuid();
  await seedInvoice(owner, facturaId);
  if (opts.supplier !== undefined) {
    await actAsOwner(db);
    await db.query('update public.facturas_proveedores set proveedor_codigo = $1 where id = $2', [opts.supplier, facturaId]);
  }
  const extraccionId = await finalizeExtraction(facturaId, owner, 'completado', printedResult(lines));
  return { facturaId, extraccionId, owner, lineIds: lines.map(() => uuid()) };
}

// 'pendiente' | 'nuevo' (producto_nuevo) | a catalog SKU (confirmado).
function decision(value: string): Json {
  if (value === 'pendiente') return { tipo: 'pendiente', codigoInterno: null, evidencia: null, motivo: null };
  if (value === 'nuevo') return { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'Producto nuevo' };
  return { tipo: 'confirmado', codigoInterno: value, evidencia: 'sugerencia', motivo: null };
}

async function saveDecisions(
  s: FeedbackScenario,
  decisions: string[],
  opts: { expectedRevision?: number; key?: string } = {}
): Promise<Json> {
  const lineas = decisions.map((value, i) => linea(i + 1, { lineaId: s.lineIds[i], asociacion: decision(value) }));
  await actAs(db, s.owner, true);
  return save({ id: s.facturaId, expectedRevision: opts.expectedRevision ?? 0, key: opts.key, content: contenido(s.extraccionId, lineas) });
}

interface FeedbackDecision {
  lineIndex: number;
  decision: 'confirmado' | 'producto_nuevo';
  codigoInterno: string | null;
}

async function feedback(s: { facturaId: string; extraccionId: string }, version = 1, user = ADMIN, sessionValid = true): Promise<FeedbackDecision[]> {
  await actAs(db, user, sessionValid);
  const r = await db.query<{ r: { decisiones: FeedbackDecision[] } }>(
    'select public.buscar_feedback_productos_factura($1::uuid, $2::uuid, $3::int) as r',
    [s.facturaId, s.extraccionId, version]
  );
  return r.rows[0].r.decisiones;
}

const confirmed = (lineIndex: number, codigoInterno: string): FeedbackDecision => ({ lineIndex, decision: 'confirmado', codigoInterno });
const brandNew = (lineIndex: number): FeedbackDecision => ({ lineIndex, decision: 'producto_nuevo', codigoInterno: null });

describe('buscar_feedback_productos_factura: saved human decisions as search feedback', () => {
  beforeAll(async () => {
    db = await initTestDb();
    await addUser(db, ADMIN, 'admin');
    await addUser(db, OTHER_ADMIN, 'admin');
    await addUser(db, SUPER, 'superempleado');
    await addUser(db, EMPLEADO, 'empleado');
    await addUser(db, INACTIVO, 'admin', false);
    await db.exec(CATALOG_FIXTURE);
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns no decisions for an invoice whose supplier never had a saved review', async () => {
    const s = await feedbackScenario({ supplier: newSupplier() });
    expect(await feedback(s)).toEqual([]);
  });

  it('turns a saved confirmation and a saved new-product decision into hints for the same printed lines', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['SKU-A', 'nuevo', 'pendiente']);
    const later = await feedbackScenario({ supplier });

    expect(await feedback(later)).toEqual([confirmed(0, 'SKU-A'), brandNew(1)]);
    // The reviewed invoice itself benefits from its own current saved decisions.
    expect(await feedback(first)).toEqual([confirmed(0, 'SKU-A'), brandNew(1)]);
  });

  it('exposes only line index, decision and SKU: no invoice, user, description or count', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['SKU-A', 'SKU-A', 'SKU-A']);
    const later = await feedbackScenario({ supplier });
    const decisions = await feedback(later);
    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) expect(Object.keys(d).sort()).toEqual(['codigoInterno', 'decision', 'lineIndex']);
    const raw = JSON.stringify(decisions);
    for (const secret of [first.facturaId, ADMIN, 'Articulo', 'PROV']) expect(raw).not.toContain(secret);
  });

  it('lets a corrected selection B replace the saved A and never keeps reinforcing the rejected one', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['SKU-A', 'pendiente', 'pendiente']);
    await saveDecisions(first, ['SKU-B', 'pendiente', 'pendiente'], { expectedRevision: 1 });
    const later = await feedbackScenario({ supplier });
    expect(await feedback(later)).toEqual([confirmed(0, 'SKU-B')]);
  });

  it('lets the latest saved decision across invoices win, deterministically', async () => {
    const supplier = newSupplier();
    const a = await feedbackScenario({ supplier });
    const b = await feedbackScenario({ supplier });
    const target = await feedbackScenario({ supplier });
    await saveDecisions(a, ['SKU-A', 'pendiente', 'pendiente']);
    await saveDecisions(b, ['SKU-B', 'pendiente', 'pendiente']);
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-B')]);
    await saveDecisions(a, ['SKU-A', 'pendiente', 'pendiente'], { expectedRevision: 1 });
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-A')]);
    expect(await feedback(target)).toEqual(await feedback(target));
  });

  it('turns a later new-product decision into a new hint instead of the previously confirmed SKU', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['SKU-A', 'pendiente', 'pendiente']);
    await saveDecisions(first, ['nuevo', 'pendiente', 'pendiente'], { expectedRevision: 1 });
    const later = await feedbackScenario({ supplier });
    expect(await feedback(later)).toEqual([brandNew(0)]);
  });

  it('makes a genuinely new product reusable positive feedback once a later save confirms its registered SKU', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['nuevo', 'pendiente', 'pendiente']);
    const target = await feedbackScenario({ supplier });
    expect(await feedback(target)).toEqual([brandNew(0)]);
    const second = await feedbackScenario({ supplier });
    await saveDecisions(second, ['SKU-NEW', 'pendiente', 'pendiente']);
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-NEW')]);
  });

  it('does not revive an older confirmation after the line is reset to pending', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['SKU-A', 'SKU-B', 'pendiente']);
    await saveDecisions(first, ['pendiente', 'SKU-B', 'pendiente'], { expectedRevision: 1 });
    const later = await feedbackScenario({ supplier });
    expect(await feedback(later)).toEqual([confirmed(1, 'SKU-B')]);
  });

  it('does not revive an older confirmation after a rejected save or after the extraction is detached', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['SKU-A', 'pendiente', 'pendiente']);
    const target = await feedbackScenario({ supplier });
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-A')]);

    // A rejected save (stale revision) is not feedback and changes nothing.
    await expect(saveDecisions(first, ['SKU-B', 'pendiente', 'pendiente'], { expectedRevision: 0 })).rejects.toMatchObject({ code: 'PR409' });
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-A')]);

    await actAs(db, ADMIN, true);
    await save({ id: first.facturaId, expectedRevision: 1, content: contenido(null, []), extraccionId: null, motivo: 'Desvincular extraccion' });
    expect(await feedback(target)).toEqual([]);
  });

  it('counts a replayed save and a repeated confirmation on another invoice once: no voting weight', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    const key = uuid();
    expect(await saveDecisions(first, ['SKU-A', 'pendiente', 'pendiente'], { key })).toMatchObject({ revision: 1, replay: false });
    expect(await saveDecisions(first, ['SKU-A', 'pendiente', 'pendiente'], { key })).toMatchObject({ revision: 1, replay: true });
    expect(await revisions(first.facturaId)).toHaveLength(1);
    const target = await feedbackScenario({ supplier });
    const once = await feedback(target);
    const other = await feedbackScenario({ supplier });
    await saveDecisions(other, ['SKU-A', 'pendiente', 'pendiente']);
    expect(await feedback(target)).toEqual(once);
    expect(once).toEqual([confirmed(0, 'SKU-A')]);
  });

  it('never learns across owners or suppliers', async () => {
    const supplier = newSupplier();
    const foreignOwner = await feedbackScenario({ owner: OTHER_ADMIN, supplier });
    await saveDecisions(foreignOwner, ['SKU-B', 'SKU-B', 'SKU-B']);
    const otherSupplier = await feedbackScenario({ supplier: newSupplier() });
    await saveDecisions(otherSupplier, ['SKU-C', 'SKU-C', 'SKU-C']);

    const mine = await feedbackScenario({ supplier });
    expect(await feedback(mine)).toEqual([]);
    // And the other owner never sees mine.
    await saveDecisions(mine, ['SKU-A', 'pendiente', 'pendiente']);
    expect(await feedback(foreignOwner, 1, OTHER_ADMIN)).toEqual([confirmed(0, 'SKU-B'), confirmed(1, 'SKU-B'), confirmed(2, 'SKU-B')]);
    expect(await feedback(mine)).toEqual([confirmed(0, 'SKU-A')]);
  });

  it('keeps leading zeros, punctuation, model and unit apart and normalizes only whitespace and case', async () => {
    const supplier = newSupplier();
    const history = await feedbackScenario({ supplier, lines: [['00123', 'Tornillo 1/4', 'UND']] });
    await saveDecisions(history, ['SKU-A']);
    const target = await feedbackScenario({
      supplier,
      lines: [
        ['123', 'Tornillo 1/4', 'UND'],
        ['00123', 'Tornillo 1/4', 'UND'],
        ['00123', 'Tornillo 3/8', 'UND'],
        ['00123', 'Tornillo 1/4', 'CAJA'],
        ['  00123 ', '  tornillo   1/4 ', 'und'],
        ['0-0123', 'Tornillo 1/4', 'UND'],
        ['00123', 'Tornillo 1/4.', 'UND'],
      ],
    });
    expect(await feedback(target)).toEqual([confirmed(1, 'SKU-A'), confirmed(4, 'SKU-A')]);
  });

  it('learns from the raw printed line, not from corrected values, and ignores manual lines', async () => {
    const supplier = newSupplier();
    const history = await feedbackScenario({ supplier });
    const lineas = [
      linea(1, { lineaId: history.lineIds[0], asociacion: decision('SKU-A'), correcciones: { codigoProveedor: { valor: 'ZZZ-OTRO', motivo: 'Lectura corregida' }, descripcion: { valor: 'Otra cosa', motivo: 'Lectura corregida' } } }),
      linea(2, { lineaId: history.lineIds[1], asociacion: decision('pendiente') }),
      linea(3, { lineaId: history.lineIds[2], asociacion: decision('pendiente') }),
      linea(null, { asociacion: decision('SKU-B'), correcciones: { descripcion: { valor: 'Articulo 2', motivo: 'Manual' }, codigoProveedor: { valor: '00123', motivo: 'Manual' }, unidad: { valor: 'UND', motivo: 'Manual' } } }),
    ];
    await actAs(db, ADMIN, true);
    await save({ id: history.facturaId, content: contenido(history.extraccionId, lineas) });
    const target = await feedbackScenario({ supplier });
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-A')]);
  });

  it('only returns SKUs that exist now and are not placeholders, and never falls back to an older SKU', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['SKU-A', 'pendiente', 'pendiente']);
    const target = await feedbackScenario({ supplier });
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-A')]);

    const missing = await feedbackScenario({ supplier });
    await saveDecisions(missing, ['NO-EXISTE', 'pendiente', 'pendiente']);
    expect(await feedback(target)).toEqual([]);

    const placeholder = await feedbackScenario({ supplier });
    await saveDecisions(placeholder, ['PLACEHOLDER', 'pendiente', 'pendiente']);
    expect(await feedback(target)).toEqual([]);

    const negative = await feedbackScenario({ supplier });
    await saveDecisions(negative, ['SKU-B', 'pendiente', 'pendiente']);
    // SKU-B has negative stock: stock is never a filter.
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-B')]);
  });

  it('returns nothing for a confirmed SKU deleted from the catalog since it was saved', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['SKU-DEL', 'pendiente', 'pendiente']);
    const target = await feedbackScenario({ supplier });
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-DEL')]);
    await actAsOwner(db);
    await db.exec("delete from public.productos where codigo_interno = 'SKU-DEL'");
    expect(await feedback(target)).toEqual([]);
    await actAsOwner(db);
    await db.exec("insert into public.productos (codigo_interno, descripcion, existencia) values ('SKU-DEL', 'Producto por borrar', 0)");
  });

  it('preserves the literal SKU, leading zeros included', async () => {
    const supplier = newSupplier();
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['00123-A', 'pendiente', 'pendiente']);
    const target = await feedbackScenario({ supplier });
    expect(await feedback(target)).toEqual([confirmed(0, '00123-A')]);
  });

  it.each([
    ['without a supplier code', null],
    ['with a blank supplier code', '   '],
  ])('learns nothing for an invoice %s, not even from other unknown-supplier invoices', async (_name, supplier) => {
    const first = await feedbackScenario({ supplier });
    await saveDecisions(first, ['SKU-A', 'SKU-A', 'SKU-A']);
    const target = await feedbackScenario({ supplier });
    expect(await feedback(target)).toEqual([]);
    expect(await feedback(first)).toEqual([]);
  });

  it('ignores a historical revision whose invoice version or document changed after it was saved', async () => {
    const supplier = newSupplier();
    const stale = await feedbackScenario({ supplier });
    await saveDecisions(stale, ['SKU-A', 'pendiente', 'pendiente']);
    const target = await feedbackScenario({ supplier });
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-A')]);
    await reattachDocument(ADMIN, stale.facturaId, 1);
    expect(await feedback(target)).toEqual([]);
  });

  it('maps repeated printed lines to each original index and is stable between calls', async () => {
    const supplier = newSupplier();
    const history = await feedbackScenario({ supplier, lines: [['R-1', 'Repetido', 'UND']] });
    await saveDecisions(history, ['SKU-A']);
    const target = await feedbackScenario({ supplier, lines: [['R-1', 'Repetido', 'UND'], ['R-2', 'Otro', 'UND'], ['R-1', 'Repetido', 'UND']] });
    const first = await feedback(target);
    expect(first).toEqual([confirmed(0, 'SKU-A'), confirmed(2, 'SKU-A')]);
    expect(await feedback(target)).toEqual(first);
  });

  it('breaks a conflict between repeated saved lines of one revision by the highest line id', async () => {
    const supplier = newSupplier();
    const history = await feedbackScenario({ supplier, lines: [['R-1', 'Repetido', 'UND'], ['R-1', 'Repetido', 'UND']] });
    await saveDecisions(history, ['SKU-A', 'SKU-B']);
    const target = await feedbackScenario({ supplier, lines: [['R-1', 'Repetido', 'UND']] });
    expect(history.lineIds[1] > history.lineIds[0]).toBe(true);
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-B')]);
  });

  it('considers only the first 200 extraction lines', async () => {
    const supplier = newSupplier();
    const history = await feedbackScenario({ supplier, lines: [['BULK', 'Linea repetida', 'UND']] });
    await saveDecisions(history, ['SKU-A']);
    const target = await feedbackScenario({ supplier, lines: Array.from({ length: 205 }, (): PrintedLine => ['BULK', 'Linea repetida', 'UND']) });
    const decisions = await feedback(target);
    expect(decisions).toHaveLength(200);
    expect(decisions[0]).toEqual(confirmed(0, 'SKU-A'));
    expect(decisions[199]).toEqual(confirmed(199, 'SKU-A'));
  });

  it('does not reuse a decision outside the 200 most recent eligible invoices', async () => {
    const supplier = newSupplier();
    const original = await feedbackScenario({ supplier, lines: [['OLD', 'Old context', 'UND']] });
    await saveDecisions(original, ['SKU-A']);
    const target = await feedbackScenario({ supplier, lines: [['OLD', 'Old context', 'UND']] });
    for (let i = 0; i < 199; i += 1) {
      const newer = await feedbackScenario({ supplier, lines: [[`OTHER-${i}`, 'Different context', 'UND']] });
      await saveDecisions(newer, ['SKU-B']);
    }
    expect(await feedback(target)).toEqual([confirmed(0, 'SKU-A')]);
    const newest = await feedbackScenario({ supplier, lines: [['LAST', 'Different context', 'UND']] });
    await saveDecisions(newest, ['SKU-B']);
    expect(await feedback(target)).toEqual([]);
  });

  describe('source and caller guards', () => {
    it.each([
      ['an expected version that is not the current one', (s: FeedbackScenario) => feedback(s, 2), 'PV409'],
      ['an unknown extraction', (s: FeedbackScenario) => feedback({ ...s, extraccionId: uuid() }, 1), 'P0002'],
      ['a non-positive version', (s: FeedbackScenario) => feedback(s, 0), '22023'],
    ])('rejects %s without touching any table', async (_name, call, code) => {
      const s = await feedbackScenario({ supplier: newSupplier() });
      await saveDecisions(s, ['SKU-A', 'pendiente', 'pendiente']);
      const before = await snapshot(FEEDBACK_TABLES);
      await expect(call(s)).rejects.toMatchObject({ code });
      expect(await snapshot(FEEDBACK_TABLES)).toBe(before);
    });

    it('rejects an extraction of another invoice, a failed extraction and a stale attachment', async () => {
      const supplier = newSupplier();
      const s = await feedbackScenario({ supplier });
      const foreign = await feedbackScenario({ supplier });
      await expect(feedback({ facturaId: s.facturaId, extraccionId: foreign.extraccionId })).rejects.toMatchObject({ code: 'P0002' });

      const failedInvoice = uuid();
      await seedInvoice(ADMIN, failedInvoice);
      const failedExtraction = await finalizeExtraction(failedInvoice, ADMIN, 'fallido');
      await expect(feedback({ facturaId: failedInvoice, extraccionId: failedExtraction })).rejects.toMatchObject({ code: '22023' });

      await reattachDocument(ADMIN, s.facturaId, 1);
      await expect(feedback(s, 1)).rejects.toMatchObject({ code: 'PV409' });
      await expect(feedback(s, 2)).rejects.toMatchObject({ code: 'PV409' });
    });

    it("hides another owner's invoice exactly like a missing one", async () => {
      const mine = await feedbackScenario({ supplier: newSupplier() });
      await expect(feedback(mine, 1, OTHER_ADMIN)).rejects.toMatchObject({ code: 'P0002', message: 'fuente_no_disponible' });
      await expect(feedback({ facturaId: uuid(), extraccionId: uuid() })).rejects.toMatchObject({ code: 'P0002', message: 'fuente_no_disponible' });
    });

    it.each([
      ['an employee', () => feedback({ facturaId: uuid(), extraccionId: uuid() }, 1, EMPLEADO)],
      ['an inactive admin', () => feedback({ facturaId: uuid(), extraccionId: uuid() }, 1, INACTIVO)],
      ['a user with an invalid session', () => feedback({ facturaId: uuid(), extraccionId: uuid() }, 1, ADMIN, false)],
    ])('refuses %s with the stable authorization error and no writes', async (_name, call) => {
      const before = await snapshot(FEEDBACK_TABLES);
      await expect(call()).rejects.toMatchObject({ code: '42501', message: 'no_autorizado' });
      expect(await snapshot(FEEDBACK_TABLES)).toBe(before);
    });

    it('lets a superempleado read their own feedback', async () => {
      const supplier = newSupplier();
      const s = await feedbackScenario({ owner: SUPER, supplier });
      await saveDecisions(s, ['SKU-A', 'pendiente', 'pendiente']);
      expect(await feedback(s, 1, SUPER)).toEqual([confirmed(0, 'SKU-A')]);
    });

    it('is not callable by anon or service_role', async () => {
      const s = await feedbackScenario({ supplier: newSupplier() });
      await actAsAnon(db);
      await expect(db.query('select public.buscar_feedback_productos_factura($1::uuid, $2::uuid, 1)', [s.facturaId, s.extraccionId])).rejects.toMatchObject({ code: '42501' });
      await actAsServiceRole(db);
      await expect(db.query('select public.buscar_feedback_productos_factura($1::uuid, $2::uuid, 1)', [s.facturaId, s.extraccionId])).rejects.toMatchObject({ code: '42501' });
    });

    it('never writes: tables, catalog and history are byte-identical after successful reads', async () => {
      const supplier = newSupplier();
      const s = await feedbackScenario({ supplier });
      await saveDecisions(s, ['SKU-A', 'nuevo', 'pendiente']);
      const before = await snapshot(FEEDBACK_TABLES);
      expect(await feedback(s)).toHaveLength(2);
      expect(await snapshot(FEEDBACK_TABLES)).toBe(before);
    });
  });

  describe('security metadata', () => {
    it('is an invoker, stable, fixed-empty-search_path function executable by authenticated only', async () => {
      await actAsOwner(db);
      const sig = 'public.buscar_feedback_productos_factura(uuid, uuid, integer)';
      const meta = await db.query<{ prosecdef: boolean; provolatile: string; proconfig: string[] | null; proacl: string | null }>(
        'select prosecdef, provolatile, proconfig, proacl::text from pg_proc where oid = $1::regprocedure',
        [sig]
      );
      expect(meta.rows).toHaveLength(1);
      expect(meta.rows[0].prosecdef).toBe(false);
      expect(meta.rows[0].provolatile).toBe('s');
      expect(meta.rows[0].proconfig).toContain('search_path=""');
      expect(meta.rows[0].proacl ?? '').not.toMatch(/(^\{|,)=X/);
      const exec = async (role: string) => (await db.query<{ ok: boolean }>("select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as ok", [role, sig])).rows[0].ok;
      expect(await exec('authenticated')).toBe(true);
      expect(await exec('anon')).toBe(false);
      expect(await exec('service_role')).toBe(false);
    });

    it('adds no table, trigger or private function: the revision history stays the only ledger', async () => {
      await actAsOwner(db);
      const objects = await db.query<{ n: string }>(
        `select p.oid::regprocedure::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname in ('public', 'facturas_privado') and p.proname like '%feedback%'`
      );
      expect(objects.rows.map(r => r.n)).toEqual(['buscar_feedback_productos_factura(uuid,uuid,integer)']);
      const tables = await db.query<{ n: string }>("select tablename as n from pg_tables where schemaname = 'public' and tablename like '%feedback%'");
      expect(tables.rows).toEqual([]);
    });
  });
});

describe('buscar_feedback_productos_factura: migration applied to a warmed session', () => {
  beforeAll(async () => {
    db = await initTestDb(true, false);
    await addUser(db, ADMIN, 'admin');
    await db.exec(CATALOG_FIXTURE);
  });

  afterAll(async () => {
    await db.close();
  });

  const identities = async () => {
    await actAsOwner(db);
    const functions = await db.query<Record<string, unknown>>(
      `select p.oid::regprocedure::text as sig, p.oid::int as oid, p.proacl::text as acl, pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname in ('guardar_revision_factura', 'aprobar_revision_factura') and n.nspname in ('public', 'facturas_privado')
        order by sig`
    );
    const policies = await db.query<Record<string, unknown>>(
      `select policyname, cmd, roles::text as roles, qual, with_check from pg_policies
        where tablename = 'facturas_proveedores_revisiones' order by policyname`
    );
    return { functions: functions.rows, policies: policies.rows };
  };

  it('leaves the save/approve functions, ACLs, policies, stored revisions and replays byte-identical', async () => {
    const s = await scenario();
    const key = uuid();
    const content = fullContent(s);
    const first = await save({ id: s.facturaId, key, content });
    await approve(s.facturaId, 1, String(first.fingerprint));
    // The new RPC does not exist yet.
    await expect(feedback(s)).rejects.toMatchObject({ code: '42883' });

    const identitiesBefore = await identities();
    const rowsBefore = await revisions(s.facturaId);
    const tablesBefore = await snapshot(FEEDBACK_TABLES);

    await actAsOwner(db);
    await db.exec(migrationSql('_factura_matching_feedback.sql'));

    expect(await identities()).toEqual(identitiesBefore);
    expect(await revisions(s.facturaId)).toEqual(rowsBefore);
    expect(await snapshot(FEEDBACK_TABLES)).toBe(tablesBefore);
    await actAs(db, ADMIN, true);
    expect(await save({ id: s.facturaId, key, content })).toMatchObject({ revision: 1, replay: true, fingerprint: first.fingerprint });
    expect(await approve(s.facturaId, 1, String(first.fingerprint))).toMatchObject({ replay: true });

    // Same session, no reconnect: the new RPC answers, and the saved default-supplier history is readable.
    expect(Array.isArray(await feedback(s))).toBe(true);
    // A rejected command after the migration still leaves every table untouched.
    await expectRejected(as(ADMIN), () => save({ id: s.facturaId, expectedRevision: 0, content }), 'PR409');
  });
});
