import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface PresupuestoConfig {
  markup_porcentaje: number;
}

export function usePresupuestoConfig() {
  return useQuery({
    queryKey: ['presupuesto-config'],
    queryFn: fetchPresupuestoConfig,
    staleTime: 5 * 60_000, // 5 minutes cache
  });
}

async function fetchPresupuestoConfig(): Promise<PresupuestoConfig> {
  const { data, error } = await supabase
    .from('presupuesto_config')
    .select('markup_porcentaje')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    // Default fallback if query fails or table is empty
    return { markup_porcentaje: 30 };
  }

  return {
    markup_porcentaje: Number(data.markup_porcentaje || 30),
  };
}
