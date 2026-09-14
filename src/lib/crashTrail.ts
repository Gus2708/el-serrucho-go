// Lógica pura del logger de crashes (sin React Native ni Supabase), para
// poder testearla. El I/O vive en ./crashLog.

export type Breadcrumb = { ts: number; evento: string; meta?: Record<string, unknown> };

export type PendingReport = {
  tipo: 'js_error' | 'session_trail';
  mensaje: string | null;
  stack: string | null;
  breadcrumbs: Breadcrumb[];
  ocurridoEn: number;
};

export const MAX_BREADCRUMBS = 40;
export const MAX_PENDING = 5;
export const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Mismos topes que los CHECK de la migración 048: un reporte más grande
// rebotaría en la base y quedaría trabado en la cola.
export const MENSAJE_MAX = 2000;
export const STACK_MAX = 20000;
const META_STRING_MAX = 300;

export const EVENT_BOOT = 'app_boot';
export const EVENT_ACTIVE = 'app: active';
export const EVENT_BACKGROUND = 'app: background';
export const EVENT_CRASH_REPORTED = 'crash: reportado';

export function truncate(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    sanitized[key] = typeof value === 'string' ? truncate(value, META_STRING_MAX) : value;
  }
  return sanitized;
}

export function appendBreadcrumb(trail: Breadcrumb[], crumb: Breadcrumb): Breadcrumb[] {
  const next = [...trail, crumb];
  return next.length > MAX_BREADCRUMBS ? next.slice(-MAX_BREADCRUMBS) : next;
}

/**
 * Una sesión terminó mal si el proceso murió con la app en primer plano: el
 * último marcador de ciclo de vida no es "background", y el crash no quedó ya
 * encolado como js_error. Un cierre normal de Android siempre pasa antes por
 * background, así que no genera reporte.
 */
export function isAbnormalExit(trail: Breadcrumb[]): boolean {
  for (let i = trail.length - 1; i >= 0; i--) {
    const { evento } = trail[i];
    if (evento === EVENT_BACKGROUND || evento === EVENT_CRASH_REPORTED) return false;
    if (evento === EVENT_ACTIVE || evento === EVENT_BOOT) return true;
  }
  // Sin marcador (quedó fuera del rastro recortado): los últimos breadcrumbs
  // pasaron en primer plano, porque ir a background siempre agrega uno.
  return trail.length > 0;
}

/** Descarta reportes viejos y deja solo los más recientes, para que la cola nunca crezca sin límite. */
export function prunePending(pending: PendingReport[], now: number): PendingReport[] {
  return pending
    .filter((report) => now - report.ocurridoEn <= PENDING_MAX_AGE_MS)
    .slice(-MAX_PENDING);
}

export function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
