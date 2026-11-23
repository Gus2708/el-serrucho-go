import { Platform } from 'react-native';
import { requestNotificationPermission, showLocalNotification } from './notifications';

jest.mock('react-native', () => ({ Platform: { OS: 'web' }, Vibration: { vibrate: jest.fn() } }));

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNotification = Object.getOwnPropertyDescriptor(globalThis, 'Notification');

function installNotification(permission: NotificationPermission = 'default'): jest.Mock & { permission: NotificationPermission; requestPermission: jest.Mock } {
  const notification = Object.assign(jest.fn(), {
    permission,
    requestPermission: jest.fn().mockResolvedValue('granted'),
  });
  Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: notification });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { Notification: notification } });
  return notification;
}

function restoreProperty(name: 'window' | 'Notification', original: PropertyDescriptor | undefined): void {
  if (original) Object.defineProperty(globalThis, name, original);
  else Reflect.deleteProperty(globalThis, name);
}

afterEach(() => {
  restoreProperty('window', originalWindow);
  restoreProperty('Notification', originalNotification);
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  jest.restoreAllMocks();
});

describe('local notification permission boundary', () => {
  it('does not prompt or notify from a realtime event when permission is undecided', async () => {
    const notification = installNotification();
    showLocalNotification('Stock', 'Inventory changed');
    await Promise.resolve();
    expect(notification.requestPermission).not.toHaveBeenCalled();
    expect(notification).not.toHaveBeenCalled();
  });

  it('preserves granted notification payload and the default interaction option', () => {
    const notification = installNotification('granted');
    showLocalNotification('Stock', 'Inventory changed');
    expect(notification).toHaveBeenCalledWith('Stock', {
      body: 'Inventory changed', icon: '/elserruchogo512x512.png', requireInteraction: false,
    });
    expect(notification.requestPermission).not.toHaveBeenCalled();
  });

  it('preserves explicitly requested persistent notifications without changing caller options', () => {
    const notification = installNotification('granted');
    const options = Object.freeze({ requireInteraction: true });
    showLocalNotification('Alert', 'Action required', options);
    expect(notification.mock.calls[0][1].requireInteraction).toBe(true);
    expect(options).toEqual({ requireInteraction: true });
  });

  it('does not prompt or notify when permission was denied', () => {
    const notification = installNotification('denied');
    showLocalNotification('Stock', 'Inventory changed');
    expect(notification).not.toHaveBeenCalled();
    expect(notification.requestPermission).not.toHaveBeenCalled();
  });

  it('still permits an explicit user permission request', () => {
    const notification = installNotification();
    requestNotificationPermission();
    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(notification).not.toHaveBeenCalled();
  });

  it.each(['granted', 'denied'] as const)('does not repeat an explicit request with %s permission', permission => {
    const notification = installNotification(permission);
    requestNotificationPermission();
    expect(notification.requestPermission).not.toHaveBeenCalled();
  });

  it('keeps native event handling free of web notification requests', () => {
    const notification = installNotification();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    showLocalNotification('Stock', 'Inventory changed');
    requestNotificationPermission();
    expect(notification).not.toHaveBeenCalled();
    expect(notification.requestPermission).not.toHaveBeenCalled();
  });

  it('handles browsers without the Notification API', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    expect(() => showLocalNotification('Stock', 'Inventory changed')).not.toThrow();
    expect(() => requestNotificationPermission()).not.toThrow();
  });

  it('preserves recovery when the browser rejects notification construction', () => {
    const notification = installNotification('granted');
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    notification.mockImplementationOnce(() => { throw new Error('Browser rejected notification'); });
    expect(() => showLocalNotification('Stock', 'Inventory changed')).not.toThrow();
    expect(warning).toHaveBeenCalledWith('Error launching local Notification:', expect.any(Error));
  });
});
