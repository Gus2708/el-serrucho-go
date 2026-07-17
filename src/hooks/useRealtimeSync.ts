import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { playNotificationSound, showLocalNotification, playSecurityAlertSound } from '../utils/notifications';

/**
 * Hook global que centraliza todas las suscripciones de Realtime.
 *
 * Tres correcciones importantes vs. la versión anterior:
 *  1. Se setea el token del empleado (`setAuth`) ANTES de suscribir, para no suscribir
 *     como `anon` por una carrera (getSession es asíncrono).
 *  2. Las tablas de NOTIFICACIONES (atenciones + solicitudes del bot) van en su PROPIO
 *     canal. Cuando hay muchas suscripciones `postgres_changes` con RLS en un solo canal,
 *     Realtime puede "perder" la última (era el caso de `solicitudes_ayuda`): por eso no
 *     llegaban las notificaciones ni se actualizaba la lista en vivo.
 *  3. Las alertas de spoofing (intentos de estafa) van en un TERCER canal, aislado del
 *     resto — es la notificación más crítica del sistema (seguridad, no conveniencia) y
 *     no puede arriesgarse a perderse por compartir canal con otras 3 suscripciones.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let dataChannel: ReturnType<typeof supabase.channel> | null = null;
    let notifChannel: ReturnType<typeof supabase.channel> | null = null;
    let seguridadChannel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // ── Invalidación con debounce ──
    // El widget sube ventas/productos en lotes: cada fila insertada dispara un
    // evento de Realtime. Sin debounce, un sync de 50 facturas provocaba 50×7
    // invalidaciones (y sus refetches) en segundos. Acumulamos las keys y
    // disparamos UNA invalidación por key cuando el lote se calma (1.5s).
    const pendingKeys = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const invalidateDebounced = (...keys: string[]) => {
      keys.forEach(k => pendingKeys.add(k));
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const toRun = [...pendingKeys];
        pendingKeys.clear();
        toRun.forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      }, 1500);
    };

    function subscribeChannels() {
      if (cancelled) return;

      // ── Canal 1: DATOS (solo invalida queries de la UI) ──────────────────────
      dataChannel = supabase
        .channel('global-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas' }, () => {
          invalidateDebounced(
            'ventas-period',
            'ventas-infinite',
            'profit-summary',
            'profit-daily',
            'profit-hourly',
            'top-productos',
            'velocidad',
          );
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => {
          invalidateDebounced('productos', 'sync-status', 'velocidad');
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tazas' }, () => {
          invalidateDebounced('tazas-actual');
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'comandos_remotos' }, () => {
          invalidateDebounced('sync-status');
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos_zelle' }, (payload) => {
          // Solo admin/superempleado reciben estos eventos (Realtime respeta la RLS).
          queryClient.invalidateQueries({ queryKey: ['pagos-zelle'] });

          if (payload.eventType === 'INSERT' && payload.new) {
            const { monto, remitente, asunto, estado } = payload.new;
            const montoTxt = monto == null ? null : `$${Number(monto).toFixed(2)}`;
            const enRevision = estado === 'en_revision';
            playNotificationSound();
            showLocalNotification(
              enRevision ? '⏳ Zelle en revisión' : '💰 Zelle recibido',
              montoTxt
                ? enRevision
                  ? `${montoTxt} de ${remitente || 'remitente desconocido'} — retenido por el banco`
                  : `${montoTxt} — ${remitente || 'remitente desconocido'}`
                : (asunto || 'Nuevo pago Zelle (revisar correo)'),
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

      // ── Canal 3: SEGURIDAD (intentos de estafa — aislado, es la alerta más crítica) ──
      seguridadChannel = supabase
        .channel('seguridad-spoof')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alertas_zelle_spoof' }, (payload) => {
          queryClient.invalidateQueries({ queryKey: ['alertas-spoof'] });
          queryClient.invalidateQueries({ queryKey: ['alertas-spoof-count'] });

          if (payload.new) {
            const { from_addr } = payload.new;
            playSecurityAlertSound();
            showLocalNotification(
              '🚨 INTENTO DE ESTAFA DETECTADO',
              `Correo falso imitando un pago Zelle desde "${from_addr}". NO es un pago real — ignóralo.`,
              { requireInteraction: true },
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
      if (flushTimer) clearTimeout(flushTimer);
      if (dataChannel) supabase.removeChannel(dataChannel);
      if (notifChannel) supabase.removeChannel(notifChannel);
      if (seguridadChannel) supabase.removeChannel(seguridadChannel);
      subscription.unsubscribe();
    };
  }, [queryClient]);
}
