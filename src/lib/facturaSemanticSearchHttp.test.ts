import { handleFacturaSemanticSearchRequest } from '../../supabase/functions/consultar-productos-semantico/handler';
import type { FacturaExtraccionPayload } from './facturaExtractionContract';

type Kind = 'auth' | 'privileged' | 'session' | 'source' | 'embeddings' | 'lexical' | 'semantic' | 'unexpected';
interface Call {
  kind: Kind;
  url: string;
  init: RequestInit;
  body: any;
}
type Responder = (call: Call) => Response | Promise<Response>;

const userId = '11111111-1111-4111-8111-111111111111';
const facturaId = '22222222-2222-4222-8222-222222222222';
const extractionId = '33333333-3333-4333-8333-333333333333';
const sha256 = 'b'.repeat(64);
const config = { supabaseUrl: 'https://project.test', supabaseAnonKey: 'anon-key', openRouterApiKey: 'provider-key' };
const requestBody = { facturaId, extraccionId: extractionId, versionEsperada: 1 };
const DIM = 1536;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function request(body: unknown = requestBody, authorization = 'Bearer user-jwt', method = 'POST'): Request {
  return new Request('https://edge.test/consultar-productos-semantico', {
    method,
    headers: { ...(authorization ? { Authorization: authorization } : {}), 'Content-Type': 'application/json' },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

function extraction(descriptions: Array<string | null>): FacturaExtraccionPayload {
  return {
    version: 1,
    cabecera: {
      proveedorNombre: 'Proveedor Secreto SA', proveedorRif: 'J-12345678-9', numeroDocumento: 'DOC-1', numeroControl: null,
      fechaEmision: '2026-10-25', moneda: 'USD', tasaCambio: null, subtotal: null, descuentos: [], impuestos: [], total: null,
    },
    lineas: descriptions.map((descripcion, index) => ({
      numeroLinea: index + 1, pagina: 1, codigoProveedor: 'SUP-CODE', descripcion, cantidad: '1', unidad: 'UND',
      precioUnitario: '1', descuentos: [], tasaIva: null, total: null, incertidumbre: null,
    })),
    metadatos: { totalPaginas: 1, paginasProcesadas: [1], documentoCompleto: true, advertencias: [], confianzaGlobal: null },
  };
}

function source(descriptions: Array<string | null>, changes: { invoice?: object; extraction?: object } = {}) {
  return [{
    id: facturaId,
    version: 1,
    documento_sha256: sha256,
    ...changes.invoice,
    facturas_proveedores_extracciones: [{
      id: extractionId, factura_id: facturaId, estado: 'completado', factura_version: 1,
      documento_sha256: sha256, resultado: extraction(descriptions), ...changes.extraction,
    }],
  }];
}

function vector(first: number): number[] {
  const values = new Array<number>(DIM).fill(0);
  values[0] = first;
  return values;
}

function classify(url: string): Kind {
  if (url === 'https://openrouter.ai/api/v1/embeddings') return 'embeddings';
  if (url.endsWith('/auth/v1/user')) return 'auth';
  if (url.endsWith('/rest/v1/rpc/is_privileged')) return 'privileged';
  if (url.endsWith('/rest/v1/rpc/validate_session')) return 'session';
  if (url.includes('/rest/v1/facturas_proveedores?')) return 'source';
  if (url.endsWith('/rest/v1/rpc/buscar_productos')) return 'lexical';
  if (url.endsWith('/rest/v1/rpc/buscar_semantico')) return 'semantic';
  return 'unexpected';
}

const hang: Responder = ({ init }) => new Promise<Response>((_resolve, reject) => {
  init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
});

function embeddingsFor(mutate: (index: number) => unknown = index => vector(index + 1), order: 'asc' | 'desc' = 'asc'): Responder {
  return ({ body }) => {
    const items = (body.input as string[]).map((_text, index) => ({ object: 'embedding', index, embedding: mutate(index) }));
    return json({ object: 'list', model: body.model, data: order === 'asc' ? items : items.reverse() });
  };
}

const defaultResponders: Record<Kind, Responder> = {
  auth: () => json({ id: userId, role: 'authenticated' }),
  privileged: () => json(true),
  session: () => json(true),
  source: () => json(source(['Martillo 16oz', 'Clavo 2 pulgadas'])),
  embeddings: embeddingsFor(),
  lexical: ({ body }) => json([
    { codigo_interno: `L1:${body.p_busqueda}`, descripcion: 'x', precio_venta: 9, existencia: 1, total_vendido: 0, score: 0.9 },
    { codigo_interno: `L2:${body.p_busqueda}`, descripcion: 'y', precio_venta: 9, existencia: 1, total_vendido: 0, score: 0.5 },
  ]),
  semantic: ({ body }) => {
    const first = (JSON.parse(body.p_embedding) as number[])[0];
    return json([
      { codigo_interno: `S1:${first}`, descripcion: 'x', precio_venta: 9, existencia: 1, similitud: 0.9 },
      { codigo_interno: `S2:${first}`, descripcion: 'y', precio_venta: 9, existencia: 1, similitud: 0.5 },
    ]);
  },
  unexpected: () => json({}, 404),
};

async function run(options: {
  request?: Request;
  responders?: Partial<Record<Kind, Responder>>;
  config?: Partial<typeof config>;
  limits?: { requestTimeoutMs?: number; retrievalTimeoutMs?: number };
} = {}) {
  const calls: Call[] = [];
  const responders = { ...defaultResponders, ...options.responders };
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    const kind = classify(url);
    const call: Call = { kind, url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return responders[kind](call);
  }) as typeof fetch;
  const response = await handleFacturaSemanticSearchRequest(options.request ?? request(), {
    config: { ...config, ...options.config },
    fetchFn,
    limits: options.limits,
  });
  expect(calls.filter(call => call.kind === 'unexpected')).toEqual([]);
  return { response, calls };
}

const kindsOf = (calls: Call[], ...kinds: Kind[]) => calls.filter(call => kinds.includes(call.kind));
const noSearchCalls = (calls: Call[]) => expect(kindsOf(calls, 'embeddings', 'lexical', 'semantic')).toEqual([]);

describe('supplier invoice hybrid retrieval endpoint', () => {
  afterEach(() => jest.restoreAllMocks());

  it('ranks the authorized current extraction lines with lexical and semantic evidence', async () => {
    const { response } = await run();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      hybridRanks: [
        {
          lineIndex: 0,
          lexical: [{ codigoInterno: 'L1:Martillo 16oz', rank: 1 }, { codigoInterno: 'L2:Martillo 16oz', rank: 2 }],
          semantic: [{ codigoInterno: 'S1:1', rank: 1 }, { codigoInterno: 'S2:1', rank: 2 }],
        },
        {
          lineIndex: 1,
          lexical: [{ codigoInterno: 'L1:Clavo 2 pulgadas', rank: 1 }, { codigoInterno: 'L2:Clavo 2 pulgadas', rank: 2 }],
          semantic: [{ codigoInterno: 'S1:2', rank: 1 }, { codigoInterno: 'S2:2', rank: 2 }],
        },
      ],
      parcial: false,
    });
  });

  it('verifies identity, privilege and session before reading the source or calling the provider', async () => {
    const { calls } = await run();
    const first = (kind: Kind) => calls.findIndex(call => call.kind === kind);
    expect(first('auth')).toBe(0);
    expect(first('privileged')).toBeGreaterThan(first('auth'));
    expect(first('session')).toBeGreaterThan(first('privileged'));
    expect(first('source')).toBeGreaterThan(first('session'));
    expect(first('embeddings')).toBeGreaterThan(first('source'));
    expect(first('lexical')).toBeGreaterThan(first('source'));
  });

  it('calls the provider once with the pinned model, dimension and only invoice descriptions', async () => {
    const { calls } = await run();
    const provider = kindsOf(calls, 'embeddings');
    expect(provider).toHaveLength(1);
    expect(provider[0].init.method).toBe('POST');
    expect(provider[0].body).toEqual({
      model: 'openai/text-embedding-3-small',
      input: ['Martillo 16oz', 'Clavo 2 pulgadas'],
      dimensions: 1536,
    });
    const headers = new Headers(provider[0].init.headers);
    expect(headers.get('authorization')).toBe('Bearer provider-key');
    expect(headers.get('apikey')).toBeNull();
    const serialized = JSON.stringify([provider[0].init, provider[0].body]);
    for (const secret of ['user-jwt', 'anon-key', 'Proveedor Secreto', 'J-12345678-9', 'SUP-CODE', facturaId, extractionId]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('queries Supabase as the caller with the anon key and bounded RPC parameters', async () => {
    const { calls } = await run();
    for (const call of kindsOf(calls, 'auth', 'privileged', 'session', 'source', 'lexical', 'semantic')) {
      const headers = new Headers(call.init.headers);
      expect(headers.get('authorization')).toBe('Bearer user-jwt');
      expect(headers.get('apikey')).toBe('anon-key');
    }
    const source = kindsOf(calls, 'source')[0];
    expect(source.init.method).toBe('GET');
    expect(source.url).toContain(`id=eq.${facturaId}`);
    expect(source.url).toContain(`facturas_proveedores_extracciones.id=eq.${extractionId}`);
    expect(source.url).toContain('facturas_proveedores_extracciones.limit=1');
    const lexical = kindsOf(calls, 'lexical');
    expect(lexical.map(call => call.body)).toEqual([
      { p_busqueda: 'Martillo 16oz', p_limite: 8 },
      { p_busqueda: 'Clavo 2 pulgadas', p_limite: 8 },
    ]);
    const semantic = kindsOf(calls, 'semantic');
    expect(semantic).toHaveLength(2);
    expect(semantic[0].body).toEqual({ p_embedding: JSON.stringify(vector(1)), p_umbral: 0.35, p_limite: 8 });
  });

  it('returns only ranks: no costs, descriptions, secrets or diagnostics', async () => {
    const { response } = await run();
    const text = await response.text();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['hybridRanks', 'parcial']);
    for (const leaked of ['provider-key', 'user-jwt', 'precio_venta', 'descripcion', 'costo', 'existencia']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('answers CORS preflight and rejects other methods', async () => {
    const preflight = await run({ request: request(requestBody, '', 'OPTIONS') });
    expect(preflight.response.status).toBe(200);
    expect(preflight.response.headers.get('cache-control')).toBe('no-store');
    expect(preflight.response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.calls).toHaveLength(0);
    const get = await run({ request: request(requestBody, 'Bearer user-jwt', 'GET') });
    expect(get.response.status).toBe(405);
    expect(get.response.headers.get('allow')).toBe('POST, OPTIONS');
    expect(get.calls).toHaveLength(0);
  });

  it.each([
    ['unknown key', { ...requestBody, texto: 'martillo' }],
    ['client supplied lines', { ...requestBody, lineas: [] }],
    ['missing extraction', { facturaId, versionEsperada: 1 }],
    ['invalid factura uuid', { ...requestBody, facturaId: 'nope' }],
    ['invalid extraction uuid', { ...requestBody, extraccionId: '123' }],
    ['zero version', { ...requestBody, versionEsperada: 0 }],
    ['unsafe version', { ...requestBody, versionEsperada: Number.MAX_SAFE_INTEGER + 1 }],
    ['string version', { ...requestBody, versionEsperada: '1' }],
    ['array body', []],
    ['invalid json', '{nope'],
    ['empty body', ''],
  ])('rejects %s before any network access', async (_name, body) => {
    const { response, calls } = await run({ request: request(body as unknown) });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects an oversized request before any network access', async () => {
    const { response, calls } = await run({ request: request(' '.repeat(4097)) });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('cancels a streamed oversized request without trusting content-length', async () => {
    const state = { pulled: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.pulled += 1024;
        controller.enqueue(new Uint8Array(1024));
        if (state.pulled >= 1024 * 1024) controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    });
    const streamed = new Request('https://edge.test/consultar-productos-semantico', {
      method: 'POST',
      headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const { response, calls } = await run({ request: streamed });
    expect(response.status).toBe(400);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(1024 * 1024);
    expect(calls).toHaveLength(0);
  });

  it('requires a bearer token before any network access', async () => {
    const { response, calls } = await run({ request: request(requestBody, '') });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['missing Supabase URL', { supabaseUrl: '' }],
    ['missing anon key', { supabaseAnonKey: '' }],
  ])('returns a safe configuration error for %s', async (_name, changes) => {
    const { response, calls } = await run({ config: changes });
    expect(response.status).toBe(500);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['rejected identity', { auth: () => json({}, 401) }, 401],
    ['identity without a uuid', { auth: () => json({ id: 'x' }) }, 401],
    ['service role credential', { auth: () => json({ id: userId, role: 'service_role' }) }, 403],
    ['identity service down', { auth: () => json({}, 503) }, 401],
    ['unprivileged user', { privileged: () => json(false) }, 403],
    ['non boolean privilege', { privileged: () => json('true') }, 403],
    ['rejected privilege call', { privileged: () => json({ message: 'jwt expired' }, 401) }, 403],
    ['privilege backend failure', { privileged: () => json({}, 500) }, 503],
    ['invalid session', { session: () => json(false) }, 401],
    ['malformed session', { session: () => json(null) }, 401],
    ['session backend failure', { session: () => json({}, 500) }, 503],
    ['identity network failure', { auth: () => { throw new Error('boom'); } }, 503],
  ])('does not read the source or call the provider on %s', async (_name, responders, status) => {
    const { response, calls } = await run({ responders: responders as Partial<Record<Kind, Responder>> });
    expect(response.status).toBe(status);
    expect(kindsOf(calls, 'source')).toEqual([]);
    noSearchCalls(calls);
    const text = await response.text();
    expect(text).not.toContain('jwt expired');
    expect(text).not.toContain('boom');
  });

  it('uses one fixed 404 body for hidden, absent or foreign sources', async () => {
    const absent = await run({ responders: { source: () => json([]) } });
    const foreign = await run({ responders: { source: () => json([{ ...source(['x'])[0], id: '55555555-5555-4555-8555-555555555555' }]) } });
    const otherExtraction = await run({ responders: { source: () => json(source(['x'], { extraction: { id: '66666666-6666-4666-8666-666666666666' } })) } });
    const withoutExtraction = await run({ responders: { source: () => json([{ ...source(['x'])[0], facturas_proveedores_extracciones: [] }]) } });
    const bodies = [];
    for (const result of [absent, foreign, otherExtraction, withoutExtraction]) {
      expect(result.response.status).toBe(404);
      noSearchCalls(result.calls);
      bodies.push(await result.response.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it.each([
    ['invoice version differs from the requested one', { invoice: { version: 2 } }, 409],
    ['extraction version differs from the invoice', { extraction: { factura_version: 2 } }, 409],
    ['extraction document hash differs', { extraction: { documento_sha256: 'c'.repeat(64) } }, 409],
    ['invoice has no current document', { invoice: { documento_sha256: null } }, 409],
    ['extraction is quarantined', { extraction: { estado: 'cuarentena' } }, 409],
    ['extraction is still processing', { extraction: { estado: 'procesando' } }, 409],
    ['extraction failed', { extraction: { estado: 'fallido' } }, 409],
    ['extraction belongs to another invoice', { extraction: { factura_id: '55555555-5555-4555-8555-555555555555' } }, 422],
    ['stored result fails the parser contract', { extraction: { resultado: { version: 'invalid' } } }, 422],
  ])('rejects a source whose %s without any embedding or search call', async (_name, changes, status) => {
    const { response, calls } = await run({ responders: { source: () => json(source(['Martillo'], changes)) } });
    expect(response.status).toBe(status);
    noSearchCalls(calls);
    expect(await response.text()).not.toContain('Martillo');
  });

  it('rejects an expected version that is not the stored one', async () => {
    const { response, calls } = await run({ request: request({ ...requestBody, versionEsperada: 2 }) });
    expect(response.status).toBe(409);
    noSearchCalls(calls);
  });

  it('keeps the lexical branch with parcial when the provider key is missing', async () => {
    const { response, calls } = await run({ config: { openRouterApiKey: '' } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.parcial).toBe(true);
    expect(body.hybridRanks.map((group: any) => group.lineIndex)).toEqual([0, 1]);
    expect(body.hybridRanks.every((group: any) => group.semantic === undefined)).toBe(true);
    expect(kindsOf(calls, 'embeddings', 'semantic')).toEqual([]);
  });

  it.each([
    ['http failure', () => json({ error: 'SECRET-DIAG' }, 500)],
    ['network failure', () => { throw new Error('SECRET-DIAG'); }],
    ['invalid json', () => new Response('SECRET-DIAG', { status: 200 })],
    ['not a list', () => json({ data: 'SECRET-DIAG' })],
    ['response with duplicated index', ({ body }: Call) => json({ data: body.input.map(() => ({ index: 0, embedding: vector(1) })) })],
    ['response with out of range index', ({ body }: Call) => json({ data: [...body.input.map((_t: string, index: number) => ({ index, embedding: vector(index + 1) })), { index: 9, embedding: vector(1) }] })],
  ])('preserves the lexical branch and logs nothing on provider %s', async (_name, embeddings) => {
    const spies = (['log', 'warn', 'error', 'info'] as const).map(method => jest.spyOn(console, method).mockImplementation(() => undefined));
    const { response, calls } = await run({ responders: { embeddings } });
    const text = await response.text();
    const body = JSON.parse(text);
    expect(response.status).toBe(200);
    expect(body.parcial).toBe(true);
    expect(body.hybridRanks).toHaveLength(2);
    expect(body.hybridRanks.every((group: any) => group.lexical.length === 2 && group.semantic === undefined)).toBe(true);
    expect(kindsOf(calls, 'semantic')).toEqual([]);
    expect(text).not.toContain('SECRET-DIAG');
    spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
  });

  it('abandons a hanging provider at its request deadline and keeps lexical results', async () => {
    const { response } = await run({ responders: { embeddings: hang }, limits: { requestTimeoutMs: 30, retrievalTimeoutMs: 2000 } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.parcial).toBe(true);
    expect(body.hybridRanks[0].lexical).toHaveLength(2);
    expect(body.hybridRanks[0].semantic).toBeUndefined();
  });

  it('stops all retrieval at the overall deadline and still answers with parcial', async () => {
    const started = Date.now();
    const { response } = await run({
      responders: { lexical: hang, embeddings: hang },
      limits: { requestTimeoutMs: 5000, retrievalTimeoutMs: 60 },
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hybridRanks: [], parcial: true });
  });

  it('maps out-of-order provider vectors by their index, not their position', async () => {
    const { response } = await run({ responders: { embeddings: embeddingsFor(index => vector(index + 1), 'desc') } });
    const body = await response.json();
    expect(body.parcial).toBe(false);
    expect(body.hybridRanks[0].semantic[0].codigoInterno).toBe('S1:1');
    expect(body.hybridRanks[1].semantic[0].codigoInterno).toBe('S1:2');
  });

  it.each([
    ['wrong dimension', () => new Array(1535).fill(0.5)],
    ['null component', () => { const values = vector(1); values[5] = null as unknown as number; return values; }],
    ['string component', () => { const values = vector(1) as unknown[]; values[5] = '0.5'; return values; }],
    ['zero norm', () => new Array(DIM).fill(0)],
    ['not an array', () => 'abc'],
  ])('drops only the semantic branch of a line whose vector has a %s', async (_name, bad) => {
    const { response, calls } = await run({ responders: { embeddings: embeddingsFor(index => (index === 1 ? bad() : vector(index + 1))) } });
    const body = await response.json();
    expect(body.parcial).toBe(true);
    expect(body.hybridRanks[0].semantic).toEqual([{ codigoInterno: 'S1:1', rank: 1 }, { codigoInterno: 'S2:1', rank: 2 }]);
    expect(body.hybridRanks[1].semantic).toBeUndefined();
    expect(body.hybridRanks[1].lexical).toHaveLength(2);
    expect(kindsOf(calls, 'semantic')).toHaveLength(1);
  });

  it('drops a non finite provider vector (overflowing number) without sending it to the database', async () => {
    const sentinel = 123456.789;
    const { response, calls } = await run({
      responders: {
        embeddings: ({ body }) => new Response(
          JSON.stringify({ data: body.input.map((_t: string, index: number) => ({ index, embedding: index === 0 ? [sentinel, ...new Array(DIM - 1).fill(0.1)] : vector(2) })) }).replace(String(sentinel), '1e999'),
        ),
      },
    });
    const body = await response.json();
    expect(body.parcial).toBe(true);
    expect(body.hybridRanks[0].semantic).toBeUndefined();
    expect(body.hybridRanks[1].semantic[0].codigoInterno).toBe('S1:2');
    expect(kindsOf(calls, 'semantic')).toHaveLength(1);
  });

  it.each([
    ['lexical', 'semantic'],
    ['semantic', 'lexical'],
  ] as const)('keeps the other branch when the %s RPC fails or returns malformed data', async (failing, surviving) => {
    const failures: Array<[string, Responder]> = [
      ['http error', () => json({ message: 'SECRET-SQL' }, 500)],
      ['not an array', () => json({ rows: [] })],
      ['row without sku', () => json([{ descripcion: 'x' }])],
      ['blank sku', () => json([{ codigo_interno: '  ' }])],
      ['non string sku', () => json([{ codigo_interno: 7 }])],
      ['invalid json', () => new Response('SECRET-SQL')],
      ['network failure', () => { throw new Error('SECRET-SQL'); }],
    ];
    for (const [, failure] of failures) {
      const { response } = await run({ responders: { [failing]: failure } });
      const text = await response.text();
      const body = JSON.parse(text);
      expect(response.status).toBe(200);
      expect(body.parcial).toBe(true);
      expect(body.hybridRanks).toHaveLength(2);
      expect(body.hybridRanks.every((group: any) => group[failing] === undefined && group[surviving].length === 2)).toBe(true);
      expect(text).not.toContain('SECRET-SQL');
    }
  });

  it('abandons a hanging RPC and keeps the other branch', async () => {
    const { response } = await run({ responders: { semantic: hang }, limits: { requestTimeoutMs: 30, retrievalTimeoutMs: 2000 } });
    const body = await response.json();
    expect(body.parcial).toBe(true);
    expect(body.hybridRanks[0].lexical).toHaveLength(2);
    expect(body.hybridRanks[0].semantic).toBeUndefined();
  });

  it('ranks by returned position, keeps the first duplicate and caps each list at eight', async () => {
    const skus = ['A', 'B', 'A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const { response } = await run({
      responders: {
        source: () => json(source(['Martillo'])),
        lexical: () => json(skus.map(codigo_interno => ({ codigo_interno }))),
      },
    });
    const body = await response.json();
    expect(body.hybridRanks[0].lexical).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((codigoInterno, index) => ({ codigoInterno, rank: index + 1 })),
    );
  });

  it.each(['lexical', 'semantic'] as const)('marks parcial when the %s branch fills its eight-row cap and keeps its ranks', async branch => {
    const rows = (prefix: string, count: number) => json(Array.from({ length: count }, (_x, i) => ({ codigo_interno: `${prefix}${i + 1}` })));
    const capped = await run({ responders: { source: () => json(source(['Martillo'])), [branch]: () => rows('C', 8) } });
    const cappedBody = await capped.response.json();
    expect(cappedBody.parcial).toBe(true);
    expect(cappedBody.hybridRanks[0][branch]).toHaveLength(8);
    const under = await run({ responders: { source: () => json(source(['Martillo'])), [branch]: () => rows('C', 7) } });
    expect((await under.response.json()).parcial).toBe(false);
  });

  it('marks parcial when a branch returned more than eight rows and truncated them', async () => {
    const { response } = await run({
      responders: { source: () => json(source(['Martillo'])), lexical: () => json(Array.from({ length: 11 }, (_x, i) => ({ codigo_interno: `T${i}` }))) },
    });
    const body = await response.json();
    expect(body.parcial).toBe(true);
    expect(body.hybridRanks[0].lexical).toHaveLength(8);
  });

  it('keeps negative and zero stock products: existence is never a filter', async () => {
    const { response } = await run({
      responders: {
        source: () => json(source(['Martillo'])),
        lexical: () => json([{ codigo_interno: 'NEG', existencia: -3 }, { codigo_interno: 'ZERO', existencia: 0 }]),
        semantic: () => json([{ codigo_interno: 'NEG', existencia: -3, similitud: 0.6 }]),
      },
    });
    const body = await response.json();
    expect(body.hybridRanks[0].lexical).toEqual([{ codigoInterno: 'NEG', rank: 1 }, { codigoInterno: 'ZERO', rank: 2 }]);
    expect(body.hybridRanks[0].semantic).toEqual([{ codigoInterno: 'NEG', rank: 1 }]);
    expect(body.parcial).toBe(false);
  });

  it('never treats empty retrieval as proof of a new product: it is parcial with no ranks', async () => {
    const { response } = await run({
      responders: { source: () => json(source(['Producto inexistente'])), lexical: () => json([]), semantic: () => json([]) },
    });
    expect(await response.json()).toEqual({ hybridRanks: [], parcial: true });
  });

  it('embeds and searches a repeated description once and maps its ranks to every original line', async () => {
    const lines = ['Martillo', null, 'Martillo', '   Martillo   ', 'Clavo'];
    const { response, calls } = await run({ responders: { source: () => json(source(lines)) } });
    const body = await response.json();
    expect(kindsOf(calls, 'embeddings')[0].body.input).toEqual(['Martillo', 'Clavo']);
    expect(kindsOf(calls, 'lexical').map(call => call.body.p_busqueda)).toEqual(['Martillo', 'Clavo']);
    expect(body.hybridRanks.map((group: any) => group.lineIndex)).toEqual([0, 2, 3, 4]);
    expect(body.hybridRanks[1]).toEqual({ ...body.hybridRanks[0], lineIndex: 2 });
    expect(body.hybridRanks[2]).toEqual({ ...body.hybridRanks[0], lineIndex: 3 });
    expect(body.parcial).toBe(true);
  });

  it('skips descriptions over 200 characters and marks the result parcial', async () => {
    const exact = 'a'.repeat(200);
    const { response, calls } = await run({ responders: { source: () => json(source([exact, 'b'.repeat(201)])) } });
    const body = await response.json();
    expect(kindsOf(calls, 'embeddings')[0].body.input).toEqual([exact]);
    expect(body.hybridRanks.map((group: any) => group.lineIndex)).toEqual([0]);
    expect(body.parcial).toBe(true);
  });

  it('caps unique queries at 40, marks the rest parcial and keeps RPC concurrency at four', async () => {
    const lines = Array.from({ length: 45 }, (_unused, index) => `Producto ${index}`);
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = (responder: Responder): Responder => async call => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 2));
      inFlight -= 1;
      return responder(call);
    };
    const { response, calls } = await run({
      responders: {
        source: () => json(source(lines)),
        lexical: slow(defaultResponders.lexical),
        semantic: slow(defaultResponders.semantic),
      },
    });
    const body = await response.json();
    expect(kindsOf(calls, 'embeddings')[0].body.input).toEqual(lines.slice(0, 40));
    expect(kindsOf(calls, 'lexical')).toHaveLength(40);
    expect(kindsOf(calls, 'semantic')).toHaveLength(40);
    expect(body.hybridRanks.map((group: any) => group.lineIndex)).toEqual(Array.from({ length: 40 }, (_unused, index) => index));
    expect(body.parcial).toBe(true);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('caps the lines it will search at 200 original lines', async () => {
    const lines = Array.from({ length: 201 }, () => 'Mismo producto');
    const { response } = await run({ responders: { source: () => json(source(lines)) } });
    const body = await response.json();
    expect(body.hybridRanks).toHaveLength(200);
    expect(body.hybridRanks[199].lineIndex).toBe(199);
    expect(body.parcial).toBe(true);
  });
});
