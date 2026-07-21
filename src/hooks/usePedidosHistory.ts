import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PedidoDraftItem } from './usePedido';

export interface PedidoConItems {
  id:                  number;
  cliente_codigo:      string;
  cliente_nombre:      string | null;
  nota:                string | null;
  status:              string;
  creado_en:           string;
  item_count:          number;
  backend_status:      'pendiente' | 'aplicando' | 'completado' | 'error';
  backend_resultado:   string | null;
  backend_aplicado_en: string | null;
  documento_hybrid:    string | null;
  creado_por_nombre?:  string;
}

export function usePedidosHistory(): UseQueryResult<PedidoConItems[], Error> {
  return useQuery({
    queryKey:  ['pedidos-history'],
    queryFn:   fetchPedidosHistory,
    staleTime: 60_000,
  });
}

async function fetchPedidosHistory(): Promise<PedidoConItems[]> {
  const { data, error } = await supabase
    .from('pedidos_app')
    .select(`
      id, creado_por, cliente_codigo, cliente_nombre, nota, status, creado_en,
      backend_status, backend_resultado, backend_aplicado_en, documento_hybrid
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

  // Batch-fetch item counts (grouped by pedido_id)
  const ids = rows.map((c: any) => c.id);
  let countMap: Record<number, number> = {};

  if (ids.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from('pedidos_app_items')
      .select('pedido_id')
      .in('pedido_id', ids);

    if (itemsError) {
      console.warn('No se pudo cargar item_count del historial de pedidos:', itemsError.message);
    } else if (items) {
      countMap = items.reduce((acc: Record<number, number>, item: any) => {
        const pedidoId = Number(item.pedido_id);
        acc[pedidoId] = (acc[pedidoId] ?? 0) + 1;
        return acc;
      }, {});
    }
  }

  return rows.map((c: any) => ({
    id:                  c.id,
    cliente_codigo:      c.cliente_codigo,
    cliente_nombre:      c.cliente_nombre,
    nota:                c.nota,
    status:              c.status,
    creado_en:           c.creado_en,
    item_count:          countMap[Number(c.id)] ?? 0,
    backend_status:      c.backend_status,
    backend_resultado:   c.backend_resultado,
    backend_aplicado_en: c.backend_aplicado_en,
    documento_hybrid:    c.documento_hybrid,
    creado_por_nombre:   profileMap[c.creado_por] ?? undefined,
  }));
}

/** Ítems de un pedido puntual, para precargar el draft de "editar y reintentar". */
export async function fetchPedidoItemsForEdit(pedidoId: number): Promise<PedidoDraftItem[]> {
  const { data, error } = await supabase
    .from('pedidos_app_items')
    .select('codigo_producto, descripcion, cantidad')
    .eq('pedido_id', pedidoId);

  if (error) throw error;

  return (data ?? []).map((it: any) => ({
    codigo_producto: it.codigo_producto,
    descripcion:     it.descripcion ?? '',
    cantidad:        Number(it.cantidad),
  }));
}
