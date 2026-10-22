import * as React from 'react';
import { ProveedorDisponibilidad } from './ProveedorDisponibilidad';
import { MaxcamCandidato } from '../hooks/useMaxcamConsulta';

/** Sold-out product: is it available at Maxcam, Barquisimeto branch? */
export function MaxcamDisponibilidad({ codigoInterno }: { codigoInterno: string }) {
  return (
    <ProveedorDisponibilidad<MaxcamCandidato>
      tabla="consultas_maxcam"
      codigoInterno={codigoInterno}
      titulo="Disponibilidad en Maxcam (BQ)"
      ayuda="Producto agotado. Consulta si Maxcam lo tiene en Barquisimeto para pedirlo."
      sinResultado="No se encontró un equivalente en el catálogo de Maxcam."
      nota="Solo cuenta el stock de Barquisimeto."
      badge={(c) => (c.disponible ? `Disponible · ${c.stock_bq} uds` : 'Agotado en BQ')}
      detalle={(c) => (c.cant_caja ? `caja x${c.cant_caja}` : '')}
    />
  );
}
