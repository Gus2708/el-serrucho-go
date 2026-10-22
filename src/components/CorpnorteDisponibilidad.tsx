import * as React from 'react';
import { ProveedorDisponibilidad } from './ProveedorDisponibilidad';
import { CorpnorteCandidato } from '../hooks/useCorpnorteConsulta';

/** Sold-out product: does Corporación Norte have it in stock? */
export function CorpnorteDisponibilidad({ codigoInterno }: { codigoInterno: string }) {
  return (
    <ProveedorDisponibilidad<CorpnorteCandidato>
      tabla="consultas_corpnorte"
      codigoInterno={codigoInterno}
      titulo="Disponibilidad en Corporación Norte"
      ayuda="Producto agotado. Consulta si Corporación Norte lo tiene en stock para pedirlo."
      sinResultado="No se encontró un equivalente en el catálogo de Corporación Norte."
      nota="Stock total del proveedor."
      badge={(c) => (c.disponible ? `Disponible · ${c.stock} uds` : 'Sin stock')}
      detalle={(c) => [c.bulto ? `mín. ${c.bulto}` : '', c.en_vivo === false ? 'dato guardado, no en vivo' : '']
        .filter(Boolean).join('  ·  ')}
    />
  );
}
