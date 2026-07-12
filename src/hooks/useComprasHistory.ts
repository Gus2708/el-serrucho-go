import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface CompraConItems {
  id:                  number;
  proveedor_codigo:    string;
  proveedor_nombre:    string | null;
  nota:                string | null;
  status:              string;
  creado_en:           string;
  item_count:          number;
  backend_status:      'pendiente' | 'aplicando' | 'completado' | 'error';
  backend_resultado:   string | null;
  backend_aplicado_en: string | null;
  creado_por_nombre?:  string;
}

export function useComprasHistory(): UseQueryResult<CompraConItems[], Error> {
  return useQuery({
    queryKey:  ['compras-history'],
    queryFn:   fetchComprasHistory,
    staleTime: 60_000,
  });
}

async function fetchComprasHistory(): Promise<CompraConItems[]> {
  const { data, error } = await supabase
    .from('compras_app')
    .select(`
      id, creado_por, proveedor_codigo, proveedor_nombre, nota, status, creado_en,
      backend_status, backend_resultado, backend_aplicado_en
    `)
    .order('creado_en', { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows = data ?? [];

  // Batch-fetch creator names from profiles
  const uniqueIds = [...new Set(rows.map((c: any) => c.creado_por).filter(Boolean))];
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

  // Batch-fetch item counts (grouped by compra_id)
  const ids = rows.map((c: any) => c.id);
  let countMap: Record<number, number> = {};

  if (ids.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from('compras_app_items')
      .select('compra_id')
      .in('compra_id', ids);

    if (itemsError) {
      console.warn('No se pudo cargar item_count del historial:', itemsError.message);
    } else if (items) {
      countMap = items.reduce((acc: Record<number, number>, item: any) => {
        const compraId = Number(item.compra_id);
        acc[compraId] = (acc[compraId] ?? 0) + 1;
        return acc;
      }, {});
    }
  }

  return rows.map((c: any) => ({
    id:                  c.id,
    proveedor_codigo:    c.proveedor_codigo,
    proveedor_nombre:    c.proveedor_nombre,
    nota:                c.nota,
    status:              c.status,
    creado_en:           c.creado_en,
    item_count:          countMap[Number(c.id)] ?? 0,
    backend_status:      c.backend_status,
    backend_resultado:   c.backend_resultado,
    backend_aplicado_en: c.backend_aplicado_en,
    creado_por_nombre:   profileMap[c.creado_por] ?? undefined,
  }));
}
