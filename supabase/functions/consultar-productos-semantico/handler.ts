import { parseFacturaExtraction } from '../../../src/lib/facturaExtractionContract.ts';

interface HandlerConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly openRouterApiKey: string;
}

interface HandlerLimits {
  readonly requestTimeoutMs: number;
  readonly retrievalTimeoutMs: number;
}

interface HandlerDependencies {
  readonly config?: Partial<HandlerConfig>;
  readonly fetchFn?: typeof fetch;
  readonly limits?: Partial<HandlerLimits>;
}

interface Upstream {
  readonly status: number;
  /** Parsed body, or undefined when the body was not valid JSON. */
  readonly json: unknown;
}

type RankEntry = { readonly codigoInterno: string; readonly rank: number };
type LineRanks = { lineIndex: number; lexical?: readonly RankEntry[]; semantic?: readonly RankEntry[] };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_REGEX = /^[0-9a-f]{64}$/;
const MAX_REQUEST_BODY_BYTES = 4 * 1024;
const MAX_UPSTREAM_BODY_BYTES = 4 * 1024 * 1024;
const EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';
// Same embedding space as the inventory vectors (productos_embedding is vector(1536)); never swap the model alone.
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_LINES = 200;
const MAX_UNIQUE_QUERIES = 40;
const MAX_QUERY_CHARS = 200;
const MAX_SKU_CHARS = 120;
const RESULT_LIMIT = 8;
const SEMANTIC_THRESHOLD = 0.35;
const RPC_CONCURRENCY = 4;
const DEFAULT_LIMITS: HandlerLimits = { requestTimeoutMs: 10_000, retrievalTimeoutMs: 30_000 };

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const UNAVAILABLE_BODY = JSON.stringify({
  error: { code: 'fuente_no_disponible', message: 'Fuente de extracción no disponible' },
});

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, ...NO_STORE_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function unavailableResponse(): Response {
  return new Response(UNAVAILABLE_BODY, {
    status: 404,
    headers: { ...CORS_HEADERS, ...NO_STORE_HEADERS, 'Content-Type': 'application/json' },
  });
}

function resolveEnv(key: string): string {
  try {
    const denoEnv = (globalThis as any).Deno?.env?.get;
    if (typeof denoEnv === 'function') return (globalThis as any).Deno.env.get(key) || '';
    if (typeof process !== 'undefined' && process?.env) return process.env[key] || '';
  } catch {
    // Ignore environment lookup failures.
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Reads at most maxBytes from a body stream; null when it is too large or unreadable. */
async function readBoundedText(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  const reader = stream?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** One upstream call under its own deadline (and an optional shared one); null on any transport failure. */
async function requestJson(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  sharedSignal?: AbortSignal,
): Promise<Upstream | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  sharedSignal?.addEventListener('abort', abort);
  if (sharedSignal?.aborted) abort();
  try {
    const res = await fetchFn(url, { ...init, signal: controller.signal });
    const text = await readBoundedText(res.body, MAX_UPSTREAM_BODY_BYTES);
    if (text === null) return null;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    sharedSignal?.removeEventListener('abort', abort);
  }
}

async function runPool(tasks: ReadonlyArray<() => Promise<void>>, concurrency: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
}

function normalizeDescription(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Maps each original zero-based line to one of at most 40 unique, bounded queries. */
function planQueries(descriptions: ReadonlyArray<string | null>) {
  const unique = new Map<string, number>();
  const lineQueries: Array<readonly [lineIndex: number, queryIndex: number]> = [];
  let partial = descriptions.length > MAX_LINES;
  descriptions.slice(0, MAX_LINES).forEach((description, lineIndex) => {
    const text = normalizeDescription(description);
    if (!text || text.length > MAX_QUERY_CHARS) {
      partial = true;
      return;
    }
    let queryIndex = unique.get(text);
    if (queryIndex === undefined) {
      if (unique.size >= MAX_UNIQUE_QUERIES) {
        partial = true;
        return;
      }
      queryIndex = unique.size;
      unique.set(text, queryIndex);
    }
    lineQueries.push([lineIndex, queryIndex]);
  });
  return { queries: [...unique.keys()], lineQueries, partial };
}

function validVector(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== EMBEDDING_DIMENSIONS) return false;
  let squares = 0;
  for (const component of value) {
    if (typeof component !== 'number' || !Number.isFinite(component)) return false;
    squares += component * component;
  }
  return Number.isFinite(squares) && squares > 0;
}

/** One batch call; per-query vector or null. A null result means the whole provider response is unusable. */
async function embedQueries(
  fetchFn: typeof fetch,
  apiKey: string,
  queries: readonly string[],
  limits: HandlerLimits,
  signal: AbortSignal,
): Promise<Array<number[] | null> | null> {
  if (!apiKey || queries.length === 0) return null;
  // Only the bounded descriptions and the server key leave this function: never caller credentials or supplier data.
  const result = await requestJson(
    fetchFn,
    EMBEDDINGS_URL,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: queries, dimensions: EMBEDDING_DIMENSIONS }),
    },
    limits.requestTimeoutMs,
    signal,
  );
  if (!result || result.status !== 200 || !isRecord(result.json) || !Array.isArray(result.json.data)) return null;

  const vectors: Array<number[] | null> = queries.map(() => null);
  const seen = new Set<number>();
  for (const item of result.json.data as unknown[]) {
    if (!isRecord(item) || typeof item.index !== 'number' || !Number.isInteger(item.index)) return null;
    if (item.index < 0 || item.index >= queries.length || seen.has(item.index)) return null;
    seen.add(item.index);
    if (validVector(item.embedding)) vectors[item.index] = item.embedding;
  }
  return vectors;
}

interface Hits {
  /** Ordered unique SKUs (first occurrence wins, max 8). */
  readonly skus: string[];
  /** The RPC filled (or exceeded) its row cap, so more matches may exist. */
  readonly capped: boolean;
}

/** Null when the RPC failed or returned malformed rows. */
function parseRpcHits(result: Upstream | null): Hits | null {
  if (!result || result.status !== 200 || !Array.isArray(result.json)) return null;
  const skus: string[] = [];
  for (const row of result.json as unknown[]) {
    if (!isRecord(row) || typeof row.codigo_interno !== 'string') return null;
    const sku = row.codigo_interno;
    if (sku.trim() === '' || sku.length > MAX_SKU_CHARS) return null;
    if (!skus.includes(sku)) skus.push(sku);
  }
  return { skus: skus.slice(0, RESULT_LIMIT), capped: result.json.length >= RESULT_LIMIT };
}

const toRanks = (hits: Hits | null): RankEntry[] =>
  (hits?.skus ?? []).map((codigoInterno, index) => ({ codigoInterno, rank: index + 1 }));

export async function handleFacturaSemanticSearchRequest(
  request: Request,
  deps: HandlerDependencies = {},
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: { ...CORS_HEADERS, ...NO_STORE_HEADERS } });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: { code: 'method_not_allowed', message: 'Método no permitido' } }, 405, { Allow: 'POST, OPTIONS' });
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_REQUEST_BODY_BYTES) {
    return errorResponse('bad_request', 'Cuerpo de la solicitud excede el tamaño permitido', 400);
  }
  const bodyText = await readBoundedText(request.body, MAX_REQUEST_BODY_BYTES);
  if (!bodyText) return errorResponse('bad_request', 'Cuerpo de solicitud inválido o excede el límite de tamaño', 400);

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return errorResponse('bad_request', 'El cuerpo debe ser un JSON válido', 400);
  }
  if (!isRecord(body)) return errorResponse('bad_request', 'El cuerpo debe ser un objeto JSON', 400);

  const keys = Object.keys(body);
  if (keys.length !== 3 || !['facturaId', 'extraccionId', 'versionEsperada'].every(key => keys.includes(key))) {
    return errorResponse('bad_request', 'El cuerpo contiene claves no permitidas o incompletas', 400);
  }
  if (typeof body.facturaId !== 'string' || !UUID_REGEX.test(body.facturaId)) {
    return errorResponse('bad_request', 'facturaId debe ser un UUID válido', 400);
  }
  if (typeof body.extraccionId !== 'string' || !UUID_REGEX.test(body.extraccionId)) {
    return errorResponse('bad_request', 'extraccionId debe ser un UUID válido', 400);
  }
  if (!validPositiveInteger(body.versionEsperada)) {
    return errorResponse('bad_request', 'versionEsperada debe ser un entero positivo', 400);
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse('unauthorized', 'Cabecera Authorization Bearer requerida', 401);
  }
  const userJwt = authHeader.slice(7).trim();
  if (!userJwt) return errorResponse('unauthorized', 'Token de autorización vacío', 401);

  const supabaseUrl = (deps.config?.supabaseUrl ?? resolveEnv('SUPABASE_URL')).trim().replace(/\/$/, '');
  const supabaseAnonKey = (deps.config?.supabaseAnonKey ?? resolveEnv('SUPABASE_ANON_KEY')).trim();
  // A missing provider key is not an error: the lexical branch still answers (parcial).
  const openRouterApiKey = (deps.config?.openRouterApiKey ?? resolveEnv('OPENROUTER_API_KEY')).trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return errorResponse('server_configuration_error', 'Configuración del servidor incompleta', 500);
  }
  const limits: HandlerLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const fetchFn = deps.fetchFn || fetch;
  const facturaId = body.facturaId.toLowerCase();
  const extraccionId = body.extraccionId.toLowerCase();

  const readHeaders = { Authorization: `Bearer ${userJwt}`, apikey: supabaseAnonKey, Accept: 'application/json' };
  const rpcHeaders = { ...readHeaders, 'Content-Type': 'application/json' };
  const callSupabase = (path: string, init: RequestInit, signal?: AbortSignal) =>
    requestJson(fetchFn, `${supabaseUrl}${path}`, init, limits.requestTimeoutMs, signal);
  const callRpc = (name: string, rpcBody: unknown, signal?: AbortSignal) =>
    callSupabase(`/rest/v1/rpc/${name}`, { method: 'POST', headers: rpcHeaders, body: JSON.stringify(rpcBody) }, signal);

  try {
    // Identity, privilege and session are all proven before any source read or billable provider call.
    const auth = await callSupabase('/auth/v1/user', { method: 'GET', headers: readHeaders });
    if (!auth) return errorResponse('servicio_no_disponible', 'No se pudo verificar la identidad del usuario', 503);
    if (auth.status !== 200 || !isRecord(auth.json) || typeof auth.json.id !== 'string' || !UUID_REGEX.test(auth.json.id)) {
      return errorResponse('unauthorized', 'Sesión no válida o expirada', 401);
    }
    if (auth.json.role === 'service_role') {
      return errorResponse('forbidden', 'Acceso denegado para credenciales de servicio', 403);
    }

    const privileged = await callRpc('is_privileged', {});
    if (!privileged || privileged.status >= 500) {
      return errorResponse('servicio_no_disponible', 'No se pudo verificar el permiso del usuario', 503);
    }
    if (privileged.status !== 200 || privileged.json !== true) {
      return errorResponse('forbidden', 'Permiso insuficiente', 403);
    }

    const session = await callRpc('validate_session', {});
    if (!session || session.status >= 500) {
      return errorResponse('servicio_no_disponible', 'No se pudo verificar la sesión del usuario', 503);
    }
    if (session.status !== 200 || session.json !== true) {
      return errorResponse('unauthorized', 'Sesión no válida o expirada', 401);
    }

    const query = new URLSearchParams({
      id: `eq.${facturaId}`,
      select: 'id,version,documento_sha256,facturas_proveedores_extracciones(id,factura_id,estado,factura_version,documento_sha256,resultado)',
      'facturas_proveedores_extracciones.id': `eq.${extraccionId}`,
      'facturas_proveedores_extracciones.limit': '1',
    });
    const sourceResponse = await callSupabase(`/rest/v1/facturas_proveedores?${query.toString()}`, { method: 'GET', headers: readHeaders });
    if (!sourceResponse) return errorResponse('servicio_no_disponible', 'No se pudo leer la fuente de extracción', 503);
    if (sourceResponse.status !== 200 || !Array.isArray(sourceResponse.json)) {
      return errorResponse('error_servidor', 'Error al leer la fuente de extracción', 500);
    }

    const invoice = sourceResponse.json[0] as unknown;
    if (!isRecord(invoice) || invoice.id !== facturaId) return unavailableResponse();
    const extractions = invoice.facturas_proveedores_extracciones;
    const stored = Array.isArray(extractions) ? (extractions[0] as unknown) : null;
    if (!isRecord(stored) || stored.id !== extraccionId) return unavailableResponse();
    if (stored.factura_id !== facturaId) {
      return errorResponse('fuente_inconsistente', 'La extracción almacenada no coincide con la factura', 422);
    }
    if (
      !validPositiveInteger(invoice.version) ||
      invoice.version !== body.versionEsperada ||
      stored.factura_version !== invoice.version ||
      typeof invoice.documento_sha256 !== 'string' ||
      !SHA256_REGEX.test(invoice.documento_sha256) ||
      stored.documento_sha256 !== invoice.documento_sha256
    ) {
      return errorResponse('version_obsoleta', 'La versión o el documento de la factura cambió', 409);
    }
    if (stored.estado !== 'completado') {
      return errorResponse('extraccion_no_disponible', 'La extracción no está completada', 409);
    }
    const parsed = parseFacturaExtraction(stored.resultado);
    if (!parsed.ok) return errorResponse('fuente_inconsistente', 'La extracción almacenada no es válida', 422);

    const plan = planQueries(parsed.data.lineas.map(line => line.descripcion));
    const { queries } = plan;
    const lexicalHits: Array<Hits | null> = queries.map(() => null);
    const semanticHits: Array<Hits | null> = queries.map(() => null);

    if (queries.length > 0) {
      const retrieval = new AbortController();
      const retrievalTimer = setTimeout(() => retrieval.abort(), limits.retrievalTimeoutMs);
      try {
        const lexicalTasks = queries.map((text, index) => async () => {
          lexicalHits[index] = parseRpcHits(await callRpc('buscar_productos', { p_busqueda: text, p_limite: RESULT_LIMIT }, retrieval.signal));
        });
        const [vectors] = await Promise.all([
          embedQueries(fetchFn, openRouterApiKey, queries, limits, retrieval.signal),
          runPool(lexicalTasks, RPC_CONCURRENCY),
        ]);
        const semanticTasks = (vectors ?? []).flatMap((vector, index) => vector ? [async () => {
          const rpcBody = { p_embedding: JSON.stringify(vector), p_umbral: SEMANTIC_THRESHOLD, p_limite: RESULT_LIMIT };
          semanticHits[index] = parseRpcHits(await callRpc('buscar_semantico', rpcBody, retrieval.signal));
        }] : []);
        await runPool(semanticTasks, RPC_CONCURRENCY);
      } finally {
        clearTimeout(retrievalTimer);
      }
    }

    // Any failed, missing, capped or empty branch makes the answer partial: absence of ranks never proves a product is new.
    let partial = plan.partial;
    queries.forEach((_text, index) => {
      const lexical = lexicalHits[index];
      const semantic = semanticHits[index];
      if (lexical === null || semantic === null || lexical.capped || semantic.capped) partial = true;
      if (lexical?.skus.length === 0 && semantic?.skus.length === 0) partial = true;
    });

    const hybridRanks: LineRanks[] = [];
    for (const [lineIndex, queryIndex] of plan.lineQueries) {
      const lexical = toRanks(lexicalHits[queryIndex]);
      const semantic = toRanks(semanticHits[queryIndex]);
      if (lexical.length === 0 && semantic.length === 0) continue;
      hybridRanks.push({
        lineIndex,
        ...(lexical.length > 0 ? { lexical } : {}),
        ...(semantic.length > 0 ? { semantic } : {}),
      });
    }
    return jsonResponse({ hybridRanks, parcial: partial });
  } catch {
    return errorResponse('error_servidor', 'Error interno al consultar productos', 500);
  }
}
