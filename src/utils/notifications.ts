import { Platform, Vibration } from 'react-native';

/**
 * Reproduce un sonido de notificación.
 * En Web/PWA, sintetiza un agradable chime doble utilizando la API de Web Audio.
 * En dispositivos nativos, utiliza la API de vibración para alertar al empleado.
 */
export function playNotificationSound() {
  if (Platform.OS === 'web') {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const audioCtx = new AudioContext();

      // Primer tono (La5, 880Hz)
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain1.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);

      // Segundo tono (Mi6, 1318.51Hz) con retraso de 0.1s
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1318.51, audioCtx.currentTime + 0.1);
      gain2.gain.setValueAtTime(0.12, audioCtx.currentTime + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);

      osc1.start(audioCtx.currentTime);
      osc1.stop(audioCtx.currentTime + 0.4);
      osc2.start(audioCtx.currentTime + 0.1);
      osc2.stop(audioCtx.currentTime + 0.6);
    } catch (e) {
      console.warn('Web Audio play failed or blocked:', e);
    }
  } else {
    // Fallback nativo: patrón de vibración
    Vibration.vibrate([0, 400, 200, 400]);
  }
}

type LocalNotificationOptions = {
  /** Si es true, la notificación web NO se auto-cierra sola (requiere que el usuario la descarte). */
  requireInteraction?: boolean;
};

/**
 * Dispara una notificación del sistema.
 * En Web/PWA, utiliza la API de Notificaciones HTML5.
 */
export function showLocalNotification(title: string, body: string, options: LocalNotificationOptions = {}) {
  if (Platform.OS === 'web') {
    if ('Notification' in window) {
      const notifOptions: NotificationOptions = {
        body,
        icon: '/elserruchogo512x512.png',
        requireInteraction: options.requireInteraction ?? false,
      };
      if (Notification.permission === 'granted') {
        try {
          new Notification(title, notifOptions);
        } catch (e) {
          console.warn('Error launching local Notification:', e);
        }
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification(title, notifOptions);
          }
        });
      }
    }
  }
}

/**
 * Alerta de seguridad (intento de estafa): suena más fuerte/urgente que la
 * notificación estándar — en Web repite un tono agudo 3 veces en ráfaga; en
 * nativo usa un patrón de vibración largo y agresivo.
 */
export function playSecurityAlertSound() {
  if (Platform.OS === 'web') {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const audioCtx = new AudioContext();

      for (let i = 0; i < 3; i++) {
        const start = audioCtx.currentTime + i * 0.35;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1046.5, start); // Do6 — tono agudo de alarma
        gain.gain.setValueAtTime(0.15, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.25);
      }
    } catch (e) {
      console.warn('Web Audio play failed or blocked:', e);
    }
  } else {
    Vibration.vibrate([0, 500, 200, 500, 200, 500, 200, 500]);
  }
}

/**
 * Solicita de forma explícita el permiso para mostrar notificaciones.
 */
export function requestNotificationPermission() {
  if (Platform.OS === 'web' && 'Notification' in window) {
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission().catch(e => console.warn('Request permission failed:', e));
    }
  }
}
