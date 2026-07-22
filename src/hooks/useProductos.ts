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
    staleTime: 60_000,
  });

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

/** Normaliza texto de búsqueda eliminando acentos/diacríticos (ej: Ü -> U, á -> A) y convirtiendo a mayúsculas */
export function normalizeSearchTerm(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
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
  // margen_negativo usa una vista dedicada en la BD (IVA-aware, server-side).
  // El resto usa productos_view.
  const fromTable =
    filter === 'margen_negativo' ? 'productos_margen_negativo_view' : 'productos_view';

  let query = supabase
    .from(fromTable)
    .select('*')
    .order('es_placeholder', { ascending: true })
    .order('descripcion')
    .range(offset, offset + PAGE_SIZE - 1);

  const trimmed = normalizeSearchTerm(search).trim();
  if (trimmed) {
    if (trimmed.includes('*')) {
      // Wildcard mode: busca en cualquier posición
      const clean = trimmed.replace(/\*/g, '').trim();
      const words = clean.split(/\s+/).filter(w => w.length > 0);
      const pattern = `%${words.join('%')}%`;
      // NOTE: referencia no está en la vista — solo buscar en columnas existentes
      query = query.or(`descripcion.ilike.${pattern},codigo_interno.ilike.${pattern},codigo_barras.ilike.${pattern}`);
    } else if (/^\d{8,}$/.test(trimmed)) {
      // Modo código de barras: la búsqueda es solo dígitos largos (EAN-8/13, UPC, etc.)
      // Busca coincidencia exacta en codigo_barras o como prefijo en codigo_interno
      const term = `${trimmed}%`;
      query = query.or(`codigo_barras.eq.${trimmed},codigo_interno.ilike.${term},codigo_barras.ilike.${term}`);
    } else {
      // Strict mode: busca por prefijo en nombre y código
      const term = `${trimmed}%`;
      // NOTE: referencia no está en la vista — solo buscar en columnas existentes
      query = query.or(`descripcion.ilike.${term},codigo_interno.ilike.${term},codigo_barras.ilike.${term}`);
    }
  }

  switch (filter) {
    case 'sin_stock':
      query = query.lte('existencia', 0);
      break;
    case 'stock_bajo':
      query = query.gt('existencia', 0).lte('existencia', 5);
      break;
    // margen_negativo: la vista ya aplica el filtro IVA-aware (costo > precio_venta / 1.16).
    // No se necesita condición adicional ni filtrado en cliente.
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as Producto[];
}
