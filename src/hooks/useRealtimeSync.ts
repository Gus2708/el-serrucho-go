import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Hook global que centraliza todas las suscripciones de Realtime.
 * Escucha cambios en tablas clave e invalida las queries de React Query
 * para forzar una actualización instantánea de la interfaz.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('global-db-changes')
      // 1. ESCUCHAR VENTAS (Dashboard, Listado, Reportes)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ventas' },
        (payload) => {
          console.log('Realtime: Cambio en VENTAS', payload.eventType);
          queryClient.invalidateQueries({ queryKey: ['ventas-period'] });
          queryClient.invalidateQueries({ queryKey: ['ventas-infinite'] });
          queryClient.invalidateQueries({ queryKey: ['profit-summary'] });
          queryClient.invalidateQueries({ queryKey: ['profit-daily'] });
          queryClient.invalidateQueries({ queryKey: ['profit-hourly'] });
          queryClient.invalidateQueries({ queryKey: ['top-productos'] });
          queryClient.invalidateQueries({ queryKey: ['velocidad'] });
        }
      )
      // 2. ESCUCHAR PRODUCTOS (Inventario, Alertas)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'productos' },
        (payload) => {
          console.log('Realtime: Cambio en PRODUCTOS', payload.eventType);
          queryClient.invalidateQueries({ queryKey: ['productos'] });
          queryClient.invalidateQueries({ queryKey: ['alertas-stock'] });
          queryClient.invalidateQueries({ queryKey: ['sync-status'] });
          queryClient.invalidateQueries({ queryKey: ['velocidad'] });
        }
      )
      // 3. ESCUCHAR TASAS (TasaCard)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tazas' },
        (payload) => {
          console.log('Realtime: Cambio en TAZAS', payload.eventType);
          queryClient.invalidateQueries({ queryKey: ['tazas-actual'] });
        }
      )
      // 4. ESCUCHAR COMANDOS (Estado de sincronización)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comandos_remotos' },
        (payload) => {
          console.log('Realtime: Cambio en COMANDOS', payload.eventType);
          queryClient.invalidateQueries({ queryKey: ['sync-status'] });
        }
      )
      // 5. ESCUCHAR ANOMALÍAS (Alertas de IA)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'anomalias' },
        (payload) => {
          console.log('Realtime: Cambio en ANOMALIAS', payload.eventType);
          queryClient.invalidateQueries({ queryKey: ['anomalias'] });
        }
      )
      // 6. ESCUCHAR ORDENES DE CAMBIO (Historial)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ordenes_cambio' },
        (payload) => {
          console.log('Realtime: Cambio en ORDENES_CAMBIO', payload.eventType);
          queryClient.invalidateQueries({ queryKey: ['ordenes-history'] });
        }
      )

      .subscribe((status) => {
        console.log('Realtime Subscription Status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
