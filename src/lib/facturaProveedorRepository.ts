import type { SupabaseClient } from '@supabase/supabase-js';
import { buildDocumentPath, displayNameFor, validateDocumentBytes } from './facturaDocumento';
import type { FacturaRecord, FacturaDocumento, SavePayload } from './facturaProveedor';
import { reportFacturaThrown, type FacturaOperation } from './facturaTelemetry';

const BUCKET = 'facturas_proveedores';
const LIST_LIMIT = 50;
const SIGNED_URL_SECONDS = 300;

export type FacturaErrorCode =
  | 'no_autorizado'
  | 'version_obsoleta'
  | 'clave_reutilizada'
  | 'datos_invalidos'
  | 'no_encontrada'
  | 'red'
  | 'desconocido';

const MESSAGES: Record<FacturaErrorCode, string> = {
  no_autorizado: 'No tienes permiso para esta factura. Inicia sesión de nuevo e inténtalo otra vez.',
  version_obsoleta: 'Esta factura cambió desde otro dispositivo. Recárgala para ver la última versión.',
  clave_reutilizada: 'Esta operación ya se registró con otro contenido. Vuelve a guardar.',
  datos_invalidos: 'Hay datos que no se pudieron guardar. Revisa los campos e inténtalo otra vez.',
  no_encontrada: 'No se encontró la factura.',
  red: 'Sin conexión con el servidor. Tus datos siguen en pantalla; vuelve a intentar.',
  desconocido: 'No se pudo completar la operación. Inténtalo otra vez.',
};

const SQLSTATE_CODES: Record<string, FacturaErrorCode> = {
  '42501': 'no_autorizado',
  PV409: 'version_obsoleta',
  PI409: 'clave_reutilizada',
  '22023': 'datos_invalidos',
  '23514': 'datos_invalidos',
  '22P02': 'datos_invalidos',
  '22003': 'datos_invalidos',
  '23505': 'datos_invalidos',
  P0002: 'no_encontrada',
};

const STORAGE_STATUS_CODES: Record<string, FacturaErrorCode> = {
  '401': 'no_autorizado',
  '403': 'no_autorizado',
  '404': 'no_encontrada',
  '409': 'datos_invalidos',
  '413': 'datos_invalidos',
  '415': 'datos_invalidos',
};

/** Raw server answer kept next to the typed code so callers can tell a definite rejection from a lost response. */
export interface FacturaErrorDetail {
  sqlState?: string;
  httpStatus?: number;
}

export class FacturaError extends Error {
  readonly code: FacturaErrorCode;
  readonly sqlState?: string;
  readonly httpStatus?: number;

  constructor(code: FacturaErrorCode, detail: FacturaErrorDetail = {}) {
    super(MESSAGES[code]);
    this.name = 'FacturaError';
    this.code = code;
    this.sqlState = detail.sqlState;
    this.httpStatus = detail.httpStatus;
  }
}

interface ErrorLike {
  code?: string;
  statusCode?: string | number;
  message?: string;
}

function isNetworkMessage(message: string | undefined): boolean {
  return /network|fetch|timeout|timed out|abort/i.test(message ?? '');
}

/**
 * Maps SQLSTATEs and Storage statuses to typed errors; raw server messages are never shown to the user.
 * `httpStatus` is the response status of the call, when there was a response.
 */
export function mapFacturaError(error: ErrorLike | null | undefined, httpStatus?: number): FacturaError {
  const detail: FacturaErrorDetail = { sqlState: error?.code || undefined, httpStatus };

  const bySqlState = error?.code ? SQLSTATE_CODES[error.code] : undefined;
  if (bySqlState) return new FacturaError(bySqlState, detail);

  const byStatus = error?.statusCode !== undefined ? STORAGE_STATUS_CODES[String(error.statusCode)] : undefined;
  if (byStatus) return new FacturaError(byStatus, detail);

  if (!error?.code && isNetworkMessage(error?.message)) return new FacturaError('red', detail);
  return new FacturaError('desconocido', detail);
}

export interface FacturaResumen {
  id: string;
  version: number;
  proveedor_nombre: string | null;
  numero_documento: string | null;
  fecha_documento: string | null;
  actualizado_en: string;
  documento_mime: string | null;
}

export interface GuardarInput {
  facturaId: string;
  /** Version the draft was loaded from; 0 creates the invoice. */
  version: number;
  /** Idempotency key: reuse it when retrying the same content. */
  key: string;
  payload: SavePayload;
}

export interface GuardarResult {
  facturaId: string;
  version: number;
  replay: boolean;
}

export interface SubirDocumentoInput {
  ownerId: string;
  facturaId: string;
  documentId: string;
  bytes: Uint8Array;
  nombre: string;
  sha256: string;
}

export type FacturaClient = Pick<SupabaseClient, 'rpc' | 'from' | 'storage'>;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  return (whole ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer;
}

/** Reports a mapped error when it is unexpected (see facturaTelemetry) and hands it back to be thrown unchanged. */
function observed(operation: FacturaOperation, error: FacturaError): FacturaError {
  reportFacturaThrown(operation, error);
  return error;
}

function parseGuardarResult(data: unknown): GuardarResult {
  const row = data as { factura_id?: unknown; version?: unknown; replay?: unknown } | null;
  if (!row || typeof row.factura_id !== 'string' || typeof row.version !== 'number') {
    throw observed('save', new FacturaError('desconocido'));
  }
  return { facturaId: row.factura_id, version: row.version, replay: row.replay === true };
}

async function attempt<T>(operation: FacturaOperation, call: () => PromiseLike<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw observed(operation, error instanceof FacturaError ? error : mapFacturaError(error as ErrorLike));
  }
}

export function createFacturaRepository(client: FacturaClient) {
  return {
    async listar(): Promise<FacturaResumen[]> {
      const { data, error } = await attempt('list', () =>
        client
          .from('facturas_proveedores')
          .select('id, version, proveedor_nombre, numero_documento, fecha_documento, actualizado_en, documento_mime')
          .order('actualizado_en', { ascending: false })
          .limit(LIST_LIMIT),
      );
      if (error) throw observed('list', mapFacturaError(error));
      return (data ?? []) as FacturaResumen[];
    },

    async abrir(facturaId: string): Promise<FacturaRecord | null> {
      const { data, error } = await attempt('open', () =>
        client
          .from('facturas_proveedores')
          .select('*, lineas:facturas_proveedores_lineas(*)')
          .eq('id', facturaId)
          .maybeSingle(),
      );
      if (error) throw observed('open', mapFacturaError(error));
      return (data ?? null) as FacturaRecord | null;
    },

    async guardar({ facturaId, version, key, payload }: GuardarInput): Promise<GuardarResult> {
      const { data, error, status } = await attempt('save', () =>
        client.rpc('guardar_factura_proveedor', {
          p_factura_id: facturaId,
          p_version_esperada: version,
          p_clave: key,
          p_cabecera: payload.cabecera,
          p_lineas: payload.lineas,
        }),
      );
      if (error) throw observed('save', mapFacturaError(error, status));
      return parseGuardarResult(data);
    },

    async subirDocumento(input: SubirDocumentoInput): Promise<FacturaDocumento> {
      const validation = validateDocumentBytes(input.bytes);
      if (!validation.ok) throw new FacturaError('datos_invalidos');

      const path = buildDocumentPath(input.ownerId, input.facturaId, input.documentId, validation.mime);
      const { error } = await attempt('upload', () =>
        client.storage.from(BUCKET).upload(path, toArrayBuffer(input.bytes), {
          contentType: validation.mime,
          upsert: false,
        }),
      );
      if (error) throw observed('upload', mapFacturaError(error as ErrorLike));

      return {
        path,
        nombre: displayNameFor(input.nombre),
        mime: validation.mime,
        bytes: input.bytes.length,
        sha256: input.sha256,
      };
    },

    async urlDocumento(path: string): Promise<string> {
      const { data, error } = await attempt('download', () =>
        client.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS),
      );
      if (error || !data?.signedUrl) throw observed('download', mapFacturaError(error as ErrorLike | null));
      return data.signedUrl;
    },

    /** Best effort: the delete policy only allows unreferenced objects, and a failure leaves a harmless private orphan. */
    async limpiarHuerfano(path: string): Promise<boolean> {
      try {
        const { error } = await client.storage.from(BUCKET).remove([path]);
        if (error) observed('cleanup', mapFacturaError(error as ErrorLike));
        return !error;
      } catch (error) {
        observed('cleanup', mapFacturaError(error as ErrorLike));
        return false;
      }
    },
  };
}

export type FacturaRepository = ReturnType<typeof createFacturaRepository>;
