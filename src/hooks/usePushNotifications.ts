import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import * as Notifications from 'expo-notifications';
import { isDemoActive } from '../demo/useDemoStore';
import { logBreadcrumb } from '../lib/crashLog';

// ── Web Push (VAPID) ──────────────────────────────────────────────────────────

// VAPID public key (safe to ship; private lives only in the send-push Edge Fn).
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

async function subscribeWeb(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const { data: { session } } = await supabase.auth.getSession();
  const empleadoId = session?.user?.id;
  if (!empleadoId) return;

  // Only subscribe when the user has already granted permission.
  // Never auto-request: Chrome Android silently blocks automatic prompts and
  // eventually marks the site as abusive. Permission must come from a user gesture.
  if (Notification.permission !== 'granted') return;

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

// ── Native Push (Expo Push Token → FCM via Expo relay) ───────────────────────

// EAS project ID (public — used only to scope the push token to this app).
const EAS_PROJECT_ID = '63f510dd-b89a-4d82-87f7-37032b8039e0';

// Show alerts/sounds for foreground notifications on native.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    logBreadcrumb('push: creando canales android');
    // Canal usado por send-push para pagos Zelle y avisos de bots (channelId: 'default').
    // Debe existir en el dispositivo o Android 8+ no muestra el push.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notificaciones',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F5B200',
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync('alerta-seguridad', {
      name: 'Alertas de seguridad',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 200, 500, 200, 500, 200, 500],
      lightColor: '#FF3B30',
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    });
    logBreadcrumb('push: canales android listos');
  } catch (e) {
    logBreadcrumb('push: fallo creando canales', { error: String(e) });
    console.warn('[push] no se pudieron crear los canales de notificación:', e);
  }
}

async function subscribeNative(): Promise<void> {
  await ensureAndroidChannels();

  // Request permission (on Android 13+ this shows the system dialog; older = auto-granted).
  logBreadcrumb('push: chequeando permiso existente');
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    logBreadcrumb('push: pidiendo permiso de notificaciones');
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    logBreadcrumb('push: respuesta de permiso', { status });
  }

  if (finalStatus !== 'granted') {
    logBreadcrumb('push: permiso no otorgado, abortando');
    return;
  }

  logBreadcrumb('push: pidiendo token de Expo');
  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  const expoToken = tokenData.data;
  logBreadcrumb('push: token obtenido');

  const { data: { session } } = await supabase.auth.getSession();
  const empleadoId = session?.user?.id;
  if (!empleadoId) return;

  await supabase
    .from('push_subscriptions')
    .upsert(
      {
        empleado_id: empleadoId,
        endpoint:    expoToken,
        subscription: { expo_token: expoToken, type: 'expo' },
        user_agent:  `native-android-${Platform.Version}`,
      },
      { onConflict: 'endpoint' },
    );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Registers this device for push notifications.
 * - Web/PWA: subscribes via Web Push (VAPID) only if permission is already granted.
 * - Native Android: requests permission via expo-notifications and registers FCM token.
 */
export function usePushNotifications(): void {
  useEffect(() => {
    if (isDemoActive()) return;
    if (Platform.OS === 'web') {
      subscribeWeb().catch((e) => console.warn('[push] web subscribe failed:', e));

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) subscribeWeb().catch((e) => console.warn('[push] web re-subscribe:', e));
      });
      return () => subscription.unsubscribe();
    }

    // Nativo: antes esto se disparaba sin condicionar a que hubiera sesión,
    // así que el diálogo de permiso de notificaciones (Android) podía aparecer
    // con el usuario todavía parado en la pantalla de login — compitiendo con
    // la propia transición de navegación del login. Ahora esperamos una sesión
    // confirmada y un pequeño delay antes de tocar nada nativo.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleSubscribe = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) {
          logBreadcrumb('push: disparando subscribeNative');
          subscribeNative().catch((e) => console.warn('[push] native subscribe failed:', e));
        }
      }, 2500);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !cancelled) scheduleSubscribe();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) scheduleSubscribe();
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);
}
