import type { LineMatch, LineMatchStatus } from './facturaMatching';

const GOLD_TIERS = [
  'staff_exact', 'staff_wrong_variant_of', 'staff_substitute', 'staff_not_in_catalog', 'staff_unsure',
  'regression_verified', 'regression_probable', 'regression_ambiguous', 'regression_not_found',
] as const;

export type GoldTier = (typeof GOLD_TIERS)[number];

export interface GoldLine {
  readonly key: string;
  readonly tier: GoldTier;
  readonly skus: readonly string[];
  readonly labeler: string;
  readonly labeledAt: string;
  readonly source: 'physical' | 'purchase' | 'catalog_text';
  readonly catalogHash: string;
  readonly matcherVersion: string;
}

export interface MatchingEvaluationLine {
  readonly key: string;
  readonly match: LineMatch;
  readonly pool?: readonly string[];
}

export interface MatchingEvaluationProvenance {
  readonly catalogHash: string;
  readonly matcherVersion: string;
  readonly querySource: 'transcription' | 'ocr';
}

export interface TierMetrics {
  lines: number;
  top1LabelHits: number;
  topKLabelHits: number;
  poolMeasured: number;
  poolLabelHits: number;
  excludedLabels: number;
  conflictingLabels: number;
  wrongVariantTop1: number;
  substituteTop1: number;
  falseSuggestions: number;
  relatedLeads: number;
  statuses: Record<LineMatchStatus, number>;
}

interface EvaluationFailure {
  readonly ok: false;
  readonly error: string;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveTier(tier: GoldTier): boolean {
  return tier === 'staff_exact' || tier === 'regression_verified' || tier === 'regression_probable';
}

function absentTier(tier: GoldTier): boolean {
  return tier === 'staff_not_in_catalog' || tier === 'regression_not_found';
}

/** Validates declared provenance, not its truth. Staff labels still require independent human adjudication. */
export function parseMatchingGold(value: unknown): { readonly ok: true; readonly lines: readonly GoldLine[] } | EvaluationFailure {
  if (!Array.isArray(value)) return { ok: false, error: 'Gold input must be an array.' };
  const keys = new Set<string>();
  const lines: GoldLine[] = [];
  for (const row of value as unknown[]) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return { ok: false, error: 'Gold lines must be objects.' };
    }
    const item = row as Record<string, unknown>;
    const tier = item.tier as GoldTier;
    if (!nonempty(item.key) || keys.has(item.key) || !GOLD_TIERS.includes(tier)
      || !nonempty(item.labeler) || !nonempty(item.labeledAt) || !Number.isFinite(Date.parse(item.labeledAt))
      || typeof item.catalogHash !== 'string' || !/^[a-f0-9]{64}$/i.test(item.catalogHash)
      || !nonempty(item.matcherVersion) || typeof item.source !== 'string'
      || !['physical', 'purchase', 'catalog_text'].includes(item.source)
      || !Array.isArray(item.skus) || !item.skus.every(nonempty)
      || new Set(item.skus).size !== item.skus.length) {
      return { ok: false, error: 'Invalid or duplicate gold line or provenance.' };
    }
    if ((tier.startsWith('staff_') && tier !== 'staff_unsure' && item.source === 'catalog_text')
      || (positiveTier(tier) && item.skus.length === 0)
      || ((tier === 'staff_wrong_variant_of' || tier === 'staff_substitute') && item.skus.length === 0)
      || (absentTier(tier) && item.skus.length !== 0)) {
      return { ok: false, error: 'Gold tier conflicts with its evidence or SKU labels.' };
    }
    keys.add(item.key);
    lines.push({
      key: item.key, tier, skus: [...item.skus], labeler: item.labeler, labeledAt: item.labeledAt,
      source: item.source as GoldLine['source'], catalogHash: item.catalogHash, matcherVersion: item.matcherVersion,
    });
  }
  return { ok: true, lines };
}

function emptyMetrics(): TierMetrics {
  return { lines: 0, top1LabelHits: 0, topKLabelHits: 0, poolMeasured: 0, poolLabelHits: 0,
    excludedLabels: 0, conflictingLabels: 0, wrongVariantTop1: 0, substituteTop1: 0,
    falseSuggestions: 0, relatedLeads: 0, statuses: { suggested: 0, review: 0, conflict: 0, unresolved: 0 } };
}

/** Counts remain separated by label tier. Status counts are not calibrated risk or physical-identity accuracy. */
export function evaluateInvoiceMatches(
  gold: unknown,
  results: readonly MatchingEvaluationLine[],
  provenance: MatchingEvaluationProvenance,
  topK: number,
): { readonly ok: true; readonly provenance: MatchingEvaluationProvenance; readonly topK: number;
  readonly tiers: Readonly<Record<GoldTier, TierMetrics>> } | EvaluationFailure {
  const parsed = parseMatchingGold(gold);
  if (!parsed.ok) return parsed;
  if (!Number.isSafeInteger(topK) || topK < 1
    || !['transcription', 'ocr'].includes(provenance.querySource)
    || parsed.lines.some(line => line.catalogHash !== provenance.catalogHash || line.matcherVersion !== provenance.matcherVersion)) {
    return { ok: false, error: 'Invalid top-K or inconsistent evaluation provenance.' };
  }
  const byKey = new Map(results.map(row => [row.key, row]));
  if (byKey.size !== results.length || byKey.size !== parsed.lines.length || parsed.lines.some(line => !byKey.has(line.key))) {
    return { ok: false, error: 'Each gold line must have exactly one result.' };
  }
  const tiers = Object.fromEntries(GOLD_TIERS.map(tier => [tier, emptyMetrics()])) as Record<GoldTier, TierMetrics>;
  for (const line of parsed.lines) {
    const row = byKey.get(line.key)!;
    const metrics = tiers[line.tier];
    const ids = row.match.candidates.map(candidate => candidate.codigoInterno);
    const hasLabel = (id: string): boolean => line.skus.includes(id);
    const firstMatches = ids.length > 0 && hasLabel(ids[0]);
    metrics.lines += 1;
    metrics.statuses[row.match.status] += 1;
    if (positiveTier(line.tier)) {
      metrics.top1LabelHits += Number(firstMatches);
      metrics.topKLabelHits += Number(ids.slice(0, topK).some(hasLabel));
      if (row.pool !== undefined) {
        metrics.poolMeasured += 1;
        metrics.poolLabelHits += Number(row.pool.some(hasLabel));
      }
      metrics.excludedLabels += Number(row.match.excluded.some(candidate => hasLabel(candidate.codigoInterno)));
      metrics.conflictingLabels += Number(row.match.conflicts.some(conflict => conflict.codigosInternos.some(hasLabel)));
    }
    metrics.wrongVariantTop1 += Number(line.tier === 'staff_wrong_variant_of' && firstMatches);
    metrics.substituteTop1 += Number(line.tier === 'staff_substitute' && firstMatches);
    if (absentTier(line.tier)) {
      metrics.falseSuggestions += Number(line.tier === 'staff_not_in_catalog' && row.match.status === 'suggested');
      metrics.relatedLeads += Number(ids.length > 0);
    }
  }
  return { ok: true, provenance: { ...provenance }, topK, tiers };
}
