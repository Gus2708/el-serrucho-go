import { Alert, Platform } from 'react-native';

/**
 * Cross-platform info dialog. On native usa Alert.alert; en web usa
 * window.alert (Alert.alert es no-op en react-native-web).
 */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}

export interface ConfirmOptions {
  title:        string;
  message?:     string;
  confirmText?: string;
  cancelText?:  string;
  destructive?: boolean;
  onConfirm:    () => void | Promise<void>;
  onCancel?:    () => void;
}

/**
 * Cross-platform confirmation dialog. En web usa window.confirm; en native
 * usa Alert.alert con dos botones.
 */
export function confirm(opts: ConfirmOptions): void {
  const { title, message, confirmText = 'Aceptar', cancelText = 'Cancelar', destructive, onConfirm, onCancel } = opts;

  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && window.confirm(message ? `${title}\n\n${message}` : title);
    if (ok) Promise.resolve(onConfirm()).catch(() => {});
    else onCancel?.();
    return;
  }

  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel', onPress: onCancel },
    {
      text:    confirmText,
      style:   destructive ? 'destructive' : 'default',
      onPress: () => { Promise.resolve(onConfirm()).catch(() => {}); },
    },
  ]);
}
