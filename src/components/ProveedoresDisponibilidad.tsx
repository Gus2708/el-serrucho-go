import * as React from 'react';
import { MaxcamDisponibilidad } from './MaxcamDisponibilidad';
import { CorpnorteDisponibilidad } from './CorpnorteDisponibilidad';

/**
 * Supplier availability cards (Maxcam and Corporación Norte).
 * Shown for all products; queries to suppliers are triggered on-demand
 * when the user taps "Consultar" on each card.
 */
export function ProveedoresDisponibilidad(
  { codigoInterno, existencia }: { codigoInterno: string; existencia: number },
) {
  return (
    <>
      <MaxcamDisponibilidad codigoInterno={codigoInterno} existencia={existencia} />
      <CorpnorteDisponibilidad codigoInterno={codigoInterno} existencia={existencia} />
    </>
  );
}
