import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, AlertaZelleSpoof } from '../lib/supabase';

const PAGE_SIZE = 100;

/**
 * Intentos de estafa (correos que imitan un aviso de pago Zelle pero no pasaron
 * el filtro anti-spoofing). Visible para TODOS los empleados activos — es un
 * tema de seguridad de la tienda, no financiero (a diferencia de pagos_zelle).
 */
export function useAlertasSpoof() {
  return useQuery({
    queryKey: ['alertas-spoof'],
    queryFn: async (): Promise<AlertaZelleSpoof[]> => {
      const { data, error } = await supabase
        .from('alertas_zelle_spoof')
        .select('*')
        .order('detectado_en', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;
      return (data || []) as AlertaZelleSpoof[];
    },
    staleTime: 0,
  });
}

export function useAlertasSpoofCount() {
  return useQuery({
    queryKey: ['alertas-spoof-count'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('alertas_zelle_spoof')
        .select('*', { count: 'exact', head: true })
        .eq('revisado', false);

      if (error) throw error;
      return count || 0;
    },
    staleTime: 5 * 60_000,
  });
}

/** Marca una alerta como revisada por el empleado (cualquier activo puede hacerlo). */
export function useRevisarAlertaSpoof() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase
        .from('alertas_zelle_spoof')
        .update({ revisado: true, revisado_por: session?.user?.id ?? null })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertas-spoof'] });
      queryClient.invalidateQueries({ queryKey: ['alertas-spoof-count'] });
    },
  });
}
