import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { playNotificationSound, showLocalNotification } from '../utils/notifications';

/**
 * Hook global que centraliza todas las suscripciones de Realtime.
 *
 * Dos correcciones importantes vs. la versión anterior:
 *  1. Se setea el token del empleado (`setAuth`) ANTES de suscribir, para no suscribir
 *     como `anon` por una carrera (getSession es asíncrono).
 *  2. Las tablas de NOTIFICACIONES (atenciones + solicitudes del bot) van en su PROPIO
 *     canal. Cuando hay muchas suscripciones `postgres_changes` con RLS en un solo canal,
 *     Realtime puede "perder" la última (era el caso de `solicitudes_ayuda`): por eso no
 *     llegaban las notificaciones ni se actualizaba la lista en vivo.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let dataChannel: ReturnType<typeof supabase.channel> | null = null;
    let notifChannel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    function subscribeChannels() {
      if (cancelled) return;

      // ── Canal 1: DATOS (solo invalida queries de la UI) ──────────────────────
      dataChannel = supabase
        .channel('global-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas' }, () => {
          queryClient.invalidateQueries({ queryKey: ['ventas-period'] });
          queryClient.invalidateQueries({ queryKey: ['ventas-infinite'] });
          queryClient.invalidateQueries({ queryKey: ['profit-summary'] });
          queryClient.invalidateQueries({ queryKey: ['profit-daily'] });
          queryClient.invalidateQueries({ queryKey: ['profit-hourly'] });
          queryClient.invalidateQueries({ queryKey: ['top-productos'] });
          queryClient.invalidateQueries({ queryKey: ['velocidad'] });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => {
          queryClient.invalidateQueries({ queryKey: ['productos'] });
          queryClient.invalidateQueries({ queryKey: ['sync-status'] });
          queryClient.invalidateQueries({ queryKey: ['velocidad'] });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tazas' }, () => {
          queryClient.invalidateQueries({ queryKey: ['tazas-actual'] });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'comandos_remotos' }, () => {
          queryClient.invalidateQueries({ queryKey: ['sync-status'] });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'anomalias' }, () => {
          queryClient.invalidateQueries({ queryKey: ['anomalias'] });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes_cambio' }, () => {
          queryClient.invalidateQueries({ queryKey: ['ordenes-history'] });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes_cambio_items' }, () => {
          // Write-back: el backend reporta avance actualizando backend_status en
          // los ITEMS (la cabecera nunca cambia). Sin esta suscripción, el badge
          // del historial no se entera de pendiente→completado hasta un refetch
          // manual — el detalle del modal sí, porque tiene su propio canal.
          queryClient.invalidateQueries({ queryKey: ['ordenes-history'] });
          queryClient.invalidateQueries({ queryKey: ['orden-cambio-detalle'] });
        })
        .subscribe();

      // ── Canal 2: NOTIFICACIONES (aislado para que Realtime no lo pierda) ──────
      notifChannel = supabase
        .channel('notificaciones-empleado')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'atenciones_pendientes' }, (payload) => {
          queryClient.invalidateQueries({ queryKey: ['atenciones-pendientes'] });
          queryClient.invalidateQueries({ queryKey: ['atenciones-count'] });

          if (payload.eventType === 'INSERT' && payload.new && payload.new.status === 'pendiente') {
            const { nombre, telefono, motivo } = payload.new;
            const cleanTel = telefono ? telefono.replace('@c.us', '') : '';
            playNotificationSound();
            showLocalNotification(
              `🔔 WhatsApp: ${nombre || cleanTel}`,
              `Motivo: ${motivo || 'Solicita atención'}`
            );
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_ayuda' }, (payload) => {
          queryClient.invalidateQueries({ queryKey: ['solicitudes-pendientes'] });

          if (payload.eventType === 'INSERT' && payload.new && payload.new.status === 'pendiente') {
            const { nombre, telefono, consulta } = payload.new;
            const cleanTel = telefono ? telefono.replace('@c.us', '') : '';
            playNotificationSound();
            showLocalNotification(
              `🙋 Solicitud de Ayuda: ${nombre || cleanTel}`,
              `Consulta: ${consulta || 'Sin consulta'}`
            );
          }
        })
        .subscribe();
    }

    // Setear el token del empleado ANTES de suscribir (evita suscribir como anon por la carrera).
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      })
      .catch(() => { /* sin sesión: se suscribe igual */ })
      .finally(() => subscribeChannels());

    // Si el empleado inicia/cierra sesión, actualizar el token del Realtime.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    return () => {
      cancelled = true;
      if (dataChannel) supabase.removeChannel(dataChannel);
      if (notifChannel) supabase.removeChannel(notifChannel);
      subscription.unsubscribe();
    };
  }, [queryClient]);
}
