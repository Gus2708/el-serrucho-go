import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { withSupabaseRetry } from '../lib/retry';
import { isDemoActive } from '../demo/useDemoStore';
import { demoProductos } from '../demo/demoData';

/** Existencia actual por codigo_interno. Códigos sin fila quedan fuera del mapa. */
export type ExistenciasMap = Record<string, number>;

// La lista de códigos viaja en la URL (?codigo_interno=in.(...)), así que se
// pide por tandas para no pasarse del largo máximo con compras muy grandes.
const CHUNK_SIZE = 200;

/**
 * Unidades que faltan para volver a cero cuando la existencia está en negativo.
 *
 * Hybrid SUMA lo comprado al saldo actual: si un producto está en -3 y se
 * compran 10, queda en 7. Cargando el faltante además de lo comprado el saldo
 * final termina siendo exactamente lo que el usuario escribió.
 */
export function faltantePorNegativo(existencia: number | null | undefined): number {
  if (typeof existencia !== 'number' || existencia >= 0) return 0;
  return Math.abs(existencia);
}

export function useExistencias(codigos: string[]): UseQueryResult<ExistenciasMap, Error> {
  const claves = [...new Set(codigos)].sort();

  return useQuery({
    queryKey:  ['existencias', claves],
    queryFn:   () => fetchExistencias(claves),
    enabled:   claves.length > 0,
    staleTime: 30_000,
  });
}

export async function fetchExistencias(codigos: string[]): Promise<ExistenciasMap> {
  const claves = [...new Set(codigos)];
  const existencias: ExistenciasMap = {};

  if (isDemoActive()) {
    for (const clave of claves) {
      const producto = demoProductos.find(p => p.codigo_interno === clave);
      existencias[clave] = producto ? Number(producto.existencia) || 0 : 0;
    }
    return existencias;
  }

  for (let i = 0; i < claves.length; i += CHUNK_SIZE) {
    const tanda = claves.slice(i, i + CHUNK_SIZE);

    const { data, error } = await withSupabaseRetry(() =>
      supabase.from('productos').select('codigo_interno, existencia').in('codigo_interno', tanda)
    );

    if (error) throw error;

    for (const fila of data ?? []) {
      existencias[fila.codigo_interno] = Number(fila.existencia) || 0;
    }
  }

  return existencias;
}
