import { evaluateInvoiceMatches, parseMatchingGold } from './facturaMatchingEval';
import type { LineMatch } from './facturaMatching';

const CATALOG_HASH = 'a'.repeat(64);
const provenance = { catalogHash: CATALOG_HASH, matcherVersion: 'fixture-v1', querySource: 'transcription' as const };

function label(key: string, tier = 'regression_verified', skus = ['SKU-A'], source = 'catalog_text'): Record<string, unknown> {
  return { key, tier, skus, source, labeler: 'reviewer-opaque', labeledAt: '2026-11-26',
    catalogHash: CATALOG_HASH, matcherVersion: 'fixture-v1' };
}

function match(ids: string[], status: LineMatch['status'] = 'review'): LineMatch {
  return { index: 0, numeroLinea: 1, codigoProveedor: null, status,
    candidates: ids.map(codigoInterno => ({ codigoInterno, descripcion: 'Synthetic fixture',
      evidence: [], similarity: null, unknownAttributes: [] })),
    excluded: [], conflicts: [], omittedCandidates: 0, reasons: [] };
}

describe('matching gold import', () => {
  it('retains probable labels without treating catalog-text evidence as staff exact identity', () => {
    expect(parseMatchingGold([label('line-a', 'regression_probable')])).toMatchObject({
      ok: true, lines: [{ tier: 'regression_probable', skus: ['SKU-A'] }],
    });
    expect(parseMatchingGold([label('line-a', 'staff_exact')])).toMatchObject({ ok: false, error: expect.any(String) });
    expect(parseMatchingGold([label('line-a', 'staff_exact', ['SKU-A'], 'physical')])).toMatchObject({ ok: true });
  });

  it.each([
    ['unknown tier', [label('x', 'made_up')]],
    ['duplicate key', [label('x'), label('x')]],
    ['missing labeler', [{ ...label('x'), labeler: '' }]],
    ['invalid date', [{ ...label('x'), labeledAt: 'yesterday-ish' }]],
    ['missing catalog hash', [{ ...label('x'), catalogHash: '' }]],
    ['empty exact identity', [label('x', 'regression_verified', [])]],
    ['SKU on not-in-catalog label', [label('x', 'staff_not_in_catalog', ['SKU-A'], 'physical')]],
  ])('rejects %s instead of silently scoring it', (_name, input) => {
    expect(parseMatchingGold(input)).toMatchObject({ ok: false, error: expect.any(String) });
  });
});

describe('frozen matching evaluation', () => {
  it('does not call a not-found audit label proof that a suggestion is false', () => {
    expect(evaluateInvoiceMatches([label('a', 'regression_not_found', [])], [
      { key: 'a', match: match(['POSSIBLE'], 'suggested') },
    ], provenance, 5)).toMatchObject({ ok: true, tiers: {
      regression_not_found: { falseSuggestions: 0, relatedLeads: 1, statuses: { suggested: 1 } },
    } });
  });

  it('rejects non-string source metadata without invoking arbitrary coercion', () => {
    const input = [{ ...label('a'), source: { toString() { throw new Error('Do not invoke'); } } }];
    expect(parseMatchingGold(input)).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('reports tier-separated hand-checked counts and real query provenance without inferred accuracy', () => {
    const gold = [
      label('a'),
      label('b', 'regression_probable', ['SKU-B']),
      label('c', 'staff_not_in_catalog', [], 'physical'),
    ];
    const results = [
      { key: 'a', match: match(['SKU-A']), pool: ['SKU-A'] },
      { key: 'b', match: match(['WRONG', 'SKU-B'], 'conflict') },
      { key: 'c', match: match(['LEAD'], 'suggested'), pool: [] },
    ];
    const before = JSON.stringify({ gold, results });
    const report = evaluateInvoiceMatches(gold, results, provenance, 5);
    expect(report).toMatchObject({
      ok: true, provenance, topK: 5, tiers: {
        regression_verified: { lines: 1, top1LabelHits: 1, topKLabelHits: 1, poolMeasured: 1, poolLabelHits: 1 },
        regression_probable: { lines: 1, top1LabelHits: 0, topKLabelHits: 1, poolMeasured: 0 },
        staff_exact: { lines: 0, top1LabelHits: 0 },
        staff_not_in_catalog: { lines: 1, falseSuggestions: 1, relatedLeads: 1 },
      },
    });
    expect(evaluateInvoiceMatches(gold, results, provenance, 5)).toEqual(report);
    expect(JSON.stringify({ gold, results })).toBe(before);
  });

  it('counts known wrong variants and substitutes as errors, never identity hits', () => {
    const report = evaluateInvoiceMatches([
      label('variant', 'staff_wrong_variant_of', ['WRONG-SIZE'], 'physical'),
      label('substitute', 'staff_substitute', ['SUBSTITUTE'], 'purchase'),
    ], [
      { key: 'variant', match: match(['WRONG-SIZE']) },
      { key: 'substitute', match: match(['SUBSTITUTE']) },
    ], provenance, 5);
    expect(report).toMatchObject({ ok: true, tiers: {
      staff_wrong_variant_of: { wrongVariantTop1: 1, top1LabelHits: 0 },
      staff_substitute: { substituteTop1: 1, top1LabelHits: 0 },
    } });
  });

  it('records positive-label exclusion and conflict separately from candidate recall', () => {
    const excluded = { ...match([]), excluded: [{ codigoInterno: 'SKU-A', reasons: ['size'] }] };
    const conflict = { ...match(['SKU-A'], 'conflict'),
      conflicts: [{ code: 'ambiguous_code' as const, codigosInternos: ['SKU-A'] }] };
    expect(evaluateInvoiceMatches([label('a'), label('b')], [
      { key: 'a', match: excluded, pool: ['SKU-A'] }, { key: 'b', match: conflict },
    ], provenance, 5)).toMatchObject({ ok: true, tiers: {
      regression_verified: { lines: 2, top1LabelHits: 1, excludedLabels: 1, conflictingLabels: 1,
        poolMeasured: 1, poolLabelHits: 1, statuses: { review: 1, conflict: 1 } },
    } });
  });

  it('rejects missing or duplicate result keys rather than inflating evaluated coverage', () => {
    expect(evaluateInvoiceMatches([label('a')], [], provenance, 5)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(evaluateInvoiceMatches([label('a')], [
      { key: 'a', match: match([]) }, { key: 'a', match: match([]) },
    ], provenance, 5)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(evaluateInvoiceMatches([label('a')], [
      { key: 'a', match: match([]) }, { key: 'extra', match: match([]) },
    ], provenance, 5)).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('rejects mixed snapshots and invalid top-K instead of inventing comparable evidence', () => {
    const rows = [{ key: 'a', match: match([]) }];
    expect(evaluateInvoiceMatches([label('a')], rows, { ...provenance, catalogHash: 'b'.repeat(64) }, 5)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(evaluateInvoiceMatches([label('a')], rows, { ...provenance, matcherVersion: 'other' }, 5)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(evaluateInvoiceMatches([label('a')], rows, provenance, 0)).toMatchObject({ ok: false, error: expect.any(String) });
  });
});
