import { calcularCantidadesCompra } from './compraCantidades';

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
