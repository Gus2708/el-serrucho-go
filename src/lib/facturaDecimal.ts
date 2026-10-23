// Exact decimal arithmetic for supplier-invoice review.
//
// Values are sign + base-1e7 integer limbs + decimal scale. Every limb operation keeps
// intermediate products below 2^53 (1e14 + carries), so results are exact for any length
// and no monetary value ever passes through binary floating point. BigInt is deliberately
// not used: this tree has no official evidence that the pinned Hermes build ships it.
// Nothing here rounds unless the caller passes an explicit rounding mode.

const LIMB_DIGITS = 7;
const LIMB_BASE = 10_000_000;
const MAX_INPUT_LENGTH = 400;
const DEFAULT_DIVISION_DIGITS = 12;

type Magnitude = readonly number[];

export interface Decimal {
  readonly neg: boolean;
  readonly mag: Magnitude;
  readonly scale: number;
}

export type RoundingMode = 'half_up' | 'truncate';

function trim(limbs: number[]): number[] {
  while (limbs.length > 0 && limbs[limbs.length - 1] === 0) limbs.pop();
  return limbs;
}

function magFromDigits(digits: string): number[] {
  const limbs: number[] = [];
  for (let end = digits.length; end > 0; end -= LIMB_DIGITS) {
    limbs.push(Number(digits.slice(Math.max(0, end - LIMB_DIGITS), end)));
  }
  return trim(limbs);
}

function magToString(mag: Magnitude): string {
  if (mag.length === 0) return '0';
  let out = String(mag[mag.length - 1]);
  for (let i = mag.length - 2; i >= 0; i -= 1) out += String(mag[i]).padStart(LIMB_DIGITS, '0');
  return out;
}

function magCmp(a: Magnitude, b: Magnitude): -1 | 0 | 1 {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function magAdd(a: Magnitude, b: Magnitude): number[] {
  const out: number[] = [];
  let carry = 0;
  for (let i = 0; i < Math.max(a.length, b.length) || carry > 0; i += 1) {
    const sum = (a[i] ?? 0) + (b[i] ?? 0) + carry;
    out.push(sum % LIMB_BASE);
    carry = sum >= LIMB_BASE ? 1 : 0;
  }
  return out;
}

// Requires a >= b.
function magSub(a: Magnitude, b: Magnitude): number[] {
  const out: number[] = [];
  let borrow = 0;
  for (let i = 0; i < a.length; i += 1) {
    let diff = a[i] - (b[i] ?? 0) - borrow;
    borrow = diff < 0 ? 1 : 0;
    if (diff < 0) diff += LIMB_BASE;
    out.push(diff);
  }
  return trim(out);
}

function magMulSmall(a: Magnitude, n: number): number[] {
  if (n === 0 || a.length === 0) return [];
  const out: number[] = [];
  let carry = 0;
  for (let i = 0; i < a.length || carry > 0; i += 1) {
    const cur = (a[i] ?? 0) * n + carry;
    out.push(cur % LIMB_BASE);
    carry = Math.floor(cur / LIMB_BASE);
  }
  return out;
}

function magMul(a: Magnitude, b: Magnitude): number[] {
  if (a.length === 0 || b.length === 0) return [];
  const out = new Array<number>(a.length + b.length).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    let carry = 0;
    for (let j = 0; j < b.length || carry > 0; j += 1) {
      const cur = out[i + j] + a[i] * (b[j] ?? 0) + carry;
      out[i + j] = cur % LIMB_BASE;
      carry = Math.floor(cur / LIMB_BASE);
    }
  }
  return trim(out);
}

function magPow10(exponent: number): number[] {
  const limbs = new Array<number>(Math.floor(exponent / LIMB_DIGITS)).fill(0);
  limbs.push(10 ** (exponent % LIMB_DIGITS));
  return limbs;
}

function magDivMod(a: Magnitude, b: Magnitude): [number[], number[]] {
  if (magCmp(a, b) < 0) return [[], [...a]];
  const quotient = new Array<number>(a.length).fill(0);
  let rem: number[] = [];
  for (let i = a.length - 1; i >= 0; i -= 1) {
    rem = trim([a[i], ...rem]);
    if (magCmp(rem, b) < 0) continue;
    let lo = 1;
    let hi = LIMB_BASE - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (magCmp(magMulSmall(b, mid), rem) <= 0) lo = mid;
      else hi = mid - 1;
    }
    rem = magSub(rem, magMulSmall(b, lo));
    quotient[i] = lo;
  }
  return [trim(quotient), rem];
}

function make(neg: boolean, mag: Magnitude, scale: number): Decimal {
  return { neg: mag.length > 0 && neg, mag, scale };
}

function toScale(d: Decimal, scale: number): Magnitude {
  return scale === d.scale ? d.mag : magMul(d.mag, magPow10(scale - d.scale));
}

/** Strict canonical input only: optional minus, digits, optional dot fraction. No comma, space or exponent. */
export function parseDecimal(text: string): Decimal | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_INPUT_LENGTH) return null;
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? '';
  return make(match[1] === '-', magFromDigits(match[2] + fraction), fraction.length);
}

/** Shortest plain string, with at least `minScale` decimals. */
export function toDecimalString(d: Decimal, minScale = 0): string {
  const digits = magToString(d.mag).padStart(d.scale + 1, '0');
  const integer = digits.slice(0, digits.length - d.scale);
  let fraction = d.scale > 0 ? digits.slice(digits.length - d.scale) : '';
  while (fraction.length > minScale && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  fraction = fraction.padEnd(minScale, '0');
  return `${d.neg ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

/** Fixed-scale string, or null when the value needs more decimals than `scale` (never rounds). */
export function toFixedExact(d: Decimal, scale: number): string | null {
  const text = toDecimalString(d, scale);
  const dot = text.indexOf('.');
  return dot !== -1 && text.length - dot - 1 > scale ? null : text;
}

export function isZeroDecimal(d: Decimal): boolean {
  return d.mag.length === 0;
}

export function negDecimal(d: Decimal): Decimal {
  return make(!d.neg, d.mag, d.scale);
}

export function absDecimal(d: Decimal): Decimal {
  return make(false, d.mag, d.scale);
}

export function cmpDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  if (a.neg !== b.neg) return a.neg ? -1 : 1;
  const scale = Math.max(a.scale, b.scale);
  const result = magCmp(toScale(a, scale), toScale(b, scale));
  return a.neg ? (-result as -1 | 0 | 1) : result;
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  const x = toScale(a, scale);
  const y = toScale(b, scale);
  if (a.neg === b.neg) return make(a.neg, magAdd(x, y), scale);
  return magCmp(x, y) >= 0 ? make(a.neg, magSub(x, y), scale) : make(b.neg, magSub(y, x), scale);
}

export function subDecimal(a: Decimal, b: Decimal): Decimal {
  return addDecimal(a, negDecimal(b));
}

export function mulDecimal(a: Decimal, b: Decimal): Decimal {
  return make(a.neg !== b.neg, magMul(a.mag, b.mag), a.scale + b.scale);
}

/** Divides by 10^exponent exactly (moves the decimal point). */
export function scaleDownPow10(d: Decimal, exponent: number): Decimal {
  return make(d.neg, d.mag, d.scale + exponent);
}

/**
 * a / b only when the quotient terminates within `maxDigits` extra decimals;
 * null for division by zero or a non-terminating quotient (e.g. 1/3). Never rounds.
 */
export function divExactDecimal(a: Decimal, b: Decimal, maxDigits = DEFAULT_DIVISION_DIGITS): Decimal | null {
  if (isZeroDecimal(b)) return null;
  let [quotient, rem] = magDivMod(a.mag, b.mag);
  let digits = 0;
  while (rem.length > 0 && digits < maxDigits) {
    const [digit, next] = magDivMod(magMulSmall(rem, 10), b.mag);
    quotient = magAdd(magMulSmall(quotient, 10), digit);
    rem = next;
    digits += 1;
  }
  if (rem.length > 0) return null;
  const scale = a.scale - b.scale + digits;
  const neg = a.neg !== b.neg;
  return scale >= 0 ? make(neg, trim(quotient), scale) : make(neg, magMul(quotient, magPow10(-scale)), 0);
}

/** Rounds the magnitude to `scale` decimals. Only for explicit, injected policies. */
export function roundDecimal(d: Decimal, scale: number, mode: RoundingMode): Decimal {
  if (d.scale <= scale) return d;
  const divisor = magPow10(d.scale - scale);
  const [quotient, rem] = magDivMod(d.mag, divisor);
  const up = mode === 'half_up' && magCmp(magMulSmall(rem, 2), divisor) >= 0;
  return make(d.neg, up ? magAdd(quotient, [1]) : quotient, scale);
}

function toUnits(d: Decimal, scale: number): number[] | null {
  if (d.scale <= scale) return [...toScale(d, scale)];
  const [quotient, rem] = magDivMod(d.mag, magPow10(d.scale - scale));
  return rem.length === 0 ? quotient : null;
}

export interface AllocationBase {
  readonly id: string;
  readonly base: Decimal;
}

export interface AllocationShare {
  readonly id: string;
  readonly share: Decimal;
}

/**
 * Splits a non-negative `total` proportionally to the bases in whole units of 10^-scale.
 * Floors every share, then hands the leftover units to the largest remainders; equal
 * remainders go to the smallest id. The shares always add up to `total`. Returns null
 * when the total is not representable at `scale`, a base is negative, ids repeat or
 * every base is zero. Share order follows the input order.
 */
export function allocateLargestRemainder(input: {
  readonly total: Decimal;
  readonly bases: readonly AllocationBase[];
  readonly scale: number;
}): AllocationShare[] | null {
  const { total, bases, scale } = input;
  if (total.neg || bases.length === 0 || new Set(bases.map(item => item.id)).size !== bases.length) return null;
  if (bases.some(item => item.base.neg)) return null;
  const totalUnits = toUnits(total, scale);
  if (!totalUnits) return null;

  const common = Math.max(...bases.map(item => item.base.scale));
  const weights = bases.map(item => toScale(item.base, common));
  const weightSum = weights.reduce<number[]>((acc, weight) => magAdd(acc, weight), []);
  if (weightSum.length === 0) return null;

  const parts = weights.map(weight => magDivMod(magMul(totalUnits, weight), weightSum));
  const assigned = parts.reduce<number[]>((acc, [floor]) => magAdd(acc, floor), []);
  const leftover = Number(magToString(magSub(totalUnits, assigned)));

  const order = bases
    .map((item, index) => ({ id: item.id, index }))
    .sort((x, y) => magCmp(parts[y.index][1], parts[x.index][1]) || (x.id < y.id ? -1 : 1));
  const extra = new Set(order.slice(0, leftover).map(item => item.index));

  return bases.map((item, index) => ({
    id: item.id,
    share: make(false, extra.has(index) ? magAdd(parts[index][0], [1]) : parts[index][0], scale),
  }));
}
