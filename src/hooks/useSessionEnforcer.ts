import { useEffect, useRef } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notify';

function decodeJwtSid(accessToken: string | undefined | null): string | null {
  if (!accessToken) return null;
  const parts = accessToken.split('.');
  if (parts.length < 2) return null;
  try {
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    const json =
      typeof atob === 'function'
        ? atob(payload)
        : // RN/Node fallback
          // @ts-ignore
          (global.Buffer ? global.Buffer.from(payload, 'base64').toString('utf8') : '');
    const obj = JSON.parse(json);
    return (obj?.session_id ?? obj?.sid ?? null) as string | null;
  } catch {
    return null;
  }
}

function notifyKicked() {
  notify('Sesión cerrada', 'Tu sesión fue cerrada porque la cuenta inició sesión en otro dispositivo.');
}

/**
 * Enforces single-device login.
 *  1. Al recibir un session válido, llama a `sync_session()` (registra este
 *     dispositivo como el `allowed_sid` en profiles).
 *  2. Verifica una vez contra la DB si nuestro sid coincide con `allowed_sid`.
 *  3. Suscribe Realtime al propio row de profiles: si `allowed_sid` cambia y
 *     ya no coincide con nuestro sid → signOut + alerta.
 */
export function useSessionEnforcer(session: Session | null) {
  const claimedSidRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session?.user || !session.access_token) {
      claimedSidRef.current = null;
      return;
    }

    const userId = session.user.id;
    const mySid = decodeJwtSid(session.access_token);
    if (!mySid) return;

    let cancelled = false;

    async function claimAndVerify() {
      // 1. Reclamar este dispositivo (idempotente si ya éramos el dueño).
      if (claimedSidRef.current !== mySid) {
        const { error } = await supabase.rpc('sync_session');
        if (!cancelled && !error) claimedSidRef.current = mySid;
        if (error && !error.message.includes('No session found in JWT')) {
          console.warn('[session-enforcer] sync_session error:', error.message);
        }
      }

      // 2. Verificación inicial: ¿seguimos siendo el dispositivo permitido?
      const { data, error: selErr } = await supabase
        .from('profiles')
        .select('allowed_sid')
        .eq('id', userId)
        .single();

      if (cancelled) return;
      if (selErr) {
        console.warn('[session-enforcer] check error:', selErr.message);
        return;
      }
      if (data?.allowed_sid && data.allowed_sid !== mySid) {
        notifyKicked();
        try { await supabase.auth.signOut({ scope: 'local' }); } catch {}
      }
    }

    claimAndVerify();

    // 3. Realtime: si otro dispositivo reclama, nos enteramos al instante.
    const channel = supabase
      .channel(`session-enforcer-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        async (payload) => {
          const newSid = (payload.new as { allowed_sid?: string | null })?.allowed_sid ?? null;
          if (newSid && newSid !== mySid) {
            notifyKicked();
            try { await supabase.auth.signOut({ scope: 'local' }); } catch {}
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, session?.access_token]);
}
