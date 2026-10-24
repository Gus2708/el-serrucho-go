import { createFacturaRevisionRepository, RevisionRepositoryError, type RevisionClient } from './facturaRevisionRepository';
import { crearRevisionManual } from './facturaRevision';
import type { ExtraidaLinea } from './facturaExtractionContract';

const FACTURA = 'f0000000-0000-4000-8000-000000000001';
const CLAVE = 'c0000000-0000-4000-8000-000000000001';
const EXTRACCION = 'e0000000-0000-4000-8000-000000000001';

interface Answer {
  data?: unknown;
  error?: { code?: string; message?: string; status?: number } | null;
  status?: number;
}

interface Call {
  table: string;
  steps: Array<[string, ...unknown[]]>;
}

function fakeClient(options: {
  rpc?: Answer | (() => Promise<Answer>);
  tables?: Record<string, Answer | ((call: Call) => Answer)>;
  invoke?: () => Promise<{ data: unknown; error: unknown }>;
}) {
  const calls: Call[] = [];
  const rpc = jest.fn(async (..._args: unknown[]) => {
    const answer = typeof options.rpc === 'function' ? await options.rpc() : options.rpc ?? { data: null };
    return { data: answer.data ?? null, error: answer.error ?? null, status: answer.status ?? 200 };
  });
  const invoke = jest.fn(options.invoke ?? (async () => ({ data: null, error: null })));
  const from = jest.fn((table: string) => {
    const call: Call = { table, steps: [] };
    calls.push(call);
    const proxy: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'limit', 'eq', 'in', 'ilike', 'or', 'range']) {
      proxy[method] = (...args: unknown[]) => {
        call.steps.push([method, ...args]);
        return proxy;
      };
    }
    proxy.then = (resolve: (value: unknown) => unknown) => {
      const entry = options.tables?.[table];
      const answer = typeof entry === 'function' ? entry(call) : entry ?? { data: [] };
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null }).then(resolve);
    };
    return proxy;
  });
  const client = { rpc, from, functions: { invoke } } as unknown as RevisionClient;
  return { client, rpc, invoke, from, calls };
}

const stepsOf = (call: Call, name: string) => call.steps.filter(([step]) => step === name);

describe('guardarRevision / aprobarRevision wire contract', () => {
  const contenido = crearRevisionManual();
  const input = { facturaId: FACTURA, revisionEsperada: 2, clave: CLAVE, facturaVersion: 4, extraccionId: null, contenido, motivo: 'Cambio explicito' };

  it('calls the public RPC with the exact parameter names and returns revision, fingerprint and replay', async () => {
    const { client, rpc } = fakeClient({ rpc: { data: { factura_id: FACTURA, revision: 3, fingerprint: 'a'.repeat(64), replay: false } } });
    const result = await createFacturaRevisionRepository(client).guardarRevision(input);
    expect(result).toEqual({ revision: 3, fingerprint: 'a'.repeat(64), replay: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('guardar_revision_factura', {
      p_factura_id: FACTURA,
      p_revision_esperada: 2,
      p_clave: CLAVE,
      p_factura_version: 4,
      p_extraccion_id: null,
      p_contenido: contenido,
      p_motivo: 'Cambio explicito',
    });
  });

  it('reports a server replay', async () => {
    const { client } = fakeClient({ rpc: { data: { factura_id: FACTURA, revision: 3, fingerprint: 'b'.repeat(64), replay: true } } });
    expect(await createFacturaRevisionRepository(client).guardarRevision(input)).toMatchObject({ replay: true });
  });

  it('attests with the exact parameter names', async () => {
    const { client, rpc } = fakeClient({ rpc: { data: { factura_id: FACTURA, revision: 3, fingerprint: 'a'.repeat(64), replay: false } } });
    const result = await createFacturaRevisionRepository(client).aprobarRevision({ facturaId: FACTURA, revision: 3, fingerprint: 'a'.repeat(64), facturaVersion: 4 });
    expect(result.revision).toBe(3);
    expect(rpc).toHaveBeenCalledWith('aprobar_revision_factura', {
      p_factura_id: FACTURA,
      p_revision: 3,
      p_fingerprint: 'a'.repeat(64),
      p_factura_version: 4,
    });
  });

  it.each([
    ['PR409', 'revision_obsoleta'],
    ['PV409', 'version_obsoleta'],
    ['PI409', 'clave_reutilizada'],
    ['42501', 'no_autorizado'],
    ['22023', 'datos_invalidos'],
    ['P0002', 'no_encontrada'],
    ['42P01', 'no_disponible'],
    ['PGRST202', 'no_disponible'],
    ['XX000', 'desconocido'],
  ])('maps SQLSTATE %s to %s', async (sqlState, expected) => {
    const { client } = fakeClient({ rpc: { error: { code: sqlState, message: 'raw server text with SECRET-123' } } });
    const failure = await createFacturaRevisionRepository(client).guardarRevision(input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RevisionRepositoryError);
    expect((failure as RevisionRepositoryError).code).toBe(expected);
    expect((failure as RevisionRepositoryError).message).not.toContain('SECRET-123');
  });

  it('maps a thrown network failure to red and a malformed answer to desconocido', async () => {
    const lost = fakeClient({ rpc: () => Promise.reject(new Error('Network request failed')) });
    await expect(createFacturaRevisionRepository(lost.client).guardarRevision(input)).rejects.toMatchObject({ code: 'red' });
    const malformed = fakeClient({ rpc: { data: { revision: 'tres' } } });
    await expect(createFacturaRevisionRepository(malformed.client).guardarRevision(input)).rejects.toMatchObject({ code: 'desconocido' });
  });
});

describe('reading history through RLS', () => {
  it('reads the saved revisions of one invoice in order, mapped to camelCase', async () => {
    const row = {
      revision: 1, clave: CLAVE, factura_version: 2, extraccion_id: EXTRACCION, documento_sha256: 'a'.repeat(64),
      contenido: { x: 1 }, fingerprint: 'f'.repeat(64), motivo: null, creado_por: 'u1', aprobado_por: null, aprobado_en: null,
    };
    const { client, calls } = fakeClient({ tables: { facturas_proveedores_revisiones: { data: [row] } } });
    const rows = await createFacturaRevisionRepository(client).leerRevisiones(FACTURA);
    expect(rows).toEqual([{ revision: 1, clave: CLAVE, facturaVersion: 2, extraccionId: EXTRACCION, documentoSha256: 'a'.repeat(64), contenido: { x: 1 }, fingerprint: 'f'.repeat(64), motivo: null, creadoPor: 'u1', aprobadoPor: null, aprobadoEn: null }]);
    expect(calls[0].table).toBe('facturas_proveedores_revisiones');
    expect(stepsOf(calls[0], 'eq')).toEqual([['eq', 'factura_id', FACTURA]]);
    expect(stepsOf(calls[0], 'order')).toEqual([['order', 'revision', { ascending: true }]]);
    expect(stepsOf(calls[0], 'limit')).toHaveLength(1);
  });

  it('reads extraction attempts newest first', async () => {
    const row = { id: EXTRACCION, solicitud_id: CLAVE, estado: 'completado', factura_version: 2, documento_sha256: 'a'.repeat(64), resultado: { version: 1 }, error_codigo: null, iniciado_en: '2026-10-23T00:00:00Z' };
    const { client, calls } = fakeClient({ tables: { facturas_proveedores_extracciones: { data: [row] } } });
    const rows = await createFacturaRevisionRepository(client).leerExtracciones(FACTURA);
    expect(rows[0]).toMatchObject({ id: EXTRACCION, solicitudId: CLAVE, estado: 'completado', facturaVersion: 2, errorCodigo: null });
    expect(stepsOf(calls[0], 'order')).toEqual([['order', 'iniciado_en', { ascending: false }]]);
  });

  it('maps a missing relation to no_disponible so manual entry keeps working', async () => {
    const { client } = fakeClient({ tables: { facturas_proveedores_revisiones: { error: { code: '42P01' } }, facturas_proveedores_extracciones: { error: { code: 'PGRST205' } } } });
    const repo = createFacturaRevisionRepository(client);
    await expect(repo.leerRevisiones(FACTURA)).rejects.toMatchObject({ code: 'no_disponible' });
    await expect(repo.leerExtracciones(FACTURA)).rejects.toMatchObject({ code: 'no_disponible' });
  });

  it('rejects rows with an unknown shape instead of passing them on', async () => {
    const { client } = fakeClient({ tables: { facturas_proveedores_revisiones: { data: [{ revision: 'uno' }] } } });
    await expect(createFacturaRevisionRepository(client).leerRevisiones(FACTURA)).rejects.toMatchObject({ code: 'desconocido' });
  });
});

describe('extraer: one explicit call, typed outcomes, never a retry', () => {
  const entrada = { facturaId: FACTURA, solicitudId: CLAVE, versionEsperada: 3 };
  const http = (status: number, body: unknown) => ({ name: 'FunctionsHttpError', context: { status, json: async () => body } });

  it('sends exactly the existing request shape once', async () => {
    const { client, invoke } = fakeClient({ invoke: async () => ({ data: { estado: 'completado', extraccionId: EXTRACCION, replay: false }, error: null }) });
    const result = await createFacturaRevisionRepository(client).extraer(entrada);
    expect(result).toEqual({ tipo: 'completado', extraccionId: EXTRACCION, replay: false });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('procesar-factura-multimodal', { body: { facturaId: FACTURA, solicitudId: CLAVE, versionEsperada: 3 } });
  });

  it('reports a quarantined result as such', async () => {
    const { client } = fakeClient({ invoke: async () => ({ data: { estado: 'cuarentena', extraccionId: EXTRACCION, replay: false }, error: null }) });
    expect(await createFacturaRevisionRepository(client).extraer(entrada)).toMatchObject({ tipo: 'cuarentena' });
  });

  it.each([
    ['409 busy', http(409, { error: { code: 'extraccion_en_curso' } }), { tipo: 'en_curso' }],
    ['500 recoverable persistence', http(500, { error: { code: 'persistence_error' }, recuperable: true }), { tipo: 'incierto' }],
    ['502 upstream', http(502, { error: { code: 'upstream_error' } }), { tipo: 'incierto' }],
    ['network failure', { name: 'FunctionsFetchError', message: 'Failed to fetch' }, { tipo: 'incierto' }],
    ['403 not authorized', http(403, { error: { code: 'no_autorizado' } }), { tipo: 'rechazado', codigo: 'no_autorizado' }],
    ['401 unauthorized', http(401, { error: { code: 'unauthorized' } }), { tipo: 'rechazado', codigo: 'unauthorized' }],
    ['422 invalid document', http(422, { error: { code: 'invalid_document' } }), { tipo: 'rechazado', codigo: 'invalid_document' }],
    ['400 no document', http(400, { error: { code: 'sin_documento_fuente' } }), { tipo: 'rechazado', codigo: 'sin_documento_fuente' }],
    ['404 invoice', http(404, { error: { code: 'factura_no_encontrada' } }), { tipo: 'rechazado', codigo: 'factura_no_encontrada' }],
    ['404 function not deployed', http(404, { message: 'Function not found' }), { tipo: 'no_disponible' }],
    ['relay error', { name: 'FunctionsRelayError', message: 'relay' }, { tipo: 'no_disponible' }],
  ])('maps %s without calling again', async (_name, error, expected) => {
    const { client, invoke } = fakeClient({ invoke: async () => ({ data: null, error }) });
    expect(await createFacturaRevisionRepository(client).extraer(entrada)).toEqual(expected);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('treats a thrown invoke as an uncertain outcome', async () => {
    const { client, invoke } = fakeClient({ invoke: () => Promise.reject(new Error('socket hang up')) });
    expect(await createFacturaRevisionRepository(client).extraer(entrada)).toEqual({ tipo: 'incierto' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not leak unreadable error bodies', async () => {
    const error = { name: 'FunctionsHttpError', context: { status: 500, json: async () => { throw new Error('not json'); } } };
    const { client } = fakeClient({ invoke: async () => ({ data: null, error }) });
    expect(await createFacturaRevisionRepository(client).extraer(entrada)).toEqual({ tipo: 'incierto' });
  });
});

describe('bounded catalog reads', () => {
  const linea = (numeroLinea: number, over: Partial<ExtraidaLinea> = {}): ExtraidaLinea => ({
    numeroLinea, pagina: 1, codigoProveedor: `COD${numeroLinea}`, descripcion: `Tornillo ${numeroLinea}`, cantidad: '1', unidad: 'UND',
    precioUnitario: '1', descuentos: [], tasaIva: '16', total: null, incertidumbre: null, ...over,
  });
  const producto = (codigo: string, barras: string | null = null) => ({ codigo_interno: codigo, descripcion: `P ${codigo}`, codigo_barras: barras, existencia: 0, costo: 1, precio_venta: 2 });

  it('never downloads the whole catalog: every read is filtered and capped', async () => {
    const { client, calls } = fakeClient({ tables: { productos_view: { data: [producto('A')] } } });
    const result = await createFacturaRevisionRepository(client).buscarCandidatos([linea(1), linea(2)]);
    expect(result.productos.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.table).toBe('productos_view');
      expect(stepsOf(call, 'limit').length).toBe(1);
      expect(stepsOf(call, 'in').length + stepsOf(call, 'ilike').length).toBeGreaterThan(0);
    }
  });

  it('keeps hostile invoice text out of filter syntax', async () => {
    const hostil = 'x%,descripcion.eq.1),or(codigo_barras.neq.0';
    const { client, calls } = fakeClient({ tables: { productos_view: { data: [] } } });
    await createFacturaRevisionRepository(client).buscarCandidatos([linea(1, { descripcion: hostil, codigoProveedor: hostil })]);
    const used = calls.flatMap(call => call.steps).flatMap(step => step.slice(1)).filter((value): value is string => typeof value === 'string');
    expect(calls.flatMap(call => stepsOf(call, 'or'))).toEqual([]);
    for (const text of used) expect(text).not.toMatch(/[,()]/);
    for (const call of calls) for (const [, , values] of stepsOf(call, 'in')) expect(JSON.stringify(values)).not.toMatch(/[,()%*"]/);
  });

  it('marks the result partial when a code cannot be queried safely, a cap is hit or a read fails', async () => {
    const hostile = fakeClient({ tables: { productos_view: { data: [] } } });
    expect((await createFacturaRevisionRepository(hostile.client).buscarCandidatos([linea(1, { codigoProveedor: 'A,B)' })])).parcial).toBe(true);
    const capped = fakeClient({ tables: { productos_view: { data: Array.from({ length: 500 }, (_x, i) => producto(`P${i}`)) } } });
    expect((await createFacturaRevisionRepository(capped.client).buscarCandidatos([linea(1)])).parcial).toBe(true);
    const failing = fakeClient({ tables: { productos_view: { error: { code: 'XX000' } } } });
    expect(await createFacturaRevisionRepository(failing.client).buscarCandidatos([linea(1)])).toMatchObject({ productos: [], parcial: true });
    const fine = fakeClient({ tables: { productos_view: { data: [producto('A')] } } });
    expect((await createFacturaRevisionRepository(fine.client).buscarCandidatos([linea(1)])).parcial).toBe(false);
  });

  it('de-duplicates products found by several reads', async () => {
    const { client } = fakeClient({ tables: { productos_view: { data: [producto('A'), producto('A')] } } });
    const result = await createFacturaRevisionRepository(client).buscarCandidatos([linea(1), linea(2)]);
    expect(result.productos.map(p => p.codigo_interno)).toEqual(['A']);
  });

  describe('barcode collisions', () => {
    it('reads codigo_barras and codigo_interno independently and exactly', async () => {
      const { client, calls } = fakeClient({
        tables: { productos_view: (call: Call) => ({ data: stepsOf(call, 'in')[0]?.[1] === 'codigo_barras' ? [producto('B', '00123A')] : [] }) },
      });
      const result = await createFacturaRevisionRepository(client).leerColisionesBarras(['00123A']);
      const columns = calls.map(call => stepsOf(call, 'in')[0]?.[1]).sort();
      expect(columns).toEqual(['codigo_barras', 'codigo_interno']);
      expect(result['00123A'].completo).toBe(true);
      expect(result['00123A'].productos).toEqual([{ codigoInterno: 'B', codigoBarras: '00123A' }]);
    });

    it('counts an internal-code match as a collision entry', async () => {
      const { client } = fakeClient({
        tables: { productos_view: (call: Call) => ({ data: stepsOf(call, 'in')[0]?.[1] === 'codigo_interno' ? [producto('7501', null)] : [] }) },
      });
      const result = await createFacturaRevisionRepository(client).leerColisionesBarras(['7501']);
      expect(result['7501'].productos).toEqual([{ codigoInterno: '7501', codigoBarras: '7501' }]);
    });

    it('is complete only when both reads succeed under the cap for a safe code', async () => {
      const ok = await createFacturaRevisionRepository(fakeClient({ tables: { productos_view: { data: [] } } }).client).leerColisionesBarras(['999']);
      expect(ok['999']).toEqual({ productos: [], completo: true });

      const capped = fakeClient({ tables: { productos_view: { data: Array.from({ length: 500 }, (_x, i) => producto(`P${i}`, '999')) } } });
      expect((await createFacturaRevisionRepository(capped.client).leerColisionesBarras(['999']))['999'].completo).toBe(false);

      const oneFails = fakeClient({ tables: { productos_view: (call: Call) => (stepsOf(call, 'in')[0]?.[1] === 'codigo_interno' ? { error: { code: 'XX000' } } : { data: [] }) } });
      expect((await createFacturaRevisionRepository(oneFails.client).leerColisionesBarras(['999']))['999'].completo).toBe(false);

      const unsafe = await createFacturaRevisionRepository(fakeClient({ tables: { productos_view: { data: [] } } }).client).leerColisionesBarras(['9,9']);
      expect(unsafe['9,9']).toEqual({ productos: [], completo: false });
    });

    it('preserves leading zeros and letters in the literal code', async () => {
      const { client, calls } = fakeClient({ tables: { productos_view: { data: [] } } });
      await createFacturaRevisionRepository(client).leerColisionesBarras(['000123A']);
      expect(stepsOf(calls[0], 'in')[0][2]).toEqual(['000123A']);
    });
  });
});
