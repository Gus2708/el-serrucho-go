import {
  absDecimal,
  addDecimal,
  allocateLargestRemainder,
  cmpDecimal,
  divExactDecimal,
  isZeroDecimal,
  mulDecimal,
  negDecimal,
  parseDecimal,
  roundDecimal,
  scaleDownPow10,
  subDecimal,
  toDecimalString,
  toFixedExact,
  type Decimal,
} from './facturaDecimal';

function d(text: string): Decimal {
  const parsed = parseDecimal(text);
  if (!parsed) throw new Error(`fixture is not a decimal: ${text}`);
  return parsed;
}

const show = (value: Decimal | null): string | null => (value ? toDecimalString(value) : null);

describe('facturaDecimal', () => {
  describe('parse and format', () => {
    it.each([
      ['0', '0'],
      ['007', '7'],
      ['1.50', '1.5'],
      ['-0.0', '0'],
      ['-2.250', '-2.25'],
      ['123456789012345678901234567890.000000000000000000000001', '123456789012345678901234567890.000000000000000000000001'],
    ])('parses %s as %s', (input, expected) => {
      expect(show(parseDecimal(input))).toBe(expected);
    });

    it.each(['', ' 1', '1 ', '1,5', '1e3', '.5', '5.', '--1', '+1', 'abc', '1.2.3', '١٢٣', 'Infinity', 'NaN'])(
      'rejects %j',
      input => {
        expect(parseDecimal(input)).toBeNull();
      }
    );

    it('rejects absurdly long input instead of looping', () => {
      expect(parseDecimal('1'.repeat(500))).toBeNull();
    });

    it('formats with a minimum scale and exact fixed scale', () => {
      expect(toDecimalString(d('7.6'), 2)).toBe('7.60');
      expect(toDecimalString(d('7'), 2)).toBe('7.00');
      expect(toFixedExact(d('7.60'), 2)).toBe('7.60');
      expect(toFixedExact(d('7.6000'), 2)).toBe('7.60');
      expect(toFixedExact(d('7.372'), 2)).toBeNull();
      expect(toFixedExact(d('-0.5'), 3)).toBe('-0.500');
    });
  });

  describe('exact arithmetic', () => {
    it('adds 0.1 and 0.2 to exactly 0.3', () => {
      expect(show(addDecimal(d('0.1'), d('0.2')))).toBe('0.3');
      expect(cmpDecimal(addDecimal(d('0.1'), d('0.2')), d('0.3'))).toBe(0);
    });

    it('subtracts across signs and scales', () => {
      expect(show(subDecimal(d('1'), d('0.0001')))).toBe('0.9999');
      expect(show(subDecimal(d('0.1'), d('0.3')))).toBe('-0.2');
      expect(show(subDecimal(d('-1.5'), d('-1.5')))).toBe('0');
      expect(show(addDecimal(d('-1.5'), d('0.5')))).toBe('-1');
      expect(show(negDecimal(d('2.5')))).toBe('-2.5');
      expect(show(absDecimal(d('-2.5')))).toBe('2.5');
      expect(show(negDecimal(d('0')))).toBe('0');
    });

    it('multiplies without binary floating point drift', () => {
      expect(show(mulDecimal(d('0.1'), d('0.2')))).toBe('0.02');
      expect(show(mulDecimal(d('1.1'), d('1.1')))).toBe('1.21');
      expect(show(mulDecimal(d('-3'), d('0.5')))).toBe('-1.5');
      expect(show(mulDecimal(d('0'), d('-5')))).toBe('0');
      expect(show(mulDecimal(d('99999999999'), d('99999999999')))).toBe('9999999999800000000001');
    });

    it('chains the ordered discounts 10 x 0.80 x 0.95 = 7.60, then x 0.97 = 7.372', () => {
      const step = (amount: Decimal, pct: string) => scaleDownPow10(mulDecimal(amount, subDecimal(d('100'), d(pct))), 2);
      const first = step(step(d('10'), '20'), '5');
      expect(toDecimalString(first, 2)).toBe('7.60');
      expect(show(step(first, '3'))).toBe('7.372');
    });

    it('compares and detects zero', () => {
      expect(cmpDecimal(d('1.0'), d('1'))).toBe(0);
      expect(cmpDecimal(d('1.01'), d('1'))).toBe(1);
      expect(cmpDecimal(d('-1'), d('0.0001'))).toBe(-1);
      expect(cmpDecimal(d('-2'), d('-1'))).toBe(-1);
      expect(isZeroDecimal(d('0.000'))).toBe(true);
      expect(isZeroDecimal(d('0.001'))).toBe(false);
    });

    it('matches BigInt on deterministic wide operands (oracle only, not used by the module)', () => {
      let seed = 12345;
      const next = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed;
      };
      const randomDigits = (length: number) => {
        let out = String(1 + (next() % 9));
        while (out.length < length) out += String(next() % 10);
        return out;
      };
      for (let i = 0; i < 60; i += 1) {
        const a = randomDigits(1 + (next() % 40));
        const b = randomDigits(1 + (next() % 40));
        const product = (BigInt(a) * BigInt(b)).toString();
        expect(show(mulDecimal(d(a), d(b)))).toBe(product);
        expect(show(addDecimal(d(a), d(b)))).toBe((BigInt(a) + BigInt(b)).toString());
        const big = BigInt(a) > BigInt(b) ? [a, b] : [b, a];
        expect(show(subDecimal(d(big[0]), d(big[1])))).toBe((BigInt(big[0]) - BigInt(big[1])).toString());
        const quotient = divExactDecimal(d(product), d(b));
        expect(show(quotient)).toBe(a);
      }
    });
  });

  describe('exact division', () => {
    it('divides terminating quotients exactly', () => {
      expect(show(divExactDecimal(d('24'), d('12')))).toBe('2');
      expect(show(divExactDecimal(d('1'), d('8')))).toBe('0.125');
      expect(show(divExactDecimal(d('116'), d('1.16')))).toBe('100');
      expect(show(divExactDecimal(d('-9'), d('4')))).toBe('-2.25');
      expect(show(divExactDecimal(d('0'), d('7')))).toBe('0');
    });

    it('returns null for a non terminating quotient instead of rounding', () => {
      expect(divExactDecimal(d('1'), d('3'))).toBeNull();
      expect(divExactDecimal(d('10'), d('3'))).toBeNull();
      expect(divExactDecimal(d('1'), d('7'))).toBeNull();
    });

    it('returns null for division by zero', () => {
      expect(divExactDecimal(d('1'), d('0'))).toBeNull();
    });

    it('stops at the digit limit', () => {
      expect(show(divExactDecimal(d('1'), d('1024'), 10))).toBe('0.0009765625');
      expect(divExactDecimal(d('1'), d('1024'), 9)).toBeNull();
    });
  });

  describe('rounding (only for explicit, injected policies)', () => {
    it('rounds half up and truncates by magnitude', () => {
      expect(show(roundDecimal(d('0.1234'), 2, 'half_up'))).toBe('0.12');
      expect(show(roundDecimal(d('0.125'), 2, 'half_up'))).toBe('0.13');
      expect(show(roundDecimal(d('-0.125'), 2, 'half_up'))).toBe('-0.13');
      expect(show(roundDecimal(d('0.129'), 2, 'truncate'))).toBe('0.12');
      expect(show(roundDecimal(d('7'), 2, 'half_up'))).toBe('7');
      expect(show(roundDecimal(d('999.999'), 2, 'half_up'))).toBe('1000');
    });

    it('shows the 0.1234 x 1000 versus 0.12 x 1000 difference of 3.40', () => {
      const exact = mulDecimal(d('0.1234'), d('1000'));
      const quantized = mulDecimal(roundDecimal(d('0.1234'), 2, 'half_up'), d('1000'));
      expect(toDecimalString(exact, 2)).toBe('123.40');
      expect(toDecimalString(quantized, 2)).toBe('120.00');
      expect(toDecimalString(subDecimal(exact, quantized), 2)).toBe('3.40');
    });
  });

  describe('largest remainder allocation', () => {
    const base = (id: string, value: string) => ({ id, base: d(value) });

    it('spreads 0.10 over three equal bases as 0.04 / 0.03 / 0.03 by stable ID order', () => {
      const result = allocateLargestRemainder({
        total: d('0.10'),
        scale: 2,
        bases: [base('b-line', '10'), base('c-line', '10'), base('a-line', '10')],
      });
      expect(result).not.toBeNull();
      const byId = Object.fromEntries((result ?? []).map(share => [share.id, toDecimalString(share.share, 2)]));
      expect(byId).toEqual({ 'a-line': '0.04', 'b-line': '0.03', 'c-line': '0.03' });
    });

    it('conserves the total and keeps input order in the result', () => {
      const result = allocateLargestRemainder({
        total: d('1.00'),
        scale: 2,
        bases: [base('l3', '3'), base('l1', '7'), base('l2', '11')],
      });
      expect((result ?? []).map(share => share.id)).toEqual(['l3', 'l1', 'l2']);
      const sum = (result ?? []).reduce((acc, share) => addDecimal(acc, share.share), d('0'));
      expect(toDecimalString(sum, 2)).toBe('1.00');
    });

    it('gives the extra cent to the larger remainder before the ID tie-break', () => {
      const result = allocateLargestRemainder({
        total: d('0.03'),
        scale: 2,
        bases: [base('a', '1'), base('b', '2')],
      });
      expect(Object.fromEntries((result ?? []).map(share => [share.id, toDecimalString(share.share, 2)]))).toEqual({
        a: '0.01',
        b: '0.02',
      });
    });

    it('refuses totals that are not representable at the scale, zero bases and duplicate IDs', () => {
      expect(allocateLargestRemainder({ total: d('0.105'), scale: 2, bases: [base('a', '1')] })).toBeNull();
      expect(allocateLargestRemainder({ total: d('1'), scale: 2, bases: [base('a', '0')] })).toBeNull();
      expect(allocateLargestRemainder({ total: d('1'), scale: 2, bases: [] })).toBeNull();
      expect(allocateLargestRemainder({ total: d('1'), scale: 2, bases: [base('a', '1'), base('a', '2')] })).toBeNull();
      expect(allocateLargestRemainder({ total: d('-1'), scale: 2, bases: [base('a', '1')] })).toBeNull();
    });
  });
});
