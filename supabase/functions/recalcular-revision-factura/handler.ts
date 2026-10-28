import { parseFacturaExtraction } from '../../../src/lib/facturaExtractionContract.ts';
import {
  calcularRevision,
  validarContenidoRevision,
} from '../../../src/lib/facturaRevision.ts';

interface HandlerConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
}

interface HandlerDependencies {
  readonly config?: Partial<HandlerConfig>;
  readonly fetchFn?: typeof fetch;
}

interface StoredExtraction {
  readonly id: string;
  readonly factura_id: string;
  readonly estado: string;
  readonly factura_version: number;
  readonly documento_sha256: string;
  readonly resultado: unknown;
}

interface StoredRevision {
  readonly revision: number;
  readonly factura_version: number;
  readonly extraccion_id: string | null;
  readonly documento_sha256: string | null;
  readonly contenido: unknown;
  readonly fingerprint: string;
  readonly aprobado_por: string | null;
  readonly aprobado_en: string | null;
  readonly facturas_proveedores_extracciones: StoredExtraction | null;
}

interface StoredInvoice {
  readonly id: string;
  readonly version: number;
  readonly documento_sha256: string | null;
  readonly facturas_proveedores_revisiones: readonly StoredRevision[] | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_REGEX = /^[0-9a-f]{64}$/;
const MAX_REQUEST_BODY_BYTES = 4 * 1024;
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const NOT_AVAILABLE_BODY = JSON.stringify({
  error: { code: 'fuente_no_disponible', message: 'Fuente aprobada no disponible' },
});

function response(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      ...NO_STORE_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return response(JSON.stringify(data), status);
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function unavailableResponse(): Response {
  return response(NOT_AVAILABLE_BODY, 404);
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

function validOptionalSha256(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && SHA256_REGEX.test(value));
}

async function readBoundedBody(request: Request): Promise<{ text: string } | { error: 'read' | 'too_large' }> {
  const reader = request.body?.getReader();
  if (!reader) return { text: '' };

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return { error: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { error: 'read' };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}

export async function handleFacturaRecalculationRequest(
  request: Request,
  deps: HandlerDependencies = {},
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: { ...CORS_HEADERS, ...NO_STORE_HEADERS } });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Método no permitido' } }), {
      status: 405,
      headers: { ...CORS_HEADERS, ...NO_STORE_HEADERS, 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' },
    });
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_REQUEST_BODY_BYTES) {
    return errorResponse('bad_request', 'Cuerpo de la solicitud excede el tamaño permitido', 400);
  }

  const bodyResult = await readBoundedBody(request);
  if ('error' in bodyResult && bodyResult.error === 'read') {
    return errorResponse('bad_request', 'No se pudo leer el cuerpo de la solicitud', 400);
  }
  if ('error' in bodyResult) {
    return errorResponse('bad_request', 'Cuerpo de solicitud inválido o excede el límite de tamaño', 400);
  }
  const bodyText = bodyResult.text;
  if (!bodyText) return errorResponse('bad_request', 'Cuerpo de solicitud inválido o excede el límite de tamaño', 400);

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return errorResponse('bad_request', 'El cuerpo debe ser un JSON válido', 400);
  }
  if (!isRecord(body)) return errorResponse('bad_request', 'El cuerpo debe ser un objeto JSON', 400);

  const keys = Object.keys(body);
  if (keys.length !== 4 || !['facturaId', 'revision', 'fingerprint', 'versionEsperada'].every(key => keys.includes(key))) {
    return errorResponse('bad_request', 'El cuerpo contiene claves no permitidas o incompletas', 400);
  }
  if (typeof body.facturaId !== 'string' || !UUID_REGEX.test(body.facturaId)) {
    return errorResponse('bad_request', 'facturaId debe ser un UUID válido', 400);
  }
  if (!validPositiveInteger(body.revision)) {
    return errorResponse('bad_request', 'revision debe ser un entero positivo', 400);
  }
  if (typeof body.fingerprint !== 'string' || !SHA256_REGEX.test(body.fingerprint)) {
    return errorResponse('bad_request', 'fingerprint debe ser un SHA-256 hexadecimal válido', 400);
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

  const supabaseUrl = (deps.config?.supabaseUrl || resolveEnv('SUPABASE_URL')).trim().replace(/\/$/, '');
  const supabaseAnonKey = (deps.config?.supabaseAnonKey || resolveEnv('SUPABASE_ANON_KEY')).trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return errorResponse('server_configuration_error', 'Configuración del servidor incompleta', 500);
  }

  const fetchFn = deps.fetchFn || fetch;
  try {
    const authResponse = await fetchFn(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${userJwt}`, apikey: supabaseAnonKey },
    });
    if (!authResponse.ok) return errorResponse('unauthorized', 'Sesión no válida o expirada', 401);
    const authBody: unknown = await authResponse.json();
    if (!isRecord(authBody) || typeof authBody.id !== 'string' || !UUID_REGEX.test(authBody.id)) {
      return errorResponse('unauthorized', 'Identidad de usuario no válida', 401);
    }
    if (authBody.role === 'service_role') {
      return errorResponse('unauthorized', 'Acceso denegado para credenciales de servicio', 403);
    }
  } catch {
    return errorResponse('unauthorized', 'Error al verificar la identidad del usuario', 401);
  }

  const facturaId = body.facturaId.toLowerCase();
  const query = new URLSearchParams({
    id: `eq.${facturaId}`,
    select: 'id,version,documento_sha256,facturas_proveedores_revisiones(revision,factura_version,extraccion_id,documento_sha256,contenido,fingerprint,aprobado_por,aprobado_en,facturas_proveedores_extracciones(id,factura_id,estado,factura_version,documento_sha256,resultado))',
    'facturas_proveedores_revisiones.order': 'revision.desc',
    'facturas_proveedores_revisiones.limit': '1',
  });
  let sourceResponse: Response;
  try {
    sourceResponse = await fetchFn(`${supabaseUrl}/rest/v1/facturas_proveedores?${query.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userJwt}`,
        apikey: supabaseAnonKey,
        Accept: 'application/json',
      },
    });
  } catch {
    return errorResponse('error_servidor', 'Error al leer la fuente de revisión', 500);
  }
  if (!sourceResponse.ok) return errorResponse('error_servidor', 'Error al leer la fuente de revisión', 500);

  let rows: unknown;
  try {
    rows = await sourceResponse.json();
  } catch {
    return errorResponse('error_servidor', 'Respuesta de fuente inválida', 500);
  }
  if (!Array.isArray(rows) || rows.length === 0) return unavailableResponse();
  const invoice = rows[0] as StoredInvoice;
  if (!isRecord(invoice) || invoice.id !== facturaId) return unavailableResponse();
  const revisions = invoice.facturas_proveedores_revisiones;
  if (!Array.isArray(revisions) || revisions.length === 0) return unavailableResponse();
  const latest = revisions[0] as StoredRevision;
  if (!isRecord(latest) || !validPositiveInteger(latest.revision)) {
    return errorResponse('fuente_inconsistente', 'La revisión almacenada no es válida', 422);
  }
  if (latest.revision !== body.revision) {
    return errorResponse('revision_obsoleta', 'La revisión solicitada ya no es la última', 409);
  }
  if (latest.aprobado_por === null && latest.aprobado_en === null) {
    return errorResponse('revision_no_aprobada', 'La última revisión no está aprobada', 409);
  }
  if (typeof latest.aprobado_por !== 'string' || !UUID_REGEX.test(latest.aprobado_por) || typeof latest.aprobado_en !== 'string' || !latest.aprobado_en) {
    return errorResponse('fuente_inconsistente', 'La fuente de revisión almacenada es inconsistente', 422);
  }
  if (typeof latest.fingerprint !== 'string' || !SHA256_REGEX.test(latest.fingerprint)) {
    return errorResponse('fuente_inconsistente', 'La huella de la revisión almacenada no es válida', 422);
  }
  if (latest.fingerprint !== body.fingerprint) {
    return errorResponse('fingerprint_no_coincide', 'La huella de la revisión no coincide', 409);
  }
  if (
    !validPositiveInteger(invoice.version) ||
    !validPositiveInteger(latest.factura_version) ||
    invoice.version !== body.versionEsperada ||
    latest.factura_version !== invoice.version ||
    !validOptionalSha256(invoice.documento_sha256) ||
    !validOptionalSha256(latest.documento_sha256) ||
    latest.documento_sha256 !== invoice.documento_sha256
  ) {
    return errorResponse('version_obsoleta', 'La versión o el documento de la factura cambió', 409);
  }

  let extraction = null;
  if (!isRecord(latest.contenido) || latest.contenido.extraccion_id !== latest.extraccion_id) {
    return errorResponse('fuente_inconsistente', 'El identificador de extracción no coincide con la revisión', 422);
  }
  if (latest.extraccion_id !== null) {
    const storedExtraction = latest.facturas_proveedores_extracciones;
    if (
      !isRecord(storedExtraction) ||
      storedExtraction.id !== latest.extraccion_id ||
      storedExtraction.factura_id !== facturaId ||
      storedExtraction.estado !== 'completado' ||
      storedExtraction.factura_version !== invoice.version ||
      storedExtraction.documento_sha256 !== invoice.documento_sha256
    ) {
      return errorResponse('fuente_inconsistente', 'La extracción almacenada no coincide con la revisión', 422);
    }
    const parsedExtraction = parseFacturaExtraction(storedExtraction.resultado);
    if (!parsedExtraction.ok) return errorResponse('fuente_inconsistente', 'La extracción almacenada no es válida', 422);
    extraction = parsedExtraction.data;
  } else if (latest.facturas_proveedores_extracciones !== null) {
    return errorResponse('fuente_inconsistente', 'La extracción almacenada no coincide con la revisión', 422);
  }

  const validated = validarContenidoRevision(latest.contenido, extraction);
  if (!validated.ok) return errorResponse('fuente_inconsistente', 'El contenido almacenado de la revisión no es válido', 422);
  const calculation = calcularRevision({ extraccion: extraction, contenido: validated.contenido });

  return jsonResponse({
    origen: {
      facturaId,
      revision: latest.revision,
      fingerprint: latest.fingerprint,
      facturaVersion: invoice.version,
      documentoSha256: invoice.documento_sha256,
      extraccionId: latest.extraccion_id,
      aprobadoEn: latest.aprobado_en,
      calculoVersion: calculation.calculo_version,
    },
    calculo: {
      calculo_version: calculation.calculo_version,
      moneda: calculation.moneda,
      totales: calculation.totales,
      pos: calculation.pos,
      bloqueos: calculation.bloqueos.map(({ codigo, ambito, lineaId }) => ({ codigo, ambito, lineaId })),
      sinBloqueos: calculation.sinBloqueos,
    },
    permisoImportacion: false,
    instantaneaDe: 'instantanea_una_lectura_postgrest_sin_garantia_entre_peticiones',
  });
}
