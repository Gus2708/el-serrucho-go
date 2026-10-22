import type { PGlite } from '@electric-sql/pglite';
import { actAs, actAsAnon, actAsOwner, addUser, createMigratedDb } from './support/pgliteHarness';

jest.setTimeout(120_000);

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER_ADMIN = '22222222-2222-4222-8222-222222222222';
const SUPER = '33333333-3333-4333-8333-333333333333';
const EMPLEADO = '44444444-4444-4444-8444-444444444444';
const INACTIVO = '55555555-5555-4555-8555-555555555555';

const BUCKET = 'facturas_proveedores';

let db: PGlite;
let counter = 0;

function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function linea(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    linea_id: id,
    codigo_proveedor: 'P-100',
    codigo_producto: 'SKU-1',
    descripcion: 'Tornillo 1/4',
    cantidad_documento: '10',
    unidad_documento: 'UND',
    costo_unitario_documento: '1.250000',
    total_documento: '12.5000',
    nota: null,
    ...overrides,
  };
}

function cabecera(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proveedor_codigo: 'PROV-1',
    proveedor_nombre: 'Distribuidora Norte',
    numero_documento: 'A-001',
    numero_control: '00-123',
    fecha_documento: '2026-10-01',
    moneda: 'USD',
    notas: null,
    documento: null,
    ...overrides,
  };
}

interface SaveArgs {
  id: string;
  expected: number;
  key?: string;
  cab?: Record<string, unknown>;
  lineas?: Record<string, unknown>[];
}

async function save({ id, expected, key = uuid(), cab = cabecera(), lineas = [] }: SaveArgs) {
  const result = await db.query<{ r: { factura_id: string; version: number; replay: boolean } }>(
    'select public.guardar_factura_proveedor($1::uuid, $2::int, $3::uuid, $4::jsonb, $5::jsonb) as r',
    [id, expected, key, JSON.stringify(cab), JSON.stringify(lineas)],
  );
  return result.rows[0].r;
}

async function lineasDe(id: string) {
  const result = await db.query<{ linea_id: string; orden: number; codigo_producto: string; costo_unitario_documento: string }>(
    'select linea_id, orden, codigo_producto, costo_unitario_documento from public.facturas_proveedores_lineas where factura_id = $1 order by orden',
    [id],
  );
  return result.rows;
}

async function cabeceraDe(id: string) {
  const result = await db.query<{ version: number; numero_documento: string; documento_path: string | null }>(
    'select version, numero_documento, documento_path from public.facturas_proveedores where id = $1',
    [id],
  );
  return result.rows[0];
}

function docPath(owner: string, facturaId: string, ext = 'pdf'): string {
  return `${owner}/${facturaId}/${uuid()}.${ext}`;
}

// Storage records the real size and the declared Content-Type in objects.metadata.
async function subirObjeto(path: string, metadata: Record<string, unknown> = { size: 2048, mimetype: 'application/pdf' }): Promise<void> {
  await db.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb)', [
    BUCKET,
    path,
    JSON.stringify(metadata),
  ]);
}

function documento(path: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path,
    nombre: 'factura.pdf',
    mime: 'application/pdf',
    bytes: 2048,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

beforeAll(async () => {
  db = await createMigratedDb();
  await addUser(db, ADMIN, 'admin');
  await addUser(db, OTHER_ADMIN, 'admin');
  await addUser(db, SUPER, 'superempleado');
  await addUser(db, EMPLEADO, 'empleado');
  await addUser(db, INACTIVO, 'admin', false);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await actAs(db, ADMIN);
});

describe('guardar_factura_proveedor: persistencia', () => {
  it('crea la factura en version 1 y se reabre con lineas e IDs estables', async () => {
    const id = uuid();
    const [l1, l2] = [uuid(), uuid()];

    const result = await save({ id, expected: 0, lineas: [linea(l1), linea(l2, { codigo_producto: 'SKU-2' })] });

    expect(result).toEqual({ factura_id: id, version: 1, replay: false });
    const reabierta = await lineasDe(id);
    expect(reabierta.map(l => l.linea_id)).toEqual([l1, l2]);
    expect(reabierta.map(l => l.orden)).toEqual([1, 2]);
  });

  it('conserva lineas repetidas con el mismo SKU y costos distintos', async () => {
    const id = uuid();
    const [l1, l2] = [uuid(), uuid()];

    await save({
      id,
      expected: 0,
      lineas: [
        linea(l1, { codigo_producto: 'SKU-9', costo_unitario_documento: '2.000000' }),
        linea(l2, { codigo_producto: 'SKU-9', costo_unitario_documento: '2.500000' }),
      ],
    });

    const reabierta = await lineasDe(id);
    expect(reabierta).toHaveLength(2);
    expect(reabierta.map(l => l.codigo_producto)).toEqual(['SKU-9', 'SKU-9']);
    expect(reabierta.map(l => l.costo_unitario_documento)).toEqual(['2.000000', '2.500000']);
  });

  it('actualiza con la version esperada, conserva IDs, reordena y elimina las ausentes', async () => {
    const id = uuid();
    const [l1, l2, l3, l4] = [uuid(), uuid(), uuid(), uuid()];
    await save({ id, expected: 0, lineas: [linea(l1), linea(l2), linea(l3)] });

    const result = await save({
      id,
      expected: 1,
      cab: cabecera({ numero_documento: 'A-002' }),
      lineas: [linea(l3), linea(l1), linea(l4, { codigo_producto: 'SKU-4' })],
    });

    expect(result).toMatchObject({ version: 2, replay: false });
    expect((await lineasDe(id)).map(l => l.linea_id)).toEqual([l3, l1, l4]);
    expect((await cabeceraDe(id)).numero_documento).toBe('A-002');
  });
});

describe('guardar_factura_proveedor: versiones e idempotencia', () => {
  it('rechaza una version obsoleta sin tocar el estado', async () => {
    const id = uuid();
    const l1 = uuid();
    await save({ id, expected: 0, lineas: [linea(l1)] });
    await save({ id, expected: 1, cab: cabecera({ numero_documento: 'A-002' }), lineas: [linea(l1)] });

    await expect(
      save({ id, expected: 1, cab: cabecera({ numero_documento: 'A-STALE' }), lineas: [] }),
    ).rejects.toMatchObject({ code: 'PV409' });

    expect((await cabeceraDe(id)).version).toBe(2);
    expect((await cabeceraDe(id)).numero_documento).toBe('A-002');
    expect(await lineasDe(id)).toHaveLength(1);
  });

  it('rechaza crear de nuevo una factura existente con otra clave', async () => {
    const id = uuid();
    await save({ id, expected: 0, lineas: [linea(uuid())] });

    await expect(save({ id, expected: 0, lineas: [] })).rejects.toMatchObject({ code: 'PV409' });
  });

  it('un reintento con la misma clave y contenido devuelve el resultado sin incrementar la version', async () => {
    const id = uuid();
    const key = uuid();
    const l1 = uuid();
    const args = { id, expected: 0, key, lineas: [linea(l1)] };

    const first = await save(args);
    const retry = await save(args);

    expect(first).toEqual({ factura_id: id, version: 1, replay: false });
    expect(retry).toEqual({ factura_id: id, version: 1, replay: true });
    expect((await cabeceraDe(id)).version).toBe(1);
    expect(await lineasDe(id)).toHaveLength(1);
  });

  it('el reintento tardio sigue siendo idempotente aunque la factura ya avanzo', async () => {
    const id = uuid();
    const key = uuid();
    const l1 = uuid();
    await save({ id, expected: 0, key, lineas: [linea(l1)] });
    await save({ id, expected: 1, cab: cabecera({ numero_documento: 'A-002' }), lineas: [linea(l1)] });

    const lateRetry = await save({ id, expected: 0, key, lineas: [linea(l1)] });

    expect(lateRetry).toEqual({ factura_id: id, version: 1, replay: true });
    expect((await cabeceraDe(id)).version).toBe(2);
  });

  it('rechaza reutilizar una clave con contenido distinto', async () => {
    const id = uuid();
    const key = uuid();
    await save({ id, expected: 0, key, lineas: [linea(uuid())] });

    await expect(
      save({ id, expected: 1, key, cab: cabecera({ numero_documento: 'OTRA' }), lineas: [] }),
    ).rejects.toMatchObject({ code: 'PI409' });
    expect((await cabeceraDe(id)).version).toBe(1);
  });
});

describe('guardar_factura_proveedor: atomicidad y validacion', () => {
  it('revierte todo si un renglon es invalido y no consume la clave', async () => {
    const id = uuid();
    const l1 = uuid();
    await save({ id, expected: 0, lineas: [linea(l1)] });
    const key = uuid();

    await expect(
      save({
        id,
        expected: 1,
        key,
        cab: cabecera({ numero_documento: 'A-NUEVA' }),
        lineas: [linea(l1, { descripcion: 'cambiada' }), linea(uuid(), { cantidad_documento: '-5' })],
      }),
    ).rejects.toMatchObject({ code: '23514' });

    const cab = await cabeceraDe(id);
    expect(cab.version).toBe(1);
    expect(cab.numero_documento).toBe('A-001');
    const lineas = await db.query<{ descripcion: string }>(
      'select descripcion from public.facturas_proveedores_lineas where factura_id = $1',
      [id],
    );
    expect(lineas.rows.map(l => l.descripcion)).toEqual(['Tornillo 1/4']);

    const fixed = await save({ id, expected: 1, key, cab: cabecera({ numero_documento: 'A-NUEVA' }), lineas: [linea(l1)] });
    expect(fixed).toMatchObject({ version: 2, replay: false });
  });

  it('rechaza un linea_id que pertenece a otra factura', async () => {
    const mine = uuid();
    const theirs = uuid();
    const foreignLine = uuid();
    await save({ id: theirs, expected: 0, lineas: [linea(foreignLine)] });

    await expect(
      save({ id: mine, expected: 0, lineas: [linea(foreignLine)] }),
    ).rejects.toMatchObject({ code: '22023' });

    expect(await lineasDe(theirs)).toHaveLength(1);
    expect(await db.query('select 1 from public.facturas_proveedores where id = $1', [mine])).toMatchObject({ rows: [] });
  });

  it('rechaza linea_id repetidos dentro del mismo guardado', async () => {
    const dup = uuid();

    await expect(
      save({ id: uuid(), expected: 0, lineas: [linea(dup), linea(dup)] }),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('rechaza mas de 500 renglones', async () => {
    const lineas = Array.from({ length: 501 }, () => linea(uuid()));

    await expect(save({ id: uuid(), expected: 0, lineas })).rejects.toMatchObject({ code: '22023' });
  });

  it('acepta campos ilegibles como null sin inventar valores', async () => {
    const id = uuid();
    const l1 = uuid();

    await save({
      id,
      expected: 0,
      cab: cabecera({ proveedor_codigo: null, proveedor_nombre: null, fecha_documento: null, moneda: null }),
      lineas: [linea(l1, { cantidad_documento: null, costo_unitario_documento: null, total_documento: null })],
    });

    const row = await db.query<{ fecha_documento: string | null; cantidad_documento: string | null }>(
      `select f.fecha_documento, l.cantidad_documento
         from public.facturas_proveedores f
         join public.facturas_proveedores_lineas l on l.factura_id = f.id
        where f.id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ fecha_documento: null, cantidad_documento: null });
  });
});

describe('guardar_factura_proveedor: documento fuente privado', () => {
  it('adjunta un documento propio cuyo objeto existe en Storage', async () => {
    const id = uuid();
    const path = docPath(ADMIN, id);
    await subirObjeto(path);

    await save({ id, expected: 0, cab: cabecera({ documento: documento(path) }), lineas: [] });

    expect((await cabeceraDe(id)).documento_path).toBe(path);
  });

  it('rechaza una ruta de otro usuario o de otra factura', async () => {
    const id = uuid();
    const foreignPath = docPath(OTHER_ADMIN, id);
    const wrongInvoicePath = docPath(ADMIN, uuid());
    await actAsOwner(db);
    await subirObjeto(foreignPath);
    await subirObjeto(wrongInvoicePath);
    await actAs(db, ADMIN);

    await expect(
      save({ id, expected: 0, cab: cabecera({ documento: documento(foreignPath) }) }),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      save({ id, expected: 0, cab: cabecera({ documento: documento(wrongInvoicePath) }) }),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('rechaza un documento cuyo objeto no existe', async () => {
    const id = uuid();

    await expect(
      save({ id, expected: 0, cab: cabecera({ documento: documento(docPath(ADMIN, id)) }) }),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('rechaza MIME no permitido y tamano fuera de limite aunque Storage los registre', async () => {
    const htmlId = uuid();
    const htmlPath = docPath(ADMIN, htmlId);
    await subirObjeto(htmlPath, { size: 2048, mimetype: 'text/html' });
    const bigId = uuid();
    const bigPath = docPath(ADMIN, bigId);
    const tooBig = 10 * 1024 * 1024 + 1;
    await subirObjeto(bigPath, { size: tooBig, mimetype: 'application/pdf' });

    await expect(
      save({ id: htmlId, expected: 0, cab: cabecera({ documento: documento(htmlPath, { mime: 'text/html' }) }) }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      save({ id: bigId, expected: 0, cab: cabecera({ documento: documento(bigPath, { bytes: tooBig }) }) }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rechaza metadatos que no coinciden con lo que Storage registro del objeto', async () => {
    const id = uuid();
    const path = docPath(ADMIN, id);
    await subirObjeto(path, { size: 2048, mimetype: 'application/pdf' });

    await expect(
      save({ id, expected: 0, cab: cabecera({ documento: documento(path, { bytes: 4096 }) }) }),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      save({ id, expected: 0, cab: cabecera({ documento: documento(path, { mime: 'image/png' }) }) }),
    ).rejects.toMatchObject({ code: '22023' });
    await actAsOwner(db);
    expect((await db.query('select 1 from public.facturas_proveedores where id = $1', [id])).rows).toEqual([]);
  });

  it('no permite que dos facturas apunten al mismo archivo', async () => {
    const first = uuid();
    const path = docPath(ADMIN, first);
    await subirObjeto(path);
    await save({ id: first, expected: 0, cab: cabecera({ documento: documento(path) }) });

    await expect(
      save({ id: uuid(), expected: 0, cab: cabecera({ documento: documento(path) }) }),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('desvincular el documento lo libera para limpieza', async () => {
    const id = uuid();
    const path = docPath(ADMIN, id);
    await subirObjeto(path);
    await save({ id, expected: 0, cab: cabecera({ documento: documento(path) }) });

    await save({ id, expected: 1, cab: cabecera({ documento: null }) });

    expect((await cabeceraDe(id)).documento_path).toBeNull();
  });
});

describe('guardar_factura_proveedor: forma del documento', () => {
  // The idempotency ledger is internal-only, so it is read as the table owner.
  async function operacionesDe(id: string): Promise<number> {
    await actAsOwner(db);
    const result = await db.query<{ total: number }>(
      'select count(*)::int as total from public.facturas_proveedores_operaciones where factura_id = $1',
      [id],
    );
    await actAs(db, ADMIN);
    return result.rows[0].total;
  }

  async function facturaConDocumento() {
    const id = uuid();
    const lineaId = uuid();
    const path = docPath(ADMIN, id);
    await subirObjeto(path);
    await save({ id, expected: 0, cab: cabecera({ documento: documento(path) }), lineas: [linea(lineaId)] });
    return { id, lineaId, path };
  }

  it.each([
    ['texto', 'factura.pdf'],
    ['numero', 42],
    ['arreglo', [{ path: 'x' }]],
    ['booleano', true],
  ])('rechaza actualizar con un documento de tipo %s y deja todo intacto', async (_label, invalido) => {
    const { id, lineaId, path } = await facturaConDocumento();
    const key = uuid();

    await expect(
      save({
        id,
        expected: 1,
        key,
        cab: cabecera({ numero_documento: 'A-INVALIDA', documento: invalido }),
        lineas: [linea(lineaId, { descripcion: 'cambiada' }), linea(uuid(), { codigo_producto: 'SKU-NUEVO' })],
      }),
    ).rejects.toMatchObject({ code: '22023' });

    const cab = await cabeceraDe(id);
    expect(cab).toEqual({ version: 1, numero_documento: 'A-001', documento_path: path });
    const lineas = await db.query<{ linea_id: string; descripcion: string }>(
      'select linea_id, descripcion from public.facturas_proveedores_lineas where factura_id = $1',
      [id],
    );
    expect(lineas.rows).toEqual([{ linea_id: lineaId, descripcion: 'Tornillo 1/4' }]);
    expect(await operacionesDe(id)).toBe(1);
  });

  it.each([
    ['texto', 'factura.pdf'],
    ['numero', 42],
    ['arreglo', []],
  ])('rechaza crear con un documento de tipo %s sin dejar factura ni operacion', async (_label, invalido) => {
    const id = uuid();

    await expect(
      save({ id, expected: 0, cab: cabecera({ documento: invalido }), lineas: [linea(uuid())] }),
    ).rejects.toMatchObject({ code: '22023' });

    await actAsOwner(db);
    expect((await db.query('select 1 from public.facturas_proveedores where id = $1', [id])).rows).toEqual([]);
    expect(await operacionesDe(id)).toBe(0);
  });

  it('el rechazo no consume la clave: el mismo guardado con un documento valido o null prospera', async () => {
    const { id, lineaId } = await facturaConDocumento();
    const key = uuid();
    await expect(
      save({ id, expected: 1, key, cab: cabecera({ numero_documento: 'A-002', documento: 'x' }), lineas: [linea(lineaId)] }),
    ).rejects.toMatchObject({ code: '22023' });

    const retry = await save({
      id,
      expected: 1,
      key,
      cab: cabecera({ numero_documento: 'A-002', documento: null }),
      lineas: [linea(lineaId)],
    });

    expect(retry).toEqual({ factura_id: id, version: 2, replay: false });
    expect(await cabeceraDe(id)).toEqual({ version: 2, numero_documento: 'A-002', documento_path: null });
  });

  it('un documento objeto valido se sigue guardando y reemplaza al anterior', async () => {
    const { id, lineaId } = await facturaConDocumento();
    const nuevo = docPath(ADMIN, id, 'png');
    await subirObjeto(nuevo, { size: 4096, mimetype: 'image/png' });

    const result = await save({
      id,
      expected: 1,
      cab: cabecera({ documento: documento(nuevo, { mime: 'image/png', bytes: 4096, nombre: 'factura.png' }) }),
      lineas: [linea(lineaId)],
    });

    expect(result).toMatchObject({ version: 2, replay: false });
    expect((await cabeceraDe(id)).documento_path).toBe(nuevo);
  });

  it('documento null desvincula el archivo y guarda el resto del contenido', async () => {
    const { id, lineaId } = await facturaConDocumento();

    const result = await save({
      id,
      expected: 1,
      cab: cabecera({ numero_documento: 'A-003', documento: null }),
      lineas: [linea(lineaId, { descripcion: 'sin adjunto' })],
    });

    expect(result).toMatchObject({ version: 2, replay: false });
    expect(await cabeceraDe(id)).toEqual({ version: 2, numero_documento: 'A-003', documento_path: null });
    const lineas = await db.query<{ descripcion: string }>(
      'select descripcion from public.facturas_proveedores_lineas where factura_id = $1',
      [id],
    );
    expect(lineas.rows).toEqual([{ descripcion: 'sin adjunto' }]);
  });
});

describe('autorizacion en SQL', () => {
  it.each([
    ['admin', ADMIN],
    ['superempleado', SUPER],
  ])('%s activo puede guardar', async (_label, userId) => {
    await actAs(db, userId);

    const result = await save({ id: uuid(), expected: 0, lineas: [linea(uuid())] });

    expect(result.version).toBe(1);
  });

  it.each([
    ['empleado', EMPLEADO, true],
    ['admin inactivo', INACTIVO, true],
    ['admin con sesion invalida', ADMIN, false],
  ])('%s no puede guardar', async (_label, userId, sessionValid) => {
    await actAs(db, userId, sessionValid);
    const id = uuid();

    await expect(save({ id, expected: 0, lineas: [] })).rejects.toMatchObject({ code: '42501' });

    await actAsOwner(db);
    expect((await db.query('select 1 from public.facturas_proveedores where id = $1', [id])).rows).toEqual([]);
  });

  it('anon no puede ejecutar la RPC', async () => {
    await actAsAnon(db);

    await expect(save({ id: uuid(), expected: 0, lineas: [] })).rejects.toMatchObject({ code: '42501' });
  });

  it('otro usuario privilegiado no puede leer ni modificar facturas ajenas', async () => {
    const id = uuid();
    const l1 = uuid();
    await save({ id, expected: 0, lineas: [linea(l1)] });

    await actAs(db, OTHER_ADMIN);

    const visibles = await db.query('select id from public.facturas_proveedores where id = $1', [id]);
    const lineasVisibles = await db.query('select linea_id from public.facturas_proveedores_lineas where factura_id = $1', [id]);
    expect(visibles.rows).toEqual([]);
    expect(lineasVisibles.rows).toEqual([]);
    await expect(save({ id, expected: 1, lineas: [linea(l1)] })).rejects.toMatchObject({ code: '42501' });
    await expect(save({ id, expected: 0, lineas: [] })).rejects.toMatchObject({ code: '42501' });
  });

  it('solo el propietario privilegiado con sesion valida lee la factura', async () => {
    const id = uuid();
    await save({ id, expected: 0, lineas: [linea(uuid())] });

    const own = await db.query('select id from public.facturas_proveedores where id = $1', [id]);
    expect(own.rows).toHaveLength(1);

    await actAs(db, ADMIN, false);
    expect((await db.query('select id from public.facturas_proveedores where id = $1', [id])).rows).toEqual([]);
  });

  it('la escritura directa a las tablas esta denegada para authenticated', async () => {
    const id = uuid();
    const l1 = uuid();
    await save({ id, expected: 0, lineas: [linea(l1)] });

    await expect(
      db.query('insert into public.facturas_proveedores (id, creado_por) values ($1, $2)', [uuid(), ADMIN]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query('update public.facturas_proveedores set version = 99 where id = $1', [id]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query('delete from public.facturas_proveedores_lineas where linea_id = $1', [l1]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select 1 from public.facturas_proveedores_operaciones')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('superficie expuesta', () => {
  it('la RPC publica es SECURITY INVOKER y la implementacion privilegiada vive en un esquema privado', async () => {
    await actAsOwner(db);

    const procs = await db.query<{ schema: string; secdef: boolean; config: string[] | null }>(
      `select n.nspname as schema, p.prosecdef as secdef, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname = 'guardar_factura_proveedor' order by n.nspname`,
    );

    expect(procs.rows).toEqual([
      { schema: 'facturas_privado', secdef: true, config: ['search_path=""'] },
      { schema: 'public', secdef: false, config: ['search_path=""'] },
    ]);
  });

  it('ninguna funcion SECURITY DEFINER de esta migracion queda en el esquema public', async () => {
    await actAsOwner(db);

    const exposed = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and p.proname like '%factura%'`,
    );

    expect(exposed.rows).toEqual([]);
  });

  it('anon no puede ejecutar la implementacion privada ni usar el esquema', async () => {
    await actAsAnon(db);

    await expect(
      db.query("select facturas_privado.guardar_factura_proveedor($1::uuid, 0, $2::uuid, '{}'::jsonb, '[]'::jsonb)", [uuid(), uuid()]),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('Storage: bucket facturas_proveedores', () => {
  async function insertObject(name: string, bucket = BUCKET) {
    return db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]);
  }

  it('el bucket es privado y limita tamano y MIME', async () => {
    await actAsOwner(db);

    const bucket = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      'select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1',
      [BUCKET],
    );

    expect(bucket.rows[0].public).toBe(false);
    expect(Number(bucket.rows[0].file_size_limit)).toBe(10 * 1024 * 1024);
    expect(bucket.rows[0].allowed_mime_types).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  });

  it('un privilegiado puede subir bajo su carpeta con nombre valido', async () => {
    await expect(insertObject(docPath(ADMIN, uuid(), 'jpg'))).resolves.toBeDefined();
    await actAs(db, SUPER);
    await expect(insertObject(docPath(SUPER, uuid(), 'png'))).resolves.toBeDefined();
  });

  it('rechaza subir en la carpeta de otro usuario', async () => {
    await expect(insertObject(docPath(OTHER_ADMIN, uuid()))).rejects.toMatchObject({ code: '42501' });
  });

  it.each([
    ['empleado', EMPLEADO, true],
    ['admin inactivo', INACTIVO, true],
    ['sesion invalida', ADMIN, false],
  ])('%s no puede subir', async (_label, userId, sessionValid) => {
    await actAs(db, userId, sessionValid);

    await expect(insertObject(docPath(userId, uuid()))).rejects.toMatchObject({ code: '42501' });
  });

  it.each([
    ['extension no permitida', `${ADMIN}/${'0'.repeat(8)}-0000-4000-8000-000000000000/${'1'.repeat(8)}-1111-4111-8111-111111111111.exe`],
    ['ruta sin carpeta de factura', `${ADMIN}/${'1'.repeat(8)}-1111-4111-8111-111111111111.pdf`],
    ['nombre arbitrario', `${ADMIN}/${'0'.repeat(8)}-0000-4000-8000-000000000000/factura.pdf`],
    ['recorrido de rutas', `${ADMIN}/../${OTHER_ADMIN}/x.pdf`],
  ])('rechaza el nombre invalido: %s', async (_label, name) => {
    await expect(insertObject(name)).rejects.toMatchObject({ code: '42501' });
  });

  it('no gobierna otros buckets', async () => {
    await actAsOwner(db);
    await db.query("insert into storage.buckets (id, name) values ('otro', 'otro') on conflict do nothing");
    await actAs(db, ADMIN);

    await expect(insertObject(docPath(ADMIN, uuid()), 'otro')).rejects.toMatchObject({ code: '42501' });
  });

  it('un objeto subido no se puede sobrescribir (sin politica UPDATE)', async () => {
    const path = docPath(ADMIN, uuid());
    await insertObject(path);

    const update = await db.query("update storage.objects set name = name || 'x' where bucket_id = $1 and name = $2", [BUCKET, path]);

    expect(update.affectedRows).toBe(0);
  });

  it('solo el propietario lee su objeto', async () => {
    const path = docPath(ADMIN, uuid());
    await insertObject(path);

    expect((await db.query('select name from storage.objects where bucket_id = $1 and name = $2', [BUCKET, path])).rows).toHaveLength(1);
    await actAs(db, OTHER_ADMIN);
    expect((await db.query('select name from storage.objects where bucket_id = $1 and name = $2', [BUCKET, path])).rows).toEqual([]);
    await actAs(db, EMPLEADO);
    expect((await db.query('select name from storage.objects where bucket_id = $1 and name = $2', [BUCKET, path])).rows).toEqual([]);
  });

  it('solo se puede borrar un objeto propio que ninguna factura referencia', async () => {
    const id = uuid();
    const referenced = docPath(ADMIN, id);
    const orphan = docPath(ADMIN, uuid());
    await subirObjeto(referenced);
    await insertObject(orphan);
    await save({ id, expected: 0, cab: cabecera({ documento: documento(referenced) }) });

    const keep = await db.query('delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, referenced]);
    const drop = await db.query('delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, orphan]);

    expect(keep.affectedRows).toBe(0);
    expect(drop.affectedRows).toBe(1);

    await actAs(db, OTHER_ADMIN);
    const foreign = await db.query('delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, referenced]);
    expect(foreign.affectedRows).toBe(0);
  });
});

// The race itself needs two connections: see facturasProveedores.concurrent.probe.ts.
// These cover the single-connection behavior of the lock-and-recheck triggers.
describe('documento fuente: coordinacion guardado/borrado', () => {
  it('un guardado no puede enlazar un documento cuyo objeto ya fue borrado (recheck bajo el lock)', async () => {
    const id = uuid();
    const path = docPath(ADMIN, id);
    await subirObjeto(path);
    await db.query('delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, path]);

    // Writers other than the RPC are covered too: the invariant lives in a trigger.
    await actAsOwner(db);
    await db.query("insert into public.facturas_proveedores (id, creado_por, version) values ($1, $2, 1)", [id, ADMIN]);
    await expect(
      db.query('update public.facturas_proveedores set documento_path = $1 where id = $2', [path, id]),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('un objeto que una factura ya referencia no se borra ni siquiera sin pasar por la politica', async () => {
    const id = uuid();
    const path = docPath(ADMIN, id);
    await subirObjeto(path);
    await save({ id, expected: 0, cab: cabecera({ documento: documento(path) }) });

    await actAsOwner(db);
    const removed = await db.query('delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, path]);

    expect(removed.affectedRows).toBe(0);
    expect((await cabeceraDe(id)).documento_path).toBe(path);
  });

  it('al desvincular el documento, el objeto vuelve a poder borrarse', async () => {
    const id = uuid();
    const path = docPath(ADMIN, id);
    await subirObjeto(path);
    await save({ id, expected: 0, cab: cabecera({ documento: documento(path) }) });
    await save({ id, expected: 1, cab: cabecera({ documento: null }) });

    const removed = await db.query('delete from storage.objects where bucket_id = $1 and name = $2', [BUCKET, path]);

    expect(removed.affectedRows).toBe(1);
  });

  it('los triggers no son invocables ni expuestos al Data API', async () => {
    await actAsOwner(db);

    const exposed = await db.query<{ proname: string; can_run: boolean }>(
      `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as can_run
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'facturas_privado' and p.proname in ('bloquear_documento', 'exigir_documento_existente', 'proteger_documento_referenciado')`,
    );

    expect(exposed.rows).toHaveLength(3);
    expect(exposed.rows.every(row => !row.can_run)).toBe(true);
  });
});
