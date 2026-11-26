import type { ExtraidaLinea } from './facturaExtractionContract';
import {
  MATCHING_NORMALIZATION_VERSION,
  matchInvoiceLines,
  isAbsentIdentifier,
  describeCandidateSupport,
  type LineMatch,
  type MatchInvoiceLinesInput,
  type SupplierAlias,
} from './facturaMatching';
import type { Producto } from './supabase';

describe('saved product feedback', () => {
  const lines = [line(9, { descripcion: 'Adhesivo blanco', unidad: 'UND' })];
  const catalog = [prod('A', 'Adhesivo blanco'), prod('B', 'Pegamento', { existencia: -3 })];
  const remembered = { lineIndex: 0, decision: 'confirmado', codigoInterno: 'B' };
  function withFeedback(feedback: unknown, products = catalog) {
    return run(lines, products, { feedback } as never)[0];
  }

  it('admits and prefers a saved corrected SKU without confirming its identity', () => {
    const result = withFeedback([remembered]);
    expect(result.candidates.map(c => c.codigoInterno)).toEqual(['B', 'A']);
    expect(result.status).toBe('review');
    expect((result as any).feedback).toEqual(remembered);
  });
  it('keeps a previous-new hint without hiding current catalog choices', () => {
    const hint = { lineIndex: 0, decision: 'producto_nuevo', codigoInterno: null };
    const result = withFeedback([hint]);
    expect(result.candidates).toEqual(run(lines, catalog)[0].candidates);
    expect((result as any).feedback).toEqual(hint);
  });
  it('does not bypass hard variant or placeholder guards', () => {
    const variants = [prod('B', 'Pegamento MX40'), prod('A', 'Adhesivo MX30')];
    const result = run([line(1, { descripcion: 'Adhesivo MX30', unidad: 'UND' })], variants, { feedback: [remembered] } as never)[0];
    expect(result.candidates.map(c => c.codigoInterno)).toEqual(['A']);
    expect((result as any).feedback).toBeUndefined();
    expect(withFeedback([remembered], [prod('B', '.')]).candidates).toEqual([]);
  });
  it('keeps direct code precedence even when another SKU was remembered', () => {
    const result = run([line(1, { codigoProveedor: 'A', descripcion: 'Adhesivo blanco', unidad: 'UND' })], catalog, { feedback: [remembered] } as never)[0];
    expect(result.candidates.map(c => c.codigoInterno)).toEqual(['A', 'B']);
  });
  it.each([null, {}, [null], [{ ...remembered, lineIndex: 8 }], [{ ...remembered, decision: 'otro' }], [{ ...remembered, codigoInterno: null }]])('ignores malformed feedback without changing legacy output (%j)', feedback => {
    expect(withFeedback(feedback)).toEqual(run(lines, catalog)[0]);
  });
  it('discards contradictory feedback and does not amplify identical duplicates', () => {
    expect(withFeedback([remembered, remembered])).toEqual(withFeedback([remembered]));
    expect(withFeedback([remembered, { ...remembered, codigoInterno: 'A' }])).toEqual(run(lines, catalog)[0]);
  });
});

const SUPPLIER = 'J-123456789';

function line(numeroLinea: number, over: Partial<ExtraidaLinea> = {}): ExtraidaLinea {
  return {
    numeroLinea,
    pagina: 1,
    codigoProveedor: null,
    descripcion: null,
    cantidad: '1',
    unidad: null,
    precioUnitario: null,
    descuentos: [],
    tasaIva: null,
    total: null,
    incertidumbre: null,
    ...over,
  };
}

function prod(codigo_interno: string, descripcion: string, over: Partial<Producto> = {}): Producto {
  return {
    codigo_interno,
    descripcion,
    unidad: 'UND',
    codigo_barras: '',
    costo: 1,
    precio_venta: 2,
    existencia: 0,
    actualizado_en: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function alias(over: Partial<SupplierAlias> = {}): SupplierAlias {
  return {
    supplierKey: SUPPLIER,
    keyType: 'codigo_proveedor',
    keyValue: 'S-77',
    unit: null,
    codigoInterno: 'P1',
    normalizationVersion: MATCHING_NORMALIZATION_VERSION,
    ...over,
  };
}

function run(
  lines: ExtraidaLinea[],
  catalog: Producto[],
  extra: Partial<MatchInvoiceLinesInput> = {},
): readonly LineMatch[] {
  const result = matchInvoiceLines({ supplierKey: SUPPLIER, lines, catalog, ...extra });
  if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
  return result.lines;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const SCREW = 'Tornillo hexagonal 1/2 pulgada';

describe('matchInvoiceLines: identity of lines and literal codes', () => {
  it('returns one result per input line in order without consolidating repeated SKUs', () => {
    const catalog = [prod('P1', SCREW, { codigo_barras: 'S-1' })];
    const lines = [
      line(5, { codigoProveedor: 'S-1', descripcion: SCREW }),
      line(9, { codigoProveedor: 'S-1', descripcion: SCREW }),
    ];
    const result = run(lines, catalog);
    expect(result.map((r) => [r.index, r.numeroLinea])).toEqual([[0, 5], [1, 9]]);
    expect(result[0].candidates).toEqual(result[1].candidates);
  });

  it('preserves the printed code byte-for-byte and never matches across leading zeros', () => {
    const catalog = [
      prod('A', 'Item A', { codigo_barras: '00123' }),
      prod('B', 'Item B', { codigo_barras: '123' }),
    ];
    const [result] = run([line(1, { codigoProveedor: '00123' })], catalog);
    expect(result.codigoProveedor).toBe('00123');
    expect(result.candidates.map((c) => c.codigoInterno)).toEqual(['A']);
  });

  it('keeps printed punctuation and whitespace, matching case-insensitively but not across punctuation', () => {
    const catalog = [
      prod('A', 'Item A', { codigo_barras: 'ab-12/x.9' }),
      prod('B', 'Item B', { codigo_barras: 'AB12X9' }),
    ];
    const [result] = run([line(1, { codigoProveedor: ' AB-12/X.9 ' })], catalog);
    expect(result.codigoProveedor).toBe(' AB-12/X.9 ');
    expect(result.candidates.map((c) => c.codigoInterno)).toEqual(['A']);
    expect(result.candidates[0].evidence.map((e) => e.source)).toContain('codigo_barras');
  });

  it('keeps OCR reading confidence out of the matching outcome', () => {
    const catalog = [prod('P1', SCREW, { codigo_barras: 'S-1' })];
    const withConfidence = (confianzaLectura: number) =>
      line(1, {
        codigoProveedor: 'S-1',
        descripcion: SCREW,
        incertidumbre: { confianzaLectura, advertencias: [], campoDudoso: [] },
      });
    const low = run([withConfidence(0.05)], catalog);
    const high = run([withConfidence(0.99)], catalog);
    expect(low).toEqual(high);
    expect(JSON.stringify(low)).not.toMatch(/confianza/i);
  });
});

describe('matchInvoiceLines: independent evidence and conflicts', () => {
  it('surfaces a conflict when the code and the description point to different products', () => {
    const catalog = [
      prod('A', 'Pintura latex blanco galon', { codigo_barras: 'ABC1' }),
      prod('B', SCREW),
    ];
    const [result] = run([line(1, { codigoProveedor: 'ABC1', descripcion: SCREW })], catalog);
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toEqual([{ code: 'code_description_conflict', codigosInternos: ['A', 'B'] }]);
    expect(result.candidates.map((c) => c.codigoInterno).sort()).toEqual(['A', 'B']);
  });

  it('surfaces a conflict when stronger description evidence points to another SKU than a loosely similar code', () => {
    const catalog = [
      prod('A', 'Taladro Makita 500 W', { codigo_barras: 'A' }),
      prod('B', 'Taladro Bosch 500 W'),
    ];
    const [result] = run([line(1, { codigoProveedor: 'A', descripcion: 'Taladro Bosch 500 W', unidad: 'UND' })], catalog);
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toEqual([{ code: 'code_description_conflict', codigosInternos: ['A', 'B'] }]);
    expect(result.candidates.map((c) => c.codigoInterno).sort()).toEqual(['A', 'B']);
  });

  it('surfaces a conflict for duplicate catalog identifiers instead of picking the first row', () => {
    const catalog = [
      prod('A', SCREW, { codigo_barras: 'DUP' }),
      prod('B', SCREW, { codigo_barras: 'DUP' }),
    ];
    const [result] = run([line(1, { codigoProveedor: 'DUP', descripcion: SCREW, unidad: 'UND' })], catalog);
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toEqual([{ code: 'ambiguous_code', codigosInternos: ['A', 'B'] }]);
  });

  it('suggests a single corroborated code match but never as a confirmed identity', () => {
    const catalog = [prod('P1', SCREW, { codigo_barras: 'S-1' })];
    const [result] = run([line(1, { codigoProveedor: 'S-1', descripcion: SCREW, unidad: 'UND' })], catalog);
    expect(result.status).toBe('suggested');
    expect(result.candidates[0].similarity).toBe(1);
    expect(result.candidates[0].unknownAttributes).toEqual([]);
  });

  it('needs review when an exact code has no description to corroborate it', () => {
    const catalog = [prod('P1', SCREW, { codigo_barras: 'S-1' })];
    const [result] = run([line(1, { codigoProveedor: 'S-1', unidad: 'UND' })], catalog);
    expect(result.status).toBe('review');
    expect(result.candidates[0].similarity).toBeNull();
  });
});

describe('matchInvoiceLines: supplier aliases', () => {
  const catalog = [prod('P1', SCREW), prod('P2', 'Tuerca hexagonal 1/2 pulgada')];
  const printed = line(1, { codigoProveedor: 'S-77', descripcion: SCREW, unidad: 'UND' });

  it('uses a valid alias as code evidence', () => {
    const [result] = run([printed], catalog, { aliases: [alias()] });
    expect(result.candidates[0].codigoInterno).toBe('P1');
    expect(result.candidates[0].evidence.map((e) => e.source)).toContain('alias');
    expect(result.status).toBe('suggested');
  });

  it('isolates aliases per supplier', () => {
    const foreign = alias({ supplierKey: 'J-999', codigoInterno: 'P2' });
    const [result] = run([printed], catalog, { aliases: [foreign] });
    expect(result.candidates.flatMap((c) => c.evidence.map((e) => e.source))).not.toContain('alias');
    expect(result.status).toBe('review');
  });

  it('ignores aliases without a known supplier', () => {
    const [result] = run([printed], catalog, { supplierKey: null, aliases: [alias()] });
    expect(result.candidates.flatMap((c) => c.evidence.map((e) => e.source))).not.toContain('alias');
  });

  it.each([
    ['revoked', { revoked: true }],
    ['inactive', { active: false }],
    ['not current', { current: false }],
    ['stale normalization version', { normalizationVersion: 'matching-v0' }],
    ['another key type', { keyType: 'codigo_barras' }],
    ['incompatible unit', { unit: 'KG' }],
    ['missing target product', { codigoInterno: 'GONE' }],
  ] as [string, Partial<SupplierAlias>][])('cannot shortcut identity when the alias is %s', (_name, over) => {
    const [result] = run([printed], catalog, { aliases: [alias(over)] });
    expect(result.candidates.flatMap((c) => c.evidence.map((e) => e.source))).not.toContain('alias');
    expect(result.reasons.some((r) => r.startsWith('alias_ignored:'))).toBe(true);
    expect(result.status).not.toBe('suggested');
  });

  it('flags ambiguous or reused aliases as a conflict and does not pick one', () => {
    const aliases = [alias({ codigoInterno: 'P1' }), alias({ codigoInterno: 'P2' })];
    const [result] = run([printed], catalog, { aliases });
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toEqual([{ code: 'alias_ambiguous', codigosInternos: ['P1', 'P2'] }]);
    expect(result.candidates.flatMap((c) => c.evidence.map((e) => e.source))).not.toContain('alias');
  });

  it('flags a conflict when the alias and a catalog code disagree', () => {
    const withCode = [prod('P1', SCREW), prod('P2', SCREW, { codigo_barras: 'S-77' })];
    const [result] = run([printed], withCode, { aliases: [alias()] });
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toEqual([{ code: 'alias_vs_code', codigosInternos: ['P1', 'P2'] }]);
  });
});

describe('matchInvoiceLines: attributes', () => {
  it.each([
    ['size', 'Tornillo hexagonal 1/2 pulgada', 'Tornillo hexagonal 3/4 pulgada', {}],
    ['voltage', 'Bombillo led 110V 9W', 'Bombillo led 220V 9W', {}],
    ['material', 'Codo 1 pulgada acero inoxidable', 'Codo 1 pulgada acero galvanizado', {}],
    ['gauge', 'Cable flexible cal 12', 'Cable flexible cal 14', {}],
    ['unit', 'Clavo de acero 2 pulgada', 'Clavo de acero 2 pulgada', { unidad: 'KG' }],
  ] as [string, string, string, Partial<ExtraidaLinea>][])(
    'excludes a candidate with a known incompatible %s',
    (kind, printedText, catalogText, over) => {
      const [result] = run([line(1, { descripcion: printedText, unidad: 'UND', ...over })], [prod('P1', catalogText)]);
      expect(result.candidates).toEqual([]);
      expect(result.excluded).toEqual([{ codigoInterno: 'P1', reasons: [`incompatible:${kind}`] }]);
      expect(result.status).toBe('unresolved');
    },
  );

  it('surfaces a conflict when the exact code points to an incompatible product', () => {
    const catalog = [prod('P1', 'Tornillo hexagonal 3/4 pulgada', { codigo_barras: 'S-1' })];
    const [result] = run([line(1, { codigoProveedor: 'S-1', descripcion: SCREW, unidad: 'UND' })], catalog);
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toEqual([{ code: 'code_attribute_incompatible', codigosInternos: ['P1'] }]);
  });

  it.each([
    ['awg suffix gauge', 'Cable cobre 12 AWG', 'Cable cobre 14 AWG', 'gauge'],
    ['AC versus DC supply', 'Transformador 12 vac', 'Transformador 12 vdc', 'voltage'],
  ])('surfaces an exact-code conflict for a known incompatible %s', (_label, printedText, catalogText, kind) => {
    const catalog = [prod('A', catalogText, { codigo_barras: 'A' })];
    const [result] = run([line(1, { codigoProveedor: 'A', descripcion: printedText, unidad: 'UND' })], catalog);
    expect(result.status).toBe('conflict');
    expect(result.candidates).toEqual([]);
    expect(result.excluded).toEqual([{ codigoInterno: 'A', reasons: [`incompatible:${kind}`] }]);
    expect(result.conflicts).toEqual([{ code: 'code_attribute_incompatible', codigosInternos: ['A'] }]);
  });

  it('keeps matching AC or DC voltage and requires review for a generic voltage', () => {
    const same = run([line(1, { descripcion: 'Transformador 12 vdc', unidad: 'UND' })], [prod('P1', 'Transformador 12 vdc')]);
    expect(same[0].candidates[0].unknownAttributes).toEqual([]);
    const [generic] = run([line(1, { descripcion: 'Transformador 12 v', unidad: 'UND' })], [prod('P1', 'Transformador 12 vdc')]);
    expect(generic.excluded).toEqual([]);
    expect(generic.status).toBe('review');
    expect(generic.candidates[0].unknownAttributes).toEqual(['voltage']);
  });

  it('requires review when an attribute is unknown on one side', () => {
    const [result] = run([line(1, { descripcion: 'Tornillo hexagonal', unidad: 'UND' })], [prod('P1', SCREW)]);
    expect(result.status).toBe('review');
    expect(result.candidates[0].unknownAttributes).toEqual(['size']);
  });

  it('keeps a differing presentation of the same unit family as unknown, not incompatible', () => {
    const [result] = run([line(1, { descripcion: SCREW, unidad: 'CAJA' })], [prod('P1', SCREW)]);
    expect(result.candidates[0].unknownAttributes).toEqual(['unit']);
  });

  it('normalizes common abbreviations without losing size or material', () => {
    const [result] = run(
      [line(1, { descripcion: 'Tornillo galv 1/2"', unidad: 'UND' })],
      [prod('P1', 'Tornillo galvanizado 1/2 pulgada')],
    );
    expect(result.candidates[0].unknownAttributes).toEqual([]);
    expect(result.excluded).toEqual([]);
  });

  it.each([
    ['MX30', 'MX-30'],
    ['MX30', 'MX 30'],
    ['MX-30', 'MX 30'],
  ])('treats equivalent MX model spellings %s and %s as compatible', (printedModel, catalogModel) => {
    const [result] = run(
      [line(1, { descripcion: `Generic adhesive ${printedModel} white` })],
      [prod('P1', `Generic adhesive ${catalogModel} white`)],
    );

    expect(result.candidates.map((candidate) => candidate.codigoInterno)).toEqual(['P1']);
    expect(result.excluded).toEqual([]);
    expect(result.candidates[0].unknownAttributes).not.toContain('model');
    expect(result.status).toBe('review');
  });

  it('excludes a fuzzy candidate with a different explicit MX model', () => {
    const [result] = run(
      [line(1, { descripcion: 'Generic adhesive MX30 white' })],
      [prod('P1', 'Generic adhesive MX50 white')],
    );

    expect(result.candidates).toEqual([]);
    expect(result.excluded).toEqual([{ codigoInterno: 'P1', reasons: ['incompatible:model'] }]);
    expect(result.status).toBe('unresolved');
  });

  it.each(['MX30.5', 'MX30,5'])('does not classify a partial decimal model %s as MX30', (printedModel) => {
    const [result] = run(
      [line(1, { descripcion: `Generic adhesive ${printedModel} white` })],
      [prod('P1', 'Generic adhesive MX50 white')],
    );

    expect(result.candidates.map((candidate) => candidate.codigoInterno)).toEqual(['P1']);
    expect(result.candidates[0].unknownAttributes).toContain('model');
    expect(result.excluded).toEqual([]);
    expect(result.status).toBe('review');
  });

  it('surfaces an exact-code conflict when an MX model differs', () => {
    const [result] = run(
      [line(1, { codigoProveedor: 'SKU-1', descripcion: 'Generic adhesive MX30 white', unidad: 'UND' })],
      [prod('P1', 'Generic adhesive MX50 white', { codigo_barras: 'SKU-1' })],
    );

    expect(result.candidates).toEqual([]);
    expect(result.excluded).toEqual([{ codigoInterno: 'P1', reasons: ['incompatible:model'] }]);
    expect(result.conflicts).toEqual([{ code: 'code_attribute_incompatible', codigosInternos: ['P1'] }]);
    expect(result.status).toBe('conflict');
  });

  it.each([
    ['line only', 'Generic adhesive MX30 white', 'Generic adhesive white'],
    ['catalog only', 'Generic adhesive white', 'Generic adhesive MX30 white'],
  ])('keeps one-sided MX model evidence unknown for %s', (_label, printed, catalog) => {
    const [result] = run([line(1, { descripcion: printed, unidad: 'UND' })], [prod('P1', catalog)]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].unknownAttributes).toContain('model');
    expect(result.excluded).toEqual([]);
    expect(result.status).toBe('review');
  });

  it('preserves existing behavior when neither description has an MX model', () => {
    const [result] = run(
      [line(1, { descripcion: 'Generic adhesive white', unidad: 'UND' })],
      [prod('P1', 'Generic adhesive white')],
    );

    expect(result.candidates.map((candidate) => candidate.codigoInterno)).toEqual(['P1']);
    expect(result.candidates[0].unknownAttributes).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.status).toBe('review');
  });

  it('does not infer diameter or incompatibility from bare 4 X 3MTS and 6 X 3MTS', () => {
    const [result] = run(
      [line(1, { descripcion: 'Generic hose 4 X 3MTS' })],
      [prod('P1', 'Generic hose 6 X 3MTS')],
    );

    expect(result.candidates.map((candidate) => candidate.codigoInterno)).toEqual(['P1']);
    expect(result.candidates[0].unknownAttributes).not.toContain('model');
    expect(result.excluded).toEqual([]);
  });

  it('still excludes a size mismatch when the explicit MX model matches', () => {
    const [result] = run(
      [line(1, { descripcion: 'Generic adhesive MX30 10mm' })],
      [prod('P1', 'Generic adhesive MX-30 12mm')],
    );

    expect(result.candidates).toEqual([]);
    expect(result.excluded).toEqual([{ codigoInterno: 'P1', reasons: ['incompatible:size'] }]);
  });
});

describe('matchInvoiceLines: fuzzy suggestions and unresolved lines', () => {
  it('retains a synonym candidate from line-scoped semantic rank for human review', () => {
    const result = run(
      [line(1, { descripcion: 'Adhesivo blanco', unidad: 'UND' })],
      [prod('P1', 'Pegamento blanco')],
      { hybridRanks: [{ lineIndex: 0, semantic: [{ codigoInterno: 'P1', rank: 1 }] }] } as never,
    )[0];
    expect(result.candidates.map((candidate) => candidate.codigoInterno)).toEqual(['P1']);
    expect(result.status).toBe('review');
    expect(result.conflicts).toEqual([]);
  });

  it('ranks trigram suggestions deterministically with provenance and review status', () => {
    const catalog = [
      prod('B2', 'Cinta aislante negra 18mm'),
      prod('A1', 'Cinta aislante negra 18mm'),
      prod('C3', 'Cinta aislante negra'),
      prod('D4', 'Martillo carpintero'),
    ];
    const [result] = run([line(1, { descripcion: 'Cinta aislante negra 18mm', unidad: 'UND' })], catalog);
    expect(result.candidates.map((c) => c.codigoInterno)).toEqual(['A1', 'B2', 'C3']);
    expect(result.candidates[0].evidence).toEqual([{ source: 'descripcion', similarity: 1 }]);
    expect(result.candidates[2].similarity).toBeGreaterThan(0.3);
    expect(result.candidates[2].similarity).toBeLessThan(1);
    expect(result.status).toBe('review');
  });

  it('returns unresolved, never a new product, when nothing is similar', () => {
    const [result] = run([line(1, { descripcion: 'Zzzzqq xxxx' })], [prod('P1', SCREW)]);
    expect(result.status).toBe('unresolved');
    expect(result.candidates).toEqual([]);
    expect(result.reasons).toContain('no_candidates');
    expect(Object.keys(result)).not.toContain('nuevo');
  });

  it('returns unresolved when the line carries no code and no description', () => {
    const [result] = run([line(1)], [prod('P1', SCREW)]);
    expect(result.status).toBe('unresolved');
    expect(result.reasons).toContain('no_evidence');
  });

  it('excludes placeholder products even on an exact code match', () => {
    const catalog = [
      prod('PH1', '.', { codigo_barras: 'Z9' }),
      prod('PH2', 'Producto largo marcado', { codigo_barras: 'Z9', es_placeholder: true }),
    ];
    const [result] = run([line(1, { codigoProveedor: 'Z9' })], catalog);
    expect(result.candidates).toEqual([]);
    expect(result.excluded).toEqual([
      { codigoInterno: 'PH1', reasons: ['placeholder'] },
      { codigoInterno: 'PH2', reasons: ['placeholder'] },
    ]);
    expect(result.status).toBe('unresolved');
  });
});

describe('matchInvoiceLines: bounds, order and purity', () => {
  it.each([
    ['too_many_lines', { maxLines: 1 }, 2],
    ['catalog_too_large', { maxCatalog: 1 }, 2],
    ['too_many_aliases', { maxAliases: 1 }, 2],
  ] as const)('rejects %s instead of truncating', (reason, bounds, actual) => {
    const result = matchInvoiceLines({
      supplierKey: SUPPLIER,
      lines: [line(1), line(2)],
      catalog: [prod('P1', 'Uno'), prod('P2', 'Dos')],
      aliases: [alias(), alias({ keyValue: 'S-78' })],
      bounds,
    });
    expect(result).toEqual({ ok: false, reason, limit: 1, actual });
  });

  it('caps candidates per line and reports how many were omitted', () => {
    const catalog = ['D', 'C', 'B', 'A'].map((id) => prod(id, 'Cinta aislante negra'));
    const [result] = run([line(1, { descripcion: 'Cinta aislante negra' })], catalog, {
      bounds: { maxCandidatesPerLine: 2 },
    });
    expect(result.candidates.map((c) => c.codigoInterno)).toEqual(['A', 'B']);
    expect(result.omittedCandidates).toBe(2);
  });

  it('does not hide a conflict when the candidate cap applies', () => {
    const catalog = ['C', 'B', 'A'].map((id) => prod(id, SCREW, { codigo_barras: 'DUP' }));
    const [result] = run([line(1, { codigoProveedor: 'DUP', descripcion: SCREW })], catalog, {
      bounds: { maxCandidatesPerLine: 1 },
    });
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toEqual([{ code: 'ambiguous_code', codigosInternos: ['A', 'B', 'C'] }]);
    expect(result.omittedCandidates).toBe(2);
  });

  it('marks over-long text unresolved while keeping the literal code', () => {
    const [result] = run(
      [line(1, { codigoProveedor: '0001', descripcion: 'x'.repeat(11) })],
      [prod('P1', SCREW)],
      { bounds: { maxTextLength: 10 } },
    );
    expect(result.status).toBe('unresolved');
    expect(result.reasons).toContain('text_too_long');
    expect(result.codigoProveedor).toBe('0001');
  });

  it('is independent of catalog and alias input order', () => {
    const catalog = [
      prod('P1', SCREW),
      prod('P2', 'Tornillo hexagonal 1/2 pulgada acero'),
      prod('P3', 'Tuerca hexagonal 1/2 pulgada', { codigo_barras: 'S-77' }),
    ];
    const aliases = [alias(), alias({ codigoInterno: 'P2' })];
    const lines = [line(1, { codigoProveedor: 'S-77', descripcion: SCREW, unidad: 'UND' })];
    const forward = run(lines, catalog, { aliases });
    const reversed = run(lines, [...catalog].reverse(), { aliases: [...aliases].reverse() });
    expect(reversed).toEqual(forward);
  });

  it('does not mutate its inputs', () => {
    const input = deepFreeze({
      supplierKey: SUPPLIER,
      lines: [line(1, { codigoProveedor: 'S-77', descripcion: SCREW, unidad: 'UND' })],
      catalog: [prod('P1', SCREW), prod('P2', 'Tuerca hexagonal 1/2 pulgada')],
      aliases: [alias()],
      bounds: { maxCandidatesPerLine: 3 },
    });
    const before = JSON.stringify(input);
    expect(() => matchInvoiceLines(input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('matchInvoiceLines: hybrid retrieval ranks', () => {
  const SYNONYMS = [
    prod('P1', 'Pegamento rojo'),
    prod('P2', 'Pegamento negro'),
    prod('P3', 'Pegamento gris'),
  ];
  const synonymLine = () => [line(1, { descripcion: 'Adhesivo', unidad: 'UND' })];
  const withRanks = (hybridRanks: unknown, catalog = SYNONYMS, extra: Partial<MatchInvoiceLinesInput> = {}) =>
    run(synonymLine(), catalog, { ...extra, hybridRanks: hybridRanks as never })[0];
  const ids = (match: LineMatch) => match.candidates.map((candidate) => candidate.codigoInterno);
  const entry = (codigoInterno: string, rank: number) => ({ codigoInterno, rank });

  it('fuses both lists with RRF so a SKU in two lists outranks one in a single list, ties by SKU', () => {
    const match = withRanks([
      { lineIndex: 0, lexical: [entry('P1', 1), entry('P2', 2)], semantic: [entry('P3', 1), entry('P2', 2)] },
    ]);
    expect(ids(match)).toEqual(['P2', 'P1', 'P3']);
    expect(match.status).toBe('review');
  });

  it('orders by rank only and never by raw lexical or cosine scores', () => {
    const match = withRanks([
      {
        lineIndex: 0,
        lexical: [{ ...entry('P1', 2), score: 999 }],
        semantic: [{ ...entry('P2', 1), similarity: 0.01 }],
      },
    ]);
    expect(ids(match)).toEqual(['P2', 'P1']);
  });

  it('counts a SKU once per source across repeated groups of the same line', () => {
    const groups = [
      { lineIndex: 0, lexical: [entry('P1', 1)] },
      { lineIndex: 0, lexical: [entry('P1', 1)] },
      { lineIndex: 0, lexical: [entry('P2', 1)], semantic: [entry('P2', 1)] },
    ];
    expect(ids(withRanks(groups))).toEqual(['P2', 'P1']);
    expect(withRanks([...groups].reverse())).toEqual(withRanks(groups));
    expect(withRanks(deepFreeze(groups))).toEqual(withRanks(groups));
  });

  it('keeps the best rank of a SKU repeated inside one source regardless of arrival order', () => {
    const forward = withRanks([{ lineIndex: 0, lexical: [entry('P1', 9), entry('P1', 1), entry('P2', 2)] }]);
    const reversed = withRanks([{ lineIndex: 0, lexical: [entry('P2', 2), entry('P1', 1), entry('P1', 9)] }]);
    expect(ids(forward)).toEqual(['P1', 'P2']);
    expect(reversed).toEqual(forward);
  });

  it('leaves the legacy output untouched for empty and invalid evidence', () => {
    const legacy = run(synonymLine(), SYNONYMS);
    const invalid = [
      null,
      5,
      { lineIndex: 0, lexical: 'P1' },
      { lineIndex: -1, semantic: [entry('P1', 1)] },
      { lineIndex: 1.5, semantic: [entry('P1', 1)] },
      { lineIndex: 99, semantic: [entry('P1', 1)] },
      { lineIndex: '0', semantic: [entry('P1', 1)] },
      { lineIndex: Number.NaN, semantic: [entry('P1', 1)] },
      {
        lineIndex: 0,
        semantic: [
          null,
          7,
          { rank: 1 },
          { codigoInterno: 7, rank: 1 },
          entry('P1', Number.NaN),
          entry('P1', Number.POSITIVE_INFINITY),
          entry('P1', 1.5),
          entry('P1', 0),
          entry('P1', -1),
          { codigoInterno: 'P1', rank: '1' },
          entry('P1', 10001),
          entry('NOT-IN-CATALOG', 1),
        ],
      },
    ];
    for (const evidence of [undefined, [], invalid, 'abc', { length: 1 }, {}, 42]) {
      expect(run(synonymLine(), SYNONYMS, { hybridRanks: evidence as never })).toEqual(legacy);
    }
  });

  it('applies the configured bounds to groups, entries per source and ranks', () => {
    const entries = [entry('X1', 1), entry('X2', 2), entry('X3', 3), entry('P1', 1)];
    expect(ids(withRanks([{ lineIndex: 0, lexical: entries }]))).toEqual(['P1']);
    expect(withRanks([{ lineIndex: 0, lexical: entries }], SYNONYMS, { bounds: { maxCatalog: 3 } }).candidates).toEqual([]);
    expect(ids(withRanks([{ lineIndex: 0, lexical: [entry('P2', 4)] }]))).toEqual(['P2']);
    expect(withRanks([{ lineIndex: 0, lexical: [entry('P2', 4)] }], SYNONYMS, { bounds: { maxCatalog: 3 } }).candidates).toEqual([]);
    const repeated = [
      { lineIndex: 0, lexical: [entry('P1', 1)] },
      { lineIndex: 0, lexical: [entry('P1', 1)] },
    ];
    expect(ids(withRanks(repeated))).toEqual(['P1']);
    expect(withRanks(repeated, SYNONYMS, { bounds: { maxLines: 1 } }).candidates).toEqual([]);
  });

  it('scopes ranks to the original line index even when numeroLinea differs or repeats', () => {
    for (const numbers of [[2, 1], [7, 7]]) {
      const lines = numbers.map((n) => line(n, { descripcion: 'Adhesivo', unidad: 'UND' }));
      const [first, second] = run(lines, SYNONYMS, {
        hybridRanks: [{ lineIndex: 1, semantic: [entry('P1', 1)] }] as never,
      });
      expect(first.candidates).toEqual([]);
      expect(first.status).toBe('unresolved');
      expect(second.candidates.map((c) => c.codigoInterno)).toEqual(['P1']);
    }
  });

  it('keeps retrieved candidates with no stock and drops placeholders and hard variant conflicts', () => {
    const catalog = [
      prod('M1', 'Pegamento MX200 12mm'),
      prod('D1', 'Pegamento MX100 20mm'),
      prod('U1', 'Pegamento MX100 12mm', { unidad: 'KG' }),
      prod('PL', '.'),
      prod('OK', 'Pegamento MX100 12mm', { existencia: -4 }),
    ];
    const ranked = ['M1', 'D1', 'U1', 'PL', 'OK'].map((sku, i) => entry(sku, i + 1));
    const [match] = run([line(1, { descripcion: 'Adhesivo MX100 12mm', unidad: 'UND' })], catalog, {
      hybridRanks: [{ lineIndex: 0, lexical: ranked, semantic: ranked }] as never,
    });
    expect(ids(match)).toEqual(['OK']);
    expect(match.status).toBe('review');
    expect(match.excluded.map((e) => e.codigoInterno)).toEqual(['D1', 'M1', 'U1']);
    expect(match.excluded.find((e) => e.codigoInterno === 'M1')?.reasons).toContain('incompatible:model');
    expect(match.excluded.find((e) => e.codigoInterno === 'D1')?.reasons).toContain('incompatible:size');
    expect(match.excluded.find((e) => e.codigoInterno === 'U1')?.reasons).toContain('incompatible:unit');
  });

  it('keeps code evidence first and its order, conflicts and status unchanged by ranks', () => {
    const catalog = [
      prod('P1', 'Cinta aislante negra', { codigo_barras: 'S-1' }),
      prod('P2', 'Cinta aislante', { referencia: 'S-1' }),
      prod('N1', 'Pegamento rojo'),
    ];
    const lines = [line(1, { codigoProveedor: 'S-1', descripcion: 'Cinta aislante negra', unidad: 'UND' })];
    const legacy = run(lines, catalog);
    const ranked = run(lines, catalog, {
      hybridRanks: [
        { lineIndex: 0, lexical: [entry('N1', 1), entry('P2', 2), entry('P1', 3)], semantic: [entry('N1', 1)] },
      ] as never,
    });
    expect(ranked[0].candidates.map((c) => c.codigoInterno)).toEqual(['P1', 'P2', 'N1']);
    expect(ranked[0].conflicts).toEqual(legacy[0].conflicts);
    expect(ranked[0].status).toBe(legacy[0].status);
    expect(ranked[0].candidates.slice(0, 2)).toEqual(legacy[0].candidates.slice(0, 2));
  });

  it('does not raise a description conflict or a suggestion from retrieval-only evidence', () => {
    // P1 keeps a corroborating (but not identical) description: an unrelated coded SKU is now its own conflict.
    const catalog = [prod('P1', 'Tornillo hexagonal 1/2', { codigo_barras: 'S-1' }), prod('P2', 'Tornillo')];
    const lines = [line(1, { codigoProveedor: 'S-1', descripcion: 'Tornillo hexagonal 1/2 pulgada', unidad: 'UND' })];
    const legacy = run(lines, catalog)[0];
    const ranked = run(lines, catalog, {
      hybridRanks: [{ lineIndex: 0, semantic: [entry('P2', 1)] }] as never,
    })[0];
    expect(legacy.conflicts).toEqual([]);
    expect(ranked.conflicts).toEqual([]);
    expect(ranked.status).toBe(legacy.status);
    expect(ranked.candidates.map((c) => c.codigoInterno)).toEqual(['P1', 'P2']);
  });
});

describe('matchInvoiceLines: audited battery line against the charger catalog rows', () => {
  const catalog = [
    prod('7453118025275', 'BATERIA 20V LITIO 24H CARGA ZASC'),
    prod('7453118025299', 'CARGADOR 2.0A 110V BATERIA 20V ZASC'),
    prod('CV-BC-75A', 'CARGADOR DE BATERIA COVO'),
    prod('CV-BAT-4AH', 'BATERIA O PILA 20V 4AMP COVO'),
    prod('00431', 'BATERIA RECARGABLE 20V / 20AH MARCA INGCO'),
  ];
  const batteryLine = () => [line(7, { codigoProveedor: 'Z-RXB-2-20V', descripcion: 'BATERIA 20V (LI-ION) 24HORAS DE CARGA', unidad: 'UND' })];
  const probe = (match: LineMatch) => ({
    ids: match.candidates.map((c) => c.codigoInterno),
    evidence: match.candidates.map((c) => c.evidence.map((e) => e.source)),
    status: match.status,
    conflicts: match.conflicts,
  });

  const entry = (codigoInterno: string, rank: number) => ({ codigoInterno, rank });
  const SCREENSHOT_ORDER = ['7453118025275', '7453118025299', 'CV-BC-75A', 'CV-BAT-4AH', '00431'];

  it('without retrieval ranks keeps only trigram-similar rows, battery first, and never suggests', () => {
    const match = run(batteryLine(), catalog)[0];
    expect(probe(match)).toEqual({
      ids: ['7453118025275', 'CV-BC-75A', '7453118025299'],
      evidence: [['descripcion'], ['descripcion'], ['descripcion']],
      status: 'review',
      conflicts: [],
    });
    expect(match.candidates.map((c) => c.similarity?.toFixed(2))).toEqual(['0.49', '0.37', '0.33']);
    expect(match.excluded).toEqual([]);
  });

  it('with the retrieval order seen in the audit it lists the five rows, retrieval-only rows carry no evidence', () => {
    const [match] = run(batteryLine(), catalog, {
      hybridRanks: [{ lineIndex: 0, lexical: SCREENSHOT_ORDER.map((sku, i) => entry(sku, i + 1)) }] as never,
    });
    expect(probe(match)).toEqual({
      ids: SCREENSHOT_ORDER,
      evidence: [['descripcion'], ['descripcion'], ['descripcion'], [], []],
      status: 'review',
      conflicts: [],
    });
  });

  it('lets a top retrieval rank put a low-similarity retrieval-only row first: order follows ranks, not similarity', () => {
    const [match] = run(batteryLine(), catalog, {
      hybridRanks: [{ lineIndex: 0, lexical: [entry('00431', 1), entry('7453118025275', 2)] }] as never,
    });
    expect(match.candidates.map((c) => c.codigoInterno)).toEqual(['00431', '7453118025275', 'CV-BC-75A', '7453118025299']);
    expect(match.candidates[0].evidence).toEqual([]);
    expect(match.status).toBe('review');
    expect(match.conflicts).toEqual([]);
  });

  it('never reports code evidence for the printed code, so no candidate can be recommended', () => {
    const [match] = run(batteryLine(), catalog, {
      hybridRanks: [{ lineIndex: 0, lexical: SCREENSHOT_ORDER.map((sku, i) => entry(sku, i + 1)) }] as never,
    });
    expect(match.candidates.every((c) => c.evidence.every((e) => e.source === 'descripcion'))).toBe(true);
    expect(match.status).not.toBe('suggested');
  });
});

describe('matchInvoiceLines: exact explicit measurements', () => {
  function single(printed: string, catalogText: string, over: Partial<ExtraidaLinea> = {}) {
    const [result] = run([line(1, { descripcion: printed, unidad: 'UND', ...over })], [prod('P1', catalogText)]);
    return result;
  }

  it.each([
    ['size', 'Nylon de pesca 0.5mm', 'Nylon de pesca 0.50mm'],
    ['size', 'Alambre 1.0m', 'Alambre 1m'],
    ['voltage', 'Fuente 12.0v', 'Fuente 12v'],
    ['power', 'Taladro 2.50w', 'Taladro 2.5w'],
  ])('keeps equivalent decimal spellings of a %s compatible', (_kind, printed, catalogText) => {
    const result = single(printed, catalogText);
    expect(result.excluded).toEqual([]);
    expect(result.candidates.map((c) => c.codigoInterno)).toEqual(['P1']);
    expect(result.candidates[0].unknownAttributes).toEqual([]);
  });

  it('still excludes a different decimal measurement', () => {
    const result = single('Nylon de pesca 0.5mm', 'Nylon de pesca 0.05mm');
    expect(result.candidates).toEqual([]);
    expect(result.excluded).toEqual([{ codigoInterno: 'P1', reasons: ['incompatible:size'] }]);
  });

  it('reads a length that is fused to a second measurement', () => {
    const different = single('Cinta metrica 7.5Mx25mm', 'Cinta metrica 5MX25MM');
    expect(different.candidates).toEqual([]);
    expect(different.excluded).toEqual([{ codigoInterno: 'P1', reasons: ['incompatible:size'] }]);

    const same = single('Cinta metrica 7.5Mx25mm', 'Cinta metrica 7.5MTSX25MM');
    expect(same.excluded).toEqual([]);
    expect(same.candidates[0].unknownAttributes).toEqual([]);
  });

  it('reads mt and mts glued to a number as meters', () => {
    const different = single('Tubo 3mts', 'Tubo 6m');
    expect(different.excluded).toEqual([{ codigoInterno: 'P1', reasons: ['incompatible:size'] }]);
    expect(single('Tubo 3mts', 'Tubo 3 m').candidates[0].unknownAttributes).toEqual([]);
  });

  it('still reads bare dimensions as unknown when only one operand has a unit', () => {
    const result = single('Tubo 4 X 3MTS', 'Tubo 6 X 3MTS');
    expect(result.excluded).toEqual([]);
    expect(result.candidates[0].unknownAttributes).toEqual([]);
  });

  it.each([
    ['28.66lb', '20lb'],
    ['13kg-28.66lb', '20lb'],
    ['13kg', '14kg'],
  ])('excludes a different weight in the same unit (%s vs %s)', (printed, catalogText) => {
    const result = single(`Nylon de pesca ${printed}`, `Nylon de pesca ${catalogText}`);
    expect(result.candidates).toEqual([]);
    expect(result.excluded).toEqual([{ codigoInterno: 'P1', reasons: ['incompatible:weight'] }]);
  });

  it.each([
    ['13kg', '20lb'],
    ['14 kg', 'sin peso'],
    ['14 kg', '14KG'],
  ])('never converts or guesses weight units (%s vs %s)', (printed, catalogText) => {
    const result = single(`Nylon de pesca ${printed}`, `Nylon de pesca ${catalogText}`);
    expect(result.excluded).toEqual([]);
    expect(result.candidates[0].unknownAttributes).toEqual([]);
  });

  it('excludes a different explicit torque and keeps the same one', () => {
    const different = single('Taladro 20v 55n.m', 'Taladro 20v 60nm');
    expect(different.excluded).toEqual([{ codigoInterno: 'P1', reasons: ['incompatible:torque'] }]);
    const same = single('Taladro 20v 55n.m', 'Taladro 20v 55NM');
    expect(same.excluded).toEqual([]);
    expect(same.candidates[0].unknownAttributes).toEqual([]);
  });

  it('does not read a bare N as torque', () => {
    const result = single('Taladro 20v 55n.m', 'Taladro 20v 60N super');
    expect(result.excluded).toEqual([]);
    expect(result.candidates.map((c) => c.codigoInterno)).toEqual(['P1']);
    expect(result.candidates[0].unknownAttributes).toEqual([]);
  });

  it('surfaces an exact-code conflict for a different same-unit weight', () => {
    const [result] = run(
      [line(1, { codigoProveedor: 'N-1', descripcion: 'Nylon de pesca 28.66lb', unidad: 'UND' })],
      [prod('P1', 'Nylon de pesca 20lb', { codigo_barras: 'N-1' })],
    );
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toEqual([{ code: 'code_attribute_incompatible', codigosInternos: ['P1'] }]);
  });
});

describe('matchInvoiceLines: exact code without description support', () => {
  const UNRELATED = prod('P1', 'Breaker thqc 1 x 30 voltage', { codigo_barras: '00626' });

  it('flags a code that only collides with an unrelated description and keeps the candidate', () => {
    const [result] = run(
      [line(1, { codigoProveedor: '00626', descripcion: 'Cajera de elect 2x4 plastica implasven', unidad: 'UND' })],
      [UNRELATED],
    );
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toEqual([{ code: 'code_description_conflict', codigosInternos: ['P1'] }]);
    expect(result.candidates.map((c) => c.codigoInterno)).toEqual(['P1']);
    expect(result.candidates[0].evidence.map((e) => e.source)).toEqual(['codigo_barras']);
    expect(result.candidates[0].similarity).toBeLessThan(0.3);
  });

  it('raises one description conflict, not two, when another SKU also outscores the code', () => {
    const [result] = run(
      [line(1, { codigoProveedor: '00626', descripcion: 'Cajera de elect 2x4 plastica', unidad: 'UND' })],
      [UNRELATED, prod('P2', 'Cajera de elect 2x4 plastica')],
    );
    expect(result.conflicts).toEqual([{ code: 'code_description_conflict', codigosInternos: ['P1', 'P2'] }]);
  });

  it('keeps an exact code with a corroborating description unflagged', () => {
    const [result] = run(
      [line(1, { codigoProveedor: '00626', descripcion: 'Breaker thqc 1 x 30', unidad: 'UND' })],
      [UNRELATED],
    );
    expect(result.conflicts).toEqual([]);
    expect(result.status).toBe('suggested');
  });

  it('keeps an exact code without a description at review with no conflict', () => {
    const [result] = run([line(1, { codigoProveedor: '00626', unidad: 'UND' })], [UNRELATED]);
    expect(result.conflicts).toEqual([]);
    expect(result.status).toBe('review');
  });

  it('does not second-guess a saved supplier alias', () => {
    const [result] = run(
      [line(1, { codigoProveedor: 'S-77', descripcion: 'Pintura latex blanco galon', unidad: 'UND' })],
      [prod('P1', SCREW)],
      { aliases: [alias()] },
    );
    expect(result.candidates[0].evidence.map((e) => e.source)).toContain('alias');
    expect(result.conflicts).toEqual([]);
  });
});

describe('matchInvoiceLines: printed code repeated as a bracket prefix', () => {
  const catalog = [prod('UID7118', 'Taladro de impacto 1/2 710W marca ingco')];
  const similarityOf = (code: string, text: string) =>
    run([line(1, { codigoProveedor: code, descripcion: text, unidad: 'UND' })], catalog)[0].candidates[0].similarity;

  it('ignores a leading bracket that repeats the printed code', () => {
    const plain = similarityOf('UID7118', 'Taladro de impacto 1/2 710W');
    expect(similarityOf('UID7118', '[UID7118] Taladro de impacto 1/2 710W')).toBe(plain);
    expect(similarityOf('UID7118', '[ uid7118 ] Taladro de impacto 1/2 710W')).toBe(plain);
  });

  it('keeps the printed code and description literal in the result', () => {
    const [result] = run([line(1, { codigoProveedor: 'UID7118', descripcion: '[UID7118] Taladro', unidad: 'UND' })], catalog);
    expect(result.codigoProveedor).toBe('UID7118');
  });

  it('does not strip a bracket that is not the printed code', () => {
    const stripped = similarityOf('UID7118', 'Taladro de impacto 1/2 710W');
    expect(similarityOf('UID7118', '[HWSP101] Taladro de impacto 1/2 710W')).toBeLessThan(stripped as number);
  });
});

describe('matchInvoiceLines: explicit electrical current configurations', () => {
  it('rejects 2X100AMP for a printed 3X100AMP even when both rank sources prefer it', () => {
    const rows = [
      prod('01536', 'CUCHILLA ELECTRICA 2 PASE 2X100AMP'),
      prod('01538', 'CUCHILLA ELECTRICA 2 PASE 3X100 AMP EXXEL'),
    ];
    const [result] = run(
      [line(1, { descripcion: 'CUCHILLA ELECTRICA 2 PASE 3X100 AMP EXXEL' })],
      rows,
      { hybridRanks: [{ lineIndex: 0,
        lexical: [{ codigoInterno: '01536', rank: 1 }, { codigoInterno: '01538', rank: 2 }],
        semantic: [{ codigoInterno: '01536', rank: 1 }, { codigoInterno: '01538', rank: 2 }],
      }] },
    );
    expect(result.candidates.map(candidate => candidate.codigoInterno)).toEqual(['01538']);
    expect(result.excluded).toEqual([{ codigoInterno: '01536', reasons: ['incompatible:amperage_configuration'] }]);
    expect(result.status).not.toBe('suggested');
  });

  it.each([['100A', '100 AMP'], ['0.50 amperios', '0.5amps'], ['3x100A', '3 X 100 AMP']])(
    'keeps explicit equivalent electrical spellings (%s / %s)', (printed, current) => {
      const [result] = run([line(1, { descripcion: `Interruptor electrico ${printed}` })],
        [prod('P1', `Interruptor electrico ${current}`)]);
      expect(result.excluded).toEqual([]);
      expect(result.candidates.map(candidate => candidate.codigoInterno)).toEqual(['P1']);
    },
  );

  it('rejects differing explicitly stated ampere ratings even for a direct code', () => {
    const [result] = run([line(1, { codigoProveedor: 'P1', descripcion: 'Interruptor electrico 125AMP' })],
      [prod('P1', 'Interruptor electrico 100A')]);
    expect(result.candidates).toEqual([]);
    expect(result.excluded).toEqual([{ codigoInterno: 'P1', reasons: ['incompatible:amperage'] }]);
    expect(result.conflicts).toContainEqual({ code: 'code_attribute_incompatible', codigosInternos: ['P1'] });
  });

  it('does not infer a missing configuration or an ampere rating from a model token', () => {
    const [unknown] = run([line(1, { descripcion: 'Interruptor electrico 3X100AMP' })],
      [prod('P1', 'Interruptor electrico 100A')]);
    expect(unknown.excluded).toEqual([]);
    expect(unknown.candidates[0].unknownAttributes).toContain('amperage_configuration');
    const [model] = run([line(1, { descripcion: 'Interruptor modelo M100A' })],
      [prod('P1', 'Interruptor modelo M125A')]);
    expect(model.excluded).toEqual([]);
  });
});

describe('matchInvoiceLines: amperage does not interpret plumbing prepositions', () => {
  it('keeps the real elbow when A/N appears beside different positionally printed numbers', () => {
    const [result] = run([line(1, { descripcion: 'CODO 3 A/N 45' })],
      [prod('01432', 'CODO 3 de 45 A/N')]);
    expect(result.candidates.map(candidate => candidate.codigoInterno)).toEqual(['01432']);
    expect(result.excluded).toEqual([]);
    expect(result.candidates[0].unknownAttributes).not.toContain('amperage');
  });

  it('preserves a corroborated exact bushing code without inventing amperage from a range', () => {
    const [result] = run([line(1, { codigoProveedor: '00753',
      descripcion: 'BUSHING GALVANIZADO 1 X 1/2 PH-M12', unidad: 'UND' })],
      [prod('00753', 'BUSHING GALVANIZADO 1 A 1/2 PH-M12', { unidad: 'UND' })]);
    expect(result.candidates.map(candidate => candidate.codigoInterno)).toEqual(['00753']);
    expect(result.candidates[0].unknownAttributes).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.status).toBe('suggested');
  });

  it.each(['1/2 A.F', '1/2A.F', '1/2A .F', '3A/N', '3A /N', '3 A/N', '1 A 1/2', '32 A 55'])(
    'does not parse the non-electrical spelling %s as amperes', (label) => {
      const [result] = run([line(1, { descripcion: `Pieza de plomeria ${label}` })],
        [prod('P1', 'Pieza de plomeria')]);
      expect(result.excluded).toEqual([]);
      expect(result.candidates[0].unknownAttributes).not.toContain('amperage');
      expect(result.candidates[0].unknownAttributes).not.toContain('amperage_configuration');
    },
  );

  it('keeps a separated A ambiguous instead of guessing between a preposition and an ampere unit', () => {
    const [result] = run([line(1, { descripcion: 'Pieza 100 A' })],
      [prod('P1', 'Pieza 125 A')]);
    expect(result.excluded).toEqual([]);
    expect(result.candidates[0].unknownAttributes).not.toContain('amperage');
  });
});


describe('absent identifiers and candidate support', () => {
  it('ignores the exact sentinel in printed codes, catalog barcodes and aliases without dropping products', () => {
    const catalog = ['A', 'B', 'C'].map(id => prod(id, 'Adhesivo blanco', { codigo_barras: 'SIN_CODIGO' }));
    const lines = [line(1, { codigoProveedor: ' sin_codigo ', descripcion: 'Adhesivo blanco', unidad: 'UND' })];
    const aliases = [alias({ keyValue: 'SIN_CODIGO', codigoInterno: 'A' })];
    const before = JSON.stringify({ lines, catalog, aliases });
    const result = run(lines, catalog, { aliases })[0];
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every(c => c.evidence.every(e => e.source === 'descripcion'))).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.status).toBe('review');
    expect(JSON.stringify({ lines, catalog, aliases })).toBe(before);
    expect(run([line(1, { codigoProveedor: 'A' })], catalog)[0].candidates[0].evidence).toContainEqual({ source: 'codigo_interno', similarity: null });
  });

  it.each(['A-SINK1919', 'A-SINK3319', 'A-SINK3319-BK', 'SINCODIGO', 'SIN_ CODIGO', '001-A/2'])('keeps literal non-sentinel identifiers: %s', code => {
    expect(isAbsentIdentifier(code)).toBe(false);
    expect(run([line(1, { codigoProveedor: code })], [prod(code, 'Adhesivo')])[0].candidates[0].codigoInterno).toBe(code);
  });

  it.each([null, undefined, '', '  ', 'SIN_CODIGO', ' sin_codigo '])('recognizes only missing or exact trim/case sentinel values: %s', code => {
    expect(isAbsentIdentifier(code)).toBe(true);
  });

  it('derives typed support, per-SKU conflicts and unknowns without changing the match', () => {
    const match = run([line(1, { codigoProveedor: 'A', descripcion: 'Adhesivo blanco', unidad: 'UND' })], [prod('A', 'Adhesivo blanco')])[0];
    const coded = match.candidates[0];
    const fuzzy = { ...coded, evidence: [{ source: 'descripcion' as const, similarity: 0.5 }], unknownAttributes: ['size', 'unit'] };
    const retrieved = { ...fuzzy, evidence: [] };
    const conflicted = { ...match, conflicts: [{ code: 'alias_vs_code' as const, codigosInternos: ['A'] }] };
    const before = JSON.stringify({ coded, fuzzy, retrieved, conflicted });
    expect(describeCandidateSupport(coded, match)).toEqual({ identifiers: ['codigo_interno'], support: 'codigo_coincidente', unknowns: [] });
    expect(describeCandidateSupport(fuzzy, match)).toEqual({ identifiers: [], support: 'pista_descripcion', unknowns: ['size', 'unit'] });
    expect(describeCandidateSupport(retrieved, match).support).toBe('pista_busqueda');
    expect(describeCandidateSupport(coded, conflicted).support).toBe('en_conflicto');
    expect(describeCandidateSupport({ ...coded, codigoInterno: 'B' }, conflicted).support).toBe('codigo_coincidente');
    expect(describeCandidateSupport({ ...coded, evidence: [{ source: 'alias', similarity: null }] }, match).identifiers).toEqual(['alias']);
    expect(JSON.stringify({ coded, fuzzy, retrieved, conflicted })).toBe(before);
  });
});
