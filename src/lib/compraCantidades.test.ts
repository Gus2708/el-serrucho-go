import { calcularCantidadesCompra, calcularCantidadesCompraDecimal } from './compraCantidades';
import { parseDecimal, toDecimalString, type Decimal } from './facturaDecimal';

const dec = (texto: string): Decimal => parseDecimal(texto) as Decimal;

describe('calcularCantidadesCompra', () => {
  it('preserves the invoice quantity when neutralizing negative stock', () => {
    expect(calcularCantidadesCompra(10, -3)).toEqual({
      cantidadFacturada: 10,
      existenciaAnterior: -3,
      compensacionNegativo: 3,
      cantidadPos: 13,
      existenciaEsperada: 10,
    });
  });

  it('adds the received quantity to positive stock without compensation', () => {
    expect(calcularCantidadesCompra(10, 5)).toEqual({
      cantidadFacturada: 10,
      existenciaAnterior: 5,
      compensacionNegativo: 0,
      cantidadPos: 10,
      existenciaEsperada: 15,
    });
  });

  it('keeps the received quantity when stock is zero', () => {
    expect(calcularCantidadesCompra(10, 0)).toEqual({
      cantidadFacturada: 10,
      existenciaAnterior: 0,
      compensacionNegativo: 0,
      cantidadPos: 10,
      existenciaEsperada: 10,
    });
  });

  it('preserves fractional inventory units while compensating negative stock', () => {
    expect(calcularCantidadesCompra(1.5, -0.25)).toEqual({
      cantidadFacturada: 1.5,
      existenciaAnterior: -0.25,
      compensacionNegativo: 0.25,
      cantidadPos: 1.75,
      existenciaEsperada: 1.5,
    });
  });
});

describe('calcularCantidadesCompraDecimal', () => {
  const texto = (cantidades: ReturnType<typeof calcularCantidadesCompraDecimal>) => ({
    cantidadFacturada: toDecimalString(cantidades.cantidadFacturada),
    existenciaAnterior: toDecimalString(cantidades.existenciaAnterior),
    compensacionNegativo: toDecimalString(cantidades.compensacionNegativo),
    cantidadPos: toDecimalString(cantidades.cantidadPos),
    existenciaEsperada: toDecimalString(cantidades.existenciaEsperada),
  });

  it('matches the number helper for negative, positive, zero and fractional stock', () => {
    const casos: Array<[string, string]> = [['10', '-3'], ['10', '5'], ['10', '0'], ['1.5', '-0.25'], ['2.5', '-0.5']];
    for (const [facturada, existencia] of casos) {
      const esperado = calcularCantidadesCompra(Number(facturada), Number(existencia));
      expect(texto(calcularCantidadesCompraDecimal(dec(facturada), dec(existencia)))).toEqual({
        cantidadFacturada: String(esperado.cantidadFacturada),
        existenciaAnterior: String(esperado.existenciaAnterior),
        compensacionNegativo: String(esperado.compensacionNegativo),
        cantidadPos: String(esperado.cantidadPos),
        existenciaEsperada: String(esperado.existenciaEsperada),
      });
    }
  });

  it('neutralizes a negative balance once and keeps the invoiced quantity as the final stock', () => {
    expect(texto(calcularCantidadesCompraDecimal(dec('10'), dec('-3')))).toEqual({
      cantidadFacturada: '10',
      existenciaAnterior: '-3',
      compensacionNegativo: '3',
      cantidadPos: '13',
      existenciaEsperada: '10',
    });
  });

  it('stays exact where binary floating point drifts', () => {
    expect(calcularCantidadesCompra(0.1, -0.2).cantidadPos).not.toBe(0.3);
    expect(texto(calcularCantidadesCompraDecimal(dec('0.1'), dec('-0.2')))).toMatchObject({
      compensacionNegativo: '0.2',
      cantidadPos: '0.3',
      existenciaEsperada: '0.1',
    });
  });
});
