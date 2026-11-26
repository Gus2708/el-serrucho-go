import {
  cmpDecimal,
  mulDecimal,
  parseDecimal,
  roundDecimal,
  scaleDownPow10,
  subDecimal,
  toDecimalString,
  type Decimal,
} from './facturaDecimal';

export const MAX_DESCUENTO_STEPS = 6;

const ZERO = parseDecimal('0') as Decimal;
const ONE = parseDecimal('1') as Decimal;
const HUNDRED = parseDecimal('100') as Decimal;

export interface ResultadoDescuentoCompra {
  costoLista: number;
  descuentosAplicados: number[];
  tieneDescuento: boolean;
  costoNetoExactoStr: string;
  costoNeto: number;
  costoNetoStr: string;
  fueRedondeado: boolean;
  porcentajeEfectivo: number;
  porcentajeEfectivoStr: string;
  ahorroUnitario: number;
}

function numberToDecimal(value: number): Decimal | null {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return ZERO;

  const raw = String(value);
  if (!/[eE]/.test(raw)) {
    return parseDecimal(raw);
  }

  const [mantissa, expText] = raw.toLowerCase().split('e');
  const exponent = Number(expText);
  if (!Number.isInteger(exponent)) return null;

  const [intPart, fracPart = ''] = mantissa.split('.');
  const digits = `${intPart}${fracPart}`.replace(/^0+/, '') || '0';
  if (digits === '0') return ZERO;

  const scale = fracPart.length - exponent;
  if (scale <= 0) {
    return parseDecimal(`${digits}${'0'.repeat(-scale)}`);
  }
  if (digits.length <= scale) {
    return parseDecimal(`0.${'0'.repeat(scale - digits.length)}${digits}`);
  }
  const splitAt = digits.length - scale;
  return parseDecimal(`${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`);
}

/**
 * Normalizes a list of percentage discounts, keeping finite values strictly in (0, 100)
 * up to MAX_DESCUENTO_STEPS. Safe for untrusted JSONB payloads from Supabase.
 */
export function normalizarDescuentos(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const result: number[] = [];
  for (const entry of raw) {
    const num = typeof entry === 'number' ? entry : typeof entry === 'string' ? Number(entry.trim()) : NaN;
    if (Number.isFinite(num) && num > 0 && num < 100) {
      result.push(num);
      if (result.length >= MAX_DESCUENTO_STEPS) break;
    }
  }
  return result;
}

/**
 * Combines item-level discounts and purchase-wide general discounts (unless excluded).
 * Percentage multiplication is commutative, so chaining preserves exact math regardless of order.
 */
export function resolverDescuentosEfectivos(
  itemDescuentos: readonly number[] | null | undefined,
  generalDescuentos: readonly number[] | null | undefined,
  excluirGeneral = false,
): number[] {
  const itemSteps = normalizarDescuentos(itemDescuentos);
  const generalSteps = excluirGeneral ? [] : normalizarDescuentos(generalDescuentos);
  return [...itemSteps, ...generalSteps].slice(0, MAX_DESCUENTO_STEPS * 2);
}

/**
 * Computes the effective combined percentage for a list of cascaded percentages
 * (e.g. [20, 5] -> 24%, [20, 5, 3] -> 26.28%).
 */
export function calcularPorcentajeEfectivo(descuentos: readonly number[]): {
  porcentajeEfectivo: number;
  porcentajeEfectivoStr: string;
} {
  const normalized = normalizarDescuentos(descuentos);
  if (normalized.length === 0) {
    return { porcentajeEfectivo: 0, porcentajeEfectivoStr: '0' };
  }

  let factor = ONE;
  for (const pct of normalized) {
    const pctDec = numberToDecimal(pct);
    if (!pctDec) continue;
    const multiplier = scaleDownPow10(subDecimal(HUNDRED, pctDec), 2);
    factor = mulDecimal(factor, multiplier);
  }

  const effectiveDec = mulDecimal(subDecimal(ONE, factor), HUNDRED);
  const displayDec = effectiveDec.scale > 2 ? roundDecimal(effectiveDec, 2, 'half_up') : effectiveDec;
  const porcentajeEfectivoStr = toDecimalString(displayDec, 0);
  return {
    porcentajeEfectivo: Number(porcentajeEfectivoStr),
    porcentajeEfectivoStr,
  };
}

/**
 * Applies chained percentage discounts using exact base-1e7 decimal arithmetic
 * (`facturaDecimal.ts`), rounding half-up to 2 decimals only when discounts apply
 * so the resulting cost matches HybridLite's 2-decimal cost field.
 */
export function calcularCostoConDescuento(
  costoLista: number,
  descuentosEfectivos: readonly number[],
): ResultadoDescuentoCompra {
  const safeCostoLista = Number.isFinite(costoLista) && costoLista > 0 ? costoLista : 0;
  const costoListaDec = numberToDecimal(safeCostoLista) ?? ZERO;
  const descuentos = normalizarDescuentos(descuentosEfectivos);

  if (descuentos.length === 0 || safeCostoLista <= 0) {
    const baseStr = toDecimalString(costoListaDec, 2);
    return {
      costoLista: safeCostoLista,
      descuentosAplicados: [],
      tieneDescuento: false,
      costoNetoExactoStr: baseStr,
      costoNeto: safeCostoLista,
      costoNetoStr: baseStr,
      fueRedondeado: false,
      porcentajeEfectivo: 0,
      porcentajeEfectivoStr: '0',
      ahorroUnitario: 0,
    };
  }

  let factor = ONE;
  for (const pct of descuentos) {
    const pctDec = numberToDecimal(pct);
    if (!pctDec) continue;
    const multiplier = scaleDownPow10(subDecimal(HUNDRED, pctDec), 2);
    factor = mulDecimal(factor, multiplier);
  }

  const costoExacto = mulDecimal(costoListaDec, factor);
  const costoRedondeado = roundDecimal(costoExacto, 2, 'half_up');
  const fueRedondeado = cmpDecimal(costoExacto, costoRedondeado) !== 0;

  const effectiveDec = mulDecimal(subDecimal(ONE, factor), HUNDRED);
  const effectiveDisplayDec = effectiveDec.scale > 2 ? roundDecimal(effectiveDec, 2, 'half_up') : effectiveDec;
  const porcentajeEfectivoStr = toDecimalString(effectiveDisplayDec, 0);

  const ahorroDec = subDecimal(costoListaDec, costoRedondeado);
  const ahorroUnitario = cmpDecimal(ahorroDec, ZERO) > 0 ? Number(toDecimalString(ahorroDec, 2)) : 0;

  const costoNetoExactoStr = toDecimalString(costoExacto, 2);
  const costoNetoStr = toDecimalString(costoRedondeado, 2);

  return {
    costoLista: safeCostoLista,
    descuentosAplicados: descuentos,
    tieneDescuento: true,
    costoNetoExactoStr,
    costoNeto: Number(costoNetoStr),
    costoNetoStr,
    fueRedondeado,
    porcentajeEfectivo: Number(porcentajeEfectivoStr),
    porcentajeEfectivoStr,
    ahorroUnitario,
  };
}

/**
 * Parses typed discount text supporting commas, optional `%`, and `+` cascades
 * (e.g. `"20+5"` commits `[20]` and leaves `"5"` as active draft).
 */
export function parseDescuentoTexto(raw: string): {
  committed: number[];
  draft: string;
  draftValue: number | null;
  error: string | null;
} {
  const cleaned = raw.replace(/%/g, '').replace(/,/g, '.').replace(/\s+/g, '');

  if (cleaned.includes('+')) {
    const parts = cleaned.split('+');
    const leading = parts.slice(0, -1);
    const trailing = parts[parts.length - 1] ?? '';
    const committed: number[] = [];

    for (const seg of leading) {
      if (seg === '') continue;
      if (!/^\d+(\.\d+)?$/.test(seg)) {
        return { committed: [], draft: cleaned, draftValue: null, error: 'Descuento inválido' };
      }
      const n = Number(seg);
      if (!Number.isFinite(n) || n <= 0) {
        return { committed: [], draft: cleaned, draftValue: null, error: 'Descuento inválido' };
      }
      if (n >= 100) {
        return { committed: [], draft: cleaned, draftValue: null, error: 'Debe ser menor a 100%' };
      }
      if (committed.length < MAX_DESCUENTO_STEPS) {
        committed.push(n);
      }
    }

    const parsedTrailing = parseSingleDraft(trailing);
    return {
      committed,
      draft: trailing,
      draftValue: parsedTrailing.draftValue,
      error: parsedTrailing.error,
    };
  }

  const parsed = parseSingleDraft(cleaned);
  return {
    committed: [],
    draft: cleaned,
    draftValue: parsed.draftValue,
    error: parsed.error,
  };
}

function parseSingleDraft(text: string): { draftValue: number | null; error: string | null } {
  if (text === '') {
    return { draftValue: null, error: null };
  }
  if (/^\d+\.$/.test(text) || text === '.') {
    const partial = text === '.' ? 0 : Number(text.slice(0, -1));
    if (partial >= 100) {
      return { draftValue: null, error: 'Debe ser menor a 100%' };
    }
    if (partial > 0) {
      return { draftValue: partial, error: null };
    }
    return { draftValue: null, error: null };
  }
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(text)) {
    return { draftValue: null, error: 'Descuento inválido' };
  }
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) {
    return { draftValue: null, error: 'Descuento inválido' };
  }
  if (n === 0) {
    return { draftValue: null, error: null };
  }
  if (n >= 100) {
    return { draftValue: null, error: 'Debe ser menor a 100%' };
  }
  return { draftValue: n, error: null };
}

export function formatearCascada(descuentos: readonly number[]): string {
  const normalized = normalizarDescuentos(descuentos);
  return normalized.map(d => `${d}%`).join(' + ');
}

export function descuentosIguales(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Detects Postgres/PostgREST missing-column errors so the app can fall back cleanly
 * if migration 053 has not yet been applied to the Supabase database.
 */
export function isMissingDiscountColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  const text = [err.message, err.details, err.hint]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');

  if (code === '42703' || code === 'PGRST204') {
    return true;
  }
  return /descuentos_generales|costo_lista|excluir_descuento_general|\bdescuentos\b/i.test(text) &&
    /column|schema cache|does not exist/i.test(text);
}
