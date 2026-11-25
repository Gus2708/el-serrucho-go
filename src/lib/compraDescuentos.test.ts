import {
  calcularCostoConDescuento,
  calcularPorcentajeEfectivo,
  descuentosIguales,
  formatearCascada,
  isMissingDiscountColumnError,
  MAX_DESCUENTO_STEPS,
  normalizarDescuentos,
  parseDescuentoTexto,
  resolverDescuentosEfectivos,
} from './compraDescuentos';

describe('compraDescuentos', () => {
  describe('calcularCostoConDescuento', () => {
    it('returns costoLista untouched when there are no discounts', () => {
      const res = calcularCostoConDescuento(0.125, []);
      expect(res).toEqual({
        costoLista: 0.125,
        descuentosAplicados: [],
        tieneDescuento: false,
        costoNetoExactoStr: '0.125',
        costoNeto: 0.125,
        costoNetoStr: '0.125',
        fueRedondeado: false,
        porcentajeEfectivo: 0,
        porcentajeEfectivoStr: '0',
        ahorroUnitario: 0,
      });
    });

    it('computes single percentage discount accurately', () => {
      const res = calcularCostoConDescuento(100, [15]);
      expect(res.tieneDescuento).toBe(true);
      expect(res.costoNeto).toBe(85);
      expect(res.costoNetoStr).toBe('85.00');
      expect(res.fueRedondeado).toBe(false);
      expect(res.porcentajeEfectivo).toBe(15);
      expect(res.porcentajeEfectivoStr).toBe('15');
      expect(res.ahorroUnitario).toBe(15);
    });

    it('computes cascaded discounts [20, 5] as 24% real (not 25%)', () => {
      const res = calcularCostoConDescuento(10, [20, 5]);
      expect(res.costoNeto).toBe(7.6);
      expect(res.costoNetoStr).toBe('7.60');
      expect(res.costoNetoExactoStr).toBe('7.60');
      expect(res.fueRedondeado).toBe(false);
      expect(res.porcentajeEfectivo).toBe(24);
      expect(res.porcentajeEfectivoStr).toBe('24');
      expect(res.ahorroUnitario).toBe(2.4);
    });

    it('computes 3-step cascade [20, 5, 3] with exact string and half-up rounding', () => {
      const res = calcularCostoConDescuento(10, [20, 5, 3]);
      expect(res.costoNetoExactoStr).toBe('7.372');
      expect(res.costoNeto).toBe(7.37);
      expect(res.costoNetoStr).toBe('7.37');
      expect(res.fueRedondeado).toBe(true);
      expect(res.porcentajeEfectivo).toBe(26.28);
      expect(res.porcentajeEfectivoStr).toBe('26.28');
      expect(res.ahorroUnitario).toBe(2.63);
    });

    it('handles half-up rounding edge cases without IEEE-754 float drift', () => {
      // 12.35 * 0.85 = 10.4975 -> 10.50
      expect(calcularCostoConDescuento(12.35, [15]).costoNeto).toBe(10.5);
      // 1.00 * 0.875 = 0.875 -> half-up = 0.88
      expect(calcularCostoConDescuento(1.0, [12.5]).costoNeto).toBe(0.88);
      // 10.05 * 0.90 = 9.045 -> half-up = 9.05
      expect(calcularCostoConDescuento(10.05, [10]).costoNeto).toBe(9.05);
      // 19.99 * 0.90 = 17.991 -> 17.99
      expect(calcularCostoConDescuento(19.99, [10]).costoNeto).toBe(17.99);
    });

    it('is commutative when chaining item + general discounts', () => {
      const a = calcularCostoConDescuento(45.5, [20, 5, 10]);
      const b = calcularCostoConDescuento(45.5, [10, 20, 5]);
      expect(a.costoNeto).toBe(b.costoNeto);
      expect(a.costoNetoExactoStr).toBe(b.costoNetoExactoStr);
      expect(a.porcentajeEfectivo).toBe(b.porcentajeEfectivo);
    });

    it('handles tiny cost rounding down to 0.00', () => {
      const res = calcularCostoConDescuento(0.01, [60]);
      expect(res.costoNetoExactoStr).toBe('0.004');
      expect(res.costoNeto).toBe(0);
      expect(res.fueRedondeado).toBe(true);
    });

    it('returns zeroed result when costoLista <= 0', () => {
      const res = calcularCostoConDescuento(0, [20]);
      expect(res.tieneDescuento).toBe(false);
      expect(res.costoNeto).toBe(0);
      expect(res.porcentajeEfectivo).toBe(0);
    });
  });

  describe('normalizarDescuentos & resolverDescuentosEfectivos', () => {
    it('filters invalid values, strings, <=0, >=100, and caps at MAX_DESCUENTO_STEPS', () => {
      expect(
        normalizarDescuentos([20, '5', 0, -3, 100, 120, NaN, null, 'abc', 1, 2, 3, 4, 5]),
      ).toEqual([20, 5, 1, 2, 3, 4].slice(0, MAX_DESCUENTO_STEPS));
      expect(normalizarDescuentos('not-array')).toEqual([]);
    });

    it('combines item and general discounts unless excluded', () => {
      expect(resolverDescuentosEfectivos([20], [5], false)).toEqual([20, 5]);
      expect(resolverDescuentosEfectivos([20], [5], true)).toEqual([20]);
    });
  });

  describe('parseDescuentoTexto', () => {
    it('parses single numeric values with comma or percent sign', () => {
      expect(parseDescuentoTexto('15,5%')).toEqual({
        committed: [],
        draft: '15.5',
        draftValue: 15.5,
        error: null,
      });
      expect(parseDescuentoTexto('12.')).toEqual({
        committed: [],
        draft: '12.',
        draftValue: 12,
        error: null,
      });
    });

    it('parses + cascades into committed steps and active draft', () => {
      expect(parseDescuentoTexto('20+5')).toEqual({
        committed: [20],
        draft: '5',
        draftValue: 5,
        error: null,
      });
      expect(parseDescuentoTexto('20+5+')).toEqual({
        committed: [20, 5],
        draft: '',
        draftValue: null,
        error: null,
      });
    });

    it('flags >=100 or malformed values without silently dropping leading invalid segments', () => {
      expect(parseDescuentoTexto('100').error).toBe('Debe ser menor a 100%');
      expect(parseDescuentoTexto('100+5').error).toBe('Debe ser menor a 100%');
      expect(parseDescuentoTexto('-5').error).toBe('Descuento inválido');
      expect(parseDescuentoTexto('abc').error).toBe('Descuento inválido');
    });
  });

  describe('helpers', () => {
    it('formats cascades and compares arrays', () => {
      expect(formatearCascada([20, 5])).toBe('20% + 5%');
      expect(descuentosIguales([20, 5], [20, 5])).toBe(true);
      expect(descuentosIguales([20, 5], [20, 6])).toBe(false);
      expect(calcularPorcentajeEfectivo([20, 5])).toEqual({
        porcentajeEfectivo: 24,
        porcentajeEfectivoStr: '24',
      });
    });

    it('detects missing discount column errors from Postgres/PostgREST', () => {
      expect(isMissingDiscountColumnError({ code: '42703', message: 'column "descuentos" does not exist' })).toBe(true);
      expect(isMissingDiscountColumnError({ code: 'PGRST204', message: "Could not find the 'costo_lista' column" })).toBe(true);
      expect(isMissingDiscountColumnError({ code: '23505', message: 'duplicate key' })).toBe(false);
    });
  });
});
