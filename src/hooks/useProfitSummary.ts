import { useQuery } from '@tanstack/react-query';
import { supabase, ProfitSummaryRow, ProfitDailyRow, getDateDaysAgo } from '../lib/supabase';

export interface ProfitMonthlyRow {
  mes:          string;   // 'YYYY-MM'
  num_ventas:   number;
  ingreso_bruto: number;
  costo_total:  number;
  ganancia:     number;
}

// ── Dashboard KPI cards ───────────────────────────────────────────────────────
export function useProfitSummary() {
  return useQuery({
    queryKey: ['profit-summary'],
    queryFn:  fetchProfitSummary,
    staleTime: 5 * 60_000,        // 5 min
    refetchInterval: 10 * 60_000, // background refresh every 10 min
  });
}

async function fetchProfitSummary(): Promise<ProfitSummaryRow> {
  const { data, error } = await supabase
    .from('vw_dashboard_stats')
    .select('*')
    .single();

  if (error) throw error;
  
  if (!data) throw new Error('No statistics data found');
  
  const d = data as any;
  return {
    ganancia_hoy:    Number(d.ganancia_hoy ?? 0),
    ingreso_hoy:     Number(d.ingreso_hoy ?? 0),
    ventas_hoy:      Number(d.ventas_hoy ?? 0),
    items_hoy:       Number(d.items_hoy ?? 0),
    ganancia_ayer:   Number(d.ganancia_ayer ?? 0),
    ingreso_ayer:    Number(d.ingreso_ayer ?? 0),
    ventas_ayer:     Number(d.ventas_ayer ?? 0),
    items_ayer:      Number(d.items_ayer ?? 0),
    ganancia_semana: Number(d.ganancia_semana ?? 0),
    ingreso_semana:  Number(d.ingreso_semana ?? 0),
    ventas_semana:   Number(d.ventas_semana ?? 0),
    items_semana:    Number(d.items_semana ?? 0),
    ganancia_mes:    Number(d.ganancia_mes ?? 0),
    ingreso_mes:     Number(d.ingreso_mes ?? 0),
    ventas_mes:      Number(d.ventas_mes ?? 0),
    items_mes:       Number(d.items_mes ?? 0),
    ticket_promedio: Number(d.ticket_promedio ?? 0),
  };
}

// ── Reportes bar chart ────────────────────────────────────────────────────────
export function useProfitDaily(days: 7 | 30 | 90 = 30) {
  return useQuery({
    queryKey: ['profit-daily', days],
    queryFn:  () => fetchProfitDaily(days),
    staleTime: 5 * 60_000,
  });
}

async function fetchProfitDaily(days: number): Promise<ProfitDailyRow[]> {
  const { data, error } = await supabase
    .from('vw_profit_daily')
    .select('*')
    .gte('dia', getDateDaysAgo(days))
    .order('dia');

  if (error) throw error;
  return (data ?? []).map(d => ({
    ...d,
    num_ventas:    Number(d.num_ventas || 0),
    ingreso_bruto: Number(d.ingreso_bruto || 0),
    costo_total:   Number(d.costo_total || 0),
    ganancia:      Number(d.ganancia || 0),
  })) as ProfitDailyRow[];
}

// ── Monthly chart (last 12 months) ───────────────────────────────────────────
export function useProfitMonthly() {
  return useQuery({
    queryKey: ['profit-monthly'],
    queryFn:  fetchProfitMonthly,
    staleTime: 10 * 60_000,
  });
}

async function fetchProfitMonthly(): Promise<ProfitMonthlyRow[]> {
  const { data, error } = await supabase
    .from('vw_profit_monthly')
    .select('*')
    .order('mes');

  if (error) throw error;
  return (data ?? []).map(d => ({
    ...d,
    num_ventas:    Number(d.num_ventas || 0),
    ingreso_bruto: Number(d.ingreso_bruto || 0),
    costo_total:   Number(d.costo_total || 0),
    ganancia:      Number(d.ganancia || 0),
  })) as ProfitMonthlyRow[];
}
