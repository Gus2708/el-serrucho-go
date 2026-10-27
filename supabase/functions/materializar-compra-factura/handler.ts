import { parseFacturaExtraction, type FacturaExtraccionPayload } from '../../../src/lib/facturaExtractionContract.ts';
import {
  calcularRevision,
  resolverFactura,
  resolverPrecioVenta,
  validarContenidoRevision,
  type RevisionContenido,
} from '../../../src/lib/facturaRevision.ts';
import { addDecimal, isZeroDecimal, parseDecimal, toDecimalString } from '../../../src/lib/facturaDecimal.ts';

interface HandlerConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly supabaseServiceRoleKey: string;
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
  readonly documento_sha256: string | null;
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
  readonly proveedor_codigo: string | null;
  readonly facturas_proveedores_revisiones: readonly StoredRevision[] | null;
}

interface DraftItem {
  readonly codigo_producto: string;
  readonly descripcion: string;
  readonly cantidad: string;
  readonly costo: string;
  readonly precio: string;
  readonly referencia: null;
  readonly es_nuevo: false;
}

interface DraftPayload {
  readonly header: {
    readonly proveedor_codigo: string | null;
    readonly proveedor_nombre: string | null;
    readonly numero_documento: string | null;
    readonly nota: string | null;
    readonly titulo: string;
  };
  readonly items: readonly DraftItem[];
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
const UNAVAILABLE_BODY = JSON.stringify({ error: { code: 'fuente_no_disponible', message: 'Fuente aprobada no disponible' } });

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, ...NO_STORE_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function resolveEnv(key: string): string {
  try {
    const denoEnv = (globalThis as any).Deno?.env?.get;
    if (typeof denoEnv === 'function') return denoEnv(key) || '';
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

async function boundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BODY_BYTES) {
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

function buildDraft(invoice: StoredInvoice, revision: StoredRevision, extraction: FacturaExtraccionPayload, contenido: RevisionContenido): DraftPayload | null {
  const calculation = calcularRevision({ extraccion: extraction, contenido });
  if (!calculation.sinBloqueos) return null;

  const effective = resolverFactura(extraction, contenido);
  const bySku = new Map<string, DraftItem>();
  const bySkuCost = new Map<string, string>();
  const bySkuPrice = new Map<string, string>();
  for (const line of calculation.lineas) {
    const sku = line.decisionAsociacion.tipo === 'confirmado' ? line.decisionAsociacion.codigoInterno : null;
    if (!sku || line.cantidadStock === null || line.costoNetoUnitarioStock === null || line.descripcion === null || line.descripcion.trim() === '') return null;
    const resolvedPrice = resolverPrecioVenta({
      tipoDocumento: contenido.cabecera.tipoDocumento ?? null,
      costoNetoUnitario: line.costoNetoUnitarioStock,
      precioVenta: revision.contenido && isRecord(revision.contenido)
        ? (Array.isArray(revision.contenido.lineas)
          ? (revision.contenido.lineas.find(row => isRecord(row) && row.lineaId === line.lineaId) as Record<string, unknown> | undefined)?.precioVenta as string | undefined ?? null
          : null)
        : null,
    });
    if (!resolvedPrice) return null;
    const parsedQuantity = parseDecimal(line.cantidadStock);
    const parsedCost = parseDecimal(line.costoNetoUnitarioStock);
    const parsedPrice = parseDecimal(resolvedPrice.valor);
    if (!parsedQuantity || parsedQuantity.neg || isZeroDecimal(parsedQuantity) || !parsedCost || parsedCost.neg || isZeroDecimal(parsedCost) || !parsedPrice || parsedPrice.neg || isZeroDecimal(parsedPrice)) return null;

    const current = bySku.get(sku);
    if (!current) {
      bySku.set(sku, {
        codigo_producto: sku,
        descripcion: line.descripcion,
        cantidad: toDecimalString(parsedQuantity),
        costo: toDecimalString(parsedCost),
        precio: toDecimalString(parsedPrice),
        referencia: null,
        es_nuevo: false,
      });
      bySkuCost.set(sku, toDecimalString(parsedCost));
      bySkuPrice.set(sku, toDecimalString(parsedPrice));
      continue;
    }
    if (current.descripcion !== line.descripcion || bySkuCost.get(sku) !== toDecimalString(parsedCost) || bySkuPrice.get(sku) !== toDecimalString(parsedPrice)) return null;
    const priorQuantity = parseDecimal(current.cantidad);
    if (!priorQuantity) return null;
    const totalQuantity = addDecimal(priorQuantity, parsedQuantity);
    bySku.set(sku, { ...current, cantidad: toDecimalString(totalQuantity) });
  }

  if (bySku.size === 0) return null;
  const header = effective.campos;
  const providerName = header.proveedorNombre.valor ?? null;
  const documentNumber = header.numeroDocumento.valor ?? null;
  return {
    header: {
      proveedor_codigo: invoice.proveedor_codigo,
      proveedor_nombre: providerName,
      numero_documento: documentNumber,
      nota: null,
      titulo: documentNumber ? `Factura ${documentNumber}` : `Factura ${invoice.id}`,
    },
    items: [...bySku.values()],
  };
}

export async function handleFacturaMaterializationRequest(request: Request, deps: HandlerDependencies = {}): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: { ...CORS_HEADERS, ...NO_STORE_HEADERS } });
  if (request.method !== 'POST') return errorResponse('method_not_allowed', 'Método no permitido', 405);
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_REQUEST_BODY_BYTES) return errorResponse('bad_request', 'Cuerpo excede el tamaño permitido', 400);
  const bodyText = await boundedBody(request);
  if (!bodyText) return errorResponse('bad_request', 'Cuerpo inválido o excede el límite permitido', 400);

  let body: unknown;
  try { body = JSON.parse(bodyText); } catch { return errorResponse('bad_request', 'El cuerpo debe ser JSON válido', 400); }
  if (!isRecord(body) || Object.keys(body).length !== 4 || !['facturaId', 'revision', 'fingerprint', 'versionEsperada'].every(key => key in body)) {
    return errorResponse('bad_request', 'El cuerpo contiene claves no permitidas o incompletas', 400);
  }
  if (typeof body.facturaId !== 'string' || !UUID_REGEX.test(body.facturaId)
      || !validPositiveInteger(body.revision)
      || typeof body.fingerprint !== 'string' || !SHA256_REGEX.test(body.fingerprint)
      || !validPositiveInteger(body.versionEsperada)) {
    return errorResponse('bad_request', 'Identidad de revisión inválida', 400);
  }

  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || !authorization.slice(7).trim()) return errorResponse('unauthorized', 'Cabecera Authorization Bearer requerida', 401);
  const userJwt = authorization.slice(7).trim();
  const supabaseUrl = (deps.config?.supabaseUrl || resolveEnv('SUPABASE_URL')).trim().replace(/\/$/, '');
  const anonKey = (deps.config?.supabaseAnonKey || resolveEnv('SUPABASE_ANON_KEY')).trim();
  const serviceKey = (deps.config?.supabaseServiceRoleKey || resolveEnv('SUPABASE_SERVICE_ROLE_KEY')).trim();
  if (!supabaseUrl || !anonKey || !serviceKey) return errorResponse('server_configuration_error', 'Configuración del servidor incompleta', 500);

  const fetchFn = deps.fetchFn || fetch;
  let userId: string;
  try {
    const auth = await fetchFn(`${supabaseUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${userJwt}`, apikey: anonKey } });
    if (!auth.ok) return errorResponse('unauthorized', 'Sesión no válida o expirada', 401);
    const data: unknown = await auth.json();
    if (!isRecord(data) || typeof data.id !== 'string' || !UUID_REGEX.test(data.id) || data.role === 'service_role') return errorResponse('unauthorized', 'Identidad de usuario no válida', 401);
    userId = data.id.toLowerCase();
  } catch {
    return errorResponse('unauthorized', 'No se pudo verificar la identidad', 401);
  }

  const facturaId = body.facturaId.toLowerCase();
  const select = 'id,version,documento_sha256,proveedor_codigo,facturas_proveedores_revisiones(revision,factura_version,extraccion_id,documento_sha256,contenido,fingerprint,aprobado_por,aprobado_en,facturas_proveedores_extracciones(id,factura_id,estado,factura_version,documento_sha256,resultado))';
  const query = new URLSearchParams({ id: `eq.${facturaId}`, select, 'facturas_proveedores_revisiones.order': 'revision.desc', 'facturas_proveedores_revisiones.limit': '1' });
  let rows: unknown;
  try {
    const source = await fetchFn(`${supabaseUrl}/rest/v1/facturas_proveedores?${query}`, {
      headers: { Authorization: `Bearer ${userJwt}`, apikey: anonKey, Accept: 'application/json' },
    });
    if (!source.ok) return errorResponse('error_servidor', 'No se pudo leer la fuente aprobada', 500);
    rows = await source.json();
  } catch {
    return errorResponse('error_servidor', 'No se pudo leer la fuente aprobada', 500);
  }
  if (!Array.isArray(rows) || rows.length === 0) return new Response(UNAVAILABLE_BODY, { status: 404, headers: { ...CORS_HEADERS, ...NO_STORE_HEADERS, 'Content-Type': 'application/json' } });
  const invoice = rows[0] as StoredInvoice;
  const latest = invoice.facturas_proveedores_revisiones?.[0];
  if (!isRecord(invoice) || invoice.id !== facturaId || !latest) return new Response(UNAVAILABLE_BODY, { status: 404, headers: { ...CORS_HEADERS, ...NO_STORE_HEADERS, 'Content-Type': 'application/json' } });
  if (latest.revision !== body.revision) return errorResponse('revision_obsoleta', 'La revisión solicitada ya no es la última', 409);
  if (latest.aprobado_por !== userId || !latest.aprobado_en) return errorResponse('revision_no_aprobada', 'La última revisión no está aprobada por esta cuenta', 409);
  if (latest.fingerprint !== body.fingerprint) return errorResponse('fingerprint_no_coincide', 'La huella de revisión no coincide', 409);
  if (invoice.version !== body.versionEsperada || latest.factura_version !== invoice.version || latest.documento_sha256 !== invoice.documento_sha256) return errorResponse('version_obsoleta', 'La versión o el documento cambió', 409);

  const storedExtraction = latest.facturas_proveedores_extracciones;
  if (!storedExtraction || storedExtraction.id !== latest.extraccion_id || storedExtraction.factura_id !== facturaId
      || storedExtraction.estado !== 'completado' || storedExtraction.factura_version !== invoice.version
      || storedExtraction.documento_sha256 !== invoice.documento_sha256) return errorResponse('fuente_inconsistente', 'La extracción no coincide con la revisión', 422);
  const parsedExtraction = parseFacturaExtraction(storedExtraction.resultado);
  if (!parsedExtraction.ok) return errorResponse('fuente_inconsistente', 'La extracción almacenada no es válida', 422);
  const validated = validarContenidoRevision(latest.contenido, parsedExtraction.data);
  if (!validated.ok) return errorResponse('fuente_inconsistente', 'La revisión almacenada no es válida', 422);
  const payload = buildDraft(invoice, latest, parsedExtraction.data, validated.contenido);
  if (!payload) return errorResponse('revision_bloqueada', 'La revisión no puede representarse como compra sin cambiar líneas, costos o decisiones', 409);

  const token = crypto.randomUUID();
  let stage: Response;
  try {
    stage = await fetchFn(`${supabaseUrl}/rest/v1/rpc/registrar_stage_compra_factura`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_token: token,
        p_factura_id: facturaId,
        p_revision: latest.revision,
        p_fingerprint: latest.fingerprint,
        p_factura_version: invoice.version,
        p_documento_sha256: invoice.documento_sha256,
        p_owner_id: userId,
        p_payload: payload,
      }),
    });
    if (!stage.ok) return errorResponse('error_servidor', 'No se pudo preparar el material para la compra', 500);
  } catch {
    return errorResponse('error_servidor', 'No se pudo preparar el material para la compra', 500);
  }
  const stagedToken: unknown = await stage.json().catch(() => null);
  if (typeof stagedToken !== 'string' || !UUID_REGEX.test(stagedToken)) return errorResponse('error_servidor', 'Preparación de compra inválida', 500);

  try {
    const result = await fetchFn(`${supabaseUrl}/rest/v1/rpc/materializar_compra_factura`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userJwt}`, apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_factura_id: facturaId,
        p_revision: latest.revision,
        p_fingerprint: latest.fingerprint,
        p_factura_version: invoice.version,
        p_token: stagedToken,
      }),
    });
    if (!result.ok) return errorResponse(result.status === 401 || result.status === 403 ? 'no_autorizado' : 'no_se_pudo_materializar', 'No se pudo crear la compra vinculada', result.status === 401 || result.status === 403 ? result.status : 409);
    const materialized: unknown = await result.json();
    if (!isRecord(materialized) || materialized.factura_id !== facturaId || !Number.isSafeInteger(materialized.compra_id)) return errorResponse('error_servidor', 'Respuesta de materialización inválida', 500);
    return jsonResponse({ facturaId, compraId: materialized.compra_id, revision: latest.revision, replay: materialized.replay === true });
  } catch {
    return errorResponse('error_servidor', 'No se pudo completar la compra vinculada', 500);
  }
}
