import type { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { actAs, actAsAnon, actAsOwner, addUser, createMigratedDb } from './support/pgliteHarness';

// Proves the SQL contract on an isolated single-connection PGlite engine, not on production
// Supabase. validate_session() and is_active_employee() are STUBS (see the harness and
// support/comprasAppFixture.sql). The purchase queue itself is the real migrations 022, 023,
// 026 (numero_documento), 034, 039 and the real 026 roles owner policies.
//
// Isolation limits, stated once: PGlite has one connection, so no two-session interleaving
// (FK waits, MVCC visibility, lock queues) is exercised here. The first-link guarantee tested
// is atomicity of one transaction plus an immutable link state, and a deterministic single-
// statement emulation of the interleaving order (see 'first-link guard'), not real concurrency.
// Sequences (identity counters) and the clock are outside the "table unchanged" hashes; the
// hashes cover every column of every row, timestamps included.

jest.setTimeout(180_000);

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER_ADMIN = '22222222-2222-4222-8222-222222222222';
const SUPER = '33333333-3333-4333-8333-333333333333';
const EMPLEADO = '44444444-4444-4444-8444-444444444444';
const INACTIVO = '55555555-5555-4555-8555-555555555555';

const BUCKET = 'facturas_proveedores';
const SHA_A = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA_B = '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae';
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const BINDING = 'public.facturas_proveedores_compras';

type Json = Record<string, any>;
type Outcome = { ok: true; rows: Json[] } | { ok: false; code: string; message: string };

let db: PGlite;
let counter = 0;

function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function migrationFile(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

function migrationSql(suffix: string): string {
  const file = readdirSync(MIGRATIONS_DIR).find(name => name.endsWith(suffix));
  if (!file) throw new Error(`Migration ${suffix} not found`);
  return migrationFile(file);
}

// The real 026 owner policies for compras_app/items (section 8), executed verbatim.
function comprasOwnerPolicies(): string {
  const sql = migrationFile('026_roles_superempleado_writeback.sql');
  const start = sql.indexOf('-- ── 8. Compras');
  const end = sql.indexOf('-- ── 9. Gestión');
  const slice = sql.slice(start, end);
  if (start < 0 || end < start || !slice.includes('Privileged - write own compras')) {
    throw new Error('026 compras owner policies not found');
  }
  return slice;
}

async function actAsServiceRole(database: PGlite, sub = ''): Promise<void> {
  await database.exec('reset role');
  await database.query("select set_config('request.jwt.claim.role', 'service_role', false)");
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
  await database.exec('set role service_role');
}

async function initDb(withBinding: boolean): Promise<PGlite> {
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
  await database.exec(readFileSync(join(__dirname, 'support', 'comprasAppFixture.sql'), 'utf8'));
  for (const name of [
    '022_compras_app.sql',
    '023_compras_producto_nuevo.sql',
    '026_compras_numero_documento.sql',
    '034_pedidos_app.sql',
    '039_borradores_pedidos_compras.sql',
  ]) {
    await database.exec(migrationFile(name));
  }
  await database.exec(comprasOwnerPolicies());
  if (withBinding) await database.exec(migrationSql('_facturas_proveedores_compras.sql'));
  for (const [id, role, active] of [
    [ADMIN, 'admin', true],
    [OTHER_ADMIN, 'admin', true],
    [SUPER, 'superempleado', true],
    [EMPLEADO, 'empleado', true],
    [INACTIVO, 'admin', false],
  ] as const) {
    await addUser(database, id, role, active);
  }
  return database;
}

async function attempt(database: PGlite, sql: string, params: unknown[] = []): Promise<Outcome> {
  try {
    const r = await database.query<Json>(sql, params);
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    return { ok: false, code: String(e.code), message: String(e.message) };
  }
}

// ── Invoice fixtures (real RPCs; same shapes as facturasRevisiones.sql.test.ts) ─────────────

async function seedInvoice(owner: string, invoiceId: string): Promise<void> {
  await actAsOwner(db);
  const docPath = `${owner}/${invoiceId}/${uuid()}.pdf`;
  await db.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb)', [
    BUCKET,
    docPath,
    JSON.stringify({ size: 2048, mimetype: 'application/pdf' }),
  ]);
  await db.query(
    `insert into public.facturas_proveedores (
       id, creado_por, proveedor_codigo, proveedor_nombre, numero_documento, version,
       documento_path, documento_nombre, documento_mime, documento_bytes, documento_sha256
     ) values ($1, $2, 'PROV-1', 'Proveedor Uno', 'DOC-001', 1, $3, 'factura.pdf', 'application/pdf', 2048, $4)`,
    [invoiceId, owner, docPath, SHA_A]
  );
}

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

async function finalizeExtraction(facturaId: string, owner: string): Promise<string> {
  await actAs(db, owner, true);
  const requestId = uuid();
  const reserved = await db.query<{ r: { extraccion_id: string } }>(
    'select public.reservar_extraccion_factura($1::uuid, $2::uuid, $3::int) as r',
    [facturaId, requestId, 1]
  );
  await actAsServiceRole(db);
  await db.query('select public.completar_extraccion_factura($1::uuid, $2::uuid, $3::text, $4::jsonb, $5::text, null)', [
    facturaId,
    requestId,
    'completado',
    JSON.stringify(extractionResult()),
    null,
  ]);
  await actAs(db, owner, true);
  return reserved.rows[0].r.extraccion_id;
}

interface Scenario {
  facturaId: string;
  extraccionId: string;
  owner: string;
  lineIds: string[];
}

async function scenario(owner = ADMIN): Promise<Scenario> {
  const facturaId = uuid();
  await seedInvoice(owner, facturaId);
  const extraccionId = await finalizeExtraction(facturaId, owner);
  return { facturaId, extraccionId, owner, lineIds: [uuid(), uuid(), uuid()] };
}

function contenido(s: Scenario, cabecera: Json = {}): Json {
  return {
    review_schema: 1,
    calculo_version: 'calc-v1',
    matching_version: 'matching-v1',
    extraccion_id: s.extraccionId,
    cabecera: {
      correcciones: {},
      tasaConfirmada: null,
      precioIncluyeIva: true,
      recepcionCompleta: true,
      documentoCompletoConfirmado: true,
      ...cabecera,
    },
    lineas: [1, 2, 3].map(n => ({
      lineaId: s.lineIds[n - 1],
      origen: { numeroLinea: n },
      correcciones: {},
      factorConversion: '1',
      asociacion: { tipo: 'confirmado', codigoInterno: 'SKU-1', evidencia: 'sugerencia', motivo: null },
      codigoBarras: { usarCodigoFactura: true },
    })),
  };
}

async function saveRevision(s: Scenario, expectedRevision: number, cabecera: Json = {}): Promise<Json> {
  await actAs(db, s.owner, true);
  const r = await db.query<{ r: Json }>(
    'select public.guardar_revision_factura($1::uuid, $2::int, $3::uuid, $4::int, $5::uuid, $6::jsonb, $7::text) as r',
    [s.facturaId, expectedRevision, uuid(), 1, s.extraccionId, JSON.stringify(contenido(s, cabecera)), 'Revision']
  );
  return r.rows[0].r;
}

async function approveRevision(s: Scenario, revision: number, fingerprint: string): Promise<void> {
  await actAs(db, s.owner, true);
  await db.query('select public.aprobar_revision_factura($1::uuid, $2::int, $3::text, $4::int)', [
    s.facturaId,
    revision,
    fingerprint,
    1,
  ]);
}

interface Approved extends Scenario {
  revision: number;
  fingerprint: string;
}

// Invoice with revision 1 saved and approved.
async function approved(owner = ADMIN): Promise<Approved> {
  const s = await scenario(owner);
  const saved = await saveRevision(s, 0);
  await approveRevision(s, 1, String(saved.fingerprint));
  return { ...s, revision: 1, fingerprint: String(saved.fingerprint) };
}

// Appends revision N+1 (different content) and approves it.
async function approveNext(a: Approved): Promise<Approved> {
  const next = a.revision + 1;
  const saved = await saveRevision(a, a.revision, { precioIncluyeIva: (next & 1) === 1, recepcionCompleta: (next & 2) === 0 });
  await approveRevision(a, next, String(saved.fingerprint));
  return { ...a, revision: next, fingerprint: String(saved.fingerprint) };
}

type PrepareArgs = { facturaId: string; revision: number; fingerprint: string; owner: string };

// Runs as whichever role is current (for expectRejected closures).
async function callPrepare(a: PrepareArgs, version = 1): Promise<Json> {
  const r = await db.query<{ r: Json }>(
    'select public.preparar_compra_factura($1::uuid, $2::int, $3::text, $4::int) as r',
    [a.facturaId, a.revision, a.fingerprint, version]
  );
  return r.rows[0].r;
}

// Success path: acts as the invoice owner.
async function prepare(a: PrepareArgs, version = 1): Promise<Json> {
  await actAs(db, a.owner, true);
  return callPrepare(a, version);
}

// ── Observation helpers ─────────────────────────────────────────────────────────────────────

const ALL_TABLES = [
  'public.facturas_proveedores',
  'public.facturas_proveedores_lineas',
  'public.facturas_proveedores_operaciones',
  'public.facturas_proveedores_extracciones',
  'public.facturas_proveedores_revisiones',
  'storage.objects',
  'public.compras_app',
  'public.compras_app_items',
  BINDING,
];

async function snapshot(tables = ALL_TABLES, database = db): Promise<string> {
  await actAsOwner(database);
  const parts: string[] = [];
  for (const t of tables) {
    const r = await database.query<{ h: string }>(
      `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from ${t} x`
    );
    parts.push(r.rows[0].h);
  }
  return parts.join(':');
}

async function rows(sql: string, params: unknown[] = []): Promise<Json[]> {
  await actAsOwner(db);
  return (await db.query<Json>(sql, params)).rows;
}

const as = (user: string, valid = true) => () => actAs(db, user, valid);
const asService = () => actAsServiceRole(db);
const asTableOwner = () => actAsOwner(db);
const asAnon = () => actAsAnon(db);

// A rejected command must leave every relevant table byte-identical.
async function expectRejected(actor: () => Promise<void>, call: () => Promise<unknown>, code: string, message?: string) {
  const before = await snapshot();
  await actor();
  await expect(call()).rejects.toMatchObject(message ? { code, message: expect.stringContaining(message) } : { code });
  expect(await snapshot()).toBe(before);
}

// Test-only: seeds states the guards make unreachable (impossible/corrupt rows) as the table
// owner with the user triggers off. This is fixture authority, never a production path.
async function seedWithoutGuards(sql: string, params: unknown[] = []): Promise<Json[]> {
  await actAsOwner(db);
  await db.exec('alter table public.compras_app disable trigger user');
  await db.exec('alter table public.compras_app_items disable trigger user');
  try {
    return (await db.query<Json>(sql, params)).rows;
  } finally {
    await db.exec('alter table public.compras_app enable trigger user');
    await db.exec('alter table public.compras_app_items enable trigger user');
  }
}

async function insertManualDraft(owner: string, titulo: string): Promise<number> {
  await actAs(db, owner, true);
  const r = await db.query<{ id: number }>(
    "insert into public.compras_app (creado_por, status, titulo) values ($1, 'borrador', $2) returning id",
    [owner, titulo]
  );
  return r.rows[0].id;
}

describe('facturas_proveedores_compras', () => {
  beforeAll(async () => {
    db = await initDb(true);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('preparar_compra_factura: persisted effects', () => {
    it('creates one empty borrador and its binding for the approved latest revision', async () => {
      const a = await approved();
      const before = await snapshot(ALL_TABLES.slice(0, 6));
      const res = await prepare(a);

      expect(res).toMatchObject({
        factura_id: a.facturaId,
        revision: 1,
        fingerprint: a.fingerprint,
        replay: false,
        rebind: false,
      });
      expect(typeof res.compra_id).toBe('number');

      const compras = await rows('select * from public.compras_app where id = $1', [res.compra_id]);
      expect(compras).toHaveLength(1);
      expect(compras[0]).toMatchObject({
        creado_por: ADMIN,
        status: 'borrador',
        proveedor_codigo: null,
        proveedor_nombre: null,
        nota: null,
        numero_documento: null,
        titulo: null,
        backend_status: 'pendiente',
        backend_resultado: null,
        backend_intentos: 0,
        backend_aplicado_en: null,
      });
      expect(await rows('select * from public.compras_app_items where compra_id = $1', [res.compra_id])).toHaveLength(0);

      const links = await rows(`select * from ${BINDING} where factura_id = $1`, [a.facturaId]);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        factura_id: a.facturaId,
        compra_id: res.compra_id,
        revision: 1,
        fingerprint: a.fingerprint,
        factura_version: 1,
        documento_sha256: SHA_A,
        vinculado_por: ADMIN,
      });
      expect(links[0].vinculado_en).toBeTruthy();
      expect(links[0].actualizado_en).toBeTruthy();

      // No amounts, items or invoice-side change: invoice, revisions, ledger and storage are untouched.
      expect(await snapshot(ALL_TABLES.slice(0, 6))).toBe(before);
    });

    it('replays the same purchase on double tap and response-loss retry without touching any row', async () => {
      const a = await approved();
      const first = await prepare(a);
      const before = await snapshot();
      const second = await prepare(a);
      const third = await prepare(a);

      expect(second).toEqual({ ...first, replay: true, rebind: false });
      expect(third).toEqual(second);
      expect(await snapshot()).toBe(before);
      expect(await rows(`select count(*)::int as n from ${BINDING} where factura_id = $1`, [a.facturaId])).toEqual([{ n: 1 }]);
    });

    it('gives independent invoices independent purchases', async () => {
      const a = await approved();
      const b = await approved(SUPER);
      const ra = await prepare(a);
      await actAs(db, SUPER, true);
      const rb = await prepare(b);
      expect(rb.compra_id).not.toBe(ra.compra_id);
      expect(await rows(`select count(*)::int as n from ${BINDING} where factura_id in ($1, $2)`, [a.facturaId, b.facturaId])).toEqual([{ n: 2 }]);
    });

    it('rebinds the same pristine draft to a newer approved revision and refuses the old one', async () => {
      const r1 = await approved();
      const first = await prepare(r1);
      const linkBefore = (await rows(`select * from ${BINDING} where factura_id = $1`, [r1.facturaId]))[0];
      const r2 = await approveNext(r1);

      const res = await prepare(r2);
      expect(res).toMatchObject({ compra_id: first.compra_id, revision: 2, fingerprint: r2.fingerprint, replay: false, rebind: true });
      expect(r2.fingerprint).not.toBe(r1.fingerprint);

      const linkAfter = (await rows(`select * from ${BINDING} where factura_id = $1`, [r1.facturaId]))[0];
      expect(linkAfter).toMatchObject({ compra_id: first.compra_id, revision: 2, fingerprint: r2.fingerprint, vinculado_por: ADMIN });
      expect(linkAfter.vinculado_en).toEqual(linkBefore.vinculado_en);
      expect(await rows('select count(*)::int as n from public.compras_app where id = $1', [first.compra_id])).toEqual([{ n: 1 }]);

      // The newer request now replays; the superseded revision is refused with nothing changed.
      expect(await prepare(r2)).toMatchObject({ compra_id: first.compra_id, replay: true, rebind: false });
      await expectRejected(as(ADMIN), () => callPrepare(r1), 'PR409');
    });

    it.each([
      ['a header field was filled', "update public.compras_app set nota = 'x' where id = $1"],
      ['a provider was set', "update public.compras_app set proveedor_codigo = 'P-1' where id = $1"],
      ['the backend attempt counter moved', 'update public.compras_app set backend_intentos = 1 where id = $1'],
      ['the draft was emitted', "update public.compras_app set proveedor_codigo = 'P-1', status = 'emitido' where id = $1"],
      [
        'an item exists',
        "insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio) select $1, 'SKU', 1, 1, 1",
      ],
    ])('fails closed instead of rebinding once the draft is not pristine: %s', async (_name, mutation) => {
      const r1 = await approved();
      const first = await prepare(r1);
      await seedWithoutGuards(mutation, [first.compra_id]);
      const r2 = await approveNext(r1);

      await expectRejected(as(ADMIN), () => callPrepare(r2), 'PC409', 'compra_factura_no_modificable');
      expect(await rows(`select revision from ${BINDING} where factura_id = $1`, [r1.facturaId])).toEqual([{ revision: 1 }]);
    });

    it('commits the draft and its binding together: a failing binding insert leaves no orphan draft', async () => {
      const a = await approved();
      await actAsOwner(db);
      await db.exec(`alter table ${BINDING} add constraint test_fuerza_fallo check (false) not valid`);
      try {
        await expectRejected(as(ADMIN), () => callPrepare(a), '23514');
      } finally {
        await actAsOwner(db);
        await db.exec(`alter table ${BINDING} drop constraint test_fuerza_fallo`);
      }
      expect(await rows(`select count(*)::int as n from ${BINDING} where factura_id = $1`, [a.facturaId])).toEqual([{ n: 0 }]);
      // Same call succeeds afterwards: the failed attempt left no state behind.
      await actAs(db, ADMIN, true);
      expect(await prepare(a)).toMatchObject({ replay: false });
    });

    it('never links a pre-existing manual draft: it stays an ordinary unlinked row', async () => {
      const manualId = await insertManualDraft(ADMIN, 'manual-previo');
      const a = await approved();
      await actAs(db, ADMIN, true);
      const res = await prepare(a);
      expect(res.compra_id).not.toBe(manualId);
      expect(await rows(`select count(*)::int as n from ${BINDING} where compra_id = $1`, [manualId])).toEqual([{ n: 0 }]);
      await actAs(db, ADMIN, true);
      await db.query("update public.compras_app set nota = 'editable' where id = $1", [manualId]);
      expect(await rows('select nota from public.compras_app where id = $1', [manualId])).toEqual([{ nota: 'editable' }]);
    });
  });

  describe('preparar_compra_factura: refusals leave every table byte-identical', () => {
    it('refuses a revision that was never approved', async () => {
      const s = await scenario();
      const saved = await saveRevision(s, 0);
      await expectRejected(as(ADMIN), () => callPrepare({ ...s, revision: 1, fingerprint: String(saved.fingerprint) }), '22023', 'revision_no_aprobada');
    });

    it('refuses an unapproved newer revision and a stale approved one', async () => {
      const r1 = await approved();
      const saved2 = await saveRevision(r1, 1, { precioIncluyeIva: false });
      await expectRejected(as(ADMIN), () => callPrepare(r1), 'PR409');
      await expectRejected(as(ADMIN), () => callPrepare({ ...r1, revision: 2, fingerprint: String(saved2.fingerprint) }), '22023', 'revision_no_aprobada');
    });

    it('refuses a wrong fingerprint, an unknown revision and an unknown invoice', async () => {
      const a = await approved();
      await expectRejected(as(ADMIN), () => callPrepare({ ...a, fingerprint: 'f'.repeat(64) }), 'PI409');
      await expectRejected(as(ADMIN), () => callPrepare({ ...a, revision: 9 }), 'P0002');
      await expectRejected(as(ADMIN), () => callPrepare({ ...a, facturaId: uuid() }), 'P0002');
    });

    it('refuses a stale invoice version after a manual edit', async () => {
      const a = await approved();
      await actAs(db, ADMIN, true);
      await db.query(
        'select public.guardar_factura_proveedor($1::uuid, $2::int, $3::uuid, $4::jsonb, $5::jsonb)',
        [a.facturaId, 1, uuid(), JSON.stringify({ proveedor_nombre: 'Editado' }), '[]']
      );
      await expectRejected(as(ADMIN), () => callPrepare(a, 1), 'PV409');
      await expectRejected(as(ADMIN), () => callPrepare(a, 2), 'PV409');
    });

    it('refuses a changed attached document even when the version did not move', async () => {
      const a = await approved();
      await actAsOwner(db);
      await db.query('update public.facturas_proveedores set documento_sha256 = $2 where id = $1', [a.facturaId, SHA_B]);
      await expectRejected(as(ADMIN), () => callPrepare(a), 'PV409');
    });

    it('refuses callers that are not the privileged, session-valid invoice owner', async () => {
      const a = await approved();
      await expectRejected(as(OTHER_ADMIN), () => callPrepare(a), '42501');
      await expectRejected(as(EMPLEADO), () => callPrepare(a), '42501');
      await expectRejected(as(INACTIVO), () => callPrepare(a), '42501');
      await expectRejected(as(ADMIN, false), () => callPrepare(a), '42501');
      await expectRejected(asAnon, () => callPrepare(a), '42501');
      await expectRejected(asService, () => callPrepare(a), '42501');
    });

    it.each([
      ['null invoice', { facturaId: null }],
      ['null revision', { revision: null }],
      ['revision below 1', { revision: 0 }],
      ['null fingerprint', { fingerprint: null }],
      ['malformed fingerprint', { fingerprint: 'not-a-sha256' }],
      ['null version', { version: null }],
      ['version below 1', { version: 0 }],
    ])('refuses %s as an invalid payload', async (_name, override) => {
      const a = await approved();
      const args = { facturaId: a.facturaId, revision: 1, fingerprint: a.fingerprint, version: 1, ...override } as Json;
      await expectRejected(
        as(ADMIN),
        () => db.query('select public.preparar_compra_factura($1::uuid, $2::int, $3::text, $4::int)', [args.facturaId, args.revision, args.fingerprint, args.version]),
        '22023'
      );
    });
  });

  describe('binding table: no client or service DML, owner-only read', () => {
    it('exposes the binding only to its privileged, session-valid owner', async () => {
      const a = await approved();
      await prepare(a);
      const read = async () => (await db.query<Json>(`select factura_id from ${BINDING} where factura_id = $1`, [a.facturaId])).rows;

      await actAs(db, ADMIN, true);
      expect(await read()).toHaveLength(1);
      for (const [user, valid] of [[OTHER_ADMIN, true], [SUPER, true], [EMPLEADO, true], [ADMIN, false]] as const) {
        await actAs(db, user, valid);
        expect(await read()).toHaveLength(0);
      }
      await asAnon();
      await expect(read()).rejects.toMatchObject({ code: '42501' });
      await asService();
      await expect(read()).rejects.toMatchObject({ code: '42501' });
    });

    it.each([
      ['authenticated owner', as(ADMIN)],
      ['service_role', asService],
      ['anon', asAnon],
    ])('denies direct INSERT/UPDATE/DELETE/TRUNCATE to %s and leaves the binding unchanged', async (_name, actor) => {
      const a = await approved();
      const res = await prepare(a);
      const statements: [string, unknown[]][] = [
        [`insert into ${BINDING} (factura_id, compra_id, revision, fingerprint, factura_version, vinculado_por) values ('${uuid()}', ${res.compra_id}, 1, '${'a'.repeat(64)}', 1, '${ADMIN}')`, []],
        [`update ${BINDING} set compra_id = compra_id where factura_id = $1`, [a.facturaId]],
        [`delete from ${BINDING} where factura_id = $1`, [a.facturaId]],
        [`truncate ${BINDING}`, []],
      ];
      for (const [sql, params] of statements) {
        await expectRejected(actor, () => db.query(sql, params), '42501');
      }
    });

    it('keeps the link immutable even for the table owner: no delete, truncate or identity change', async () => {
      const a = await approved();
      const res = await prepare(a);
      const other = await insertManualDraft(ADMIN, 'otro');
      await expectRejected(asTableOwner, () => db.query(`delete from ${BINDING} where factura_id = $1`, [a.facturaId]), '55000');
      await expectRejected(asTableOwner, () => db.query(`truncate ${BINDING}`), '55000');
      await expectRejected(asTableOwner, () => db.query(`update ${BINDING} set compra_id = $2 where factura_id = $1`, [a.facturaId, other]), '55000');
      await expectRejected(asTableOwner, () => db.query(`update ${BINDING} set factura_id = $2 where compra_id = $1`, [res.compra_id, uuid()]), '55000');
      await expectRejected(asTableOwner, () => db.query(`update ${BINDING} set vinculado_por = $2 where factura_id = $1`, [a.facturaId, OTHER_ADMIN]), '55000');
    });

    it('cannot orphan the link: the invoice, its revision and the purchase are RESTRICTed', async () => {
      const a = await approved();
      const res = await prepare(a);
      await expectRejected(asTableOwner, () => db.query('delete from public.facturas_proveedores where id = $1', [a.facturaId]), '23001');
      await expectRejected(asTableOwner, () => db.query('delete from public.facturas_proveedores_revisiones where factura_id = $1', [a.facturaId]), '55000');
      await expectRejected(asTableOwner, () => db.query('delete from public.compras_app where id = $1', [res.compra_id]), '23001');
    });

    it('enforces one purchase per invoice and one invoice per purchase', async () => {
      const a = await approved();
      const b = await approved(SUPER);
      const ra = await prepare(a);
      await actAs(db, SUPER, true);
      await prepare(b);
      await expectRejected(
        asTableOwner,
        () => db.query(`insert into ${BINDING} (factura_id, compra_id, revision, fingerprint, factura_version, vinculado_por) values ($1, $2, 1, $3, 1, $4)`, [b.facturaId, ra.compra_id, b.fingerprint, SUPER]),
        '23505'
      );
    });
  });

  describe('linked purchase guards', () => {
    interface Linked {
      compraId: number;
      itemId: number;
    }

    // A linked draft that also holds one item. Reaching that state needs the fixture authority:
    // the guards make it unreachable for every client path.
    async function linkedWithItem(): Promise<Linked> {
      const a = await approved();
      const res = await prepare(a);
      const item = await seedWithoutGuards(
        "insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio) values ($1, 'SKU', 1, 1, 1) returning id",
        [res.compra_id]
      );
      return { compraId: res.compra_id as number, itemId: item[0].id as number };
    }

    const actors: [string, () => Promise<void>][] = [
      ['authenticated owner', as(ADMIN)],
      ['service_role', asService],
      ['table owner', asTableOwner],
    ];

    describe.each(actors)('as %s', (_name, actor) => {
      it.each([
        ['emit the draft', "update public.compras_app set proveedor_codigo = 'P-1', status = 'emitido' where id = $1"],
        ['reset the backend state', "update public.compras_app set backend_status = 'pendiente', backend_intentos = 0, backend_resultado = null, backend_aplicado_en = null where id = $1"],
        ['mark it completed', "update public.compras_app set backend_status = 'completado' where id = $1"],
        ['edit a header field', "update public.compras_app set titulo = 'x' where id = $1"],
        ['no-op update', 'update public.compras_app set status = status where id = $1'],
        ['change the owner', `update public.compras_app set creado_por = '${OTHER_ADMIN}' where id = $1`],
      ])('rejects a header update that tries to %s', async (_label, sql) => {
        const l = await linkedWithItem();
        await expectRejected(actor, () => db.query(sql, [l.compraId]), '55000', 'compra_factura_bloqueada');
      });

      // RESTRICT (23001) when the draft is empty; with an item present the item guard answers first.
      it('rejects deleting the linked header', async () => {
        const a = await approved();
        const res = await prepare(a);
        await expectRejected(actor, () => db.query('delete from public.compras_app where id = $1', [res.compra_id]), '23001');
        const l = await linkedWithItem();
        await expectRejected(actor, () => db.query('delete from public.compras_app where id = $1', [l.compraId]), '55000', 'compra_factura_bloqueada');
      });

      it('rejects deleting the items of a linked purchase', async () => {
        const l = await linkedWithItem();
        await expectRejected(actor, () => db.query('delete from public.compras_app_items where compra_id = $1', [l.compraId]), '55000', 'compra_factura_bloqueada');
      });

      it('rejects item INSERT and UPDATE on a linked purchase', async () => {
        const l = await linkedWithItem();
        await expectRejected(
          actor,
          () => db.query("insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio) values ($1, 'NEW', 1, 1, 1)", [l.compraId]),
          '55000',
          'compra_factura_bloqueada'
        );
        await expectRejected(actor, () => db.query('update public.compras_app_items set cantidad = 2 where id = $1', [l.itemId]), '55000', 'compra_factura_bloqueada');
      });

      it('rejects moving an item between a linked and an unlinked purchase in either direction', async () => {
        const l = await linkedWithItem();
        const manual = await insertManualDraft(ADMIN, 'manual-destino');
        const manualItem = (
          await rows(
            "insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio) values ($1, 'M', 1, 1, 1) returning id",
            [manual]
          )
        )[0].id;
        // NEW parent linked
        await expectRejected(actor, () => db.query('update public.compras_app_items set compra_id = $2 where id = $1', [manualItem, l.compraId]), '55000');
        // OLD parent linked
        await expectRejected(actor, () => db.query('update public.compras_app_items set compra_id = $2 where id = $1', [l.itemId, manual]), '55000');
      });
    });

    it('keeps emitido unreachable: the listener poll filter never matches a linked purchase', async () => {
      const l = await linkedWithItem();
      for (const actor of [as(ADMIN), asService, asTableOwner]) {
        await actor();
        await attempt(db, "update public.compras_app set proveedor_codigo = 'P-1', status = 'emitido', backend_status = 'pendiente' where id = $1", [l.compraId]);
      }
      expect(
        await rows("select count(*)::int as n from public.compras_app where id = $1 and status = 'emitido' and backend_status = 'pendiente'", [l.compraId])
      ).toEqual([{ n: 0 }]);
    });

    // Row triggers do not see TRUNCATE; the statement triggers do. The binding table grants no
    // TRUNCATE to client roles, so a statement that must also truncate it (CASCADE, explicit list)
    // stops at the ACL for them (42501) and at the statement trigger for the table owner (55000).
    // The items-only statement has no FK dependents and reaches the statement trigger for everyone.
    it.each([
      ['the items', 'truncate public.compras_app_items', { owner: '55000', other: '55000' }],
      ['the purchases with CASCADE', 'truncate public.compras_app cascade', { owner: '55000', other: '42501' }],
      [
        'purchases, items and bindings together',
        `truncate public.compras_app, public.compras_app_items, ${BINDING}`,
        { owner: '55000', other: '42501' },
      ],
    ])('rejects bulk TRUNCATE of %s while a link exists, leaving all rows', async (_label, sql, expected) => {
      await linkedWithItem();
      for (const [name, actor] of actors) {
        await expectRejected(actor, () => db.query(sql), name === 'table owner' ? expected.owner : expected.other);
      }
    });

    it('does not let a caller-chosen claim waive the guard', async () => {
      const l = await linkedWithItem();
      await actAs(db, ADMIN, true);
      await db.query("select set_config('request.jwt.claim.role', 'service_role', false)");
      await expect(db.query("update public.compras_app set titulo = 'x' where id = $1", [l.compraId])).rejects.toMatchObject({ code: '55000' });
    });
  });

  // Staged first-link interleaving on ONE connection: in a single statement an early row reaches
  // its BEFORE trigger while the target purchase does not exist yet, and a later row calls the
  // prepare RPC, so the draft and its binding appear before the end-of-statement FK check. This
  // is a deterministic emulation of that order, NOT a two-session proof: real lock queues and
  // MVCC visibility between connections are not exercised, and the FOR KEY SHARE lock itself is
  // not observable here (the FK check takes the same lock at statement end).
  describe('first-link guard: a not-yet-visible target purchase is refused', () => {
    const PREPARE_FNS = [
      'public.preparar_compra_factura(uuid, integer, text, integer)',
      'facturas_privado.preparar_compra_factura(uuid, integer, text, integer)',
    ];

    // Fixture authority only: lets the BYPASSRLS actor of the staged statement also play the owner.
    async function asServiceRoleWithPrepare(owner: string): Promise<void> {
      await actAsOwner(db);
      for (const fn of PREPARE_FNS) await db.exec(`grant execute on function ${fn} to service_role`);
      await actAsServiceRole(db, owner);
    }

    async function revokePrepareGrant(): Promise<void> {
      await actAsOwner(db);
      for (const fn of PREPARE_FNS) await db.exec(`revoke execute on function ${fn} from service_role`);
    }

    async function nextCompraId(): Promise<number> {
      await actAsOwner(db);
      const seq = (await db.query<{ s: string }>("select pg_get_serial_sequence('public.compras_app', 'id') as s")).rows[0].s;
      const r = await db.query<{ n: string }>(`select (case when is_called then last_value + 1 else last_value end)::text as n from ${seq}`);
      return Number(r.rows[0].n);
    }

    const prepareCall = (a: Approved) => `public.preparar_compra_factura('${a.facturaId}'::uuid, ${a.revision}, '${a.fingerprint}', 1) is not null`;

    // The service role (RLS bypassed) is answered by the FK code; the owner by the RLS refusal.
    async function expectRefusedAndPristine(
      a: Approved,
      predicted: number,
      before: string,
      run: () => Promise<unknown>,
      actor: 'service' | 'owner' = 'service'
    ) {
      if (actor === 'owner') await actAs(db, a.owner, true);
      else await asServiceRoleWithPrepare(a.owner);
      try {
        await expect(run()).rejects.toMatchObject({ code: actor === 'owner' ? '42501' : '23503' });
      } finally {
        await revokePrepareGrant();
      }
      expect(await snapshot()).toBe(before);
      expect(await rows(`select count(*)::int as n from ${BINDING} where factura_id = $1`, [a.facturaId])).toEqual([{ n: 0 }]);
      expect(await rows('select count(*)::int as n from public.compras_app_items where compra_id = $1', [predicted])).toEqual([{ n: 0 }]);
      // The refused statement left the invoice free to get its normal, empty draft.
      const res = await prepare(a);
      expect(res).toMatchObject({ compra_id: predicted, replay: false });
      expect(await rows('select count(*)::int as n from public.compras_app_items where compra_id = $1', [predicted])).toEqual([{ n: 0 }]);
    }

    it('refuses a service-role item INSERT whose purchase appears only mid-statement', async () => {
      const a = await approved();
      const manual = await insertManualDraft(ADMIN, 'race-insert');
      const predicted = await nextCompraId();
      const before = await snapshot();
      await expectRefusedAndPristine(a, predicted, before, () =>
        db.query(
          `insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio)
           select case when g = 1 then ${predicted} else ${manual} end, 'RACE' || g, 1, 1, 1
             from generate_series(1, 2) g
            where g = 1 or ${prepareCall(a)}`
        )
      );
    });

    it('keeps the RLS refusal for an owner item INSERT whose purchase appears only mid-statement', async () => {
      const a = await approved();
      const manual = await insertManualDraft(ADMIN, 'race-owner-insert');
      const predicted = await nextCompraId();
      const before = await snapshot();
      await expectRefusedAndPristine(
        a,
        predicted,
        before,
        () =>
          db.query(
            `insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio)
             select case when g = 1 then ${predicted} else ${manual} end, 'RACE' || g, 1, 1, 1
               from generate_series(1, 2) g
              where g = 1 or ${prepareCall(a)}`
          ),
        'owner'
      );
    });

    it.each(['service', 'owner'] as const)('refuses a %s item UPDATE that moves it into a purchase appearing mid-statement', async actor => {
      const a = await approved();
      const manual = await insertManualDraft(ADMIN, `race-move-${actor}`);
      const itemSql = "insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio) values ($1, $2, 1, 1, 1) returning id";
      const mover = (await rows(itemSql, [manual, 'MOVER']))[0].id as number;
      const driver = (await rows(itemSql, [manual, 'DRIVER']))[0].id as number;
      // The staged order needs the moving row to be scanned first.
      expect((await rows('select id from public.compras_app_items where id in ($1, $2) order by ctid', [mover, driver])).map(r => r.id)).toEqual([mover, driver]);
      const predicted = await nextCompraId();
      const before = await snapshot();
      await expectRefusedAndPristine(
        a,
        predicted,
        before,
        () =>
          db.query(
            `update public.compras_app_items
                set compra_id = case when id = ${mover} then ${predicted} else ${manual} end
              where id = ${mover} or (id = ${driver} and ${prepareCall(a)})`
          ),
        actor
      );
      expect(await rows('select id, compra_id from public.compras_app_items where id in ($1, $2) order by id', [mover, driver])).toEqual([
        { id: mover, compra_id: manual },
        { id: driver, compra_id: manual },
      ]);
    });
  });

  describe('item guard error codes', () => {
    const MISSING = 2147480000;

    // An owner subject to RLS inserting into, or moving an item to, a purchase that does not exist.
    async function ownerMissingParent(database: PGlite): Promise<{ codes: string[]; messages: string[]; draft: number }> {
      await actAs(database, ADMIN, true);
      const draft = (
        await database.query<{ id: number }>("insert into public.compras_app (creado_por, status, titulo) values ($1, 'borrador', 'mp') returning id", [ADMIN])
      ).rows[0].id;
      await database.query("insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio) values ($1, 'A', 1, 1, 1)", [draft]);
      const insert = await attempt(database, `insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio) values (${MISSING}, 'O', 1, 1, 1)`);
      const move = await attempt(database, `update public.compras_app_items set compra_id = ${MISSING} where compra_id = $1`, [draft]);
      const refused = [insert, move].map(r => (r.ok ? { code: 'OK', message: '' } : { code: r.code, message: r.message }));
      return { codes: refused.map(r => r.code), messages: refused.map(r => r.message), draft };
    }

    // A target purchase the owner cannot see is answered by the RLS WITH CHECK, exactly as before
    // the migration: same code and message, and nothing is written.
    it('keeps the RLS refusal for an owner insert or move to a missing purchase', async () => {
      const baseline = await initDb(false);
      let expected: Awaited<ReturnType<typeof ownerMissingParent>>;
      try {
        expected = await ownerMissingParent(baseline);
        expect(expected.codes).toEqual(['42501', '42501']);
      } finally {
        await baseline.close();
      }
      const candidate = await initDb(true);
      try {
        const { codes, messages, draft } = await ownerMissingParent(candidate);
        expect({ codes, messages }).toEqual({ codes: expected.codes, messages: expected.messages });
        await actAsOwner(candidate);
        const items = await candidate.query<{ compra_id: number }>('select compra_id from public.compras_app_items order by id');
        expect(items.rows).toEqual([{ compra_id: draft }]);
      } finally {
        await candidate.close();
      }
    });
  });

  describe('unlinked manual behavior is unchanged', () => {
    const TITLE = 'ctl';

    // Mirrors the useCompra/useBorradores write paths against the real policies.
    async function runManualControls(database: PGlite, withTruncate: boolean): Promise<Json[]> {
      const steps: Json[] = [];
      const rec = async (name: string, sql: string, params: unknown[] = []) => {
        const r = await attempt(database, sql, params);
        steps.push({ name, ...(r.ok ? { rows: r.rows } : { code: r.code }) });
        return r;
      };
      const idOf = async (titulo: string) =>
        (await database.query<{ id: number }>('select id from public.compras_app where titulo = $1', [titulo])).rows[0].id;
      const item = (n: string, q: number) => `insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio) values ($1, '${n}', ${q}, 1.5, 3)`;

      await actAs(database, ADMIN, true);
      await rec('insert borrador', `insert into public.compras_app (creado_por, status, titulo) values ($1, 'borrador', '${TITLE}-1') returning titulo, status, proveedor_codigo, backend_status, backend_intentos`, [ADMIN]);
      const id = await idOf(`${TITLE}-1`);
      await rec('insert items', `${item('A', 2)}, ($1, 'B', 1, 0, 0) returning codigo_producto`, [id]);
      await rec('update item', "update public.compras_app_items set cantidad = 5 where compra_id = $1 and codigo_producto = 'A' returning cantidad::text", [id]);
      await rec('delete item', "delete from public.compras_app_items where compra_id = $1 and codigo_producto = 'B' returning codigo_producto", [id]);
      await rec('reinsert item', `${item('B', 3)} returning codigo_producto`, [id]);
      await rec('zero quantity', item('Z', 0), [id]);
      await rec('emit without provider', "update public.compras_app set status = 'emitido' where id = $1", [id]);
      await rec('emit', "update public.compras_app set proveedor_codigo = 'P-1', status = 'emitido', backend_status = 'pendiente', backend_intentos = 0, backend_resultado = null, backend_aplicado_en = null where id = $1 returning status, backend_status", [id]);
      await actAsServiceRole(database);
      await rec('backend applying', "update public.compras_app set backend_status = 'aplicando', backend_intentos = backend_intentos + 1 where id = $1 returning backend_status, backend_intentos", [id]);
      await rec('backend error', "update public.compras_app set backend_status = 'error', backend_resultado = 'boom' where id = $1 returning backend_status", [id]);
      await actAs(database, ADMIN, true);
      await rec('owner resets error', "update public.compras_app set backend_status = 'pendiente', backend_intentos = 0, backend_resultado = null where id = $1 returning backend_status, backend_intentos", [id]);
      await actAsServiceRole(database);
      await rec('backend completed', "update public.compras_app set backend_status = 'completado', backend_resultado = 'ok' where id = $1 returning backend_status", [id]);
      await actAs(database, EMPLEADO, true);
      await rec('empleado insert denied', "insert into public.compras_app (creado_por, titulo) values ($1, 'denied')", [EMPLEADO]);
      await actAs(database, ADMIN, false);
      await rec('invalid session denied', "insert into public.compras_app (creado_por, titulo) values ($1, 'denied-2')", [ADMIN]);
      await actAs(database, ADMIN, true);
      await rec('second draft', `insert into public.compras_app (creado_por, status, titulo) values ($1, 'borrador', '${TITLE}-2')`, [ADMIN]);
      await rec('third draft', `insert into public.compras_app (creado_por, status, titulo) values ($1, 'borrador', '${TITLE}-3')`, [ADMIN]);
      const two = await idOf(`${TITLE}-2`);
      const three = await idOf(`${TITLE}-3`);
      await rec('item in second', `${item('M', 1)}`, [two]);
      await rec('move item between unlinked', "update public.compras_app_items set compra_id = $2 where compra_id = $1 and codigo_producto = 'M' returning codigo_producto", [two, three]);
      await rec('delete third (cascade)', 'delete from public.compras_app where id = $1 returning titulo', [three]);
      await rec('delete emitted completed', 'delete from public.compras_app where id = $1 returning titulo', [id]);

      // Item guard: visible unlinked parents, NULL parents, missing parents (the owner's RLS
      // refusal and the FK error of roles that bypass RLS) and the parent cascade keep their behavior.
      await actAs(database, ADMIN, true);
      await rec('fourth draft', `insert into public.compras_app (creado_por, status, titulo) values ($1, 'borrador', '${TITLE}-4')`, [ADMIN]);
      await rec('fifth draft', `insert into public.compras_app (creado_por, status, titulo) values ($1, 'borrador', '${TITLE}-5')`, [ADMIN]);
      const four = await idOf(`${TITLE}-4`);
      const five = await idOf(`${TITLE}-5`);
      const missing = 2147480000;
      const orphan = (target: string) => `insert into public.compras_app_items (compra_id, codigo_producto, cantidad, costo, precio) values (${target}, 'O', 1, 1, 1)`;
      await rec('item in fourth', item('S', 1), [four]);
      await rec('owner null parent', orphan('null'));
      await rec('owner missing parent', orphan(String(missing)));
      await rec('owner move to missing parent', `update public.compras_app_items set compra_id = ${missing} where compra_id = $1`, [four]);
      await actAsServiceRole(database);
      await rec('service item into visible draft', `${item('T', 1)} returning codigo_producto`, [five]);
      await rec('service move between unlinked', 'update public.compras_app_items set compra_id = $2 where compra_id = $1 and codigo_producto = \'S\' returning codigo_producto', [four, five]);
      await rec('service same-parent update', 'update public.compras_app_items set cantidad = 7 where compra_id = $1 returning codigo_producto', [five]);
      await rec('service null parent', orphan('null'));
      await rec('service missing parent', orphan(String(missing)));
      await rec('service null reparent', 'update public.compras_app_items set compra_id = null where compra_id = $1', [five]);
      await rec('service move to missing parent', `update public.compras_app_items set compra_id = ${missing} where compra_id = $1`, [five]);
      await actAsOwner(database);
      await rec('table owner null parent', orphan('null'));
      await rec('table owner missing parent', orphan(String(missing)));
      await actAsServiceRole(database);
      await rec('service cascade delete', 'delete from public.compras_app where id = $1 returning titulo', [five]);
      await actAsOwner(database);
      if (withTruncate) await rec('truncate items', 'truncate public.compras_app_items');
      steps.push({
        name: 'final',
        compras: (await database.query<Json>(`select titulo, status, proveedor_codigo, backend_status, backend_intentos, backend_resultado from public.compras_app where titulo like '${TITLE}-%' order by titulo`)).rows,
        items: (await database.query<Json>(`select i.codigo_producto, i.cantidad::text, i.costo::text, i.precio::text from public.compras_app_items i join public.compras_app c on c.id = i.compra_id where c.titulo like '${TITLE}-%' order by i.codigo_producto`)).rows,
      });
      return steps;
    }

    // The baseline is the same schema without this migration (it is the only migration this unit adds).
    async function baselineSteps(): Promise<Json[]> {
      const baseline = await initDb(false);
      try {
        const steps = await runManualControls(baseline, true);
        // Every control actually ran (a vacuous all-error sequence would not prove anything).
        expect(steps.filter(s => s.rows).length).toBeGreaterThan(12);
        expect(steps.find(s => s.name === 'emit')).toMatchObject({ rows: [{ status: 'emitido', backend_status: 'pendiente' }] });
        expect(steps.find(s => s.name === 'zero quantity')).toMatchObject({ code: '23514' });
        expect(steps.find(s => s.name === 'empleado insert denied')).toMatchObject({ code: '42501' });
        for (const [name, code] of [
          ['owner null parent', '42501'],
          ['owner missing parent', '42501'],
          ['owner move to missing parent', '42501'],
          ['service null parent', '23502'],
          ['service missing parent', '23503'],
          ['service null reparent', '23502'],
          ['service move to missing parent', '23503'],
          ['table owner null parent', '23502'],
          ['table owner missing parent', '23503'],
        ]) {
          expect(steps.find(s => s.name === name)).toMatchObject({ code });
        }
        for (const name of ['service item into visible draft', 'service move between unlinked', 'service cascade delete']) {
          expect(steps.find(s => s.name === name)?.rows).toHaveLength(1);
        }
        // The two items that now share the fifth draft are both touched.
        expect(steps.find(s => s.name === 'service same-parent update')?.rows).toHaveLength(2);
        return steps;
      } finally {
        await baseline.close();
      }
    }

    it('matches the pre-migration schema step by step when nothing is linked', async () => {
      const expected = await baselineSteps();
      const clean = await initDb(true);
      try {
        expect(await runManualControls(clean, true)).toEqual(expected);
      } finally {
        await clean.close();
      }
    });

    // Truncate is excluded here: it is blocked by design while any link exists.
    it('matches the pre-migration schema step by step next to a live linked draft', async () => {
      const expected = (await baselineSteps()).filter(s => s.name !== 'truncate items');
      const linkedDb = await initDb(true);
      const mainDb = db;
      db = linkedDb;
      try {
        await prepare(await approved());
      } finally {
        db = mainDb;
      }
      try {
        expect(await runManualControls(linkedDb, false)).toEqual(expected);
      } finally {
        await linkedDb.close();
      }
    });
  });
});
