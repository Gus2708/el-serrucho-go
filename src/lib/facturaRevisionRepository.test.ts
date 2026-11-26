import {
  createFacturaRevisionRepository,
  FACTURA_ACTUAL_SUPPLIER_SCOPE,
  RevisionRepositoryError,
  type ContextoBusquedaHibrida,
  type RevisionClient,
} from './facturaRevisionRepository';
import { MATCHING_NORMALIZATION_VERSION } from './facturaMatching';
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
  invoke?: (...args: any[]) => Promise<{ data: unknown; error: unknown }>;
}) {
  const calls: Call[] = [];
  const rpc = jest.fn(async (..._args: unknown[]) => {
    const answer = typeof options.rpc === 'function' ? await options.rpc() : options.rpc ?? { data: { decisiones: [] } };
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
  function ilikeToRegex(pattern: string): RegExp {
    let source = '^';
    for (let i = 0; i < pattern.length; i += 1) {
      const ch = pattern[i];
      if (ch === '\\' && i + 1 < pattern.length) {
        source += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        i += 1;
      } else if (ch === '%') {
        source += '.*';
      } else if (ch === '_') {
        source += '.';
      } else {
        source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    return new RegExp(`${source}$`, 'i');
  }

  const responderCatalogo = (catalog: ReturnType<typeof producto>[]) => (call: Call): Answer => {
    const rows = catalog.filter(row => {
      const inMatches = stepsOf(call, 'in').every(([, column, values]) =>
        Array.isArray(values) && values.includes(row[column as keyof typeof row])
      );
      const descriptionMatches = stepsOf(call, 'ilike').every(([, column, pattern]) => {
        if (typeof pattern !== 'string') return false;
        return ilikeToRegex(pattern).test(String(row[column as keyof typeof row] ?? ''));
      });
      return inMatches && descriptionMatches;
    });
    return { data: rows };
  };

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

  it('retrieves a compatible description match when the catalog terms appear in another order', async () => {
    const item = { ...producto('CAT-1'), descripcion: 'Galvanizado tornillo hexagonal 1/4' };
    const sameOrderItem = { ...producto('CAT-2'), descripcion: 'Tornillo hexagonal galvanizado 1/4' };
    const catalog = [item, sameOrderItem];
    const { client } = fakeClient({
      tables: { productos_view: responderCatalogo(catalog) },
    });

    const result = await createFacturaRevisionRepository(client).buscarCandidatos([
      linea(1, { codigoProveedor: null, descripcion: 'Tornillo hexagonal galvanizado 1/4' }),
    ]);

    expect(result.productos).toEqual([item, sameOrderItem]);
    expect(result.parcial).toBe(false);
  });

  describe('description search terms', () => {
    const descriptionReads = (calls: Call[]) =>
      calls
        .map(call => stepsOf(call, 'ilike').filter(([, column]) => column === 'descripcion').map(([, , pattern]) => pattern))
        .filter(patterns => patterns.length > 0);

    it('ignores a bracketed supplier code, stopwords and unit-bearing tokens in the search words only', async () => {
      const retenes = { ...producto('CAT-1'), descripcion: 'ALICATE PARA RETENES 6 4PZAS BRUFER' };
      const electricista = { ...producto('CAT-2'), descripcion: 'ALICATE ELECTRICISTA 8 BRUFER' };
      const input = [linea(1, { codigoProveedor: null, descripcion: '[UID7118] ALICATE PARA RETENES DE 6" 4 PZAS' })];
      const snapshot = JSON.stringify(input);
      const { client, calls, invoke } = fakeClient({ tables: { productos_view: responderCatalogo([retenes, electricista]) } });

      const result = await createFacturaRevisionRepository(client).buscarCandidatos(input);

      expect(descriptionReads(calls)).toEqual([['%ALICATE%', '%RETENE%']]);
      expect(result.productos).toEqual([retenes]);
      expect(result.parcial).toBe(false);
      expect(JSON.stringify(input)).toBe(snapshot);
      expect(invoke).not.toHaveBeenCalled();
    });

    it('finds a catalog row that spells a measurement differently from the printed token', async () => {
      const plug = { ...producto('CAT-1'), descripcion: 'ENCHUFE 30A 4 POLO GENERADOR L14-30P CLASSIC LUX' };
      const socket = { ...producto('CAT-2'), descripcion: 'TOMA 30AMP 4 POLOS P/GENERADOR L14-30R CLASSIC LUX' };
      const { client, calls } = fakeClient({ tables: { productos_view: responderCatalogo([plug, socket]) } });

      const result = await createFacturaRevisionRepository(client).buscarCandidatos([
        linea(1, { codigoProveedor: null, descripcion: 'ENCHUFE 30amp 4 POLO GENERADOR L14-30P CLASSIC LUX' }),
      ]);

      expect(descriptionReads(calls)).toEqual([['%ENCHUFE%', '%POLO%']]);
      expect(result.productos).toEqual([plug]);
    });

    it('matches a plural printed word against its singular catalog spelling', async () => {
      const grapa = { ...producto('CAT-1'), descripcion: 'GRAPA REDONDA 1/2 CAJA' };
      const { client, calls } = fakeClient({ tables: { productos_view: responderCatalogo([grapa]) } });

      const result = await createFacturaRevisionRepository(client).buscarCandidatos([
        linea(1, { codigoProveedor: null, descripcion: 'Grapas Redondas 1/2' }),
      ]);

      expect(descriptionReads(calls)).toEqual([['%Grapa%', '%Redonda%']]);
      expect(result.productos).toEqual([grapa]);
    });

    it('keeps the narrower raw terms when fewer than two search words remain, instead of scanning one common word', async () => {
      const wanted = { ...producto('CAT-1'), descripcion: 'Cemento 30x50 blanco' };
      const sibling = { ...producto('CAT-2'), descripcion: 'Cemento gris 25x50' };
      const { client, calls } = fakeClient({ tables: { productos_view: responderCatalogo([wanted, sibling]) } });

      const result = await createFacturaRevisionRepository(client).buscarCandidatos([
        linea(1, { codigoProveedor: null, descripcion: 'Cemento 30x50' }),
      ]);

      expect(descriptionReads(calls)).toEqual([['%Cemento%', '%30x50%']]);
      expect(result.productos).toEqual([wanted]);
    });

    it('reuses one read for lines that reduce to the same words and keeps the 40-read cap as partial', async () => {
      const same = fakeClient({ tables: { productos_view: responderCatalogo([]) } });
      const sameResult = await createFacturaRevisionRepository(same.client).buscarCandidatos([
        linea(1, { codigoProveedor: null, descripcion: 'Tornillo hexagonal 1/4' }),
        linea(2, { codigoProveedor: null, descripcion: 'Tornillos hexagonal 3/8' }),
      ]);
      expect(descriptionReads(same.calls)).toEqual([['%Tornillo%', '%hexagonal%']]);
      expect(sameResult.parcial).toBe(false);

      const distinct = Array.from({ length: 45 }, (_x, i) =>
        linea(i + 1, { codigoProveedor: null, descripcion: `Articulo${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} comun` })
      );
      const many = fakeClient({ tables: { productos_view: responderCatalogo([]) } });
      const manyResult = await createFacturaRevisionRepository(many.client).buscarCandidatos(distinct);
      expect(descriptionReads(many.calls)).toHaveLength(40);
      expect(manyResult.parcial).toBe(true);
    });

    it('marks the result partial when a description read reaches the cap or fails, keeping exact-code products', async () => {
      const exact = producto('00123');
      const capped = fakeClient({
        tables: { productos_view: (call: Call) => ({ data: Array.from({ length: stepsOf(call, 'ilike').length > 0 ? 200 : 0 }, (_x, i) => producto(`CAP${i}`)) }) },
      });
      const cappedResult = await createFacturaRevisionRepository(capped.client).buscarCandidatos([
        linea(1, { codigoProveedor: null, descripcion: 'Tornillo hexagonal' }),
      ]);
      expect(cappedResult.parcial).toBe(true);
      expect(cappedResult.productos).toHaveLength(200);

      const failing = fakeClient({
        tables: {
          productos_view: (call: Call) => (stepsOf(call, 'ilike').length > 0 ? { error: { code: 'XX000' } } : responderCatalogo([exact])(call)),
        },
      });
      const failResult = await createFacturaRevisionRepository(failing.client).buscarCandidatos([
        linea(1, { codigoProveedor: '00123', descripcion: 'Tornillo hexagonal' }),
      ]);
      expect(failResult.productos).toEqual([exact]);
      expect(failResult.parcial).toBe(true);
      expect(failing.calls.flatMap(call => stepsOf(call, 'in'))).toContainEqual(['in', 'codigo_interno', ['00123']]);
    });

    it('returns description-found candidates next to the session-bound hybrid evidence', async () => {
      const retenes = { ...producto('CAT-1'), descripcion: 'ALICATE PARA RETENES 6 4PZAS BRUFER' };
      const other = { ...producto('CAT-2'), descripcion: 'PINZA SACA RETEN 3PCS' };
      const context = { facturaId: FACTURA, extraccionId: EXTRACCION, versionEsperada: 3 };
      const { client, invoke } = fakeClient({
        tables: { productos_view: responderCatalogo([retenes, other]) },
        invoke: async () => ({ data: { hybridRanks: [{ lineIndex: 0, lexical: [{ codigoInterno: 'CAT-2', rank: 1 }] }], parcial: false }, error: null }),
        rpc: { data: { decisiones: [] } },
      });

      const result = await createFacturaRevisionRepository(client).buscarCandidatos(
        [linea(1, { codigoProveedor: null, descripcion: '[UID7118] ALICATE PARA RETENES DE 6" 4 PZAS' })],
        context,
      );

      expect(result.productos.map(p => p.codigo_interno).sort()).toEqual(['CAT-1', 'CAT-2']);
      expect(result.parcial).toBe(false);
      expect(result.hybridRanks).toEqual([{ lineIndex: 0, lexical: [{ codigoInterno: 'CAT-2', rank: 1 }] }]);
      expect(invoke).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps exact internal-code and barcode reads when descriptions are empty', async () => {
    const internal = producto('SKU-A');
    const barcode = producto('SKU-B', '00123A');
    const { client, calls } = fakeClient({ tables: { productos_view: responderCatalogo([internal, barcode]) } });

    const result = await createFacturaRevisionRepository(client).buscarCandidatos([
      linea(1, { codigoProveedor: 'SKU-A', descripcion: null }),
      linea(2, { codigoProveedor: '00123A', descripcion: null }),
    ]);

    expect(result.productos).toEqual([internal, barcode]);
    expect(result.parcial).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls.flatMap(call => stepsOf(call, 'ilike'))).toEqual([]);
  });

  it('retrieves S23 supplier references and internal codes across case and edge-whitespace variance without mutating input', async () => {
    const byRef = producto('7591234000018', 'AB-0042');
    const byInternal = producto('00123A', 'SIN_CODIGO');
    const numeric = producto('7590000000099', '00123');
    const stripped = producto('7590000000088', '123');
    const input = [
      linea(1, { codigoProveedor: ' ab-0042 ', descripcion: null }),
      linea(2, { codigoProveedor: '00123a', descripcion: null }),
      linea(3, { codigoProveedor: ' 00123 ', descripcion: null }),
    ];
    const snapshot = JSON.stringify(input);
    const { client, calls } = fakeClient({ tables: { productos_view: responderCatalogo([byRef, byInternal, numeric, stripped]) } });

    const result = await createFacturaRevisionRepository(client).buscarCandidatos(input);

    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.productos.map(p => p.codigo_interno)).toEqual(['7590000000099', '7591234000018', '00123A']);
    expect(result.parcial).toBe(false);
    expect(calls.flatMap(call => stepsOf(call, 'or'))).toEqual([]);
    const ilikePatterns = calls.flatMap(call => stepsOf(call, 'ilike')).map(([, , pattern]) => pattern);
    expect(ilikePatterns).not.toContain('00123');
  });

  it('escapes underscores literally in case-insensitive fallback so wildcards never broaden matches', async () => {
    const exactUnderscore = producto('7591234000018', 'AB_01');
    const otherChar = producto('7591234000019', 'ABX01');
    const hyphen = producto('7591234000020', 'AB-01');
    const { client, calls } = fakeClient({
      tables: { productos_view: responderCatalogo([exactUnderscore, otherChar, hyphen]) },
    });

    const result = await createFacturaRevisionRepository(client).buscarCandidatos([
      linea(1, { codigoProveedor: 'ab_01', descripcion: null }),
    ]);

    expect(result.productos).toEqual([exactUnderscore]);
    expect(result.parcial).toBe(false);
    const ilikeSteps = calls.flatMap(call => stepsOf(call, 'ilike'));
    expect(ilikeSteps).toEqual([
      ['ilike', 'codigo_interno', 'ab\\_01'],
      ['ilike', 'codigo_barras', 'ab\\_01'],
    ]);
  });

  it('skips fallback for unresolved non-letter codes and bounds unresolved letter-code fallbacks', async () => {
    const nonLetter = fakeClient({ tables: { productos_view: responderCatalogo([]) } });
    const nonLetterResult = await createFacturaRevisionRepository(nonLetter.client).buscarCandidatos([
      linea(1, { codigoProveedor: '00-123/45', descripcion: null }),
    ]);
    expect(nonLetterResult).toEqual({ productos: [], parcial: false });
    expect(nonLetter.calls.flatMap(call => stepsOf(call, 'ilike'))).toEqual([]);

    const manyLines = Array.from({ length: 45 }, (_x, i) => linea(i + 1, { codigoProveedor: `ref-${i + 1}`, descripcion: null }));
    const many = fakeClient({ tables: { productos_view: responderCatalogo([]) } });
    const manyResult = await createFacturaRevisionRepository(many.client).buscarCandidatos(manyLines);
    expect(manyResult.parcial).toBe(true);
    expect(many.calls.filter(call => stepsOf(call, 'ilike').length > 0)).toHaveLength(80);
  });

  it('marks partial when a case-insensitive fallback read fails or hits the cap and preserves hybrid/feedback flow', async () => {
    const failing = fakeClient({
      tables: {
        productos_view: (call: Call) => (stepsOf(call, 'ilike').length > 0 ? { error: { code: 'XX000' } } : { data: [] }),
      },
    });
    const failResult = await createFacturaRevisionRepository(failing.client).buscarCandidatos([
      linea(1, { codigoProveedor: 'ab-0042', descripcion: null }),
    ]);
    expect(failResult).toEqual({ productos: [], parcial: true });

    const matched = producto('7591234000018', 'AB-0042');
    const context = { facturaId: FACTURA, extraccionId: EXTRACCION, versionEsperada: 3 };
    const hybrid = fakeClient({
      tables: { productos_view: responderCatalogo([matched]) },
      invoke: async () => ({ data: { hybridRanks: [{ lineIndex: 0, lexical: [{ codigoInterno: '7591234000018', rank: 1 }] }], parcial: false }, error: null }),
      rpc: { data: { decisiones: [{ lineIndex: 0, decision: 'confirmado', codigoInterno: '7591234000018' }] } },
    });
    const hybridResult = await createFacturaRevisionRepository(hybrid.client).buscarCandidatos(
      [linea(1, { codigoProveedor: 'ab-0042', descripcion: null })],
      context,
    );
    expect(hybridResult.productos).toEqual([matched]);
    expect(hybridResult.parcial).toBe(false);
    expect(hybridResult.hybridRanks).toEqual([{ lineIndex: 0, lexical: [{ codigoInterno: '7591234000018', rank: 1 }] }]);
    expect(hybridResult.feedback).toEqual([{ lineIndex: 0, decision: 'confirmado', codigoInterno: '7591234000018' }]);
    const hydrationCalls = hybrid.calls.filter(call => stepsOf(call, 'in').some(([, col, vals]) => col === 'codigo_interno' && Array.isArray(vals) && vals.includes('7591234000018')));
    expect(hydrationCalls).toHaveLength(0);
  });

  it('returns no candidates without marking a blank code and description as a failed lookup', async () => {
    const { client } = fakeClient({ tables: { productos_view: { data: [] } } });

    const result = await createFacturaRevisionRepository(client).buscarCandidatos([
      linea(1, { codigoProveedor: null, descripcion: null }),
    ]);

    expect(result).toEqual({ productos: [], parcial: false });
  });

  it('never queries the SIN_CODIGO sentinel as a code, without marking it partial, and still searches its description', async () => {
    const sentinel = producto('7590000000077', 'SIN_CODIGO');
    const input = [
      linea(1, { codigoProveedor: 'SIN_CODIGO', descripcion: 'Manguera jardin' }),
      linea(2, { codigoProveedor: ' sin_codigo ', descripcion: null }),
      linea(3, { codigoProveedor: 'SIN-CODIGO', descripcion: null }),
    ];
    const snapshot = JSON.stringify(input);
    const { client, calls } = fakeClient({ tables: { productos_view: responderCatalogo([{ ...sentinel, descripcion: 'Manguera jardin' }]) } });

    const result = await createFacturaRevisionRepository(client).buscarCandidatos(input);

    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.parcial).toBe(false);
    expect(result.productos.map(p => p.codigo_interno)).toEqual(['7590000000077']);
    const codeValues = calls.flatMap(call => [...stepsOf(call, 'in'), ...stepsOf(call, 'ilike')])
      .filter(([, column]) => column === 'codigo_interno' || column === 'codigo_barras')
      .flatMap(([, , values]) => (Array.isArray(values) ? values : [values]));
    expect(codeValues.map(value => String(value).replace(/\\/g, '').trim().toUpperCase())).not.toContain('SIN_CODIGO');
    // A real code that only resembles the sentinel stays searchable literally.
    expect(codeValues).toContain('SIN-CODIGO');
    expect(calls.some(call => stepsOf(call, 'ilike').some(([, column]) => column === 'descripcion'))).toBe(true);
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

  describe('hybrid retrieval context', () => {
    const contexto = { facturaId: FACTURA, extraccionId: EXTRACCION, versionEsperada: 3 };
    const syn = { ...producto('SYN-1'), descripcion: 'Fijacion metalica de anclaje', existencia: -3 };
    const rank = (codigoInterno: string, value: unknown = 1) => ({ codigoInterno, rank: value });
    const answer = (hybridRanks: unknown, ...flag: [unknown?]) => async () => ({ data: { hybridRanks, parcial: flag.length > 0 ? flag[0] : false }, error: null });
    const buscar = (client: RevisionClient, lineas: ExtraidaLinea[] = [linea(1)], ctx: unknown = contexto) =>
      createFacturaRevisionRepository(client).buscarCandidatos(lineas, ctx as ContextoBusquedaHibrida);
    const hydrationReads = (calls: Call[], sku: string) =>
      calls.filter(call => stepsOf(call, 'in').some(([, column, values]) => column === 'codigo_interno' && Array.isArray(values) && values.includes(sku)));
    const catalog = (...extra: Array<ReturnType<typeof producto>>) => ({ productos_view: responderCatalogo([syn, producto('COD1'), ...extra]) });

    it('invokes the endpoint once with only the invoice, extraction and version', async () => {
      const { client, invoke } = fakeClient({ tables: catalog(), invoke: answer([]) });
      await buscar(client, [linea(1, { descripcion: 'Tornillo secreto', codigoProveedor: 'COD1' })]);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith('consultar-productos-semantico', { body: contexto });
      expect(Object.keys(invoke.mock.calls[0][1].body).sort()).toEqual(['extraccionId', 'facturaId', 'versionEsperada']);
      expect(JSON.stringify(invoke.mock.calls)).not.toContain('secreto');
    });

    it('hydrates a retrieved SKU from the current catalog and forwards its rank without trusting the endpoint', async () => {
      const { client, calls } = fakeClient({ tables: catalog(), invoke: answer([{ lineIndex: 0, semantic: [rank('SYN-1')] }]) });
      const result = await buscar(client);
      expect(result.productos).toContainEqual(syn);
      expect(result.productos.find(p => p.codigo_interno === 'SYN-1')?.existencia).toBe(-3);
      expect(result.hybridRanks).toEqual([{ lineIndex: 0, semantic: [{ codigoInterno: 'SYN-1', rank: 1 }] }]);
      expect(result.parcial).toBe(false);
      const read = hydrationReads(calls, 'SYN-1')[0];
      expect(stepsOf(read, 'in')).toEqual([['in', 'codigo_interno', ['SYN-1']]]);
      expect(stepsOf(read, 'limit').length).toBe(1);
    });

    it('keeps exact reads first and never duplicates a SKU the exact reads already found', async () => {
      const { client, calls } = fakeClient({ tables: catalog(), invoke: answer([{ lineIndex: 0, lexical: [rank('COD1')], semantic: [rank('SYN-1', 1), rank('COD1', 2)] }]) });
      const result = await buscar(client);
      expect(result.productos.map(p => p.codigo_interno)).toEqual(['COD1', 'SYN-1']);
      expect(hydrationReads(calls, 'COD1')).toHaveLength(1);
    });

    it('leaves a lookup without context exactly as before: no invoke, no ranks key, same output', async () => {
      const { client, invoke } = fakeClient({ tables: catalog(), invoke: answer([{ lineIndex: 0, semantic: [rank('SYN-1')] }]) });
      const result = await createFacturaRevisionRepository(client).buscarCandidatos([linea(1)]);
      expect(invoke).not.toHaveBeenCalled();
      expect(Object.keys(result)).toEqual(['productos', 'parcial']);
      expect(result).toEqual({ productos: [producto('COD1')], parcial: false });
    });

    it.each([
      ['non uuid invoice', { ...contexto, facturaId: 'nope' }],
      ['non uuid extraction', { ...contexto, extraccionId: '123' }],
      ['zero version', { ...contexto, versionEsperada: 0 }],
      ['fractional version', { ...contexto, versionEsperada: 1.5 }],
      ['string version', { ...contexto, versionEsperada: '3' }],
      ['null context object', null],
    ])('never invokes with an invalid context (%s) and keeps the exact reads partial', async (_name, ctx) => {
      const { client, invoke } = fakeClient({ tables: catalog(), invoke: answer([{ lineIndex: 0, semantic: [rank('SYN-1')] }]) });
      const result = await buscar(client, [linea(1)], ctx);
      expect(invoke).not.toHaveBeenCalled();
      expect(result.productos.map(p => p.codigo_interno)).toEqual(['COD1']);
      expect(result.parcial).toBe(true);
      expect(result.hybridRanks).toBeUndefined();
    });

    it('keeps leading zeros and alphanumerics exactly and ties ranks to the original line index', async () => {
      const zeros = { ...producto('00123-A'), descripcion: 'Anclaje quimico' };
      const lineas = [linea(7, { codigoProveedor: null }), linea(9, { codigoProveedor: null, descripcion: 'Otro articulo' })];
      const { client } = fakeClient({ tables: catalog(zeros), invoke: answer([{ lineIndex: 1, lexical: [rank('00123-A')] }]) });
      const result = await buscar(client, lineas);
      expect(result.hybridRanks).toEqual([{ lineIndex: 1, lexical: [{ codigoInterno: '00123-A', rank: 1 }] }]);
      expect(result.productos.map(p => p.codigo_interno)).toContain('00123-A');
    });

    it.each([
      ['negative', -1],
      ['past the last line', 1],
      ['fractional', 0.5],
      ['textual', '0'],
    ])('drops a group whose line index is %s and marks the result partial', async (_name, lineIndex) => {
      const { client } = fakeClient({ tables: catalog(), invoke: answer([{ lineIndex, semantic: [rank('SYN-1')] }, { lineIndex: 0, semantic: [rank('SYN-1')] }]) });
      const result = await buscar(client);
      expect(result.hybridRanks).toEqual([{ lineIndex: 0, semantic: [{ codigoInterno: 'SYN-1', rank: 1 }] }]);
      expect(result.parcial).toBe(true);
    });

    it.each([
      ['comma and parenthesis', 'A,B)'],
      ['quote', 'A"B'],
      ['blank', '   '],
      ['over 120 characters', 'A'.repeat(121)],
      ['non text', 7],
    ])('never puts an unsafe SKU (%s) in a filter and drops its rank', async (_name, sku) => {
      const { client, calls } = fakeClient({ tables: catalog(), invoke: answer([{ lineIndex: 0, lexical: [rank(sku as string)], semantic: [rank('SYN-1')] }]) });
      const result = await buscar(client);
      expect(result.hybridRanks).toEqual([{ lineIndex: 0, semantic: [{ codigoInterno: 'SYN-1', rank: 1 }] }]);
      expect(result.parcial).toBe(true);
      const filtered = calls.flatMap(call => stepsOf(call, 'in')).flatMap(([, , values]) => values as unknown[]);
      expect(filtered).not.toContain(sku);
    });

    it('drops the ranks of SKUs missing from the current catalog, keeps exact reads and marks partial', async () => {
      const { client } = fakeClient({ tables: catalog(), invoke: answer([{ lineIndex: 0, semantic: [rank('GONE-1')] }]) });
      const result = await buscar(client);
      expect(result.hybridRanks).toBeUndefined();
      expect(result.productos.map(p => p.codigo_interno)).toEqual(['COD1']);
      expect(result.parcial).toBe(true);
    });

    it('ignores a hydration row the SKU filter did not ask for', async () => {
      const intruder = producto('INTRUDER');
      const { client } = fakeClient({ tables: { productos_view: (call: Call) => (hydrationReads([call], 'SYN-1').length ? { data: [intruder] } : responderCatalogo([producto('COD1')])(call)) }, invoke: answer([{ lineIndex: 0, semantic: [rank('SYN-1')] }]) });
      const result = await buscar(client);
      expect(result.productos.map(p => p.codigo_interno)).toEqual(['COD1']);
      expect(result.hybridRanks).toBeUndefined();
      expect(result.parcial).toBe(true);
    });

    it('keeps exact reads and marks partial when the hydration read fails', async () => {
      const { client } = fakeClient({ tables: { productos_view: (call: Call) => (hydrationReads([call], 'SYN-1').length ? { error: { code: 'XX000' } } : responderCatalogo([producto('COD1')])(call)) }, invoke: answer([{ lineIndex: 0, semantic: [rank('SYN-1')] }]) });
      const result = await buscar(client);
      expect(result.productos.map(p => p.codigo_interno)).toEqual(['COD1']);
      expect(result.hybridRanks).toBeUndefined();
      expect(result.parcial).toBe(true);
    });

    it.each([
      ['relay error', async () => ({ data: null, error: { name: 'FunctionsRelayError' } })],
      ['401', async () => ({ data: null, error: { name: 'FunctionsHttpError', context: { status: 401 } } })],
      ['404', async () => ({ data: null, error: { name: 'FunctionsHttpError', context: { status: 404 } } })],
      ['503', async () => ({ data: null, error: { name: 'FunctionsHttpError', context: { status: 503 } } })],
      ['thrown invoke', () => Promise.reject(new Error('SECRET-NETWORK'))],
      ['null data', async () => ({ data: null, error: null })],
      ['text data', async () => ({ data: 'ok', error: null })],
      ['ranks not a list', async () => ({ data: { hybridRanks: 'x', parcial: false }, error: null })],
      ['missing ranks', async () => ({ data: { parcial: false }, error: null })],
    ])('keeps the exact reads, marks partial and never retries when the endpoint answers %s', async (_name, invoke) => {
      const fake = fakeClient({ tables: catalog(), invoke });
      const result = await buscar(fake.client);
      expect(fake.invoke).toHaveBeenCalledTimes(1);
      expect(result.productos.map(p => p.codigo_interno)).toEqual(['COD1']);
      expect(result.parcial).toBe(true);
      expect(result.hybridRanks).toBeUndefined();
    });

    it.each([
      ['endpoint says partial', true, true],
      ['partial flag missing', undefined, true],
      ['partial flag not boolean', 'false', true],
      ['endpoint says complete', false, false],
    ])('propagates parcial when the %s without discarding usable ranks', async (_name, flag, expected) => {
      const { client } = fakeClient({ tables: catalog(), invoke: answer([{ lineIndex: 0, semantic: [rank('SYN-1')] }], flag) });
      const result = await buscar(client);
      expect(result.parcial).toBe(expected);
      expect(result.hybridRanks).toEqual([{ lineIndex: 0, semantic: [{ codigoInterno: 'SYN-1', rank: 1 }] }]);
    });

    it('bounds the answer to 200 groups and 8 entries per list and marks the truncation partial', async () => {
      const many = Array.from({ length: 10 }, (_x, i) => rank(`S${i + 1}`, i + 1));
      const manyProducts = Array.from({ length: 10 }, (_x, i) => producto(`S${i + 1}`));
      const tooManyGroups = Array.from({ length: 201 }, () => ({ lineIndex: 0, semantic: [rank('SYN-1')] }));
      const lists = fakeClient({ tables: { productos_view: responderCatalogo(manyProducts) }, invoke: answer([{ lineIndex: 0, lexical: many }]) });
      const listResult = await buscar(lists.client);
      expect(listResult.hybridRanks?.[0].lexical).toHaveLength(8);
      expect(listResult.parcial).toBe(true);
      expect(hydrationReads(lists.calls, 'S9')).toEqual([]);
      const groups = fakeClient({ tables: catalog(), invoke: answer(tooManyGroups) });
      const groupResult = await buscar(groups.client);
      expect(groupResult.hybridRanks).toHaveLength(200);
      expect(groupResult.parcial).toBe(true);
    });

    it.each([['zero', 0], ['nine', 9], ['fractional', 1.5], ['text', '1'], ['null', null]])('drops an entry whose rank is %s and marks partial', async (_name, value) => {
      const { client } = fakeClient({ tables: catalog(), invoke: answer([{ lineIndex: 0, semantic: [rank('SYN-1', value), rank('COD1', 2)] }]) });
      const result = await buscar(client);
      expect(result.hybridRanks).toEqual([{ lineIndex: 0, semantic: [{ codigoInterno: 'COD1', rank: 2 }] }]);
      expect(result.parcial).toBe(true);
    });

    it('keeps the best rank of a SKU repeated in a list and never normalizes the SKU', async () => {
      const lower = { ...producto('syn-1'), descripcion: 'Otro' };
      const { client } = fakeClient({ tables: catalog(lower), invoke: answer([{ lineIndex: 0, semantic: [rank('SYN-1', 3), rank('SYN-1', 2), rank('syn-1', 4)] }]) });
      const result = await buscar(client);
      expect(result.hybridRanks).toEqual([{ lineIndex: 0, semantic: [{ codigoInterno: 'SYN-1', rank: 2 }, { codigoInterno: 'syn-1', rank: 4 }] }]);
    });
  });

  describe('saved feedback retrieval', () => {
    const context = { facturaId: FACTURA, extraccionId: EXTRACCION, versionEsperada: 4 };
    const corrected = { lineIndex: 0, decision: 'confirmado', codigoInterno: '00123A' };
    const invoke = async () => ({ data: { hybridRanks: [], parcial: false }, error: null });
    const products = [{ ...producto('00123A'), existencia: -3 }, producto('COD1')];
    const lookup = (client: RevisionClient) => createFacturaRevisionRepository(client).buscarCandidatos([linea(7, { codigoProveedor: 'COD1' })], context);

    it('reads one source-bound feedback RPC and hydrates the remembered literal SKU', async () => {
      const mock = fakeClient({ invoke, rpc: { data: { decisiones: [corrected] } }, tables: { productos_view: responderCatalogo(products) } });
      const result = await lookup(mock.client);
      expect(mock.rpc).toHaveBeenCalledTimes(1);
      expect(mock.rpc).toHaveBeenCalledWith('buscar_feedback_productos_factura', { p_factura_id: FACTURA, p_extraccion_id: EXTRACCION, p_version_esperada: 4 });
      expect((result as any).feedback).toEqual([corrected]);
      expect(result.productos.some(p => p.codigo_interno === '00123A' && p.existencia === -3)).toBe(true);
      expect(result.parcial).toBe(false);
    });
    it('retains saved feedback even when the semantic endpoint fails', async () => {
      const mock = fakeClient({ invoke: async () => { throw new Error('offline'); }, rpc: { data: { decisiones: [corrected] } }, tables: { productos_view: responderCatalogo(products) } });
      const result = await lookup(mock.client);
      expect((result as any).feedback).toEqual([corrected]);
      expect(result.parcial).toBe(true);
    });
    it('keeps a previous-new decision contextual without a fabricated catalog SKU', async () => {
      const hint = { lineIndex: 0, decision: 'producto_nuevo', codigoInterno: null };
      const mock = fakeClient({ invoke, rpc: { data: { decisiones: [hint] } }, tables: { productos_view: responderCatalogo(products) } });
      const result = await lookup(mock.client);
      expect((result as any).feedback).toEqual([hint]);
      expect(result.productos.map(p => p.codigo_interno)).toEqual(['COD1']);
    });
    it.each([null, {}, { decisiones: [null] }, { decisiones: [{ ...corrected, lineIndex: 3 }] }, { decisiones: [corrected, { ...corrected, codigoInterno: 'COD1' }] }])('keeps exact reads and marks malformed feedback partial (%j)', async data => {
      const mock = fakeClient({ invoke, rpc: { data }, tables: { productos_view: responderCatalogo(products) } });
      const result = await lookup(mock.client);
      expect(result.productos.map(p => p.codigo_interno)).toEqual(['COD1']);
      expect((result as any).feedback).toBeUndefined();
      expect(result.parcial).toBe(true);
    });
    it.each(['missing', 'placeholder'])('does not reuse a %s remembered SKU', async kind => {
      const rows = kind === 'missing' ? [producto('COD1')] : [producto('COD1'), { ...producto('00123A'), es_placeholder: true }];
      const mock = fakeClient({ invoke, rpc: { data: { decisiones: [corrected] } }, tables: { productos_view: responderCatalogo(rows) } });
      const result = await lookup(mock.client);
      expect((result as any).feedback).toBeUndefined();
      expect(result.parcial).toBe(true);
    });
    it('leaves plain catalog reads free of feedback calls', async () => {
      const mock = fakeClient({ invoke });
      await createFacturaRevisionRepository(mock.client).buscarCandidatos([linea(1)]);
      expect(mock.rpc).not.toHaveBeenCalled();
      expect(mock.invoke).not.toHaveBeenCalled();
    });
    it('keeps the legacy output shape when the deployed RPC returns no aliases key', async () => {
      const mock = fakeClient({ invoke, rpc: { data: { decisiones: [corrected] } }, tables: { productos_view: responderCatalogo(products) } });
      const result = await lookup(mock.client);
      expect(Object.keys(result)).toEqual(['productos', 'parcial', 'feedback']);
      expect(result.parcial).toBe(false);
    });

    describe('supplier aliases', () => {
      const skuA = { ...producto('SKU-A'), descripcion: 'Tubo PVC 1/2', existencia: -2 };
      const printed = (over: Partial<ExtraidaLinea> = {}) => linea(7, { codigoProveedor: '00123', descripcion: 'Tubo cambiado', unidad: 'UND', ...over });
      const aliasLookup = (aliases: unknown, lineas: ExtraidaLinea[] = [printed()], rows = [skuA, producto('COD1')], extra: Record<string, unknown> = {}) => {
        const mock = fakeClient({ invoke, rpc: { data: { decisiones: [], aliases, ...extra } }, tables: { productos_view: responderCatalogo(rows) } });
        return { mock, result: createFacturaRevisionRepository(mock.client).buscarCandidatos(lineas, context) };
      };
      const expected = (over: Record<string, unknown> = {}) => ({
        supplierKey: FACTURA_ACTUAL_SUPPLIER_SCOPE, keyType: 'codigo_proveedor', keyValue: '00123', unit: 'UND',
        codigoInterno: 'SKU-A', normalizationVersion: MATCHING_NORMALIZATION_VERSION, ...over,
      });

      it("builds the alias from the target line's own printed code and unit, hydrated from the current catalog", async () => {
        const lineas = [printed()];
        const snapshot = JSON.stringify(lineas);
        const { mock, result } = aliasLookup([{ lineIndex: 0, codigoInterno: 'SKU-A' }], lineas);
        const found = await result;
        expect(mock.rpc).toHaveBeenCalledTimes(1);
        expect(found.aliases).toEqual([expected()]);
        expect(found.supplierKey).toBe(FACTURA_ACTUAL_SUPPLIER_SCOPE);
        expect(found.productos.find(p => p.codigo_interno === 'SKU-A')?.existencia).toBe(-2);
        expect(found.parcial).toBe(false);
        expect(JSON.stringify(lineas)).toBe(snapshot);
      });

      it('keeps leading zeros, punctuation and an unknown unit literal', async () => {
        const { result } = aliasLookup([{ lineIndex: 0, codigoInterno: 'SKU-A' }], [printed({ codigoProveedor: ' 0-0123. ', unidad: null })]);
        expect((await result).aliases).toEqual([expected({ keyValue: ' 0-0123. ', unit: null })]);
      });

      it.each([
        ['not an array', { lineIndex: 0 }],
        ['a null entry', [null]],
        ['an out-of-range line', [{ lineIndex: 1, codigoInterno: 'SKU-A' }]],
        ['a fractional line', [{ lineIndex: 0.5, codigoInterno: 'SKU-A' }]],
        ['a negative line', [{ lineIndex: -1, codigoInterno: 'SKU-A' }]],
        ['an unsafe SKU', [{ lineIndex: 0, codigoInterno: 'SKU A,(x)' }]],
        ['a null SKU', [{ lineIndex: 0, codigoInterno: null }]],
        ['contradictory duplicates', [{ lineIndex: 0, codigoInterno: 'SKU-A' }, { lineIndex: 0, codigoInterno: 'COD1' }]],
        ['more than 200 entries', Array.from({ length: 201 }, () => ({ lineIndex: 0, codigoInterno: 'SKU-A' }))],
      ])('drops %s and marks the lookup partial without touching decisions', async (_name, aliases) => {
        const { result } = aliasLookup(aliases, [printed()], [skuA, producto('COD1')], { decisiones: [{ ...corrected, codigoInterno: 'COD1' }] });
        const found = await result;
        expect(found.aliases).toBeUndefined();
        expect(found.supplierKey).toBeUndefined();
        expect(found.feedback).toEqual([{ ...corrected, codigoInterno: 'COD1' }]);
        expect(found.parcial).toBe(true);
      });

      it.each(['missing', 'placeholder'])('drops an alias to a %s SKU without falling back and marks partial', async kind => {
        const rows = kind === 'missing' ? [producto('COD1')] : [producto('COD1'), { ...skuA, es_placeholder: true }];
        const { result } = aliasLookup([{ lineIndex: 0, codigoInterno: 'SKU-A' }], [printed()], rows);
        const found = await result;
        expect(found.aliases).toBeUndefined();
        expect(found.parcial).toBe(true);
      });

      it.each([null, '  ', 'SIN_CODIGO'])('drops an alias for a target line without a printed code (%j)', async codigoProveedor => {
        const { result } = aliasLookup([{ lineIndex: 0, codigoInterno: 'SKU-A' }], [printed({ codigoProveedor })]);
        const found = await result;
        expect(found.aliases).toBeUndefined();
        expect(found.parcial).toBe(true);
      });

      it('drops an alias the matcher would also apply to a same-code line the server left without that alias', async () => {
        // Server suppressed line 0 (its exact printed line disagrees); line 1's alias would still reach it.
        const disagreeing = aliasLookup([{ lineIndex: 1, codigoInterno: 'SKU-A' }], [printed({ descripcion: 'Tubo viejo' }), printed()]);
        expect((await disagreeing.result).aliases).toBeUndefined();
        expect((await disagreeing.result).parcial).toBe(true);

        // A blank unit is unknown to the matcher, so it would reach the CAJA line the server keyed apart.
        const blankUnit = aliasLookup([{ lineIndex: 0, codigoInterno: 'SKU-A' }], [printed({ unidad: null }), printed({ unidad: 'CAJA' })]);
        expect((await blankUnit.result).aliases).toBeUndefined();
      });

      it('keeps aliases whose reach the server fully covered, including other units of the same code', async () => {
        const lineas = [printed(), printed({ unidad: 'CAJA' }), printed({ descripcion: 'Tubo otra vez' })];
        const { result } = aliasLookup([{ lineIndex: 0, codigoInterno: 'SKU-A' }, { lineIndex: 2, codigoInterno: 'SKU-A' }], lineas);
        const found = await result;
        expect(found.aliases).toEqual([expected(), expected()]);
        expect(found.parcial).toBe(false);
      });

      it('keeps aliases when the semantic endpoint fails and drops them when the feedback RPC fails', async () => {
        const offline = fakeClient({ invoke: async () => { throw new Error('offline'); }, rpc: { data: { decisiones: [], aliases: [{ lineIndex: 0, codigoInterno: 'SKU-A' }] } }, tables: { productos_view: responderCatalogo([skuA]) } });
        const kept = await createFacturaRevisionRepository(offline.client).buscarCandidatos([printed()], context);
        expect(kept.aliases).toEqual([expected()]);
        expect(kept.parcial).toBe(true);

        const rejected = fakeClient({ invoke, rpc: { error: { code: '42501', message: 'PRIVATE' } }, tables: { productos_view: responderCatalogo([skuA]) } });
        const none = await createFacturaRevisionRepository(rejected.client).buscarCandidatos([printed()], context);
        expect(none.aliases).toBeUndefined();
        expect(none.supplierKey).toBeUndefined();
        expect(none.parcial).toBe(true);
      });
    });

    it('keeps exact reads on a rejected feedback RPC without leaking the error', async () => {
      const mock = fakeClient({ invoke, rpc: { error: { code: '42501', message: 'PRIVATE' } }, tables: { productos_view: responderCatalogo(products) } });
      const result = await lookup(mock.client);
      expect(result.productos.map(p => p.codigo_interno)).toEqual(['COD1']);
      expect(result.parcial).toBe(true);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });
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
