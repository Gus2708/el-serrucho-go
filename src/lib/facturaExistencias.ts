import { supabase } from './supabase';
import { withSupabaseRetry } from './retry';
import { isDemoActive } from '../demo/useDemoStore';

/** Stock by internal code. A code whose stock is missing or unreadable is absent from the map: unknown, never zero. */
export type ExistenciasEstrictas = Record<string, number>;

// The code list travels in the URL (?codigo_interno=in.(...)), so it is asked in bounded chunks.
const CHUNK_SIZE = 200;
const DECIMAL = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

function leerNumero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string' || !DECIMAL.test(valor.trim())) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/** Read-only stock reader for the supplier-invoice review. Unlike the purchase reader it never turns NULL into zero. */
export async function fetchExistenciasEstrictas(codigos: string[]): Promise<ExistenciasEstrictas> {
  const claves = [...new Set(codigos)];
  const existencias: ExistenciasEstrictas = {};
  if (isDemoActive()) return existencias;

  for (let i = 0; i < claves.length; i += CHUNK_SIZE) {
    const { data, error } = await withSupabaseRetry(() =>
      supabase.from('productos').select('codigo_interno, existencia').in('codigo_interno', claves.slice(i, i + CHUNK_SIZE))
    );
    if (error) throw error;

    for (const fila of data ?? []) {
      const existencia = leerNumero(fila.existencia);
      if (typeof fila.codigo_interno === 'string' && existencia !== null) existencias[fila.codigo_interno] = existencia;
    }
  }
  return existencias;
}
