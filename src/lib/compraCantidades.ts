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
