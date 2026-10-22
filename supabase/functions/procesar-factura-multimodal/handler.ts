import {
  executeOpenRouterExtraction,
  type SafeExtractionMetadata,
} from './openrouter.ts';
import {
  parseFacturaExtraction,
  type FacturaExtraccionPayload,
} from '../../../src/lib/facturaExtractionContract.ts';
import {
  validateDocumentBytes,
  bytesToHex,
  MAX_DOCUMENT_BYTES,
  type DocumentValidation,
} from '../../../src/lib/facturaDocumento.ts';

export interface HandlerConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly supabaseServiceRoleKey: string;
  readonly openRouterApiKey: string;
}

export interface HandlerDependencies {
  readonly config?: Partial<HandlerConfig>;
  readonly fetchFn?: typeof fetch;
  readonly validateDocument?: (bytes: Uint8Array) => DocumentValidation;
  readonly parseContract?: (raw: unknown) => {
    readonly ok: true;
    readonly data: FacturaExtraccionPayload;
  } | {
    readonly ok: false;
    readonly error: { readonly code: string; readonly message: string };
  };
  readonly signal?: AbortSignal;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BODY_BYTES = 16 * 1024; // 16 KB

function formatDecimal(value: number): string {
  const decimal = String(value);
  const exponentIndex = decimal.indexOf('e');
  let plainDecimal = decimal;
  if (exponentIndex !== -1) {
    const coefficient = decimal.slice(0, exponentIndex);
    const exponent = Number(decimal.slice(exponentIndex + 1));
    const pointIndex = coefficient.indexOf('.');
    const digits = coefficient.replace('.', '');
    const pointPosition = (pointIndex === -1 ? coefficient.length : pointIndex) + exponent;

    if (pointPosition <= 0) plainDecimal = `0.${'0'.repeat(-pointPosition)}${digits}`;
    else if (pointPosition >= digits.length) plainDecimal = `${digits}${'0'.repeat(pointPosition - digits.length)}`;
    else plainDecimal = `${digits.slice(0, pointPosition)}.${digits.slice(pointPosition)}`;
  }

  const plainPointIndex = plainDecimal.indexOf('.');
  if (plainPointIndex === -1) return `${plainDecimal}.000000`;
  return `${plainDecimal.slice(0, plainPointIndex + 1)}${plainDecimal.slice(plainPointIndex + 1).padEnd(6, '0')}`;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function createErrorResponse(
  code: string,
  message: string,
  status = 400,
  extra: Record<string, unknown> = {}
): Response {
  return createJsonResponse(
    {
      error: { code, message },
      ...extra,
    },
    status
  );
}

function resolveEnv(key: string): string {
  try {
    const denoEnv = (globalThis as any).Deno?.env?.get;
    if (typeof denoEnv === 'function') {
      return (globalThis as any).Deno.env.get(key) || '';
    }
    if (typeof process !== 'undefined' && process?.env) {
      return process.env[key] || '';
    }
  } catch {
    // Ignore environment lookup failures
  }
  return '';
}

export async function handleFacturaExtractionRequest(
  request: Request,
  deps: HandlerDependencies = {}
): Promise<Response> {
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: CORS_HEADERS,
    });
  }

  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Método no permitido' } }), {
      status: 405,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        Allow: 'POST, OPTIONS',
      },
    });
  }

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const len = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(len) && len > MAX_REQUEST_BODY_BYTES) {
      return createErrorResponse('bad_request', 'Cuerpo de la solicitud excede el tamaño permitido', 400);
    }
  }

  let bodyText = '';
  try {
    bodyText = await request.text();
  } catch {
    return createErrorResponse('bad_request', 'No se pudo leer el cuerpo de la solicitud', 400);
  }

  if (!bodyText || new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BODY_BYTES) {
    return createErrorResponse('bad_request', 'Cuerpo de solicitud inválido o excede el límite de tamaño', 400);
  }

  let body: any;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return createErrorResponse('bad_request', 'El cuerpo debe ser un JSON válido', 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return createErrorResponse('bad_request', 'El cuerpo debe ser un objeto JSON', 400);
  }

  const keys = Object.keys(body);
  if (
    keys.length !== 3 ||
    !keys.includes('facturaId') ||
    !keys.includes('solicitudId') ||
    !keys.includes('versionEsperada')
  ) {
    return createErrorResponse('bad_request', 'El cuerpo contiene claves no permitidas o incompletas', 400);
  }

  const { facturaId, solicitudId, versionEsperada } = body;
  if (typeof facturaId !== 'string' || !UUID_REGEX.test(facturaId)) {
    return createErrorResponse('bad_request', 'facturaId debe ser un UUID válido', 400);
  }
  if (typeof solicitudId !== 'string' || !UUID_REGEX.test(solicitudId)) {
    return createErrorResponse('bad_request', 'solicitudId debe ser un UUID válido', 400);
  }
  if (
    typeof versionEsperada !== 'number' ||
    !Number.isSafeInteger(versionEsperada) ||
    versionEsperada < 1
  ) {
    return createErrorResponse('bad_request', 'versionEsperada debe ser un entero positivo', 400);
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return createErrorResponse('unauthorized', 'Cabecera Authorization Bearer requerida', 401);
  }
  const userJwt = authHeader.slice(7).trim();
  if (!userJwt) {
    return createErrorResponse('unauthorized', 'Token de autorización vacío', 401);
  }

  const supabaseUrl = (deps.config?.supabaseUrl || resolveEnv('SUPABASE_URL')).trim();
  const supabaseAnonKey = (deps.config?.supabaseAnonKey || resolveEnv('SUPABASE_ANON_KEY')).trim();
  const supabaseServiceRoleKey = (
    deps.config?.supabaseServiceRoleKey || resolveEnv('SUPABASE_SERVICE_ROLE_KEY')
  ).trim();
  const openRouterApiKey = (deps.config?.openRouterApiKey || resolveEnv('OPENROUTER_API_KEY')).trim();

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !openRouterApiKey) {
    return createErrorResponse('server_configuration_error', 'Configuración del servidor incompleta', 500);
  }

  const fetchFn = deps.fetchFn || fetch;

  let authUser: { id: string; role?: string };
  try {
    const authRes = await fetchFn(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userJwt}`,
        apikey: supabaseAnonKey,
      },
    });
    if (!authRes.ok) {
      return createErrorResponse('unauthorized', 'Sesión no válida o expirada', 401);
    }
    const authJson = await authRes.json();
    if (!authJson || typeof authJson !== 'object' || !authJson.id || !UUID_REGEX.test(authJson.id)) {
      return createErrorResponse('unauthorized', 'Identidad de usuario no válida', 401);
    }
    if (authJson.role === 'service_role') {
      return createErrorResponse('unauthorized', 'Acceso denegado para credenciales de servicio', 403);
    }
    authUser = authJson;
  } catch {
    return createErrorResponse('unauthorized', 'Error al verificar la identidad del usuario', 401);
  }

  let reservationRes: Response;
  try {
    reservationRes = await fetchFn(`${supabaseUrl}/rest/v1/rpc/reservar_extraccion_factura`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userJwt}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_factura_id: facturaId,
        p_solicitud_id: solicitudId,
        p_version_esperada: versionEsperada,
      }),
    });
  } catch {
    return createErrorResponse('error_servidor', 'Error de comunicación al reservar la extracción', 500);
  }

  if (!reservationRes.ok) {
    let errBody: any = null;
    try {
      errBody = await reservationRes.json();
    } catch {
      // ignore
    }
    const errCode = errBody?.code || '';
    const errMessage = typeof errBody?.message === 'string' ? errBody.message : '';

    if (errCode === 'PX409' || errMessage.includes('extraccion_en_curso')) {
      return createErrorResponse('extraccion_en_curso', 'Ya existe una extracción en curso para esta factura', 409);
    }
    if (errCode === 'PV409' || errMessage.includes('version_obsoleta')) {
      return createErrorResponse('version_obsoleta', 'La versión de la factura es obsoleta', 409);
    }
    if (errCode === '42501' || errMessage.includes('no_autorizado')) {
      return createErrorResponse('no_autorizado', 'No tienes permiso para extraer esta factura', 403);
    }
    if (errCode === 'P0002' || errMessage.includes('factura_no_encontrada')) {
      return createErrorResponse('factura_no_encontrada', 'Factura no encontrada', 404);
    }
    if (errCode === '22023' || errMessage.includes('sin_documento_fuente')) {
      return createErrorResponse('sin_documento_fuente', 'La factura no tiene documento adjunto', 400);
    }
    return createErrorResponse('error_servidor', 'Error interno al reservar la extracción', 500);
  }

  let reservation: any;
  try {
    reservation = await reservationRes.json();
  } catch {
    return createErrorResponse('error_servidor', 'Respuesta de reserva inválida', 500);
  }

  if (reservation.replay === true) {
    return createJsonResponse(reservation, 200);
  }

  if (!reservation.ejecutar) {
    return createErrorResponse('error_servidor', 'La reserva no autorizó la ejecución', 500);
  }

  async function callCompletarRpc(params: {
    estado: 'completado' | 'fallido';
    resultado: unknown;
    errorCodigo: string | null;
    metadatos: Record<string, unknown> | null;
  }): Promise<{ ok: true; data: any } | { ok: false; status: number }> {
    try {
      const res = await fetchFn(`${supabaseUrl}/rest/v1/rpc/completar_extraccion_factura`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseServiceRoleKey}`,
          apikey: supabaseServiceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_factura_id: facturaId,
          p_solicitud_id: solicitudId,
          p_estado: params.estado,
          p_resultado: params.resultado,
          p_error_codigo: params.errorCodigo,
          p_metadatos: params.metadatos,
        }),
      });
      if (!res.ok) {
        return { ok: false, status: res.status };
      }
      const data = await res.json();
      return { ok: true, data };
    } catch {
      return { ok: false, status: 500 };
    }
  }

  const doc = reservation.documento;
  if (!doc || typeof doc !== 'object' || typeof doc.path !== 'string') {
    await callCompletarRpc({ estado: 'fallido', resultado: null, errorCodigo: 'invalid_document', metadatos: null });
    return createErrorResponse('invalid_document', 'Metadatos de documento ausentes en la reserva', 422, {
      extraccionId: reservation.extraccion_id,
    });
  }

  const pathRegex = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|jpg|png|webp)$/i;
  const pathMatch = pathRegex.exec(doc.path);

  if (
    !pathMatch ||
    pathMatch[1].toLowerCase() !== authUser.id.toLowerCase() ||
    pathMatch[2].toLowerCase() !== facturaId.toLowerCase()
  ) {
    await callCompletarRpc({ estado: 'fallido', resultado: null, errorCodigo: 'invalid_document', metadatos: null });
    return createErrorResponse('invalid_document', 'Ruta de almacenamiento no autorizada o no conforme', 422, {
      extraccionId: reservation.extraccion_id,
    });
  }

  let docRes: Response;
  try {
    const encodedPath = doc.path.split('/').map(encodeURIComponent).join('/');
    docRes = await fetchFn(`${supabaseUrl}/storage/v1/object/authenticated/facturas_proveedores/${encodedPath}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userJwt}`,
        apikey: supabaseAnonKey,
      },
    });
  } catch {
    await callCompletarRpc({ estado: 'fallido', resultado: null, errorCodigo: 'invalid_document', metadatos: null });
    return createErrorResponse('invalid_document', 'Error al descargar documento de almacenamiento', 422, {
      extraccionId: reservation.extraccion_id,
    });
  }

  if (!docRes.ok) {
    await callCompletarRpc({ estado: 'fallido', resultado: null, errorCodigo: 'invalid_document', metadatos: null });
    return createErrorResponse('invalid_document', 'No se pudo descargar el archivo de almacenamiento', 422, {
      extraccionId: reservation.extraccion_id,
    });
  }

  let docArrayBuffer: ArrayBuffer;
  let docBytes: Uint8Array;
  try {
    docArrayBuffer = await docRes.arrayBuffer();
    docBytes = new Uint8Array(docArrayBuffer);
  } catch {
    await callCompletarRpc({ estado: 'fallido', resultado: null, errorCodigo: 'invalid_document', metadatos: null });
    return createErrorResponse('invalid_document', 'Error al leer bytes del documento', 422, {
      extraccionId: reservation.extraccion_id,
    });
  }

  if (docBytes.length === 0 || docBytes.length > MAX_DOCUMENT_BYTES || docBytes.length !== doc.bytes) {
    await callCompletarRpc({ estado: 'fallido', resultado: null, errorCodigo: 'invalid_document', metadatos: null });
    return createErrorResponse('invalid_document', 'El tamaño de bytes no coincide con el registro', 422, {
      extraccionId: reservation.extraccion_id,
    });
  }

  const validation = (deps.validateDocument || validateDocumentBytes)(docBytes);
  if (!validation.ok || validation.mime !== doc.mime) {
    await callCompletarRpc({ estado: 'fallido', resultado: null, errorCodigo: 'invalid_document', metadatos: null });
    return createErrorResponse('invalid_document', 'Contenido o tipo MIME no coincide con el registro', 422, {
      extraccionId: reservation.extraccion_id,
    });
  }

  const computedSha256 = bytesToHex(await crypto.subtle.digest('SHA-256', docArrayBuffer));
  if (computedSha256.toLowerCase() !== String(doc.sha256).toLowerCase()) {
    await callCompletarRpc({ estado: 'fallido', resultado: null, errorCodigo: 'invalid_document', metadatos: null });
    return createErrorResponse('invalid_document', 'Integridad SHA-256 no coincide con el registro', 422, {
      extraccionId: reservation.extraccion_id,
    });
  }

  const activeSignal = deps.signal || request.signal;
  if (activeSignal?.aborted) {
    await callCompletarRpc({ estado: 'fallido', resultado: null, errorCodigo: 'aborted', metadatos: null });
    return createErrorResponse('aborted', 'La solicitud fue cancelada por el cliente', 499, {
      extraccionId: reservation.extraccion_id,
    });
  }

  const extractionOutcome = await executeOpenRouterExtraction({
    apiKey: openRouterApiKey,
    documentBytes: docBytes,
    validateDocument: deps.validateDocument || validateDocumentBytes,
    parseContract: deps.parseContract || parseFacturaExtraction,
    fetchFn,
    signal: activeSignal,
    timeoutMs: 60000,
  });

  if (!extractionOutcome.ok) {
    const errCode = extractionOutcome.error.code;
    await callCompletarRpc({ estado: 'fallido', resultado: null, errorCodigo: errCode, metadatos: null });

    let httpStatus = 422;
    if (errCode === 'aborted') {
      httpStatus = 499;
    } else if (errCode === 'timeout') {
      httpStatus = 504;
    } else if (errCode === 'rate_limited') {
      httpStatus = 429;
    } else if (errCode === 'insufficient_credits') {
      httpStatus = 402;
    } else if (errCode === 'unauthorized' || errCode === 'invalid_api_key') {
      httpStatus = 500;
    } else if (errCode === 'upstream_error') {
      httpStatus = 502;
    }

    return createErrorResponse(errCode, extractionOutcome.error.message, httpStatus, {
      extraccionId: reservation.extraccion_id,
    });
  }

  const meta = extractionOutcome.metadata;
  const canonicalMetadata: Record<string, unknown> = {
    model: meta.model,
    provider: meta.provider,
    tokens_prompt: meta.tokens.prompt,
    tokens_completion: meta.tokens.completion,
    tokens_total: meta.tokens.total,
    cost_usd: meta.costUsd !== null ? formatDecimal(meta.costUsd) : null,
  };

  const completionResult = await callCompletarRpc({
    estado: 'completado',
    resultado: extractionOutcome.data,
    errorCodigo: null,
    metadatos: canonicalMetadata,
  });

  if (!completionResult.ok) {
    return createJsonResponse(
      {
        error: {
          code: 'persistence_error',
          message: 'No se pudo persistir el resultado de la extracción',
        },
        recuperable: true,
        facturaId,
        solicitudId,
      },
      500
    );
  }

  const completionData = completionResult.data;
  if (completionData?.estado === 'cuarentena') {
    return createJsonResponse(
      {
        extraccionId: completionData.extraccion_id,
        facturaId,
        solicitudId,
        estado: 'cuarentena',
        replay: completionData.replay ?? false,
        aviso: 'La factura fue modificada durante el procesamiento; resultado retenido en cuarentena',
      },
      200
    );
  }

  return createJsonResponse(
    {
      extraccionId: completionData.extraccion_id,
      facturaId,
      solicitudId,
      estado: 'completado',
      replay: completionData.replay ?? false,
      resultado: extractionOutcome.data,
      metadatos: canonicalMetadata,
    },
    200
  );
}
