import { useEffect, useRef } from 'react';
import { Platform, AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Mantiene la app "en vivo" al volver del segundo plano.
 *
 * Cuando la app (nativo) o la pestaña (PWA/web) vuelve al primer plano, el navegador/SO
 * había suspendido la conexión Realtime y las consultas quedaron viejas. Este hook, en esa
 * transición background → foreground:
 *   1. Reactiva la conexión Realtime (para que vuelvan los eventos en vivo).
 *   2. Rehace TODAS las consultas activas (refresco en segundo plano: mantiene la data
 *      anterior visible mientras llega la nueva, así que no parpadea).
 *
 * Va con anti-rebote para no dispararse en cada micro-foco (eso era lo que causaba el
 * flicker que motivó desactivar refetchOnWindowFocus).
 */
export function useForegroundRefresh(): void {
  const queryClient = useQueryClient();
  const lastRunRef = useRef(0);

  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (now - lastRunRef.current < 1500) return; // anti-rebote
      lastRunRef.current = now;

      // 1) Reactivar Realtime si la conexión se cayó en segundo plano.
      try {
        const rt = supabase.realtime as unknown as {
          isConnected?: () => boolean;
          connect?: () => void;
        };
        if (rt && typeof rt.isConnected === 'function' && !rt.isConnected()) {
          rt.connect?.();
        }
      } catch {
        /* noop */
      }

      // 2) Refrescar todas las consultas activas (en segundo plano, sin parpadeo).
      queryClient.invalidateQueries();
    };

    const cleanups: Array<() => void> = [];

    // Web / PWA: la pestaña pasa a visible o la ventana recupera foco.
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') refresh();
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onVisible);
      cleanups.push(() => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', onVisible);
      });
    }

    // Nativo (Android/iOS): la app vuelve a primer plano.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    cleanups.push(() => appStateSub.remove());

    return () => cleanups.forEach((fn) => fn());
  }, [queryClient]);
}
