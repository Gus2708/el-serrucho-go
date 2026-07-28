import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { usePedido } from './usePedido';
import { useCompra } from './useCompra';
import { fetchPedidoItemsForEdit } from './usePedidosHistory';
import { fetchCompraItemsForEdit } from './useComprasHistory';

/**
 * Borradores = "listas sin terminar". Son filas normales de pedidos_app /
 * compras_app con status='borrador': los listeners del backend filtran
 * status=eq.emitido, así que nunca llegan a HybridLite hasta que el usuario
 * retoma la lista y la emite (ver migración 039).
 */
export type BorradorTipo = 'pedido' | 'compra';

export interface BorradorResumen {
  id:             number;
  titulo:         string;
  contraparte:    string | null;   // cliente (pedido) o proveedor (compra)
  nota:           string | null;
  itemCount:      number;
  actualizadoEn:  string;
}

interface TipoConfig {
  tabla:       string;
  itemsTabla:  string;
  itemsFk:     string;
  nombreCol:   string;
}

const CONFIG: Record<BorradorTipo, TipoConfig> = {
  pedido: { tabla: 'pedidos_app', itemsTabla: 'pedidos_app_items', itemsFk: 'pedido_id', nombreCol: 'cliente_nombre' },
  compra: { tabla: 'compras_app', itemsTabla: 'compras_app_items', itemsFk: 'compra_id', nombreCol: 'proveedor_nombre' },
};

export function borradoresQueryKey(tipo: BorradorTipo): [string, BorradorTipo] {
  return ['borradores', tipo];
}

export function useBorradores(tipo: BorradorTipo): UseQueryResult<BorradorResumen[], Error> {
  return useQuery({
    queryKey:  borradoresQueryKey(tipo),
    queryFn:   () => fetchBorradores(tipo),
    staleTime: 30_000,
  });
}

async function fetchBorradores(tipo: BorradorTipo): Promise<BorradorResumen[]> {
  const { tabla, itemsTabla, itemsFk, nombreCol } = CONFIG[tipo];

  // Solo los propios: RLS deja LEER los de todos pero solo ESCRIBIR los tuyos,
  // así que listar ajenos sería ofrecer un botón que siempre falla.
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from(tabla)
    .select(`id, titulo, nota, actualizado_en, creado_en, ${nombreCol}`)
    .eq('status', 'borrador')
    .eq('creado_por', userId)
    .order('actualizado_en', { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) throw error;

  const rows = data ?? [];
  const ids  = rows.map((r: any) => r.id);
  let countMap: Record<number, number> = {};

  if (ids.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from(itemsTabla)
      .select(itemsFk)
      .in(itemsFk, ids);

    if (itemsError) {
      console.warn('[useBorradores] no se pudo cargar item_count:', itemsError.message);
    } else if (items) {
      countMap = items.reduce((acc: Record<number, number>, item: any) => {
        const parentId = Number(item[itemsFk]);
        acc[parentId] = (acc[parentId] ?? 0) + 1;
        return acc;
      }, {});
    }
  }

  return rows.map((r: any) => ({
    id:            r.id,
    titulo:        r.titulo || 'Lista sin nombre',
    contraparte:   r[nombreCol] ?? null,
    nota:          r.nota,
    itemCount:     countMap[Number(r.id)] ?? 0,
    actualizadoEn: r.actualizado_en ?? r.creado_en,
  }));
}

/** Carga el borrador en el armador de pedidos y lo deja listo para continuar. */
export async function reanudarBorradorPedido(id: number): Promise<void> {
  const { data, error } = await supabase
    .from('pedidos_app')
    .select('id, titulo, cliente_codigo, cliente_nombre, nota')
    .eq('id', id)
    .single();

  if (error) throw error;

  const items = await fetchPedidoItemsForEdit(id);

  usePedido.getState().loadBorrador({
    borradorId:    data.id,
    titulo:        data.titulo ?? '',
    clienteCodigo: data.cliente_codigo,
    clienteNombre: data.cliente_nombre,
    nota:          data.nota ?? '',
    items,
  });
}

/** Carga el borrador en el armador de compras y lo deja listo para continuar. */
export async function reanudarBorradorCompra(id: number): Promise<void> {
  const { data, error } = await supabase
    .from('compras_app')
    .select('id, titulo, proveedor_codigo, proveedor_nombre, nota, numero_documento')
    .eq('id', id)
    .single();

  if (error) throw error;

  const items = await fetchCompraItemsForEdit(id);

  useCompra.getState().loadBorrador({
    borradorId:      data.id,
    titulo:          data.titulo ?? '',
    proveedorCodigo: data.proveedor_codigo,
    proveedorNombre: data.proveedor_nombre,
    nota:            data.nota ?? '',
    numeroDocumento: data.numero_documento ?? '',
    items,
  });
}

/**
 * Descarta un borrador. Los items caen solos por ON DELETE CASCADE. El guard
 * status='borrador' evita que un id equivocado borre un pedido/compra ya
 * emitido, que es historial del write-back.
 */
export async function eliminarBorrador(tipo: BorradorTipo, id: number): Promise<void> {
  const { error } = await supabase
    .from(CONFIG[tipo].tabla)
    .delete()
    .eq('id', id)
    .eq('status', 'borrador');

  if (error) throw error;
}
