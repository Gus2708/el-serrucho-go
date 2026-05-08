import { useQuery } from '@tanstack/react-query';
import { supabase, TopProductoRow } from '../lib/supabase';

export function useTopProductos() {
  return useQuery({
    queryKey:  ['top-productos'],
    queryFn:   fetchTopProductos,
    staleTime: 5 * 60_000,
  });
}

async function fetchTopProductos(): Promise<TopProductoRow[]> {
  const { data, error } = await supabase
    .from('vw_top_productos')
    .select('*');

  if (error) throw error;
  return (data ?? []).map(d => ({
    ...d,
    unidades_vendidas: Number(d.unidades_vendidas || 0),
    ingreso:           Number(d.ingreso || 0),
    ganancia:          Number(d.ganancia || 0),
  })) as TopProductoRow[];
}
