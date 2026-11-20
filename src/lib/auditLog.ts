import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { AppStateStatus } from 'react-native';
import { supabase } from './supabase';
import { isDemoActive } from '../demo/useDemoStore';
import {
  buildAuditRecord,
  enqueueAuditRecord,
  parseAuditQueue,
  partitionQueueForUser,
  shouldSkipLifecycleEvent,
  truncateAuditText,
  type AuditDeviceInfo,
  type AuditEventInput,
  type QueuedAuditEvent,
} from './auditQueue';

const QUEUE_KEY = 'serrucho-audit-queue-v1';
const FLUSH_NOW_TIMEOUT_MS = 1_500;

type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

type RNRuntime = {
  Platform: {
    OS: string;
    Version?: string | number;
    constants?: { Brand?: string; Model?: string; Release?: string };
  };
  AppState: {
    currentState: AppStateStatus;
    addEventListener: (type: 'change', listener: (nextState: AppStateStatus) => void) => unknown;
  };
};

let initialized = false;
let hydrated = false;
let hydratePromise: Promise<void> = Promise.resolve();
let queue: QueuedAuditEvent[] = [];
let activeFlushPromise: Promise<void> | null = null;
let flushRequested = false;
let activeUserId: string | null = null;
let appOpenLogged = false;
let lastAppState: AppStateStatus = 'active';
let lastLifecycleEvento: string | null = null;
let lastLifecycleTs = 0;

function getRNRuntime(): RNRuntime | null {
  try {
    // Lazy require keeps plain Node Jest tests (e.g. useCompra.test.ts) from
    // evaluating React Native native bridge modules at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native') as RNRuntime;
  } catch {
    return null;
  }
}

function getStorage(): StorageLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage');
    return (mod?.default ?? mod) as StorageLike;
  } catch {
    return null;
  }
}

function getAppVersion(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-constants');
    const constants = mod?.default ?? mod;
    return truncateAuditText(constants?.expoConfig?.version, 50);
  } catch {
    return null;
  }
}

function readDeviceInfo(): AuditDeviceInfo {
  const fallback: AuditDeviceInfo = {
    plataforma: 'unknown',
    marca: null,
    modelo: null,
    version_so: null,
    app_version: null,
  };

  try {
    const rn = getRNRuntime();
    const os = rn?.Platform?.OS ?? 'unknown';
    const appVersion = getAppVersion();

    if (os === 'android') {
      const androidConstants = rn?.Platform?.constants;
      return {
        plataforma: 'android',
        marca: truncateAuditText(androidConstants?.Brand, 100),
        modelo: truncateAuditText(androidConstants?.Model, 100),
        version_so: truncateAuditText(androidConstants?.Release, 50),
        app_version: appVersion,
      };
    }

    if (os === 'web') {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
      const plat = typeof navigator !== 'undefined' ? navigator.platform : null;
      return {
        plataforma: 'web',
        marca: truncateAuditText(plat, 100),
        modelo: truncateAuditText(ua, 100),
        version_so: null,
        app_version: appVersion,
      };
    }

    return {
      plataforma: os,
      marca: os === 'ios' ? 'Apple' : null,
      modelo: null,
      version_so: rn?.Platform?.Version != null ? truncateAuditText(String(rn.Platform.Version), 50) : null,
      app_version: appVersion,
    };
  } catch {
    return fallback;
  }
}

function persistQueue(): Promise<void> {
  if (!hydrated) return Promise.resolve();
  const storage = getStorage();
  if (!storage) return Promise.resolve();
  return storage.setItem(QUEUE_KEY, JSON.stringify(queue)).catch(() => {});
}

function recordLifecycleEvent(evento: 'app_open' | 'app_foreground' | 'app_background'): void {
  const now = Date.now();
  if (shouldSkipLifecycleEvent(evento, lastLifecycleEvento, lastLifecycleTs, now)) return;
  lastLifecycleEvento = evento;
  lastLifecycleTs = now;
  trackAuditEvent({ evento });
}

async function runFlushDrain(): Promise<void> {
  try {
    do {
      flushRequested = false;
      if (queue.length === 0) break;

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      if (!userId) break;

      activeUserId = userId;
      const { toFlush, droppedForeign } = partitionQueueForUser(queue, userId);

      if (droppedForeign > 0) {
        queue = toFlush;
        await persistQueue();
      }

      let hitTransientError = false;
      for (const item of [...toFlush]) {
        const { error } = await supabase.from('auditoria_eventos').insert({
          empleado_id: userId,
          origen: 'app',
          evento: item.evento,
          entidad: item.entidad,
          entidad_id: item.entidad_id,
          detalle: item.detalle,
          cliente_ts: item.cliente_ts,
          plataforma: item.plataforma,
          marca: item.marca,
          modelo: item.modelo,
          version_so: item.version_so,
          app_version: item.app_version,
        });

        if (error) {
          // 22xxx / 23xxx (invalid input / check violation): drop poison pill so queue never stalls.
          const isConstraintError =
            typeof error.code === 'string' &&
            (error.code.startsWith('22') || error.code.startsWith('23'));
          if (isConstraintError) {
            queue = queue.filter((entry) => entry !== item);
            await persistQueue();
            continue;
          }
          hitTransientError = true;
          break;
        }

        queue = queue.filter((entry) => entry !== item);
        await persistQueue();
      }

      if (hitTransientError) break;
    } while (flushRequested && queue.length > 0);
  } catch {
    // Network errors keep queued events for the next flush.
  }
}

export async function flushAuditEvents(): Promise<void> {
  if (isDemoActive()) return;
  await hydratePromise;
  if (queue.length === 0) return;
  if (typeof supabase.auth?.getSession !== 'function') return;

  if (activeFlushPromise) {
    flushRequested = true;
    await activeFlushPromise;
    return;
  }

  activeFlushPromise = runFlushDrain().finally(() => {
    activeFlushPromise = null;
  });
  await activeFlushPromise;
}

export function trackAuditEvent(input: AuditEventInput): void {
  try {
    if (isDemoActive()) return;
    const now = Date.now();
    const record = buildAuditRecord(
      { ...input, empleadoId: input.empleadoId ?? activeUserId },
      readDeviceInfo(),
      now,
    );
    queue = enqueueAuditRecord(queue, record, now);
    void hydratePromise.then(persistQueue).then(flushAuditEvents);
  } catch {
    // Audit logging must never interfere with business transactions.
  }
}

/** Persists and flushes immediately (with a short timeout) before signOut clears the JWT. */
export async function trackAuditEventNow(input: AuditEventInput): Promise<void> {
  try {
    if (isDemoActive()) return;
    const now = Date.now();
    const record = buildAuditRecord(
      { ...input, empleadoId: input.empleadoId ?? activeUserId },
      readDeviceInfo(),
      now,
    );
    queue = enqueueAuditRecord(queue, record, now);
    const work = hydratePromise.then(persistQueue).then(flushAuditEvents);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, FLUSH_NOW_TIMEOUT_MS));
    await Promise.race([work, timeout]);
  } catch {
    // Never block logout on audit errors.
  }
}

export function notifyAuditSession(event: AuthChangeEvent | 'BOOT_SESSION', session: Session | null): void {
  if (isDemoActive()) return;
  const userId = session?.user?.id ?? null;

  if (userId) {
    activeUserId = userId;
    if (!appOpenLogged) {
      appOpenLogged = true;
      recordLifecycleEvent('app_open');
    }
    if (event === 'SIGNED_IN') {
      trackAuditEvent({ evento: 'auth_login', empleadoId: userId });
    } else if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || event === 'BOOT_SESSION') {
      void flushAuditEvents();
    }
    return;
  }

  if (event === 'SIGNED_OUT') {
    activeUserId = null;
    appOpenLogged = false;
  }
}

export function initAuditLog(): void {
  if (initialized) return;
  initialized = true;

  const storage = getStorage();
  hydratePromise = (storage ? storage.getItem(QUEUE_KEY) : Promise.resolve(null))
    .then((raw) => {
      const stored = parseAuditQueue(raw);
      if (stored.length > 0) {
        const now = Date.now();
        let merged: QueuedAuditEvent[] = stored;
        for (const item of queue) {
          merged = enqueueAuditRecord(merged, item, now);
        }
        queue = merged;
      }
    })
    .catch(() => {})
    .finally(() => {
      hydrated = true;
    });

  void hydratePromise.then(persistQueue).then(flushAuditEvents);

  try {
    const rn = getRNRuntime();
    if (!rn) return;

    if (rn.Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!activeUserId) return;
        if (document.visibilityState === 'visible') {
          recordLifecycleEvent('app_foreground');
        } else if (document.visibilityState === 'hidden') {
          recordLifecycleEvent('app_background');
        }
      });
      return;
    }

    lastAppState = rn.AppState.currentState;
    rn.AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prevState = lastAppState;
      lastAppState = nextState;
      if (!activeUserId) return;

      if (nextState === 'active' && prevState !== 'active') {
        recordLifecycleEvent('app_foreground');
      } else if (nextState === 'background' && prevState !== 'background') {
        recordLifecycleEvent('app_background');
      }
    });
  } catch {
    // Running outside React Native runtime (e.g., Node tests).
  }
}
