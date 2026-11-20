// Pure logic for the client-side employee activity/audit queue (no RN/Supabase I/O).

export const AUDIT_MAX_QUEUE = 100;
export const AUDIT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const LIFECYCLE_DEDUP_MS = 2_000;

export const EVENTO_MAX = 80;
export const ENTIDAD_MAX = 60;
export const ENTIDAD_ID_MAX = 80;
const DETAIL_STRING_MAX = 400;
const DETAIL_MAX_DEPTH = 4;
const DETAIL_MAX_ARRAY_ITEMS = 25;

const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|authorization|apikey|api_key|cookie|credential)/i;

export type AuditDeviceInfo = {
  plataforma: string;
  marca: string | null;
  modelo: string | null;
  version_so: string | null;
  app_version: string | null;
};

export type AuditEventInput = {
  evento: string;
  entidad?: string | null;
  entidadId?: string | number | null;
  empleadoId?: string | null;
  detalle?: Record<string, unknown>;
};

export type QueuedAuditEvent = AuditDeviceInfo & {
  evento: string;
  entidad: string | null;
  entidad_id: string | null;
  empleado_id: string | null;
  detalle: Record<string, unknown>;
  cliente_ts: string;
  ocurridoEn: number;
};

export function truncateAuditText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    return value.length > DETAIL_STRING_MAX ? value.slice(0, DETAIL_STRING_MAX) : value;
  }
  if (depth >= DETAIL_MAX_DEPTH) return undefined;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value.slice(0, DETAIL_MAX_ARRAY_ITEMS)) {
      const cleanItem = sanitizeValue(item, depth + 1);
      if (cleanItem !== undefined) out.push(cleanItem);
    }
    return out;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      const cleanEntry = sanitizeValue(entry, depth + 1);
      if (cleanEntry !== undefined) out[key] = cleanEntry;
    }
    return out;
  }

  return undefined;
}

export function sanitizeAuditDetail(detalle?: Record<string, unknown>): Record<string, unknown> {
  if (!detalle || typeof detalle !== 'object' || Array.isArray(detalle)) return {};
  const cleaned = sanitizeValue(detalle, 0);
  if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) return {};
  return cleaned as Record<string, unknown>;
}

export function buildAuditRecord(
  input: AuditEventInput,
  device: AuditDeviceInfo,
  nowMs: number,
): QueuedAuditEvent {
  const rawEntityId = input.entidadId != null ? String(input.entidadId) : null;
  return {
    evento: truncateAuditText(input.evento, EVENTO_MAX) ?? 'evento_desconocido',
    entidad: truncateAuditText(input.entidad, ENTIDAD_MAX),
    entidad_id: truncateAuditText(rawEntityId, ENTIDAD_ID_MAX),
    empleado_id: truncateAuditText(input.empleadoId, 80),
    detalle: sanitizeAuditDetail(input.detalle),
    cliente_ts: new Date(nowMs).toISOString(),
    ocurridoEn: nowMs,
    plataforma: truncateAuditText(device.plataforma, 20) ?? 'unknown',
    marca: truncateAuditText(device.marca, 100),
    modelo: truncateAuditText(device.modelo, 100),
    version_so: truncateAuditText(device.version_so, 50),
    app_version: truncateAuditText(device.app_version, 50),
  };
}

export function partitionQueueForUser(
  queue: readonly QueuedAuditEvent[],
  userId: string,
): { toFlush: QueuedAuditEvent[]; droppedForeign: number } {
  const toFlush: QueuedAuditEvent[] = [];
  let droppedForeign = 0;
  for (const item of queue) {
    if (item.empleado_id === null || item.empleado_id === userId) {
      toFlush.push(item);
    } else {
      droppedForeign += 1;
    }
  }
  return { toFlush, droppedForeign };
}

export function enqueueAuditRecord(
  queue: readonly QueuedAuditEvent[],
  record: QueuedAuditEvent,
  nowMs: number,
): QueuedAuditEvent[] {
  return [...queue, record]
    .filter((item) => nowMs - item.ocurridoEn <= AUDIT_MAX_AGE_MS)
    .slice(-AUDIT_MAX_QUEUE);
}

export function shouldSkipLifecycleEvent(
  nextEvento: string,
  lastEvento: string | null,
  lastTsMs: number,
  nowMs: number,
): boolean {
  if (nextEvento === 'app_open') return false;
  if (nextEvento !== lastEvento) return false;
  return nowMs - lastTsMs <= LIFECYCLE_DEDUP_MS;
}

function isValidQueuedEvent(value: unknown): value is QueuedAuditEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.evento === 'string' &&
    candidate.evento.length > 0 &&
    typeof candidate.cliente_ts === 'string' &&
    typeof candidate.ocurridoEn === 'number' &&
    typeof candidate.plataforma === 'string' &&
    typeof candidate.detalle === 'object' &&
    candidate.detalle !== null &&
    !Array.isArray(candidate.detalle)
  );
}

export function parseAuditQueue(raw: string | null | undefined): QueuedAuditEvent[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidQueuedEvent);
  } catch {
    return [];
  }
}
