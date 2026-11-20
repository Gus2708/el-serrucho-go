import {
  AUDIT_MAX_AGE_MS,
  AUDIT_MAX_QUEUE,
  LIFECYCLE_DEDUP_MS,
  buildAuditRecord,
  enqueueAuditRecord,
  parseAuditQueue,
  partitionQueueForUser,
  sanitizeAuditDetail,
  shouldSkipLifecycleEvent,
  type QueuedAuditEvent,
} from './auditQueue';

const DEVICE = {
  plataforma: 'android',
  marca: 'POCO',
  modelo: '2412DPC0AG',
  version_so: '16',
  app_version: '1.2.8',
};

describe('sanitizeAuditDetail', () => {
  it('strips sensitive keys recursively and preserves safe fields', () => {
    const clean = sanitizeAuditDetail({
      codigo_producto: 'CEMCSC',
      valor_tecleado: '358',
      delta: 358,
      password: 'secret',
      accessToken: 'jwt-abc',
      nested: {
        modo_ui: 'relative',
        authorization: 'Bearer 123',
        ok: true,
      },
    });

    expect(clean).toEqual({
      codigo_producto: 'CEMCSC',
      valor_tecleado: '358',
      delta: 358,
      nested: {
        modo_ui: 'relative',
        ok: true,
      },
    });
  });

  it('truncates long strings and returns empty object for nullish input', () => {
    expect(sanitizeAuditDetail(undefined)).toEqual({});
    const clean = sanitizeAuditDetail({ nota: 'a'.repeat(600) });
    expect((clean.nota as string).length).toBeLessThanOrEqual(400);
  });
});

describe('buildAuditRecord', () => {
  it('builds a normalized record with ISO client_ts and truncated fields', () => {
    const now = Date.parse('2026-11-19T12:30:46.630Z');
    const record = buildAuditRecord(
      {
        evento: 'ajuste_rapido_enviado',
        entidad: 'ordenes_cambio',
        entidadId: 35965,
        detalle: { modo_ui: 'relative', operador_ui: '+', valor_tecleado: '358', delta: 358 },
      },
      DEVICE,
      now,
    );

    expect(record).toEqual({
      evento: 'ajuste_rapido_enviado',
      entidad: 'ordenes_cambio',
      entidad_id: '35965',
      empleado_id: null,
      detalle: { modo_ui: 'relative', operador_ui: '+', valor_tecleado: '358', delta: 358 },
      cliente_ts: '2026-11-19T12:30:46.630Z',
      ocurridoEn: now,
      ...DEVICE,
    });
  });
});

describe('enqueueAuditRecord', () => {
  function makeEvent(ts: number, evento = 'app_foreground'): QueuedAuditEvent {
    return buildAuditRecord({ evento }, DEVICE, ts);
  }

  it('drops events older than max age and caps queue keeping newest events', () => {
    const now = 1_800_000_000_000;
    const stale = makeEvent(now - AUDIT_MAX_AGE_MS - 1000, 'stale_event');
    const existing = [
      stale,
      ...Array.from({ length: AUDIT_MAX_QUEUE }, (_, idx) => makeEvent(now - 5000 + idx, `ev_${idx}`)),
    ];
    const newest = makeEvent(now, 'ev_newest');

    const next = enqueueAuditRecord(existing, newest, now);

    expect(next).toHaveLength(AUDIT_MAX_QUEUE);
    expect(next.some((e) => e.evento === 'stale_event')).toBe(false);
    expect(next[0].evento).toBe('ev_1');
    expect(next[next.length - 1].evento).toBe('ev_newest');
  });
});

describe('shouldSkipLifecycleEvent', () => {
  it('deduplicates rapid duplicate foreground/background events within cooldown', () => {
    const t0 = 1_000_000;
    expect(shouldSkipLifecycleEvent('app_foreground', 'app_foreground', t0, t0 + 500)).toBe(true);
    expect(shouldSkipLifecycleEvent('app_foreground', 'app_foreground', t0, t0 + LIFECYCLE_DEDUP_MS + 1)).toBe(false);
    expect(shouldSkipLifecycleEvent('app_foreground', 'app_background', t0, t0 + 200)).toBe(false);
  });

  it('never skips app_open events', () => {
    const t0 = 1_000_000;
    expect(shouldSkipLifecycleEvent('app_open', 'app_open', t0, t0 + 100)).toBe(false);
  });
});

describe('parseAuditQueue', () => {
  it('returns empty array for missing, invalid, or malformed storage', () => {
    expect(parseAuditQueue(null)).toEqual([]);
    expect(parseAuditQueue('{bad json')).toEqual([]);
    expect(parseAuditQueue('{"not":"array"}')).toEqual([]);
  });

  it('filters out invalid entries and preserves valid queued events', () => {
    const valid = buildAuditRecord({ evento: 'app_open', empleadoId: 'user-a' }, DEVICE, 1_795_000_000_000);
    const raw = JSON.stringify([valid, { broken: true }, null]);
    expect(parseAuditQueue(raw)).toEqual([valid]);
  });
});

describe('partitionQueueForUser', () => {
  it('only flushes events belonging to the active user (or unbound boot events) and drops foreign-user events', () => {
    const own = buildAuditRecord({ evento: 'app_foreground', empleadoId: 'user-a' }, DEVICE, 1000);
    const bootUnbound = buildAuditRecord({ evento: 'app_open', empleadoId: null }, DEVICE, 1001);
    const foreign = buildAuditRecord({ evento: 'ajuste_rapido_enviado', empleadoId: 'user-b' }, DEVICE, 1002);

    const { toFlush, droppedForeign } = partitionQueueForUser([own, bootUnbound, foreign], 'user-a');

    expect(toFlush).toEqual([own, bootUnbound]);
    expect(droppedForeign).toBe(1);
  });
});
