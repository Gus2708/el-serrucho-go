import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { Profile } from '../lib/supabase';

const DEMO_STORAGE_KEY = 'serrucho_demo_mode';
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000dec';

export const DEMO_PROFILE: Profile = {
  id: DEMO_USER_ID,
  role: 'admin',
  email: 'reclutador@elserrucho.com',
  display_name: 'Reclutador Demo (GUEST)',
  is_active: true,
  notif_prefs: {
    bots: true,
    zelle: true,
    pedidos: true,
  },
  updated_at: new Date().toISOString(),
};

export const DEMO_SESSION: Session = {
  access_token: 'demo-jwt-token-for-recruiters',
  refresh_token: 'demo-refresh-token',
  expires_in: 31536000,
  token_type: 'bearer',
  user: {
    id: DEMO_USER_ID,
    app_metadata: { provider: 'demo' },
    user_metadata: { display_name: 'Reclutador Demo' },
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
    email: 'reclutador@elserrucho.com',
  },
};

function getInitialDemoState(): boolean {
  if (typeof window !== 'undefined') {
    try {
      const demoParam = new URLSearchParams(window.location?.search ?? '').get('demo');
      if (demoParam === '1' || demoParam === 'true') {
        localStorage?.setItem(DEMO_STORAGE_KEY, 'true');
        return true;
      }
      return localStorage?.getItem(DEMO_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }
  return false;
}

interface DemoState {
  isDemoMode: boolean;
  enableDemo: () => void;
  disableDemo: () => void;
}

export const useDemoStore = create<DemoState>((set) => ({
  isDemoMode: getInitialDemoState(),
  enableDemo: () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage?.setItem(DEMO_STORAGE_KEY, 'true');
      } catch {}
    }
    set({ isDemoMode: true });
  },
  disableDemo: () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage?.removeItem(DEMO_STORAGE_KEY);
      } catch {}
    }
    set({ isDemoMode: false });
  },
}));

/** Helper no reactivo para verificar el estado demo sincrónicamente */
export function isDemoActive(): boolean {
  return useDemoStore.getState().isDemoMode;
}
