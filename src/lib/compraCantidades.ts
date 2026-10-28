import { addDecimal, negDecimal, parseDecimal, type Decimal } from './facturaDecimal';

export interface CantidadesCompra {
  cantidadFacturada: number;
  existenciaAnterior: number;
  compensacionNegativo: number;
  cantidadPos: number;
  existenciaEsperada: number;
}

/**
 * Quantities must be finite numbers in the same inventory unit. Pass the
 * original received invoice quantity, never a quantity already adjusted for POS.
 * Expected stock uses this snapshot; execution must verify the actual balance.
 */
export function calcularCantidadesCompra(
  cantidadFacturada: number,
  existenciaAnterior: number,
): CantidadesCompra {
  const compensacionNegativo = Math.max(0, -existenciaAnterior);

  return {
    cantidadFacturada,
    existenciaAnterior,
    compensacionNegativo,
    cantidadPos: cantidadFacturada + compensacionNegativo,
    existenciaEsperada: Math.max(0, existenciaAnterior) + cantidadFacturada,
  };
}

export interface CantidadesCompraDecimal {
  cantidadFacturada: Decimal;
  existenciaAnterior: Decimal;
  compensacionNegativo: Decimal;
  cantidadPos: Decimal;
  existenciaEsperada: Decimal;
}

const CERO = parseDecimal('0') as Decimal;

/** Same formula as `calcularCantidadesCompra`, in exact decimals for invoice review quantities. */
export function calcularCantidadesCompraDecimal(
  cantidadFacturada: Decimal,
  existenciaAnterior: Decimal,
): CantidadesCompraDecimal {
  const compensacionNegativo = existenciaAnterior.neg ? negDecimal(existenciaAnterior) : CERO;

  return {
    cantidadFacturada,
    existenciaAnterior,
    compensacionNegativo,
    cantidadPos: addDecimal(cantidadFacturada, compensacionNegativo),
    existenciaEsperada: addDecimal(existenciaAnterior.neg ? CERO : existenciaAnterior, cantidadFacturada),
  };
}
