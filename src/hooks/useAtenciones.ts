import { useQuery } from '@tanstack/react-query';
import { supabase, AtencionPendiente } from '../lib/supabase';

/**
 * Consulta la lista de clientes pendientes de atención (ordenados por el más antiguo primero).
 */
export function useAtenciones() {
  return useQuery({
    queryKey: ['atenciones-pendientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('atenciones_pendientes')
        .select('id, telefono, nombre, motivo, creado_en, status, atendido_en, atendido_por')
        .eq('status', 'pendiente')
        .order('creado_en', { ascending: true });

      if (error) throw error;
      return (data || []) as AtencionPendiente[];
    },
    staleTime: 0, // Datos frescos; se actualizarán mediante invalidación en Supabase Realtime
  });
}

/**
 * Consulta la cantidad exacta de clientes pendientes en cola.
 */
export function useAtencionesCount() {
  return useQuery({
    queryKey: ['atenciones-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('atenciones_pendientes')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pendiente');

      if (error) throw error;
      return count || 0;
    },
    staleTime: 5 * 60_000, // Mantenido por invalidación instantánea en RealtimeSync
  });
}
