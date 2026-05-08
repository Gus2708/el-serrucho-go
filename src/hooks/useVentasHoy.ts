import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { supabase, getLocalDateStr, getDateDaysAgo } from '../lib/supabase';

export type VentasPeriod = 'hoy' | 'ayer' | 'semana' | 'mes';

export interface VentaHoy {
  venta_id:                    number;
  id:                          number;
  documento:                   string | null;
  created_at:                  string;
  fecha_emision:               string;
  status:                      number;
  rif_cliente:                 string | null;
  nombre_cliente:              string;
  total_usd:                   number;
  ganancia_total_usd:          number;
  items_count:                 number;
  // Totales USD reales del backend (post-fix: ya no son VES)
  total_neto_usd:              number;
  total_bruto_usd:             number;
  total_impuesto_usd:          number;
  // Legacy (deprecated, mismo valor que total_neto_usd y total_impuesto_usd)
  original_total_neto_ves:     number;
  original_total_impuesto_ves: number;
}

const PAGE_SIZE = 25;

export function useVentasPeriod(period: VentasPeriod) {
  return useQuery({
    queryKey:        ['ventas-period', period],
    queryFn:         () => fetchVentas(period, 0, 1000), // Legacy fallback
    staleTime:       30_000,
    refetchInterval: 60_000,
  });
}

export function useVentasInfinite(period: VentasPeriod) {
  return useInfiniteQuery({
    queryKey: ['ventas-infinite', period],
    queryFn: ({ pageParam }) => fetchVentas(period, pageParam as number, (pageParam as number) + PAGE_SIZE - 1),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined;
    },
    staleTime: 30_000,
  });
}

async function fetchVentas(period: VentasPeriod, from: number, to: number): Promise<VentaHoy[]> {
  const today     = getLocalDateStr();
  const yesterday = getDateDaysAgo(1);

  let query = supabase
    .from('vw_ventas_usd')
    .select('*')
    .eq('status', 1)
    .order('created_at', { ascending: false })
    .range(from, to);

  switch (period) {
    case 'hoy':
      query = query.eq('fecha_emision', today);
      break;
    case 'ayer':
      query = query.eq('fecha_emision', yesterday);
      break;
    case 'semana':
      query = query.gte('fecha_emision', getDateDaysAgo(7));
      break;
    case 'mes':
      query = query.gte('fecha_emision', getDateDaysAgo(30));
      break;
  }

  const { data, error } = await query;
  if (error) throw error;
  return parseRows(data ?? []);
}

function parseRows(rows: any[]): VentaHoy[] {
  return rows.map(v => ({
    ...v,
    id:                          v.venta_id,
    total_usd:                   Number(v.total_usd   ?? 0),
    ganancia_total_usd:          Number(v.ganancia_total_usd ?? 0),
    items_count:                 Number(v.items_count ?? 0),
    total_neto_usd:              Number(v.total_neto_usd     ?? 0),
    total_bruto_usd:             Number(v.total_bruto_usd    ?? 0),
    total_impuesto_usd:          Number(v.total_impuesto_usd ?? 0),
    original_total_neto_ves:     Number(v.original_total_neto_ves     ?? 0),
    original_total_impuesto_ves: Number(v.original_total_impuesto_ves ?? 0),
    nombre_cliente:              v.nombre_cliente ?? 'Cliente Genérico',
  }));
}

// Keep old export for compatibility
export interface VentasHoyResult {
  ventas:        VentaHoy[];
  fechaMostrada: string;
  esHoy:         boolean;
}
export function useVentasHoy() {
  return useVentasPeriod('hoy');
}
