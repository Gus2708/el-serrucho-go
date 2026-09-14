import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import { supabase } from './supabase';
import {
  EVENT_ACTIVE,
  EVENT_BACKGROUND,
  EVENT_BOOT,
  EVENT_CRASH_REPORTED,
  MENSAJE_MAX,
  STACK_MAX,
  appendBreadcrumb,
  isAbnormalExit,
  parseJsonArray,
  prunePending,
  sanitizeMeta,
  truncate,
  type Breadcrumb,
  type PendingReport,
} from './crashTrail';

// ── Diagnóstico de crashes en dispositivos reales ───────────────────────────
//
// No hay Sentry/Bugsnag en el proyecto. Logger mínimo sobre Supabase:
//  - Un rastro de breadcrumbs en AsyncStorage. Si el proceso muere con la app
//    en primer plano (crash nativo, sin excepción JS), el próximo arranque lo
//    detecta y lo encola como 'session_trail'.
//  - Un handler global para excepciones JS no capturadas ('js_error'). En un
//    error fatal espera a que el reporte llegue a disco antes de dejar que RN
//    mate el proceso.
//  - Los reportes quedan en una cola persistida hasta que el insert se
//    confirma: sin red o sin sesión no se pierde nada.
//
// Solo corre en builds nativas de release: en dev cada recarga de Metro
// parecería un crash, y web tiene sus propias herramientas.

const TRAIL_KEY = 'serrucho-crashlog-trail-v2';
const PENDING_KEY = 'serrucho-crashlog-pending-v2';
const FATAL_PERSIST_TIMEOUT_MS = 1500;

type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;

let enabled = false;
let bootDone = false;
let bootPromise: Promise<void> = Promise.resolve();
let trail: Breadcrumb[] = [];
let pending: PendingReport[] = [];
let flushing = false;

// Nada se escribe hasta leer lo que dejó la sesión anterior: si no, el rastro
// nuevo pisaría al viejo antes de revisarlo.
function canPersist(): boolean {
  return enabled && bootDone;
}

function persistTrail(): Promise<void> {
  if (!canPersist()) return Promise.resolve();
  return AsyncStorage.setItem(TRAIL_KEY, JSON.stringify(trail)).catch(() => {});
}

function persistAll(): Promise<void> {
  if (!canPersist()) return Promise.resolve();
  return AsyncStorage.multiSet([
    [TRAIL_KEY, JSON.stringify(trail)],
    [PENDING_KEY, JSON.stringify(pending)],
  ]).catch(() => {});
}

/** Registra un paso de diagnóstico y lo persiste de inmediato (para sobrevivir un crash del proceso). */
export function logBreadcrumb(evento: string, meta?: Record<string, unknown>): void {
  trail = appendBreadcrumb(trail, { ts: Date.now(), evento, meta: sanitizeMeta(meta) });
  void persistTrail();
}

function enqueue(report: Omit<PendingReport, 'ocurridoEn'>): void {
  const now = Date.now();
  pending = prunePending([...pending, { ...report, ocurridoEn: now }], now);
}

function deviceInfo(): {
  plataforma: string;
  marca: string | null;
  modelo: string | null;
  version_so: string | null;
  app_version: string | null;
} {
  const androidConstants = Platform.OS === 'android' ? Platform.constants : null;
  return {
    plataforma:  Platform.OS,
    marca:       truncate(androidConstants?.Brand, 100),
    modelo:      truncate(androidConstants?.Model, 100),
    version_so:  truncate(androidConstants ? androidConstants.Release : String(Platform.Version), 50),
    app_version: truncate(Constants.expoConfig?.version, 50),
  };
}

async function flushPending(): Promise<void> {
  if (!canPersist() || flushing || pending.length === 0) return;
  flushing = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    for (const report of [...pending]) {
      // Sin sesión se sube anónimo (migración 048): un crash antes de
      // iniciar sesión también tiene que llegar.
      const { error } = await supabase.from('crash_reports').insert({
        empleado_id: session?.user?.id ?? null,
        tipo:        report.tipo,
        mensaje:     report.mensaje,
        stack:       report.stack,
        breadcrumbs: report.breadcrumbs,
        ...deviceInfo(),
      });
      // insert() no lanza: devuelve el error. Sin red o con el JWT vencido,
      // el reporte queda en la cola para el próximo intento.
      if (error) break;
      pending = pending.filter((item) => item !== report);
      await persistAll();
    }
  } catch {
    // Falla de red: los reportes siguen encolados.
  } finally {
    flushing = false;
  }
}

function installErrorHandler(): void {
  const errorUtils = (global as typeof global & {
    ErrorUtils?: {
      getGlobalHandler?: () => GlobalErrorHandler;
      setGlobalHandler?: (handler: GlobalErrorHandler) => void;
    };
  }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;

  const previousHandler = errorUtils.getGlobalHandler?.();

  errorUtils.setGlobalHandler((error, isFatal) => {
    try {
      enqueue({
        tipo:        'js_error',
        mensaje:     truncate(error?.message, MENSAJE_MAX),
        stack:       truncate(error?.stack, STACK_MAX),
        breadcrumbs: trail,
      });

      if (!isFatal) {
        void persistAll().then(flushPending);
        previousHandler?.(error, isFatal);
        return;
      }

      // En release, el handler por defecto de RN mata el proceso al instante.
      // Se le da al reporte una ventana corta para llegar a disco (se sube en
      // el próximo arranque), y se marca el rastro para no reportarlo dos
      // veces. El marcador se escribe junto con la cola en un solo multiSet.
      trail = appendBreadcrumb(trail, { ts: Date.now(), evento: EVENT_CRASH_REPORTED });
      const persisted = bootPromise.then(persistAll);
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, FATAL_PERSIST_TIMEOUT_MS));
      void Promise.race([persisted, timeout]).finally(() => previousHandler?.(error, isFatal));
    } catch {
      // Un bug en el logger nunca puede tragarse el manejo normal del error.
      previousHandler?.(error, isFatal);
    }
  });
}

/**
 * Llamar UNA sola vez, lo antes posible al arrancar la app (nivel módulo,
 * antes de cualquier componente).
 */
export function initCrashLog(): void {
  if (enabled || __DEV__ || Platform.OS === 'web') return;
  enabled = true;

  logBreadcrumb(EVENT_BOOT);
  installErrorHandler();

  bootPromise = AsyncStorage.multiGet([TRAIL_KEY, PENDING_KEY])
    .then((entries) => {
      const stored = Object.fromEntries(entries);
      const previousTrail = parseJsonArray<Breadcrumb>(stored[TRAIL_KEY]);
      const storedPending = parseJsonArray<PendingReport>(stored[PENDING_KEY]);
      const recovered: PendingReport[] = isAbnormalExit(previousTrail)
        ? [{
            tipo:        'session_trail',
            mensaje:     null,
            stack:       null,
            breadcrumbs: previousTrail,
            ocurridoEn:  previousTrail[previousTrail.length - 1].ts,
          }]
        : [];
      // Lo que esta sesión ya encoló antes de terminar la lectura (un crash
      // muy temprano) va al final.
      pending = prunePending([...storedPending, ...recovered, ...pending], Date.now());
    })
    .catch(() => {})
    .finally(() => {
      bootDone = true;
    });

  void bootPromise.then(persistAll).then(flushPending);

  AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      logBreadcrumb(EVENT_BACKGROUND);
      void flushPending();
    } else if (state === 'active') {
      logBreadcrumb(EVENT_ACTIVE);
      void flushPending();
    }
  });
}
