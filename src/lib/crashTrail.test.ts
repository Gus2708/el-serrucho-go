import {
  EVENT_ACTIVE,
  EVENT_BACKGROUND,
  EVENT_BOOT,
  EVENT_CRASH_REPORTED,
  MAX_BREADCRUMBS,
  MAX_PENDING,
  PENDING_MAX_AGE_MS,
  appendBreadcrumb,
  isAbnormalExit,
  parseJsonArray,
  prunePending,
  sanitizeMeta,
  truncate,
  type Breadcrumb,
  type PendingReport,
} from './crashTrail';

function crumb(evento: string, ts = 0): Breadcrumb {
  return { ts, evento };
}

function report(ocurridoEn: number): PendingReport {
  return { tipo: 'session_trail', mensaje: null, stack: null, breadcrumbs: [], ocurridoEn };
}

describe('isAbnormalExit', () => {
  it('ignores an empty trail (first launch)', () => {
    expect(isAbnormalExit([])).toBe(false);
  });

  it('flags a session that died in the foreground', () => {
    expect(isAbnormalExit([crumb(EVENT_BOOT), crumb('push: pidiendo permiso de notificaciones')])).toBe(true);
  });

  it('treats dying after going to background as a normal exit', () => {
    expect(isAbnormalExit([crumb(EVENT_BOOT), crumb('push: token obtenido'), crumb(EVENT_BACKGROUND)])).toBe(false);
  });

  it('keeps it a normal exit when breadcrumbs keep arriving in background', () => {
    expect(isAbnormalExit([crumb(EVENT_BOOT), crumb(EVENT_BACKGROUND), crumb('push: token obtenido')])).toBe(false);
  });

  it('flags a crash after returning to the foreground', () => {
    expect(
      isAbnormalExit([crumb(EVENT_BOOT), crumb(EVENT_BACKGROUND), crumb(EVENT_ACTIVE), crumb('auth: evento SIGNED_IN')]),
    ).toBe(true);
  });

  it('does not report twice a fatal JS error that was already queued', () => {
    expect(isAbnormalExit([crumb(EVENT_BOOT), crumb('auth: evento SIGNED_IN'), crumb(EVENT_CRASH_REPORTED)])).toBe(false);
  });

  it('flags a trail whose lifecycle marker was trimmed away', () => {
    expect(isAbnormalExit([crumb('push: canales android listos'), crumb('push: chequeando permiso existente')])).toBe(true);
  });
});

describe('appendBreadcrumb', () => {
  it('caps the trail keeping the most recent breadcrumbs', () => {
    let trail: Breadcrumb[] = [];
    for (let i = 0; i < MAX_BREADCRUMBS + 5; i++) trail = appendBreadcrumb(trail, crumb(`e${i}`, i));

    expect(trail).toHaveLength(MAX_BREADCRUMBS);
    expect(trail[0].evento).toBe('e5');
    expect(trail[trail.length - 1].evento).toBe(`e${MAX_BREADCRUMBS + 4}`);
  });

  it('does not mutate the previous trail', () => {
    const trail = [crumb('a')];
    appendBreadcrumb(trail, crumb('b'));
    expect(trail).toHaveLength(1);
  });
});

describe('prunePending', () => {
  const now = 1_000_000_000_000;

  it('drops reports older than the max age', () => {
    const pruned = prunePending([report(now - PENDING_MAX_AGE_MS - 1), report(now - 1000)], now);
    expect(pruned).toEqual([report(now - 1000)]);
  });

  it('keeps only the newest reports', () => {
    const queue = Array.from({ length: MAX_PENDING + 2 }, (_, i) => report(now - 1000 + i));
    const pruned = prunePending(queue, now);

    expect(pruned).toHaveLength(MAX_PENDING);
    expect(pruned[0].ocurridoEn).toBe(now - 1000 + 2);
  });
});

describe('truncate', () => {
  it('cuts long strings and keeps short ones', () => {
    expect(truncate('abcdef', 3)).toBe('abc');
    expect(truncate('ab', 3)).toBe('ab');
  });

  it('normalizes null and undefined to null', () => {
    expect(truncate(undefined, 3)).toBeNull();
    expect(truncate(null, 3)).toBeNull();
  });
});

describe('sanitizeMeta', () => {
  it('truncates long string values and leaves other types alone', () => {
    const meta = sanitizeMeta({ error: 'x'.repeat(1000), isFatal: true, status: 'granted' });
    expect((meta?.error as string).length).toBe(300);
    expect(meta?.isFatal).toBe(true);
    expect(meta?.status).toBe('granted');
  });

  it('returns undefined without meta', () => {
    expect(sanitizeMeta()).toBeUndefined();
  });
});

describe('parseJsonArray', () => {
  it('returns an empty array for missing or corrupt storage', () => {
    expect(parseJsonArray(null)).toEqual([]);
    expect(parseJsonArray('{not json')).toEqual([]);
    expect(parseJsonArray('{"a":1}')).toEqual([]);
  });

  it('parses a stored array', () => {
    expect(parseJsonArray<Breadcrumb>('[{"ts":1,"evento":"app_boot"}]')).toEqual([{ ts: 1, evento: 'app_boot' }]);
  });
});
