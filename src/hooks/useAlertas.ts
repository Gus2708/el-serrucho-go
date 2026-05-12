import * as React from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { supabase, AlertaStockRow } from '../lib/supabase';

const PAGE_SIZE = 40;

export type StockFilter = 'todos' | 'sin_stock' | 'stock_negativo' | 'margen_negativo' | 'stock_muerto';

export function useAlertasCount(filter: StockFilter) {
  return useQuery({
    queryKey: ['alertas-count', filter],
    queryFn: async () => {
      let query = supabase
        .from('vw_alertas_stock')
        .select('*', { count: 'exact', head: true });

      if (filter !== 'todos') {
        query = query.eq('tipo_alerta', filter);
      }

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
    staleTime: 5 * 60_000,
  });
}

export function useAlertasInfinite(filter: StockFilter) {
  return useInfiniteQuery({
    queryKey: ['alertas-stock-infinite', filter],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('vw_alertas_stock')
        .select('*')
        .order('tipo_alerta')
        .range(from, to);

      if (filter !== 'todos') {
        query = query.eq('tipo_alerta', filter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as AlertaStockRow[];
    },
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === PAGE_SIZE ? allPages.length : undefined;
    },
    staleTime: 5 * 60_000,
    initialPageParam: 0,
  });
}
