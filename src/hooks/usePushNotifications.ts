import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

// Clave VAPID PÚBLICA (es pública por diseño; la privada vive solo en la Edge Function send-push).
const VAPID_PUBLIC_KEY =
  'BBEycqyi6qVCYlt8kLcOPE-QrYfcBu2iQmeIqTXUiw42Ua7FiCkqatCJehm8WSZ3IeEBBq_JSyHdUD2D34sl_Ig';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function subscribeActiveEmployee(): Promise<void> {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const { data: { session } } = await supabase.auth.getSession();
  const empleadoId = session?.user?.id;
  if (!empleadoId) return;

  if (Notification.permission === 'denied') return;
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint) return;

  // RLS exige empleado activo; si no lo es, el upsert falla y se ignora en el catch del caller.
  await supabase
    .from('push_subscriptions')
    .upsert(
      {
        empleado_id: empleadoId,
        endpoint: json.endpoint,
        subscription: json,
        user_agent: navigator.userAgent,
      },
      { onConflict: 'endpoint' },
    );
}

/**
 * Suscribe el dispositivo a Web Push para recibir notificaciones AUNQUE la app esté
 * cerrada o en segundo plano. Solo aplica en web/PWA. En iPhone (Safari) requiere que
 * el empleado instale la PWA en la pantalla de inicio (iOS 16.4+).
 */
export function usePushNotifications(): void {
  useEffect(() => {
    subscribeActiveEmployee().catch((e) => console.warn('[push] no se pudo suscribir:', e));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) subscribeActiveEmployee().catch((e) => console.warn('[push] re-suscribe:', e));
    });
    return () => subscription.unsubscribe();
  }, []);
}
