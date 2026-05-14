import { useQuery } from '@tanstack/react-query';
import { supabase, TopProductoRow } from '../lib/supabase';

export function useTopProductos(
  orderBy: 'unidades_vendidas' | 'ganancia' | 'ingreso' = 'unidades_vendidas',
  days: number = 30
) {
  return useQuery({
    queryKey:  ['top-productos', orderBy, days],
    queryFn:   () => fetchTopProductos(orderBy, days),
    staleTime: 5 * 60_000,
  });
}

async function fetchTopProductos(orderBy: string, days: number): Promise<TopProductoRow[]> {
  const { data, error } = await supabase
    .rpc('get_top_productos', { days_ago: days });

  if (error) throw error;
  
  // Sorting and limiting on the client side since we get the full list from RPC
  // Alternatively, we could order inside the function, but client side is fine for 20-50 items
  return (data ?? [])
    .map(d => ({
      ...d,
      unidades_vendidas: Number(d.unidades_vendidas || 0),
      ingreso:           Number(d.ingreso || 0),
      ganancia:          Number(d.ganancia || 0),
    }))
    .sort((a: any, b: any) => (b[orderBy] || 0) - (a[orderBy] || 0))
    .slice(0, 20) as TopProductoRow[];
}
