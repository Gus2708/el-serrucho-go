import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { supabase, getLocalDateStr, getDateDaysAgo } from '../lib/supabase';

export type VentasPeriod = 'hoy' | 'ayer' | 'semana' | 'mes' | 'todo';

export interface VentaHoy {
  venta_id:                    number;
  id:                          number;
  id_unico:                    number | null;   // V2
  documento:                   string | null;
  created_at:                  string;           // V2: hora REAL de la transacción
  fecha_emision:               string;
  status:                      number;
  rif_cliente:                 string | null;
  nombre_cliente:              string;
  metodo_pago:                 string | null;   // V2: "EFECTIVO USD", "ZELLE", "T. DEBITO"…
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
    staleTime:       60_000,
  });
}

export function useVentasInfinite(period: VentasPeriod, search?: string) {
  return useInfiniteQuery({
    queryKey: ['ventas-infinite', period, search],
    queryFn: ({ pageParam }) => fetchVentas(period, pageParam as number, (pageParam as number) + PAGE_SIZE - 1, search),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined;
    },
    staleTime: 30_000,
  });
}

async function fetchVentas(period: VentasPeriod, from: number, to: number, search?: string): Promise<VentaHoy[]> {
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
    case 'todo':
      // No date filter applied
      break;
  }
  
  const trimmed = search?.trim();
  if (trimmed && trimmed.length > 0) {
    if (trimmed.includes('*')) {
      const clean = trimmed.replace(/\*/g, '').trim();
      const words = clean.split(/\s+/).filter(w => w.length > 0);
      const pattern = `%${words.join('%')}%`;
      query = query.or(`nombre_cliente.ilike.${pattern},documento.ilike.${pattern}`);
    } else {
      const term = `${trimmed}%`;
      query = query.or(`nombre_cliente.ilike.${term},documento.ilike.${term}`);
    }
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
    items_count:                 Number(v.lines_count ?? v.items_count ?? 0),
    total_neto_usd:              Number(v.total_neto_usd     ?? 0),
    total_bruto_usd:             Number(v.total_bruto_usd    ?? 0),
    total_impuesto_usd:          Number(v.total_impuesto_usd ?? 0),
    original_total_neto_ves:     Number(v.original_total_neto_ves     ?? 0),
    original_total_impuesto_ves: Number(v.original_total_impuesto_ves ?? 0),
    nombre_cliente:              v.nombre_cliente ?? 'Cliente Genérico',
    metodo_pago:                 v.metodo_pago ?? null,
    id_unico:                    v.id_unico ?? null,
  }));
}

export function useVentasSearchSummary(search: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ventas-search-summary', search],
    queryFn: async () => {
      if (!search.trim()) return null;
      const s = `%${search.trim()}%`;
      
      const periods = [
        { key: 'ayer',   filter: (q: any) => q.eq('fecha_emision', getDateDaysAgo(1)) },
        { key: 'semana', filter: (q: any) => q.gte('fecha_emision', getDateDaysAgo(7)) },
        { key: 'mes',    filter: (q: any) => q.gte('fecha_emision', getDateDaysAgo(30)) },
        { key: 'todo',   filter: (q: any) => q },
      ];

      const results = await Promise.all(periods.map(async (p) => {
        let q = supabase.from('vw_ventas_usd').select('*', { count: 'exact', head: true }).eq('status', 1);
        q = p.filter(q);
        q = q.or(`nombre_cliente.ilike.${s},documento.ilike.${s}`);
        const { count } = await q;
        return { key: p.key, count: count ?? 0 };
      }));

      return results.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.count }), {} as Record<string, number>);
    },
    enabled: enabled && search.trim().length > 0,
    staleTime: 60_000,
  });
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
