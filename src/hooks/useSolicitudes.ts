import { useQuery } from '@tanstack/react-query';
import { supabase, SolicitudAyuda } from '../lib/supabase';

/**
 * Consulta la lista de solicitudes de ayuda pendientes o resueltas pero no enviadas.
 * Ordenado por creado_en ascendente.
 */
export function useSolicitudes() {
  return useQuery({
    queryKey: ['solicitudes-pendientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('solicitudes_ayuda')
        .select('*')
        .in('status', ['pendiente', 'resuelto'])
        .order('creado_en', { ascending: true });

      if (error) throw error;

      // Filtrar: pendientes, o resueltas pero sin enviado_en
      const filtered = (data || []).filter(
        (item: SolicitudAyuda) =>
          item.status === 'pendiente' ||
          (item.status === 'resuelto' && !item.enviado_en)
      );

      return filtered as SolicitudAyuda[];
    },
    staleTime: 0, // Se actualizará mediante invalidación en Supabase Realtime
  });
}
