import * as React from 'react';
import { act } from '@testing-library/react-native';

let mockAuthCb: ((event: string, s: unknown) => void) | null = null;
let mockGetSession: () => Promise<unknown> = async () => ({ data: { session: { user: { id: 'uid-A' } } }, error: null });

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../components/AppUpdateModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../hooks/useAppUpdate', () => ({ useAppUpdateStore: Object.assign(() => ({}), { getState: () => ({}) }) }));
jest.mock('../hooks/useRealtimeSync', () => ({ useRealtimeSync: jest.fn() }));
jest.mock('../hooks/usePushNotifications', () => ({ usePushNotifications: jest.fn() }));
jest.mock('../hooks/useForegroundRefresh', () => ({ useForegroundRefresh: jest.fn() }));
jest.mock('../../assets/fonts/JetBrainsMono_400Regular.ttf', () => 1, { virtual: true });
jest.mock('../../assets/fonts/JetBrainsMono_500Medium.ttf', () => 1, { virtual: true });
jest.mock('../../assets/fonts/JetBrainsMono_600SemiBold.ttf', () => 1, { virtual: true });
jest.mock('../../assets/fonts/JetBrainsMono_700Bold.ttf', () => 1, { virtual: true });
jest.mock('../../app/global.css', () => ({}), { virtual: true });
jest.mock('expo-router', () => ({ Slot: () => null, useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useSegments: () => [] }));
jest.mock('expo-router/head', () => ({ __esModule: true, default: () => null }));
jest.mock('@sentry/react-native', () => ({ init: jest.fn(), mobileReplayIntegration: () => ({}), wrap: (c: unknown) => c, captureException: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock('expo', () => ({ isRunningInExpoGo: () => false }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => {}), hideAsync: jest.fn(async () => {}) }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../lib/crashLog', () => ({ initCrashLog: jest.fn(), logBreadcrumb: jest.fn() }));
jest.mock('../hooks/useSessionEnforcer', () => ({ useSessionEnforcer: jest.fn() }));
jest.mock('../hooks/useUserRole', () => ({
  clearRoleCache: jest.fn(),
  useUserRole: () => ({
    data: { role: 'admin', profile: { id: 'uid-A', is_active: true } },
    isLoading: false,
  }),
}));
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      signOut: jest.fn(async () => ({})),
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
        mockAuthCb = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
    from: jest.fn(),
    rpc: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

import RootLayout from '../../app/_layout';
import { getFacturaSessionUid, setFacturaSessionUid } from '../hooks/useFacturasProveedor';

async function mount() {
  setFacturaSessionUid('stale-previous');
  mockAuthCb = null;
  let r: { unmount: () => void } | undefined;
  const rt = require("react-test-renderer"); await act(async () => { r = rt.create(<RootLayout />); });
  await act(async () => { await Promise.resolve(); });
  return { unmount: () => act(() => { r!.unmount(); }) };
}

describe('layout publishes the auth account to the invoice editors', () => {
  afterEach(() => { mockGetSession = async () => ({ data: { session: { user: { id: 'uid-A' } } }, error: null }); });

  it('getSession ok -> uid published; auth events replace/clear it', async () => {
    const r = await mount();
    expect(getFacturaSessionUid()).toBe('uid-A');
    await act(async () => { mockAuthCb!('TOKEN_REFRESHED', { user: { id: 'uid-A' } }); });
    expect(getFacturaSessionUid()).toBe('uid-A');
    await act(async () => { mockAuthCb!('SIGNED_IN', { user: { id: 'uid-B' } }); });
    expect(getFacturaSessionUid()).toBe('uid-B');
    await act(async () => { mockAuthCb!('SIGNED_OUT', null); });
    expect(getFacturaSessionUid()).toBeNull();
    await r.unmount();
  });

  it('getSession error result clears a stale uid', async () => {
    mockGetSession = async () => ({ data: { session: null }, error: { message: 'revoked' } });
    const r = await mount();
    expect(getFacturaSessionUid()).toBeNull();
    await r.unmount();
  });

  it('getSession rejection clears a stale uid', async () => {
    mockGetSession = async () => { throw new Error('boom'); };
    const r = await mount();
    expect(getFacturaSessionUid()).toBeNull();
    await r.unmount();
  });
});
