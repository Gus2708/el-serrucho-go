import { useQuery } from '@tanstack/react-query';
import { supabase, OrdenCambio } from '../lib/supabase';

export type OrdenConItems = OrdenCambio & {
  item_count: number;
  creado_por_nombre?: string;
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
      item_count
    `)
    .order('creado_en', { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows = data ?? [];

  // Batch-fetch creator names from profiles
  const uniqueIds = [...new Set(rows.map((o: any) => o.creado_por).filter(Boolean))];
  let profileMap: Record<string, string> = {};

  if (uniqueIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', uniqueIds);

    if (profiles) {
      profileMap = Object.fromEntries(
        profiles.map((p: any) => [p.id, p.display_name])
      );
    }
  }

  return rows.map((o: any) => ({
    id:         o.id,
    creado_por: o.creado_por,
    nota:       o.nota,
    status:     o.status,
    pdf_url:    o.pdf_url,
    creado_en:  o.creado_en,
    item_count: o.item_count || 0,
    creado_por_nombre: profileMap[o.creado_por] ?? undefined,
  }));
}
