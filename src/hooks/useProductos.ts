import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase, Producto } from '../lib/supabase';
import { isDemoActive } from '../demo/useDemoStore';
import { demoProductos } from '../demo/demoData';
import {
  normalizeSearchTerm,
  buildBarcodeSearchVariants,
} from '../lib/barcode';

export {
  normalizeSearchTerm,
  computeGtinCheckDigit,
  expandUPCEtoUPCA,
  compressUPCAtoUPCE,
  cleanScannedBarcode,
  buildBarcodeSearchVariants,
} from '../lib/barcode';

export type StockFilter = 'todos' | 'sin_stock' | 'stock_bajo' | 'margen_negativo';

const PAGE_SIZE = 50;

export function useProductos(search: string = '', filter: StockFilter = 'todos') {
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
  if (isDemoActive()) {
    let list = [...demoProductos];
    const trimmed = normalizeSearchTerm(search).trim();
    if (trimmed) {
      const clean = trimmed.replace(/\*/g, '').toUpperCase();
      const variants = buildBarcodeSearchVariants(clean);
      list = list.filter(p => {
        const desc = normalizeSearchTerm(p.descripcion);
        const interno = normalizeSearchTerm(p.codigo_interno);
        const barras = normalizeSearchTerm(p.codigo_barras);
        if (desc.includes(clean) || interno.includes(clean) || barras.includes(clean)) {
          return true;
        }
        return variants.some(v => barras === v || interno === v || barras.startsWith(v));
      });
    }
    if (filter === 'sin_stock') {
      list = list.filter(p => p.existencia <= 0);
    } else if (filter === 'stock_bajo') {
      list = list.filter(p => p.existencia > 0 && p.existencia <= 5);
    } else if (filter === 'margen_negativo') {
      list = list.filter(p => p.costo > p.precio_venta / 1.16);
    }
    return list.slice(offset, offset + PAGE_SIZE);
  }
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
    const isCode39Wrapped = /^\*[^*\s]+\*$/.test(trimmed);
    if (trimmed.includes('*') && !isCode39Wrapped) {
      // Wildcard mode: busca en cualquier posición
      const clean = trimmed.replace(/\*/g, '').trim();
      const words = clean.split(/\s+/).filter(w => w.length > 0);
      const pattern = `%${words.join('%')}%`;
      // NOTE: referencia no está en la vista — solo buscar en columnas existentes
      query = query.or(`descripcion.ilike.${pattern},codigo_interno.ilike.${pattern},codigo_barras.ilike.${pattern}`);
    } else {
      const variants = buildBarcodeSearchVariants(trimmed);
      if (variants.length > 1 || /^\d{6,}$/.test(trimmed)) {
        // Modo código de barras: busca todas las variantes equivalentes (UPC-E, UPC-A, EAN-13, ITF-14, Codabar, Code 39)
        const clauses = variants.flatMap(v => [
          `codigo_barras.eq.${v}`,
          `codigo_interno.ilike.${v}%`,
          `codigo_barras.ilike.${v}%`,
        ]);
        query = query.or(clauses.join(','));
      } else {
        // Strict mode: busca por prefijo en nombre y código
        const term = `${trimmed}%`;
        // NOTE: referencia no está en la vista — solo buscar en columnas existentes
        query = query.or(`descripcion.ilike.${term},codigo_interno.ilike.${term},codigo_barras.ilike.${term}`);
      }
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
