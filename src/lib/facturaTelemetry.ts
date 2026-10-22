import type { Event, Scope, SeverityLevel } from '@sentry/react-native';

/**
 * Privacy-safe reporting of unexpected invoice failures. A report is built only from the static
 * values below: no error message, payload, supplier or money data, path, URL, id, breadcrumb or replay.
 * Expected outcomes (validation, stale version, reused key, authorization, not found, offline) are never reported.
 */

const OPERATION_LEVELS = {
  list: 'error',
  open: 'error',
  save: 'error',
  upload: 'error',
  download: 'error',
  cleanup: 'warning',
  pick_document: 'error',
  hash_document: 'error',
  local_read: 'error',
  local_write: 'error',
  local_list: 'error',
  local_quarantine: 'error',
} as const satisfies Record<string, SeverityLevel>;

export type FacturaOperation = keyof typeof OPERATION_LEVELS;
export type FacturaFailureCode = 'desconocido' | 'unexpected' | 'unavailable' | 'quota' | 'corrupt';

export interface FacturaFailure {
  operation: FacturaOperation;
  code: FacturaFailureCode;
  /** Five-character SQLSTATE of a server answer that no typed error covers. */
  sqlState?: string;
  httpStatus?: number;
}

const REPORTABLE_CODES: ReadonlySet<string> = new Set<FacturaFailureCode>([
  'desconocido',
  'unavailable',
  'quota',
  'corrupt',
]);
const EXPECTED_CODES: ReadonlySet<string> = new Set([
  'no_autorizado',
  'version_obsoleta',
  'clave_reutilizada',
  'datos_invalidos',
  'no_encontrada',
  'red',
  'unsupported_schema',
]);
const SQLSTATE_SHAPE = /^[0-9A-Z]{5}$/;
const THROTTLE_MS = 60_000;
const FEATURE = 'factura_proveedor';

function safeSqlState(value: unknown): string | undefined {
  return typeof value === 'string' && SQLSTATE_SHAPE.test(value) ? value : undefined;
}

function safeHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function fingerprintOf({ operation, code, sqlState, httpStatus }: FacturaFailure): string[] {
  return [FEATURE, operation, code, ...(sqlState ? [sqlState] : []), ...(httpStatus ? [String(httpStatus)] : [])];
}

export interface FacturaReporterOptions {
  capture: (failure: FacturaFailure) => void;
  now?: () => number;
}

/** `capture` is the only side effect. Reporting never throws, repeats an error object or floods one failure. */
export function createFacturaReporter({ capture, now = () => Date.now() }: FacturaReporterOptions) {
  const seen = new WeakSet<object>();
  const lastSent = new Map<string, number>();

  function reportFacturaFailure(failure: FacturaFailure, source?: unknown): void {
    try {
      if (typeof source === 'object' && source !== null) {
        if (seen.has(source)) return;
        seen.add(source);
      }
      const sqlState = safeSqlState(failure.sqlState);
      const httpStatus = safeHttpStatus(failure.httpStatus);
      const safe: FacturaFailure = {
        operation: failure.operation,
        code: failure.code,
        ...(sqlState && { sqlState }),
        ...(httpStatus && { httpStatus }),
      };
      const key = fingerprintOf(safe).join('|');
      const at = now();
      const previous = lastSent.get(key);
      if (previous !== undefined && at - previous < THROTTLE_MS) return;
      lastSent.set(key, at);
      capture(safe);
    } catch {
      // Telemetry must never change what the app does.
    }
  }

  /** For caught values: typed expected outcomes are skipped, anything else is reported by its class only. */
  function reportFacturaThrown(operation: FacturaOperation, error: unknown): void {
    const { code, sqlState, httpStatus } = (error ?? {}) as { code?: unknown; sqlState?: string; httpStatus?: number };
    if (typeof code === 'string' && EXPECTED_CODES.has(code)) return;
    const reported = typeof code === 'string' && REPORTABLE_CODES.has(code) ? (code as FacturaFailureCode) : 'unexpected';
    reportFacturaFailure({ operation, code: reported, sqlState, httpStatus }, error);
  }

  return { reportFacturaFailure, reportFacturaThrown };
}

export interface SentryApi {
  withScope(callback: (scope: Scope) => void): unknown;
  captureEvent(event: Event): unknown;
}

/**
 * The event is rebuilt from the static report by a scope processor, which runs after every integration
 * and scope merge. That drops user, request, contexts, extra, modules, breadcrumbs and exceptions that
 * other integrations add; it also clears attachments, the trace context and the sampling context
 * (which can carry a replay id). Only release, environment and dist are kept from the client.
 */
export function createSentrySink(load: () => SentryApi): (failure: FacturaFailure) => void {
  return function sendToSentry(failure) {
    const { withScope, captureEvent } = load();
    const base: Event = {
      message: `factura.${failure.operation}.${failure.code}`,
      level: OPERATION_LEVELS[failure.operation],
      tags: {
        feature: FEATURE,
        operation: failure.operation,
        code: failure.code,
        ...(failure.sqlState && { sql_state: failure.sqlState }),
        ...(failure.httpStatus && { http_status: String(failure.httpStatus) }),
      },
      fingerprint: fingerprintOf(failure),
    };

    withScope(scope => {
      scope.addEventProcessor((event, hint) => {
        hint.attachments = [];
        return {
          ...base,
          event_id: event.event_id,
          timestamp: event.timestamp,
          platform: event.platform,
          release: event.release,
          environment: event.environment,
          dist: event.dist,
          // The client fills these in after the processors, unless the key is present: undefined wins.
          contexts: { trace: undefined },
          sdkProcessingMetadata: { dynamicSamplingContext: undefined },
        };
      });
      captureEvent(base);
    });
  };
}

export const { reportFacturaFailure, reportFacturaThrown } = createFacturaReporter({
  // Loaded on first use so the invoice layers stay importable where the native SDK is not (unit tests).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  capture: createSentrySink(() => require('@sentry/react-native') as SentryApi),
});
