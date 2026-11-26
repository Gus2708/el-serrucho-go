import type { SupabaseClient } from '@supabase/supabase-js';
import type { CatalogoCodigosBarras, RevisionContenido } from './facturaRevision';
import type { ExtraidaLinea } from './facturaExtractionContract';
import {
  isAbsentIdentifier,
  matchInvoiceLines,
  MATCHING_NORMALIZATION_VERSION,
  parseProductFeedback,
  type HybridLineRanks,
  type HybridRankEntry,
  type ProductFeedback,
  type SupplierAlias,
} from './facturaMatching';
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
  /**
   * Validated hybrid retrieval ranks, keyed to the original zero-based line index and only for SKUs hydrated from the
   * current catalog. Absent when no usable rank exists; never a proof that a product is new.
   */
  readonly hybridRanks?: readonly HybridLineRanks[];
  readonly feedback?: readonly ProductFeedback[];
  /** Saved supplier aliases for target lines, built from each line's own printed code and unit; present only when usable. */
  readonly aliases?: readonly SupplierAlias[];
  /** Matcher supplier scope for `aliases`; the server already limited them to this invoice's own saved supplier. */
  readonly supplierKey?: string;
}

/**
 * Supplier scope of aliases returned for the current invoice. The feedback RPC already scoped them to the invoice's own
 * saved supplier, so the client never supplies or trusts a supplier string (OCR or otherwise).
 */
export const FACTURA_ACTUAL_SUPPLIER_SCOPE = 'factura-actual';

/** Stored extraction the hybrid retrieval endpoint may read on the server; the only data the client sends. */
export interface ContextoBusquedaHibrida {
  readonly facturaId: string;
  readonly extraccionId: string;
  readonly versionEsperada: number;
}

export type RevisionClient = Pick<SupabaseClient, 'rpc' | 'from' | 'functions'>;

export interface FacturaRevisionRepository {
  leerRevisiones(facturaId: string): Promise<RevisionRow[]>;
  leerExtracciones(facturaId: string): Promise<ExtraccionRow[]>;
  guardarRevision(input: GuardarRevisionInput): Promise<RevisionResult>;
  aprobarRevision(input: AprobarRevisionInput): Promise<RevisionResult>;
  extraer(input: ExtraerInput): Promise<ExtraerResultado>;
  /** Without `contexto` this is the plain bounded exact/description read; with it, one hybrid retrieval invoke is added. */
  buscarCandidatos(lineas: readonly ExtraidaLinea[], contexto?: ContextoBusquedaHibrida): Promise<CatalogoAcotado>;
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
const MAX_CODE_FALLBACK_QUERIES = 40;
const MAX_CODES_PER_QUERY = 100;
/** Values that can ride inside a PostgREST in.(...) list without quoting or injection risk. */
const SAFE_FILTER_VALUE = /^[A-Za-z0-9._/-]{1,80}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HYBRID_FUNCTION = 'consultar-productos-semantico';
const MAX_HYBRID_GROUPS = 200;
const MAX_HYBRID_ENTRIES = 8;
const MAX_HYBRID_SKUS = MAX_CODES_PER_QUERY * 4;
const MAX_ALIASES = 200;
const ALIAS_KEY_TYPE = 'codigo_proveedor';
const HYBRID_SOURCES = ['lexical', 'semantic'] as const;

function escapeIlikeLiteral(value: string): string {
  return value.replace(/[\\%_*]/g, '\\$&');
}

/** Connectors and a generic word that never discriminate between products. */
const DESCRIPTION_STOPWORDS = new Set(['para', 'con', 'sin', 'por', 'del', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'tipo']);

/** Drops one plural "s" so the substring read also reaches the singular spelling. */
function singular(word: string): string {
  return word.length >= 5 && /[^sS]s$/i.test(word) ? word.slice(0, -1) : word;
}

/**
 * Search words for the bounded description read. They only choose which catalog rows to load: the printed
 * text, identifiers and identity comparison are untouched. Bracketed codes and digit-bearing tokens (measurement
 * and model spellings that differ between supplier and catalog) never narrow the read. With fewer than two
 * useful words the earlier, narrower raw tokens are kept instead of scanning one common word.
 */
function descriptionTerms(text: string | null): string[] | null {
  const tokens = (text ?? '').replace(/\[[^\]]*\]/g, ' ').match(/[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]{3,}/g);
  if (!tokens) return null;
  const words: string[] = [];
  for (const token of tokens) {
    if (/\d/.test(token) || DESCRIPTION_STOPWORDS.has(token.toLowerCase())) continue;
    const word = singular(token);
    if (!words.some(known => known.toLowerCase() === word.toLowerCase())) words.push(word);
  }
  return words.length >= 2 ? words.slice(0, 2) : tokens.slice(0, 3);
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
    return { rows, ok: Array.isArray(data) && !error && rows.length < cap };
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

// ── Hybrid retrieval (server ranks, client hydration) ───────────────────────

type HybridGroup = { lineIndex: number; lexical: HybridRankEntry[]; semantic: HybridRankEntry[] };
type ParsedHybrid = { groups: HybridGroup[]; parcial: boolean };

const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

function validContext(value: unknown): value is ContextoBusquedaHibrida {
  return (
    isRecord(value) &&
    isText(value.facturaId) && UUID_REGEX.test(value.facturaId) &&
    isText(value.extraccionId) && UUID_REGEX.test(value.extraccionId) &&
    typeof value.versionEsperada === 'number' && Number.isSafeInteger(value.versionEsperada) && value.versionEsperada > 0
  );
}

/** One call, never retried; any failure reads as "no ranks". Only identifiers leave the client. */
async function requestHybridRanks(client: RevisionClient, contexto: ContextoBusquedaHibrida): Promise<unknown> {
  try {
    const { data, error } = await client.functions.invoke(HYBRID_FUNCTION, {
      body: { facturaId: contexto.facturaId, extraccionId: contexto.extraccionId, versionEsperada: contexto.versionEsperada },
    });
    return error ? null : data;
  } catch {
    return null;
  }
}

async function requestSavedFeedback(client: RevisionClient, contexto: ContextoBusquedaHibrida): Promise<unknown> {
  try {
    const { data, error } = await client.rpc('buscar_feedback_productos_factura', {
      p_factura_id: contexto.facturaId,
      p_extraccion_id: contexto.extraccionId,
      p_version_esperada: contexto.versionEsperada,
    });
    return error ? null : data;
  } catch {
    return null;
  }
}

/** Valid entries only (best rank per SKU, ordered by rank); anything dropped or truncated makes the list partial. */
function parseRankList(value: unknown): { entries: HybridRankEntry[]; parcial: boolean } {
  if (value === undefined) return { entries: [], parcial: false };
  if (!Array.isArray(value)) return { entries: [], parcial: true };
  let parcial = value.length > MAX_HYBRID_ENTRIES;
  const best = new Map<string, number>();
  for (const entry of value.slice(0, MAX_HYBRID_ENTRIES) as unknown[]) {
    const sku = isRecord(entry) ? entry.codigoInterno : undefined;
    const rank = isRecord(entry) ? entry.rank : undefined;
    if (!isText(sku) || !SAFE_FILTER_VALUE.test(sku) || !isInt(rank) || rank < 1 || rank > MAX_HYBRID_ENTRIES) {
      parcial = true;
      continue;
    }
    best.set(sku, Math.min(rank, best.get(sku) ?? rank));
  }
  const entries = [...best].map(([codigoInterno, rank]) => ({ codigoInterno, rank })).sort((a, b) => a.rank - b.rank);
  return { entries, parcial };
}

function parseHybridPayload(data: unknown, lineCount: number): ParsedHybrid | null {
  if (!isRecord(data) || !Array.isArray(data.hybridRanks)) return null;
  let parcial = data.parcial !== false || data.hybridRanks.length > MAX_HYBRID_GROUPS;
  const groups: HybridGroup[] = [];
  for (const raw of data.hybridRanks.slice(0, MAX_HYBRID_GROUPS) as unknown[]) {
    if (!isRecord(raw) || !isInt(raw.lineIndex) || raw.lineIndex < 0 || raw.lineIndex >= lineCount) {
      parcial = true;
      continue;
    }
    const [lexical, semantic] = HYBRID_SOURCES.map(source => parseRankList(raw[source]));
    if (lexical.parcial || semantic.parcial) parcial = true;
    groups.push({ lineIndex: raw.lineIndex, lexical: lexical.entries, semantic: semantic.entries });
  }
  return { groups, parcial };
}

/** Hydrates each returned SKU from the current catalog (same bounded reads) and keeps ranks only for SKUs that exist. */
async function hydrateHybridRanks(
  client: RevisionClient,
  parsed: ParsedHybrid,
  byCode: Map<string, Producto>,
  feedback: readonly ProductFeedback[],
  aliases: readonly ProductFeedback[],
): Promise<{ ranks: HybridLineRanks[]; feedback: ProductFeedback[]; aliases: ProductFeedback[]; parcial: boolean }> {
  let parcial = parsed.parcial;
  const wanted = new Set([...feedback, ...aliases].flatMap(item => item.codigoInterno === null ? [] : [item.codigoInterno]));
  for (const group of parsed.groups) {
    for (const entry of [...group.lexical, ...group.semantic]) wanted.add(entry.codigoInterno);
  }
  const missing = [...wanted].filter(sku => !byCode.has(sku));
  const toRead = missing.slice(0, MAX_HYBRID_SKUS);
  if (toRead.length < missing.length) parcial = true;

  const parts = chunk(toRead, MAX_CODES_PER_QUERY);
  const reads = await Promise.all(parts.map(part =>
    readCatalog(client.from('productos_view').select('*').in('codigo_interno', part).limit(CATALOG_QUERY_CAP), CATALOG_QUERY_CAP)
  ));
  reads.forEach((read, index) => {
    if (!read.ok) parcial = true;
    for (const row of read.rows) {
      if (isText(row.codigo_interno) && parts[index].includes(row.codigo_interno) && !byCode.has(row.codigo_interno)) {
        byCode.set(row.codigo_interno, row as unknown as Producto);
      }
    }
  });

  const ranks: HybridLineRanks[] = [];
  for (const group of parsed.groups) {
    const lexical = group.lexical.filter(entry => byCode.has(entry.codigoInterno));
    const semantic = group.semantic.filter(entry => byCode.has(entry.codigoInterno));
    if (lexical.length < group.lexical.length || semantic.length < group.semantic.length) parcial = true;
    if (lexical.length === 0 && semantic.length === 0) continue;
    ranks.push({
      lineIndex: group.lineIndex,
      ...(lexical.length > 0 ? { lexical } : {}),
      ...(semantic.length > 0 ? { semantic } : {}),
    });
  }
  // A remembered SKU missing from the current catalog, or a placeholder, is dropped and never replaced by an older one.
  const current = (item: ProductFeedback): boolean => {
    if (item.decision === 'producto_nuevo') return true;
    const product = item.codigoInterno === null ? undefined : byCode.get(item.codigoInterno);
    if (!product || product.es_placeholder === true) {
      parcial = true;
      return false;
    }
    return true;
  };
  return { ranks, feedback: feedback.filter(current), aliases: aliases.filter(current), parcial };
}

/**
 * Supplier aliases of the feedback RPC, validated like saved decisions (safe literal SKU, in-range line, contradictory
 * duplicates dropped). An absent key is an older RPC: no aliases and nothing partial. Over the cap nothing is kept.
 */
function parseAliases(data: unknown, lineas: readonly ExtraidaLinea[]): { aliases: ProductFeedback[]; parcial: boolean } {
  if (!isRecord(data) || data.aliases === undefined) return { aliases: [], parcial: false };
  const raw = data.aliases;
  if (Array.isArray(raw) && raw.length > MAX_ALIASES) return { aliases: [], parcial: true };
  const entries = Array.isArray(raw)
    ? raw.map(item => (isRecord(item) ? { lineIndex: item.lineIndex, decision: 'confirmado', codigoInterno: item.codigoInterno } : item))
    : raw;
  const parsed = parseProductFeedback(entries, lineas.length, MAX_ALIASES);
  const aliases = parsed.decisiones.filter(item => !isAbsentIdentifier(lineas[item.lineIndex].codigoProveedor));
  return { aliases, parcial: parsed.parcial || aliases.length < parsed.decisiones.length };
}

/**
 * Builds each alias from its target line's own printed code and unit. The matcher applies an alias to every line with the
 * same printed code, so an alias survives only if the real matcher reaches no line the server did not give the same SKU.
 */
function coveredAliases(
  lineas: readonly ExtraidaLinea[],
  hints: readonly ProductFeedback[],
  byCode: ReadonlyMap<string, Producto>,
): { aliases: SupplierAlias[]; parcial: boolean } {
  const sent = new Map(hints.map(hint => [hint.lineIndex, hint.codigoInterno]));
  const built: SupplierAlias[] = hints.map(hint => ({
    supplierKey: FACTURA_ACTUAL_SUPPLIER_SCOPE,
    keyType: ALIAS_KEY_TYPE,
    keyValue: lineas[hint.lineIndex].codigoProveedor ?? '',
    unit: lineas[hint.lineIndex].unidad,
    codigoInterno: hint.codigoInterno ?? '',
    normalizationVersion: MATCHING_NORMALIZATION_VERSION,
  }));
  const verdicts = new Map<string, boolean>();
  function covered(alias: SupplierAlias): boolean {
    const product = byCode.get(alias.codigoInterno);
    if (!product) return false;
    const probe = matchInvoiceLines({ supplierKey: FACTURA_ACTUAL_SUPPLIER_SCOPE, lines: lineas, catalog: [product], aliases: [alias] });
    if (!probe.ok) return false;
    return probe.lines.every(line => {
      const reached =
        line.candidates.some(c => c.codigoInterno === alias.codigoInterno && c.evidence.some(e => e.source === 'alias')) ||
        line.conflicts.some(conflict => conflict.codigosInternos.includes(alias.codigoInterno));
      return !reached || sent.get(line.index) === alias.codigoInterno;
    });
  }
  const aliases = built.filter(alias => {
    const key = JSON.stringify([alias.keyValue, alias.unit, alias.codigoInterno]);
    if (!verdicts.has(key)) verdicts.set(key, covered(alias));
    return verdicts.get(key) === true;
  });
  return { aliases, parcial: aliases.length < built.length };
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

    async buscarCandidatos(lineas, contexto) {
      // The SIN_CODIGO sentinel is no identifier: skipping its code reads is not a partial lookup.
      const codes = [...new Set(lineas.map(l => l.codigoProveedor?.trim() ?? '').filter(c => !isAbsentIdentifier(c)))];
      const safeCodes = codes.filter(code => SAFE_FILTER_VALUE.test(code));
      let parcial = safeCodes.length !== codes.length;
      const reads: Read[] = [];
      for (const part of chunk(safeCodes, MAX_CODES_PER_QUERY)) {
        reads.push(client.from('productos_view').select('*').in('codigo_interno', part).limit(CATALOG_QUERY_CAP));
        reads.push(client.from('productos_view').select('*').in('codigo_barras', part).limit(CATALOG_QUERY_CAP));
      }
      const exactReadCount = reads.length;
      const patternsByTerms = new Map<string, string[]>();
      for (const linea of lineas) {
        const terms = descriptionTerms(linea.descripcion);
        if (terms) patternsByTerms.set(terms.join(' '), terms);
      }
      const patterns = [...patternsByTerms.values()];
      if (patterns.length > MAX_DESCRIPTION_QUERIES) parcial = true;
      for (const terms of patterns.slice(0, MAX_DESCRIPTION_QUERIES)) {
        let read = client.from('productos_view').select('*');
        for (const term of terms) read = read.ilike('descripcion', `%${term}%`);
        reads.push(read.limit(CATALOG_QUERY_CAP));
      }
      // At most one hybrid invoke per lookup, and only for a valid context: a plain lookup is never a billable request.
      let hybridRequest: Promise<unknown> | null = null;
      let feedbackRequest: Promise<unknown> | null = null;
      if (contexto !== undefined) {
        if (validContext(contexto)) {
          hybridRequest = requestHybridRanks(client, contexto);
          feedbackRequest = requestSavedFeedback(client, contexto);
        }
        else parcial = true;
      }
      const results = await Promise.all(reads.map(read => readCatalog(read, CATALOG_QUERY_CAP)));
      const byCode = new Map<string, Producto>();
      const resolvedExact = new Set<string>();
      results.forEach((result, index) => {
        if (!result.ok) parcial = true;
        for (const row of result.rows) {
          if (index < exactReadCount) {
            if (isText(row.codigo_interno)) resolvedExact.add(row.codigo_interno.toUpperCase());
            if (isText(row.codigo_barras)) resolvedExact.add(row.codigo_barras.toUpperCase());
          }
          if (isText(row.codigo_interno) && !byCode.has(row.codigo_interno)) byCode.set(row.codigo_interno, row as unknown as Producto);
        }
      });
      // Bounded literal case-insensitive fallback only for letter-bearing safe codes unresolved by exact reads.
      const fallbackByKey = new Map<string, string>();
      for (const code of safeCodes) {
        if (!/[A-Za-z]/.test(code)) continue;
        const upper = code.toUpperCase();
        if (!resolvedExact.has(upper) && !fallbackByKey.has(upper)) fallbackByKey.set(upper, code);
      }
      const fallbackCodes = [...fallbackByKey.values()];
      if (fallbackCodes.length > MAX_CODE_FALLBACK_QUERIES) parcial = true;
      if (fallbackCodes.length > 0) {
        const fallbackReads: Read[] = [];
        for (const code of fallbackCodes.slice(0, MAX_CODE_FALLBACK_QUERIES)) {
          const literal = escapeIlikeLiteral(code);
          fallbackReads.push(client.from('productos_view').select('*').ilike('codigo_interno', literal).limit(CATALOG_QUERY_CAP));
          fallbackReads.push(client.from('productos_view').select('*').ilike('codigo_barras', literal).limit(CATALOG_QUERY_CAP));
        }
        const fallbackResults = await Promise.all(fallbackReads.map(read => readCatalog(read, CATALOG_QUERY_CAP)));
        for (const result of fallbackResults) {
          if (!result.ok) parcial = true;
          for (const row of result.rows) {
            if (isText(row.codigo_interno) && !byCode.has(row.codigo_interno)) byCode.set(row.codigo_interno, row as unknown as Producto);
          }
        }
      }
      if (hybridRequest === null) return { productos: [...byCode.values()], parcial };

      const [hybridData, feedbackData] = await Promise.all([hybridRequest, feedbackRequest]);
      const parsed = parseHybridPayload(hybridData, lineas.length) ?? { groups: [], parcial: true };
      const saved = parseProductFeedback(isRecord(feedbackData) ? feedbackData.decisiones : null, lineas.length);
      const savedAliases = parseAliases(feedbackData, lineas);
      const hydrated = await hydrateHybridRanks(client, parsed, byCode, saved.decisiones, savedAliases.aliases);
      const covered = coveredAliases(lineas, hydrated.aliases, byCode);
      return {
        productos: [...byCode.values()],
        parcial: parcial || hydrated.parcial || saved.parcial || savedAliases.parcial || covered.parcial,
        ...(hydrated.ranks.length > 0 ? { hybridRanks: hydrated.ranks } : {}),
        ...(hydrated.feedback.length > 0 ? { feedback: hydrated.feedback } : {}),
        ...(covered.aliases.length > 0 ? { aliases: covered.aliases, supplierKey: FACTURA_ACTUAL_SUPPLIER_SCOPE } : {}),
      };
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
