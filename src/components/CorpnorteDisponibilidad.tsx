import * as React from 'react';
import { ProveedorDisponibilidad } from './ProveedorDisponibilidad';
import { CorpnorteCandidato } from '../hooks/useCorpnorteConsulta';

const IMAGE_BASE = 'https://catalogocorporacionnorte.com/uploads/productos/';
const EXTENSIONES = ['jpg', 'png', 'jpeg', 'webp']; // the site itself tries them in this order

/**
 * Photo URLs of a Corporación Norte product. The file is named after the code with "/"
 * replaced by "-". Built here from the code on purpose: no image URL is stored anywhere.
 */
function urlsImagen(sku: string): string[] {
  const file = encodeURIComponent(sku.trim().replace(/\//g, '-'));
  return EXTENSIONES.map((ext) => `${IMAGE_BASE}${file}.${ext}`);
}

/** Sold-out or low-stock product: does Corporación Norte have it in stock? */
export function CorpnorteDisponibilidad(
  { codigoInterno, existencia }: { codigoInterno: string; existencia: number },
) {
  return (
    <ProveedorDisponibilidad<CorpnorteCandidato>
      tabla="consultas_corpnorte"
      codigoInterno={codigoInterno}
      titulo="Disponibilidad en Corporación Norte"
      ayuda={existencia <= 0
        ? 'Producto agotado. Consulta si Corporación Norte lo tiene en stock para pedirlo.'
        : `Quedan ${existencia} uds. Consulta si Corporación Norte lo tiene en stock para pedirlo antes de que se agote.`}
      sinResultado="No se encontró un equivalente en el catálogo de Corporación Norte."
      nota="Stock total del proveedor."
      badge={(c) => (c.disponible ? `Disponible · ${c.stock} uds` : 'Sin stock')}
      detalle={(c) => [c.bulto ? `mín. ${c.bulto}` : '', c.en_vivo === false ? 'dato guardado, no en vivo' : '']
        .filter(Boolean).join('  ·  ')}
      imagenes={(c) => urlsImagen(c.sku)}
    />
  );
}
