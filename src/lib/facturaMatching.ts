import type { ExtraidaLinea } from './facturaExtractionContract.ts';
import type { Producto } from './producto.ts';

export const MATCHING_NORMALIZATION_VERSION = 'matching-v1';

export interface MatchingBounds {
  readonly maxLines: number;
  readonly maxCatalog: number;
  readonly maxAliases: number;
  readonly maxCandidatesPerLine: number;
  readonly maxTextLength: number;
  readonly minSimilarity: number;
}

export const DEFAULT_MATCHING_BOUNDS: MatchingBounds = {
  maxLines: 200,
  maxCatalog: 10000,
  maxAliases: 5000,
  maxCandidatesPerLine: 5,
  maxTextLength: 200,
  minSimilarity: 0.3,
};

export interface SupplierAlias {
  readonly supplierKey: string;
  readonly keyType: string;
  readonly keyValue: string;
  readonly unit: string | null;
  readonly codigoInterno: string;
  readonly normalizationVersion: string;
  readonly active?: boolean;
  readonly revoked?: boolean;
  readonly current?: boolean;
}

export interface MatchInvoiceLinesInput {
  readonly supplierKey: string | null;
  readonly lines: readonly ExtraidaLinea[];
  readonly catalog: readonly Producto[];
  readonly aliases?: readonly SupplierAlias[];
  readonly bounds?: Partial<MatchingBounds>;
}

export type EvidenceSource =
  | 'alias'
  | 'codigo_interno'
  | 'codigo_barras'
  | 'referencia'
  | 'descripcion';

export interface CandidateEvidence {
  readonly source: EvidenceSource;
  readonly similarity: number | null;
}

export interface MatchCandidate {
  readonly codigoInterno: string;
  readonly descripcion: string;
  readonly evidence: readonly CandidateEvidence[];
  readonly similarity: number | null;
  readonly unknownAttributes: readonly string[];
}

export interface ExcludedCandidate {
  readonly codigoInterno: string;
  readonly reasons: readonly string[];
}

export type ConflictCode =
  | 'ambiguous_code'
  | 'alias_ambiguous'
  | 'alias_vs_code'
  | 'code_description_conflict'
  | 'code_attribute_incompatible';

export interface MatchConflict {
  readonly code: ConflictCode;
  readonly codigosInternos: readonly string[];
}

export type LineMatchStatus = 'suggested' | 'review' | 'conflict' | 'unresolved';

export interface LineMatch {
  readonly index: number;
  readonly numeroLinea: number;
  readonly codigoProveedor: string | null;
  readonly status: LineMatchStatus;
  readonly candidates: readonly MatchCandidate[];
  readonly excluded: readonly ExcludedCandidate[];
  readonly conflicts: readonly MatchConflict[];
  readonly omittedCandidates: number;
  readonly reasons: readonly string[];
}

export type MatchInvoiceLinesResult =
  | { readonly ok: true; readonly lines: readonly LineMatch[] }
  | {
      readonly ok: false;
      readonly reason: 'too_many_lines' | 'catalog_too_large' | 'too_many_aliases';
      readonly limit: number;
      readonly actual: number;
    };

const ALIAS_KEY_TYPE = 'codigo_proveedor';

const ABBREVIATIONS: Readonly<Record<string, string>> = {
  galv: 'galvanizado',
  inox: 'inoxidable',
  plg: 'pulgada',
  pulg: 'pulgada',
  pulgadas: 'pulgada',
  in: 'pulgada',
  mt: 'm',
  mts: 'm',
  metro: 'm',
  metros: 'm',
  lt: 'l',
  lts: 'l',
  litro: 'l',
  litros: 'l',
  kgs: 'kg',
  und: 'unidad',
  unid: 'unidad',
  voltio: 'v',
  voltios: 'v',
  volt: 'v',
  watt: 'w',
  watts: 'w',
  calibre: 'cal',
  awg: 'cal',
};

const MATERIALS = new Set([
  'acero', 'inoxidable', 'galvanizado', 'pvc', 'cobre', 'bronce', 'aluminio', 'hierro',
  'laton', 'zinc', 'plastico', 'madera', 'nylon', 'caucho',
]);
const PACKAGES = new Set(['caja', 'paquete', 'bolsa', 'docena', 'blister', 'rollo']);

const ATTRIBUTE_KINDS = ['size', 'voltage', 'power', 'gauge', 'material', 'presentation', 'model'] as const;
type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];
type Attributes = Record<AttributeKind, Set<string>>;

const SIZE = /(\d+(?:\.\d+)?(?: \d+\/\d+)?|\d+\/\d+) ?(mm|cm|m|pulgada)\b/g;
// A bare 'v' is a generic voltage; 'vac' and 'vdc' are electrically distinct supplies.
const VOLTAGE = /(\d+(?:\.\d+)?) ?(vac|vdc|v)\b/g;
const POWER = /(\d+(?:\.\d+)?) ?(w|kw|hp)\b/g;
const GAUGE = /\bcal ?(\d+)\b|\b(\d+) ?cal\b/g;
const MULTIPACK = /\bx(\d+)\b/g;
// Recognize only explicit MX-number model tokens; other alphanumeric codes remain unclassified.
const MX_MODEL = /\bmx\s*(\d+)\b/g;

// The family decides compatibility; a different presentation inside one family only needs review.
const UNIT_FAMILIES: Readonly<Record<string, readonly [canonical: string, family: string]>> = {
  und: ['unidad', 'count'], unid: ['unidad', 'count'], unidad: ['unidad', 'count'],
  pza: ['unidad', 'count'], pzas: ['unidad', 'count'], pieza: ['unidad', 'count'], piezas: ['unidad', 'count'],
  caja: ['caja', 'count'], cj: ['caja', 'count'], paq: ['paquete', 'count'], paquete: ['paquete', 'count'],
  par: ['par', 'count'], doc: ['docena', 'count'], docena: ['docena', 'count'], rollo: ['rollo', 'count'],
  m: ['m', 'length'], mt: ['m', 'length'], mts: ['m', 'length'], metro: ['m', 'length'],
  cm: ['cm', 'length'], mm: ['mm', 'length'],
  kg: ['kg', 'mass'], kgs: ['kg', 'mass'], g: ['g', 'mass'], gr: ['g', 'mass'],
  l: ['l', 'volume'], lt: ['l', 'volume'], lts: ['l', 'volume'], litro: ['l', 'volume'],
  ml: ['ml', 'volume'], gal: ['gal', 'volume'], galon: ['gal', 'volume'],
};

interface PreparedProduct {
  readonly product: Producto;
  readonly placeholder: boolean;
  readonly codes: readonly (readonly [EvidenceSource, string | null])[];
  readonly trigrams: ReadonlySet<string>;
  readonly attributes: Attributes;
  readonly unit: string | null;
}

interface MatchContext {
  readonly supplier: string | null;
  readonly catalog: readonly PreparedProduct[];
  readonly aliases: readonly SupplierAlias[];
  readonly bounds: MatchingBounds;
}

type Comparison = 'same' | 'unknown' | 'incompatible';

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Matching key only: the printed code is never rewritten, and leading zeros/punctuation stay significant.
function normalizeCode(value: string | null | undefined): string | null {
  const key = (value ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  return key === '' ? null : key;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/"/g, ' pulgada ')
    .replace(/[^a-z0-9./\s]/g, ' ')
    .replace(/\.(?=\s|$)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ABBREVIATIONS[word] ?? word)
    .join(' ');
}

// pg_trgm-style word trigrams, so a later hosted search can rank the same way.
function trigramSet(text: string): Set<string> {
  const grams = new Set<string>();
  for (const word of text.match(/[a-z0-9]+/g) ?? []) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  a.forEach((gram) => {
    if (b.has(gram)) shared += 1;
  });
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function collect(text: string, pattern: RegExp, format: (match: RegExpMatchArray) => string): Set<string> {
  return new Set(Array.from(text.matchAll(pattern), format));
}

function extractAttributes(text: string): Attributes {
  const words = text.split(' ');
  return {
    size: collect(text, SIZE, (m) => `${m[1]}${m[2]}`),
    voltage: collect(text, VOLTAGE, (m) => `${m[1]}${m[2]}`),
    power: collect(text, POWER, (m) => `${m[1]}${m[2]}`),
    gauge: collect(text, GAUGE, (m) => `cal${m[1] ?? m[2]}`),
    material: new Set(words.filter((w) => MATERIALS.has(w))),
    presentation: new Set([
      ...words.filter((w) => PACKAGES.has(w)),
      ...collect(text, MULTIPACK, (m) => `x${m[1]}`),
    ]),
    model: collect(text, MX_MODEL, (m) => `mx${m[1]}`),
  };
}

function compareSets(a: ReadonlySet<string>, b: ReadonlySet<string>): Comparison {
  const common = Array.from(a).filter((value) => b.has(value)).length;
  if (common === a.size && common === b.size) return 'same';
  if (a.size === 0 || b.size === 0) return 'unknown';
  if (common === 0) return 'incompatible';
  return common === a.size || common === b.size ? 'unknown' : 'incompatible';
}

// Same level with a different kind is incompatible only when both kinds are known (AC vs DC); a generic 'v' needs review.
function compareVoltage(a: ReadonlySet<string>, b: ReadonlySet<string>): Comparison {
  const split = (set: ReadonlySet<string>) =>
    Array.from(set, (value) => value.match(/^([\d.]+)(v|vac|vdc)$/) as RegExpMatchArray);
  const [left, right] = [split(a), split(b)];
  const levels = compareSets(new Set(left.map((m) => m[1])), new Set(right.map((m) => m[1])));
  if (levels !== 'same') return levels;
  const sameLevel = (x: RegExpMatchArray) => right.filter((y) => y[1] === x[1]);
  if (left.some((x) => sameLevel(x).every((y) => x[2] !== 'v' && y[2] !== 'v' && x[2] !== y[2]))) {
    return 'incompatible';
  }
  return compareSets(a, b) === 'same' ? 'same' : 'unknown';
}

function compareAttribute(kind: AttributeKind, a: ReadonlySet<string>, b: ReadonlySet<string>): Comparison {
  return kind === 'voltage' ? compareVoltage(a, b) : compareSets(a, b);
}

function unitKey(unit: string | null | undefined): string | null {
  const key = (unit ?? '').trim().toLowerCase().replace(/\.$/, '');
  return key === '' ? null : key;
}

function compareUnits(lineUnit: string | null, productUnit: string | null): Comparison {
  if (lineUnit === null || productUnit === null) return 'unknown';
  const line = UNIT_FAMILIES[lineUnit] ?? [lineUnit, `other:${lineUnit}`];
  const product = UNIT_FAMILIES[productUnit] ?? [productUnit, `other:${productUnit}`];
  if (line[0] === product[0]) return 'same';
  const known = !line[1].startsWith('other:') && !product[1].startsWith('other:');
  return known && line[1] !== product[1] ? 'incompatible' : 'unknown';
}

// Mirrors isPlaceholder in hooks/useProductos without importing the Supabase client.
function isPlaceholderProduct(product: Producto): boolean {
  if (product.es_placeholder !== undefined) return product.es_placeholder;
  const description = product.descripcion?.trim() ?? '';
  return /^[.\s]+$/.test(description) || description.length <= 2;
}

function prepareProduct(product: Producto): PreparedProduct {
  const text = normalizeText(product.descripcion ?? '');
  return {
    product,
    placeholder: isPlaceholderProduct(product),
    codes: [
      ['codigo_interno', normalizeCode(product.codigo_interno)],
      ['codigo_barras', normalizeCode(product.codigo_barras)],
      ['referencia', normalizeCode(product.referencia)],
    ],
    trigrams: trigramSet(text),
    attributes: extractAttributes(text),
    unit: unitKey(product.unidad),
  };
}

interface AliasResolution {
  readonly ids: ReadonlySet<string>;
  readonly conflict: MatchConflict | null;
  readonly reasons: readonly string[];
}

function resolveAliases(code: string | null, lineUnit: string | null, ctx: MatchContext): AliasResolution {
  const reasons: string[] = [];
  const valid = new Set<string>();
  for (const alias of ctx.aliases) {
    if (code === null || normalizeCode(alias.keyValue) !== code) continue;
    if (ctx.supplier === null) {
      reasons.push('alias_ignored:supplier_unknown');
      continue;
    }
    if (normalizeCode(alias.supplierKey) !== ctx.supplier) continue;
    const aliasUnit = unitKey(alias.unit);
    const targetExists = ctx.catalog.some(
      (p) => !p.placeholder && p.product.codigo_interno === alias.codigoInterno,
    );
    const rejection =
      (alias.revoked === true && 'revoked') ||
      (alias.active === false && 'inactive') ||
      (alias.current === false && 'not_current') ||
      (alias.normalizationVersion !== MATCHING_NORMALIZATION_VERSION && 'stale_version') ||
      (alias.keyType !== ALIAS_KEY_TYPE && 'key_type') ||
      (aliasUnit !== null && aliasUnit !== lineUnit && 'unit_mismatch') ||
      (!targetExists && 'target_missing');
    if (rejection) reasons.push(`alias_ignored:${rejection}`);
    else valid.add(alias.codigoInterno);
  }
  if (valid.size > 1) {
    const codigosInternos = Array.from(valid).sort(compareText);
    return { ids: new Set(), conflict: { code: 'alias_ambiguous', codigosInternos }, reasons };
  }
  return { ids: valid, conflict: null, reasons };
}

function hasCodeEvidence(candidate: MatchCandidate): boolean {
  return candidate.evidence.some((e) => e.source !== 'descripcion');
}

function compareCandidates(a: MatchCandidate, b: MatchCandidate): number {
  return (
    Number(!hasCodeEvidence(a)) - Number(!hasCodeEvidence(b)) ||
    (b.similarity ?? -1) - (a.similarity ?? -1) ||
    compareText(a.codigoInterno, b.codigoInterno) ||
    compareText(a.descripcion, b.descripcion)
  );
}

function sortedIds(candidates: readonly MatchCandidate[]): string[] {
  return Array.from(new Set(candidates.map((c) => c.codigoInterno))).sort(compareText);
}

function emptyMatch(
  base: Pick<LineMatch, 'index' | 'numeroLinea' | 'codigoProveedor'>,
  reasons: string[],
): LineMatch {
  return { ...base, status: 'unresolved', candidates: [], excluded: [], conflicts: [], omittedCandidates: 0, reasons };
}

function findConflicts(
  candidates: readonly MatchCandidate[],
  aliasConflict: MatchConflict | null,
  incompatibleCodeIds: readonly string[],
  hasDescription: boolean,
): MatchConflict[] {
  const conflicts: MatchConflict[] = aliasConflict ? [aliasConflict] : [];
  const coded = candidates.filter(hasCodeEvidence);
  const hasSource = (c: MatchCandidate, isAlias: boolean) =>
    c.evidence.some((e) => e.source !== 'descripcion' && (e.source === 'alias') === isAlias);
  const aliasIds = sortedIds(coded.filter((c) => hasSource(c, true)));
  const directIds = sortedIds(coded.filter((c) => hasSource(c, false)));

  if (aliasIds.length > 0 && directIds.length > 0 && aliasIds.join() !== directIds.join()) {
    conflicts.push({ code: 'alias_vs_code', codigosInternos: sortedIds(coded) });
  } else if (coded.length > 1) {
    conflicts.push({ code: 'ambiguous_code', codigosInternos: sortedIds(coded) });
  }
  if (incompatibleCodeIds.length > 0) {
    const codigosInternos = [...incompatibleCodeIds].sort(compareText);
    conflicts.push({ code: 'code_attribute_incompatible', codigosInternos });
  }
  const descriptionOnly = candidates.filter((c) => !hasCodeEvidence(c));
  // Independent description evidence that outscores every coded candidate points at another SKU.
  const bestCoded = Math.max(...coded.map((c) => c.similarity ?? -1));
  const outscored = descriptionOnly.some((c) => (c.similarity ?? -1) > bestCoded);
  if (hasDescription && coded.length > 0 && outscored) {
    conflicts.push({ code: 'code_description_conflict', codigosInternos: sortedIds([...coded, ...descriptionOnly]) });
  }
  return conflicts;
}

// Every status still needs human confirmation: 'suggested' only means no signal contradicts the code evidence.
function lineStatus(
  candidates: readonly MatchCandidate[],
  conflicts: readonly MatchConflict[],
  minSimilarity: number,
): LineMatchStatus {
  if (conflicts.length > 0) return 'conflict';
  if (candidates.length === 0) return 'unresolved';
  const [top] = candidates;
  const corroborated = top.similarity !== null && top.similarity >= minSimilarity;
  const outranked = candidates.some((c) => c !== top && (c.similarity ?? 0) >= (top.similarity ?? 0));
  const suggested = hasCodeEvidence(top) && corroborated && top.unknownAttributes.length === 0 && !outranked;
  return suggested ? 'suggested' : 'review';
}

function matchLine(line: ExtraidaLinea, index: number, ctx: MatchContext): LineMatch {
  const base = { index, numeroLinea: line.numeroLinea, codigoProveedor: line.codigoProveedor };
  const { bounds } = ctx;
  if ([line.codigoProveedor, line.descripcion].some((t) => (t?.trim().length ?? 0) > bounds.maxTextLength)) {
    return emptyMatch(base, ['text_too_long']);
  }
  const code = normalizeCode(line.codigoProveedor);
  const text = normalizeText(line.descripcion ?? '');
  if (code === null && text === '') return emptyMatch(base, ['no_candidates', 'no_evidence']);

  const lineUnit = unitKey(line.unidad);
  const aliases = resolveAliases(code, lineUnit, ctx);
  const lineTrigrams = trigramSet(text);
  const lineAttributes = extractAttributes(text);
  const candidates: MatchCandidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  const incompatibleCodeIds: string[] = [];

  for (const prepared of ctx.catalog) {
    const { product } = prepared;
    const sources: EvidenceSource[] = [];
    if (!prepared.placeholder && aliases.ids.has(product.codigo_interno)) sources.push('alias');
    prepared.codes.forEach(([source, key]) => {
      if (code !== null && key === code) sources.push(source);
    });
    const score = text === '' ? null : similarity(lineTrigrams, prepared.trigrams);
    const fuzzy = !prepared.placeholder && score !== null && score >= bounds.minSimilarity;
    if (sources.length === 0 && !fuzzy) continue;
    if (prepared.placeholder) {
      excluded.push({ codigoInterno: product.codigo_interno, reasons: ['placeholder'] });
      continue;
    }

    const comparisons = ATTRIBUTE_KINDS.map((kind): [string, Comparison] => [
      kind,
      text === '' ? 'same' : compareAttribute(kind, lineAttributes[kind], prepared.attributes[kind]),
    ]);
    comparisons.push(['unit', compareUnits(lineUnit, prepared.unit)]);
    const incompatible = comparisons
      .filter(([, result]) => result === 'incompatible')
      .map(([kind]) => `incompatible:${kind}`);
    if (incompatible.length > 0) {
      excluded.push({ codigoInterno: product.codigo_interno, reasons: incompatible });
      if (sources.length > 0) incompatibleCodeIds.push(product.codigo_interno);
      continue;
    }
    candidates.push({
      codigoInterno: product.codigo_interno,
      descripcion: product.descripcion,
      evidence: [
        ...sources.map((source) => ({ source, similarity: null })),
        ...(fuzzy ? [{ source: 'descripcion' as const, similarity: score }] : []),
      ],
      similarity: score,
      unknownAttributes: comparisons.filter(([, result]) => result === 'unknown').map(([kind]) => kind),
    });
  }

  candidates.sort(compareCandidates);
  excluded.sort((a, b) => compareText(a.codigoInterno, b.codigoInterno));
  // Conflicts and status read every candidate, so the per-line cap can never hide them.
  const conflicts = findConflicts(candidates, aliases.conflict, incompatibleCodeIds, text !== '');
  const kept = candidates.slice(0, bounds.maxCandidatesPerLine);
  const reasons = new Set(aliases.reasons);
  if (conflicts.length === 0 && candidates.length === 0) reasons.add('no_candidates');

  return {
    ...base,
    status: lineStatus(candidates, conflicts, bounds.minSimilarity),
    candidates: kept,
    excluded,
    conflicts,
    omittedCandidates: candidates.length - kept.length,
    reasons: Array.from(reasons).sort(compareText),
  };
}

// shortcut: linear catalog scan per line, bounded by maxLines x maxCatalog; add a trigram index if the bounds grow.
export function matchInvoiceLines(input: MatchInvoiceLinesInput): MatchInvoiceLinesResult {
  const bounds = { ...DEFAULT_MATCHING_BOUNDS, ...input.bounds };
  const aliases = input.aliases ?? [];
  const exceeded = (
    [
      ['too_many_lines', input.lines.length, bounds.maxLines],
      ['catalog_too_large', input.catalog.length, bounds.maxCatalog],
      ['too_many_aliases', aliases.length, bounds.maxAliases],
    ] as const
  ).find(([, actual, limit]) => actual > limit);
  if (exceeded) return { ok: false, reason: exceeded[0], limit: exceeded[2], actual: exceeded[1] };

  const ctx: MatchContext = {
    supplier: normalizeCode(input.supplierKey),
    catalog: input.catalog.map(prepareProduct),
    aliases,
    bounds,
  };
  return { ok: true, lines: input.lines.map((line, index) => matchLine(line, index, ctx)) };
}
