import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// ── Diagnóstico de crashes en dispositivos reales ───────────────────────────
//
// No hay Sentry/Bugsnag en el proyecto. Esto es un logger mínimo, propio,
// sobre la infra que ya existe (Supabase): guarda un rastro de "breadcrumbs"
// en AsyncStorage a medida que la app hace cosas riesgosas, y lo sube a la
// nube en el PRÓXIMO arranque — así, si el proceso muere sin que JS llegue a
// enterarse (crash nativo puro), igual queda la última pista antes del corte.
// Además instala un handler global para las excepciones JS no capturadas,
// que sí es capturable la mayoría de las veces en RN.

const STORAGE_KEY = 'serrucho-crash-breadcrumbs-v1';
const MAX_BREADCRUMBS = 40;

type Breadcrumb = { ts: number; evento: string; meta?: Record<string, unknown> };

let breadcrumbs: Breadcrumb[] = [];

/** Registra un paso de diagnóstico y lo persiste de inmediato (para sobrevivir un crash del proceso). */
export function logBreadcrumb(evento: string, meta?: Record<string, unknown>): void {
  breadcrumbs.push({ ts: Date.now(), evento, meta });
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs = breadcrumbs.slice(-MAX_BREADCRUMBS);
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(breadcrumbs)).catch(() => {});
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
    marca:       androidConstants?.Brand ?? null,
    modelo:      androidConstants?.Model ?? (Constants.deviceName ?? null),
    version_so:  androidConstants ? String(androidConstants.Release) : String(Platform.Version ?? ''),
    app_version: Constants.expoConfig?.version ?? null,
  };
}

async function uploadReport(
  tipo: 'js_error' | 'session_trail',
  extra: { mensaje?: string; stack?: string; trail: Breadcrumb[] },
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.from('crash_reports').insert({
      empleado_id: session?.user?.id ?? null,
      tipo,
      mensaje:     extra.mensaje ?? null,
      stack:       extra.stack ?? null,
      breadcrumbs: extra.trail,
      ...deviceInfo(),
    });
  } catch {
    // Sin red, sin sesión, o falló el insert: no hay nada más que hacer acá.
  }
}

/**
 * Llamar UNA sola vez, lo antes posible al arrancar la app (nivel módulo,
 * antes de cualquier componente).
 */
export function initCrashLog(): void {
  // 1. Subir el rastro de la sesión anterior, si el proceso murió con
  //    breadcrumbs pendientes (crash nativo sin excepción JS capturable).
  AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      const trail = JSON.parse(raw) as Breadcrumb[];
      if (trail.length > 0) uploadReport('session_trail', { trail });
    })
    .catch(() => {});

  logBreadcrumb('app_boot');

  // 2. Handler global para excepciones JS no capturadas — cubre la mayoría
  //    de los "dejó de funcionar" en RN, que suelen ser esto antes de que el
  //    bridge tumbe el proceso nativo.
  const globalWithErrorUtils = global as typeof global & {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
    };
  };
  const errorUtils = globalWithErrorUtils.ErrorUtils;
  if (errorUtils?.setGlobalHandler) {
    const previousHandler = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error, isFatal) => {
      logBreadcrumb('js_error', { isFatal, mensaje: error?.message });
      uploadReport('js_error', { mensaje: error?.message, stack: error?.stack, trail: breadcrumbs });
      previousHandler?.(error, isFatal);
    });
  }
}
