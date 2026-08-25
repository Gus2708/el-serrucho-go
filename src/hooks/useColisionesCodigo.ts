import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { withSupabaseRetry } from '../lib/retry';

/**
 * Producto que HybridLite cargaría en lugar del que se pidió.
 *
 * Al teclear un código en la celda "Código" de la grilla, HybridLite resuelve
 * PRIMERO por código de barras/referencia y solo después por código interno. Si
 * el código interno del producto A es el código de barras del producto B, el
 * robot termina cargando B: cantidad, costo y precio se aplican al equivocado.
 *
 * Caso real (compra C-0030, doc 399119, 2026-08-11): se pidió `7453038400787`
 * y HybridLite cargó `02940`, que tiene ese número como código de barras. El
 * descuadre solo salió en la verificación final, con el documento ya totalizado
 * y permanente en el kardex.
 */
export interface ColisionCodigo {
  codigoInterceptor: string;
  descripcion:       string;
}

/** Código pedido -> producto que lo intercepta. Los códigos limpios no aparecen. */
export type ColisionesMap = Record<string, ColisionCodigo>;

// La lista viaja en la URL (?codigo_barras=in.(...)), igual que useExistencias.
const CHUNK_SIZE = 200;

/** Mensaje listo para mostrar, explicando el choque y qué hacer. */
export function describirColision(
  codigoPedido: string,
  descripcionPedida: string,
  colision: ColisionCodigo,
): string {
  return (
    `"${descripcionPedida}" (${codigoPedido}): HybridLite cargaría ` +
    `"${colision.descripcion}" (${colision.codigoInterceptor}), porque ese número ` +
    `es su código de barras. Quita el ítem o corrige el duplicado en Hybrid antes de emitir.`
  );
}

export function useColisionesCodigo(codigos: string[]): UseQueryResult<ColisionesMap, Error> {
  const claves = [...new Set(codigos)].sort();

  return useQuery({
    queryKey:  ['colisiones-codigo', claves],
    queryFn:   () => fetchColisionesCodigo(claves),
    enabled:   claves.length > 0,
    staleTime: 5 * 60_000,
  });
}

export async function fetchColisionesCodigo(codigos: string[]): Promise<ColisionesMap> {
  const claves = [...new Set(codigos)].filter(codigo => codigo.trim().length > 0);
  const colisiones: ColisionesMap = {};

  for (let i = 0; i < claves.length; i += CHUNK_SIZE) {
    const tanda = claves.slice(i, i + CHUNK_SIZE);

    const { data, error } = await withSupabaseRetry(() =>
      supabase
        .from('productos')
        .select('codigo_interno, descripcion, codigo_barras')
        .in('codigo_barras', tanda)
    );

    if (error) throw error;

    for (const fila of data ?? []) {
      // Un producto cuyo código de barras es su propio código interno no choca
      // con nadie: Hybrid resuelve al mismo producto por cualquiera de los dos.
      if (fila.codigo_interno === fila.codigo_barras) continue;
      colisiones[fila.codigo_barras] = {
        codigoInterceptor: fila.codigo_interno,
        descripcion:       fila.descripcion,
      };
    }
  }

  return colisiones;
}
