import { useQuery } from '@tanstack/react-query';
import { supabase, OrdenCambio } from '../lib/supabase';

export type OrdenConItems = OrdenCambio & {
  item_count: number;
};

export function useOrdenesHistory() {
  return useQuery({
    queryKey:  ['ordenes-history'],
    queryFn:   fetchOrdenes,
    staleTime: 60_000,
  });
}

async function fetchOrdenes(): Promise<OrdenConItems[]> {
  const { data, error } = await supabase
    .from('ordenes_cambio')
    .select(`
      id, creado_por, nota, status, pdf_url, creado_en,
      ordenes_cambio_items(id)
    `)
    .order('creado_en', { ascending: false })
    .limit(50);

  if (error) throw error;

  return (data ?? []).map((o: any) => ({
    id:         o.id,
    creado_por: o.creado_por,
    nota:       o.nota,
    status:     o.status,
    pdf_url:    o.pdf_url,
    creado_en:  o.creado_en,
    item_count: Array.isArray(o.ordenes_cambio_items) ? o.ordenes_cambio_items.length : 0,
  }));
}
