import { useQuery } from '@tanstack/react-query';
import { supabase, AlertaStockRow, Anomalia } from '../lib/supabase';

export function useAlertas() {
  const stockAlertas = useQuery({
    queryKey: ['alertas-stock'],
    queryFn:  fetchAlertasStock,
    staleTime: 5 * 60_000,
  });

  const anomalias = useQuery({
    queryKey: ['anomalias'],
    queryFn:  fetchAnomalias,
    staleTime: 10 * 60_000,
  });

  const totalCount =
    (stockAlertas.data?.length ?? 0) +
    (anomalias.data?.length ?? 0);

  return {
    stockAlertas: stockAlertas.data ?? [],
    anomalias:    anomalias.data ?? [],
    totalCount,
    isLoading:    stockAlertas.isLoading || anomalias.isLoading,
  };
}

async function fetchAlertasStock(): Promise<AlertaStockRow[]> {
  const { data, error } = await supabase
    .from('vw_alertas_stock')
    .select('*')
    .order('tipo_alerta');
  if (error) throw error;
  return (data ?? []) as AlertaStockRow[];
}

async function fetchAnomalias(): Promise<Anomalia[]> {
  const { data, error } = await supabase
    .from('anomalias')
    .select('*')
    .eq('resuelto', false)
    .order('detectado_en', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Anomalia[];
}

// Mark an AI anomaly as resolved
export async function resolverAnomalia(id: number) {
  const { error } = await supabase
    .from('anomalias')
    .update({ resuelto: true })
    .eq('id', id);
  if (error) throw error;
}
