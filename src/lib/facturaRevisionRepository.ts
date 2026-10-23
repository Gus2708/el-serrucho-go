import type { SupabaseClient } from '@supabase/supabase-js';
import type { CatalogoCodigosBarras, RevisionContenido } from './facturaRevision';
import type { ExtraidaLinea } from './facturaExtractionContract';
import type { Producto } from './supabase';
import { reportFacturaThrown, type FacturaOperation } from './facturaTelemetry';

export type RevisionErrorCode =
  | 'no_autorizado'
  | 'version_obsoleta'
  | 'revision_obsoleta'
  | 'clave_reutilizada'
  | 'datos_invalidos'
  | 'no_encontrada'
  | 'no_disponible'
  | 'red'
  | 'desconocido';

const MESSAGES: Record<RevisionErrorCode, string> = {
  no_autorizado: 'No tienes permiso para esta operación. Inicia sesión de nuevo e inténtalo otra vez.',
  version_obsoleta: 'La factura cambió desde que se guardó esta revisión.',
  revision_obsoleta: 'Hay una revisión más reciente en el servidor.',
  clave_reutilizada: 'Esta operación ya se registró con otro contenido.',
  datos_invalidos: 'Hay datos que el servidor no aceptó. Revisa la revisión e inténtalo otra vez.',
  no_encontrada: 'No se encontró la factura o la revisión.',
  no_disponible: 'La revisión asistida todavía no está disponible en el servidor. La factura manual sigue funcionando.',
  red: 'Sin conexión con el servidor. Tus cambios siguen en pantalla; vuelve a intentar.',
  desconocido: 'No se pudo completar la operación. Inténtalo otra vez.',
};

/** Typed failure; the raw server message is never kept, so it can neither be shown nor reported. */
export class RevisionRepositoryError extends Error {
  readonly code: RevisionErrorCode;
  readonly sqlState?: string;
  readonly httpStatus?: number;
  constructor(code: RevisionErrorCode, detail: { sqlState?: string; httpStatus?: number } = {}) {
    super(MESSAGES[code]);
    this.name = 'RevisionRepositoryError';
    this.code = code;
    this.sqlState = detail.sqlState;
    this.httpStatus = detail.httpStatus;
  }
}

export interface RevisionRow {
  readonly revision: number;
  readonly clave: string;
  readonly facturaVersion: number;
  readonly extraccionId: string | null;
  readonly documentoSha256: string | null;
  readonly contenido: unknown;
  readonly fingerprint: string;
  readonly motivo: string | null;
  readonly creadoPor: string;
  readonly aprobadoPor: string | null;
  readonly aprobadoEn: string | null;
}

export interface ExtraccionRow {
  readonly id: string;
  readonly solicitudId: string;
  readonly estado: 'procesando' | 'completado' | 'fallido' | 'cuarentena';
  readonly facturaVersion: number;
  readonly documentoSha256: string;
  readonly resultado: unknown;
  readonly errorCodigo: string | null;
  readonly iniciadoEn: string;
}

export interface GuardarRevisionInput {
  readonly facturaId: string;
  readonly revisionEsperada: number;
  readonly clave: string;
  readonly facturaVersion: number;
  readonly extraccionId: string | null;
  readonly contenido: RevisionContenido;
  readonly motivo: string | null;
}

export interface AprobarRevisionInput {
  readonly facturaId: string;
  readonly revision: number;
  readonly fingerprint: string;
  readonly facturaVersion: number;
}

export interface RevisionResult {
  readonly revision: number;
  readonly fingerprint: string;
  readonly replay: boolean;
}

export interface ExtraerInput {
  readonly facturaId: string;
  readonly solicitudId: string;
  readonly versionEsperada: number;
}

export type ExtraerResultado =
  | { readonly tipo: 'completado' | 'cuarentena'; readonly extraccionId: string; readonly replay: boolean }
  | { readonly tipo: 'en_curso' }
  | { readonly tipo: 'incierto' }
  | { readonly tipo: 'rechazado'; readonly codigo: string }
  | { readonly tipo: 'no_disponible' };

export interface CatalogoAcotado {
  readonly productos: readonly Producto[];
  /** true when a query failed, hit its cap or was skipped for an unsafe term: absence proves nothing. */
  readonly parcial: boolean;
}

export type RevisionClient = Pick<SupabaseClient, 'rpc' | 'from' | 'functions'>;

export interface FacturaRevisionRepository {
  leerRevisiones(facturaId: string): Promise<RevisionRow[]>;
  leerExtracciones(facturaId: string): Promise<ExtraccionRow[]>;
  guardarRevision(input: GuardarRevisionInput): Promise<RevisionResult>;
  aprobarRevision(input: AprobarRevisionInput): Promise<RevisionResult>;
  extraer(input: ExtraerInput): Promise<ExtraerResultado>;
  buscarCandidatos(lineas: readonly ExtraidaLinea[]): Promise<CatalogoAcotado>;
  leerColisionesBarras(codigos: readonly string[]): Promise<Record<string, CatalogoCodigosBarras>>;
}

const SQLSTATES: Record<string, RevisionErrorCode> = {
  '42501': 'no_autorizado',
  PV409: 'version_obsoleta',
  PR409: 'revision_obsoleta',
  PI409: 'clave_reutilizada',
  '22023': 'datos_invalidos',
  '22P02': 'datos_invalidos',
  P0002: 'no_encontrada',
  '42P01': 'no_disponible',
  '42883': 'no_disponible',
  PGRST202: 'no_disponible',
  PGRST205: 'no_disponible',
};

interface ErrorLike {
  code?: string;
  message?: string;
}

function mapError(error: ErrorLike | null | undefined, status?: number): RevisionRepositoryError {
  const byState = error?.code ? SQLSTATES[error.code] : undefined;
  if (byState) return new RevisionRepositoryError(byState, { sqlState: error?.code, httpStatus: status });
  if (!error?.code && /network|fetch|timeout|timed out|abort/i.test(error?.message ?? '')) {
    return new RevisionRepositoryError('red', { httpStatus: status });
  }
  return new RevisionRepositoryError('desconocido', { sqlState: error?.code, httpStatus: status });
}

/** Unexpected failures go to the existing sanitized reporter; expected outcomes never do. */
function observed(operation: FacturaOperation, error: RevisionRepositoryError): RevisionRepositoryError {
  if (error.code === 'desconocido') reportFacturaThrown(operation, error);
  return error;
}

async function attempt<T>(operation: FacturaOperation, call: () => PromiseLike<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw observed(operation, error instanceof RevisionRepositoryError ? error : mapError(error as ErrorLike));
  }
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

type Row = Record<string, unknown>;

function parseRevision(row: Row): RevisionRow | null {
  if (!isInt(row.revision) || !isText(row.clave) || !isInt(row.factura_version) || !isText(row.fingerprint) || !isText(row.creado_por)) return null;
  if (!isTextOrNull(row.extraccion_id) || !isTextOrNull(row.documento_sha256) || !isTextOrNull(row.motivo) || !isTextOrNull(row.aprobado_por) || !isTextOrNull(row.aprobado_en)) return null;
  return {
    revision: row.revision,
    clave: row.clave,
    facturaVersion: row.factura_version,
    extraccionId: row.extraccion_id,
    documentoSha256: row.documento_sha256,
    contenido: row.contenido,
    fingerprint: row.fingerprint,
    motivo: row.motivo,
    creadoPor: row.creado_por,
    aprobadoPor: row.aprobado_por,
    aprobadoEn: row.aprobado_en,
  };
}

const ESTADOS = ['procesando', 'completado', 'fallido', 'cuarentena'];

function parseExtraccion(row: Row): ExtraccionRow | null {
  if (!isText(row.id) || !isText(row.solicitud_id) || !isText(row.estado) || !ESTADOS.includes(row.estado)) return null;
  if (!isInt(row.factura_version) || !isText(row.documento_sha256) || !isTextOrNull(row.error_codigo) || !isText(row.iniciado_en)) return null;
  return {
    id: row.id,
    solicitudId: row.solicitud_id,
    estado: row.estado as ExtraccionRow['estado'],
    facturaVersion: row.factura_version,
    documentoSha256: row.documento_sha256,
    resultado: row.resultado ?? null,
    errorCodigo: row.error_codigo,
    iniciadoEn: row.iniciado_en,
  };
}

function parseResult(data: unknown): RevisionResult {
  const row = data as Row | null;
  if (!row || !isInt(row.revision) || !isText(row.fingerprint)) throw observed('save', new RevisionRepositoryError('desconocido'));
  return { revision: row.revision, fingerprint: row.fingerprint, replay: row.replay === true };
}

// ── Bounded catalog reads ───────────────────────────────────────────────────

const REVISIONS_LIMIT = 200;
const EXTRACTIONS_LIMIT = 20;
const CATALOG_QUERY_CAP = 200;
const COLLISION_QUERY_CAP = 500;
const MAX_DESCRIPTION_QUERIES = 40;
const MAX_CODES_PER_QUERY = 100;
/** Values that can ride inside a PostgREST in.(...) list without quoting or injection risk. */
const SAFE_FILTER_VALUE = /^[A-Za-z0-9._/-]{1,80}$/;

function descriptionPattern(text: string | null): string | null {
  const words = (text ?? '').match(/[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]{3,}/g);
  return words && words.length > 0 ? `%${words.slice(0, 3).join('%')}%` : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Read = PromiseLike<{ data: unknown; error: unknown }>;
type ProductRow = Row & { codigo_interno?: unknown; codigo_barras?: unknown };

async function readCatalog(read: Read, cap: number): Promise<{ rows: ProductRow[]; ok: boolean }> {
  try {
    const { data, error } = await read;
    const rows = Array.isArray(data) ? (data as ProductRow[]) : [];
    return { rows, ok: !error && rows.length < cap };
  } catch {
    return { rows: [], ok: false };
  }
}

interface FunctionErrorLike {
  name?: string;
  context?: { status?: number; json?: () => Promise<unknown> };
}

async function classifyFunctionError(error: unknown): Promise<ExtraerResultado> {
  const e = error as FunctionErrorLike;
  if (e.name === 'FunctionsRelayError') return { tipo: 'no_disponible' };
  if (e.name !== 'FunctionsHttpError') return { tipo: 'incierto' };
  const status = e.context?.status ?? 0;
  let code: string | null = null;
  try {
    const body = (await e.context?.json?.()) as { error?: { code?: unknown } } | undefined;
    if (typeof body?.error?.code === 'string') code = body.error.code;
  } catch {
    code = null;
  }
  if (status === 409) return { tipo: 'en_curso' };
  if (status === 404 && code !== 'factura_no_encontrada') return { tipo: 'no_disponible' };
  if (status >= 500 || status === 499 || status === 0) return { tipo: 'incierto' };
  return { tipo: 'rechazado', codigo: code ?? 'desconocido' };
}

export function createFacturaRevisionRepository(client: RevisionClient): FacturaRevisionRepository {
  async function readRows(table: string, columns: string, orderBy: string, ascending: boolean, limit: number, facturaId: string): Promise<Row[]> {
    const { data, error } = await attempt('open', () =>
      client.from(table).select(columns).eq('factura_id', facturaId).order(orderBy, { ascending }).limit(limit)
    );
    if (error) throw observed('open', mapError(error));
    return (data ?? []) as unknown as Row[];
  }

  return {
    async leerRevisiones(facturaId) {
      const rows = await readRows(
        'facturas_proveedores_revisiones',
        'revision, clave, factura_version, extraccion_id, documento_sha256, contenido, fingerprint, motivo, creado_por, aprobado_por, aprobado_en',
        'revision', true, REVISIONS_LIMIT, facturaId
      );
      const parsed = rows.map(parseRevision);
      if (parsed.some(row => row === null)) throw observed('open', new RevisionRepositoryError('desconocido'));
      return parsed as RevisionRow[];
    },

    async leerExtracciones(facturaId) {
      const rows = await readRows(
        'facturas_proveedores_extracciones',
        'id, solicitud_id, estado, factura_version, documento_sha256, resultado, error_codigo, iniciado_en',
        'iniciado_en', false, EXTRACTIONS_LIMIT, facturaId
      );
      const parsed = rows.map(parseExtraccion);
      if (parsed.some(row => row === null)) throw observed('open', new RevisionRepositoryError('desconocido'));
      return parsed as ExtraccionRow[];
    },

    async guardarRevision(input) {
      const { data, error, status } = await attempt('save', () =>
        client.rpc('guardar_revision_factura', {
          p_factura_id: input.facturaId,
          p_revision_esperada: input.revisionEsperada,
          p_clave: input.clave,
          p_factura_version: input.facturaVersion,
          p_extraccion_id: input.extraccionId,
          p_contenido: input.contenido,
          p_motivo: input.motivo,
        })
      );
      if (error) throw observed('save', mapError(error, status));
      return parseResult(data);
    },

    async aprobarRevision(input) {
      const { data, error, status } = await attempt('save', () =>
        client.rpc('aprobar_revision_factura', {
          p_factura_id: input.facturaId,
          p_revision: input.revision,
          p_fingerprint: input.fingerprint,
          p_factura_version: input.facturaVersion,
        })
      );
      if (error) throw observed('save', mapError(error, status));
      return parseResult(data);
    },

    async extraer(input) {
      let answer: { data: unknown; error: unknown };
      try {
        answer = await client.functions.invoke('procesar-factura-multimodal', {
          body: { facturaId: input.facturaId, solicitudId: input.solicitudId, versionEsperada: input.versionEsperada },
        });
      } catch {
        return { tipo: 'incierto' };
      }
      if (answer.error) return classifyFunctionError(answer.error);
      const data = answer.data as Row | null;
      if (data && (data.estado === 'completado' || data.estado === 'cuarentena') && isText(data.extraccionId)) {
        return { tipo: data.estado, extraccionId: data.extraccionId, replay: data.replay === true };
      }
      return { tipo: 'incierto' };
    },

    async buscarCandidatos(lineas) {
      const codes = [...new Set(lineas.map(l => l.codigoProveedor).filter((c): c is string => c !== null && c !== ''))];
      const safeCodes = codes.filter(code => SAFE_FILTER_VALUE.test(code));
      let parcial = safeCodes.length !== codes.length;
      const reads: Read[] = [];
      for (const part of chunk(safeCodes, MAX_CODES_PER_QUERY)) {
        reads.push(client.from('productos_view').select('*').in('codigo_interno', part).limit(CATALOG_QUERY_CAP));
        reads.push(client.from('productos_view').select('*').in('codigo_barras', part).limit(CATALOG_QUERY_CAP));
      }
      const patterns = [...new Set(lineas.map(l => descriptionPattern(l.descripcion)).filter((p): p is string => p !== null))];
      if (patterns.length > MAX_DESCRIPTION_QUERIES) parcial = true;
      for (const pattern of patterns.slice(0, MAX_DESCRIPTION_QUERIES)) {
        reads.push(client.from('productos_view').select('*').ilike('descripcion', pattern).limit(CATALOG_QUERY_CAP));
      }
      const results = await Promise.all(reads.map(read => readCatalog(read, CATALOG_QUERY_CAP)));
      const byCode = new Map<string, Producto>();
      for (const result of results) {
        if (!result.ok) parcial = true;
        for (const row of result.rows) {
          if (isText(row.codigo_interno) && !byCode.has(row.codigo_interno)) byCode.set(row.codigo_interno, row as unknown as Producto);
        }
      }
      return { productos: [...byCode.values()], parcial };
    },

    async leerColisionesBarras(codigos) {
      const unique = [...new Set(codigos)];
      const safe = unique.filter(code => SAFE_FILTER_VALUE.test(code));
      const found = new Map<string, Array<{ codigoInterno: string; codigoBarras: string | null }>>();
      let readsOk = true;
      for (const part of chunk(safe, MAX_CODES_PER_QUERY)) {
        const [barras, internos] = await Promise.all([
          readCatalog(client.from('productos_view').select('codigo_interno, codigo_barras').in('codigo_barras', part).limit(COLLISION_QUERY_CAP), COLLISION_QUERY_CAP),
          readCatalog(client.from('productos_view').select('codigo_interno, codigo_barras').in('codigo_interno', part).limit(COLLISION_QUERY_CAP), COLLISION_QUERY_CAP),
        ]);
        if (!barras.ok || !internos.ok) readsOk = false;
        const add = (code: string, codigoInterno: string) => {
          const list = found.get(code) ?? [];
          if (!list.some(p => p.codigoInterno === codigoInterno)) list.push({ codigoInterno, codigoBarras: code });
          found.set(code, list);
        };
        for (const row of barras.rows) {
          if (isText(row.codigo_barras) && isText(row.codigo_interno) && part.includes(row.codigo_barras)) add(row.codigo_barras, row.codigo_interno);
        }
        for (const row of internos.rows) {
          if (isText(row.codigo_interno) && part.includes(row.codigo_interno)) add(row.codigo_interno, row.codigo_interno);
        }
      }
      const out: Record<string, CatalogoCodigosBarras> = {};
      for (const code of unique) {
        out[code] = { productos: found.get(code) ?? [], completo: readsOk && SAFE_FILTER_VALUE.test(code) };
      }
      return out;
    },
  };
}
