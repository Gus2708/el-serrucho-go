import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { playNotificationSound, showLocalNotification } from '../utils/notifications';

/**
 * Hook global que centraliza todas las suscripciones de Realtime.
 * Escucha cambios en tablas clave e invalida las queries de React Query
 * para forzar una actualización instantánea de la interfaz.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // ── Realtime RLS Authentication ──────────────────────────────────────────
    // Sincronizar el token del empleado autenticado con el cliente de Realtime
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    const channel = supabase
      .channel('global-db-changes')
      // 1. ESCUCHAR VENTAS (Dashboard, Listado, Reportes)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ventas' },
        (payload) => {
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
          queryClient.invalidateQueries({ queryKey: ['productos'] });
          queryClient.invalidateQueries({ queryKey: ['sync-status'] });
          queryClient.invalidateQueries({ queryKey: ['velocidad'] });
        }
      )
      // 3. ESCUCHAR TASAS (TasaCard)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tazas' },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ['tazas-actual'] });
        }
      )
      // 4. ESCUCHAR COMANDOS (Estado de sincronización)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comandos_remotos' },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ['sync-status'] });
        }
      )
      // 5. ESCUCHAR ANOMALÍAS (Alertas de IA)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'anomalias' },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ['anomalias'] });
        }
      )
      // 6. ESCUCHAR ORDENES DE CAMBIO (Historial)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ordenes_cambio' },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ['ordenes-history'] });
        }
      )
      // 7. ESCUCHAR ATENCIONES PENDIENTES (WhatsApp)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'atenciones_pendientes' },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ['atenciones-pendientes'] });
          queryClient.invalidateQueries({ queryKey: ['atenciones-count'] });

          // Si es un cliente nuevo pidiendo atención
          if (payload.eventType === 'INSERT' && payload.new && payload.new.status === 'pendiente') {
            const { nombre, telefono, motivo } = payload.new;
            const cleanTel = telefono ? telefono.replace('@c.us', '') : '';
            
            // Sonar timbre y alertar
            playNotificationSound();
            showLocalNotification(
              `🔔 WhatsApp: ${nombre || cleanTel}`,
              `Motivo: ${motivo || 'Solicita atención'}`
            );
          }
        }
      )

      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      subscription.unsubscribe();
    };
  }, [queryClient]);
}

