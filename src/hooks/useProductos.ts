import { useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, Producto } from '../lib/supabase';

export type StockFilter = 'todos' | 'sin_stock' | 'stock_bajo' | 'margen_negativo';

const PAGE_SIZE = 50;

export function useProductos(search: string = '', filter: StockFilter = 'todos') {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey:         ['productos', search, filter],
    queryFn:          ({ pageParam = 0 }) => fetchProductos(search, filter, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    staleTime: 30_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel('productos-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'productos' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['productos'] });
          queryClient.invalidateQueries({ queryKey: ['sync-status'] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Productos ordenados, con placeholders al final.
  // Memo: solo recalcula cuando query.data cambia, no en cada render del padre.
  const productos = useMemo(() => {
    const raw = query.data?.pages.flat() ?? [];
    return [...raw].sort((a, b) => {
      const aDot = isPlaceholder(a);
      const bDot = isPlaceholder(b);
      if (aDot && !bDot) return 1;
      if (!aDot && bDot) return -1;
      return 0;
    });
  }, [query.data]);

  return {
    productos,
    isLoading:       query.isLoading,
    isFetchingMore:  query.isFetchingNextPage,
    hasMore:         query.hasNextPage,
    fetchMore:       query.fetchNextPage,
    error:           query.error,
  };
}

/** Products with names like ".", "..", "...", "A", "B" are POS placeholders — treat as non-data */
export function isPlaceholder(p: Producto): boolean {
  if (p.es_placeholder !== undefined) return p.es_placeholder;
  const desc = p.descripcion?.trim() ?? '';
  return /^[.\s]+$/.test(desc) || desc.length <= 2;
}

async function fetchProductos(
  search: string,
  filter: StockFilter,
  offset: number,
): Promise<Producto[]> {
  let query = supabase
    .from('productos_view')
    .select('*')
    .order('es_placeholder', { ascending: true })
    .order('descripcion')
    .range(offset, offset + PAGE_SIZE - 1);

  if (search.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(`descripcion.ilike.${term},codigo_interno.ilike.${term}`);
  }

  switch (filter) {
    case 'sin_stock':
      query = query.lte('existencia', 0);
      break;
    case 'stock_bajo':
      query = query.gt('existencia', 0).lte('existencia', 5);
      break;
    case 'margen_negativo':
      // col > col comparison not supported server-side; fetch page and filter
      query = query.range(offset, offset + 199); // fetch bigger chunk for client filter
      break;
  }

  const { data, error } = await query;
  if (error) throw error;

  let result = (data ?? []) as Producto[];

  if (filter === 'margen_negativo') {
    // IVA-aware: precio_venta incluye IVA 16%; costo viene sin IVA.
    // Hay que comparar manzanas con manzanas dividiendo por 1.16.
    // Ignoramos productos con precio_venta = 0 (basura sin sincronizar).
    result = result.filter(p => p.precio_venta > 0 && p.costo > p.precio_venta / 1.16);
  }

  return result;
}
