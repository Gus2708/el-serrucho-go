import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, PagoZelle } from '../lib/supabase';

const PAGE_SIZE = 100;

/**
 * Últimos pagos Zelle detectados en el correo (tabla pagos_zelle).
 * Solo admin/superempleado ven filas (RLS); para empleados llega vacío.
 * La lista se mantiene al día por la invalidación de useRealtimeSync.
 */
export function usePagosZelle() {
  return useQuery({
    queryKey: ['pagos-zelle'],
    queryFn: async (): Promise<PagoZelle[]> => {
      const { data, error } = await supabase
        .from('pagos_zelle')
        .select('*')
        .order('procesado_en', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;
      return (data || []) as PagoZelle[];
    },
    staleTime: 0,
  });
}

/** Marca / desmarca un pago como conciliado (verificado a mano contra la cuenta). */
export function useConciliarPago() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, conciliado }: { id: string; conciliado: boolean }): Promise<void> => {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase
        .from('pagos_zelle')
        .update({
          conciliado,
          conciliado_por: conciliado ? (session?.user?.id ?? null) : null,
        })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pagos-zelle'] });
    },
  });
}
