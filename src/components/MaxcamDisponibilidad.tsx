import * as React from 'react';
import { ProveedorDisponibilidad } from './ProveedorDisponibilidad';
import { MaxcamCandidato } from '../hooks/useMaxcamConsulta';

/** Sold-out or low-stock product: is it available at Maxcam, Barquisimeto branch? */
export function MaxcamDisponibilidad(
  { codigoInterno, existencia }: { codigoInterno: string; existencia: number },
) {
  return (
    <ProveedorDisponibilidad<MaxcamCandidato>
      tabla="consultas_maxcam"
      codigoInterno={codigoInterno}
      titulo="Disponibilidad en Maxcam (BQ)"
      ayuda={existencia <= 0
        ? 'Producto agotado. Consulta si Maxcam lo tiene en Barquisimeto para pedirlo.'
        : `Quedan ${existencia} uds. Consulta si Maxcam lo tiene en Barquisimeto para pedirlo antes de que se agote.`}
      sinResultado="No se encontró un equivalente en el catálogo de Maxcam."
      nota="Solo cuenta el stock de Barquisimeto."
      badge={(c) => (c.disponible ? `Disponible · ${c.stock_bq} uds` : 'Agotado en BQ')}
      detalle={(c) => (c.cant_caja ? `caja x${c.cant_caja}` : '')}
      imagenes={(c) => (c.imagen ? [c.imagen] : [])}
    />
  );
}
