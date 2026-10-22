import type { Event } from '@sentry/react-native';
import {
  addLinea,
  buildSavePayload,
  createDraft,
  MAX_LINEAS,
  type FacturaDocumento,
  type FacturaDraft,
} from './facturaProveedor';
import { MAX_DOCUMENT_BYTES } from './facturaDocumento';
import {
  createFacturaLocalStore,
  facturaKey,
  type FacturaLocalRecord,
  type StorageLike,
} from './facturaLocalStore';

const mockCaptureEvent = jest.fn();
jest.mock('@sentry/react-native', () => ({
  withScope: (callback: (scope: unknown) => void) => callback({ addEventProcessor: jest.fn() }),
  captureEvent: (event: unknown) => mockCaptureEvent(event),
}));

const UID_A = '11111111-1111-4111-8111-111111111111';
const UID_B = '22222222-2222-4222-8222-222222222222';
const FACTURA_1 = 'f0000000-0000-4000-8000-000000000001';
const FACTURA_2 = 'f0000000-0000-4000-8000-000000000002';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const L2 = 'a0000000-0000-4000-8000-000000000002';
const SHA = 'a'.repeat(64);

/** In-memory StorageLike that records the real order in which setItem calls start and finish. */
class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  started: { key: string; seq: number | null }[] = [];
  completed: { key: string; seq: number | null }[] = [];
  beforeSet?: (key: string, value: string) => Promise<void> | void;
  failGet?: (key: string) => Error | undefined;
  failSet?: (key: string) => Error | undefined;
  failRemove?: (key: string) => Error | undefined;
  failKeys?: Error;

  async getItem(key: string): Promise<string | null> {
    const failure = this.failGet?.(key);
    if (failure) throw failure;
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    const seq = seqOf(value);
    this.started.push({ key, seq });
    await this.beforeSet?.(key, value);
    const failure = this.failSet?.(key);
    if (failure) throw failure;
    this.data.set(key, value);
    this.completed.push({ key, seq });
  }

  async removeItem(key: string): Promise<void> {
    const failure = this.failRemove?.(key);
    if (failure) throw failure;
    this.data.delete(key);
  }

  async getAllKeys(): Promise<readonly string[]> {
    if (this.failKeys) throw this.failKeys;
    return [...this.data.keys()];
  }
}

/** A fresh runtime over the same persisted bytes: new storage object, so no in-memory queue or counter survives. */
function restart(storage: FakeStorage): FakeStorage {
  const restarted = new FakeStorage();
  restarted.data = new Map(storage.data);
  return restarted;
}

function seqOf(value: string): number | null {
  try {
    const parsed: unknown = JSON.parse(value);
    const seq = (parsed as { seq?: unknown }).seq;
    return typeof seq === 'number' ? seq : null;
  } catch {
    return null;
  }
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function documentFor(uid: string, facturaId: string): FacturaDocumento {
  return {
    path: `${uid}/${facturaId}/doc-1.pdf`,
    nombre: 'factura.pdf',
    mime: 'application/pdf',
    bytes: 2048,
    sha256: SHA,
  };
}

function draftFor(facturaId: string, uid = UID_A): FacturaDraft {
  let draft = createDraft({ facturaId, proveedorCodigo: 'P-1', proveedorNombre: 'Ferretería Norte' });
  draft = addLinea(draft, L1, { codigoProducto: 'TOR-01', cantidad: '10', costoUnitario: '1,5' });
  draft = addLinea(draft, L2, { codigoProducto: 'TOR-01', cantidad: '4', costoUnitario: '2.25' });
  return { ...draft, notas: 'Pago a 30 días, ñandú', documento: documentFor(uid, facturaId) };
}

function recordFor(uid: string, facturaId: string, seq: number): FacturaLocalRecord {
  const draft = draftFor(facturaId, uid);
  const payload = buildSavePayload(draft);
  if (!payload.ok) throw new Error('fixture draft must build a payload');
  return {
    schema: 1,
    uid,
    facturaId,
    seq,
    draft,
    savedDocumentPath: `${uid}/${facturaId}/doc-0.pdf`,
    intent: {
      key: 'idem-key-1',
      baseVersion: 3,
      payload: { cabecera: payload.cabecera, lineas: payload.lineas },
      documentPath: draft.documento?.path ?? null,
    },
    uploads: [
      { path: `${uid}/${facturaId}/doc-2.png`, status: 'pending' },
      { path: `${uid}/${facturaId}/doc-3.jpg`, status: 'failed' },
    ],
    protectedPaths: [`${uid}/${facturaId}/doc-1.pdf`],
  };
}

function plant(storage: FakeStorage, uid: string, facturaId: string, value: unknown): void {
  storage.data.set(facturaKey(uid, facturaId), typeof value === 'string' ? value : JSON.stringify(value));
}

describe('facturaKey', () => {
  it('scopes the key by account and invoice', () => {
    expect(facturaKey(UID_A, FACTURA_1)).toBe(`serrucho-factura-v1:${UID_A}:${FACTURA_1}`);
    expect(facturaKey(UID_B, FACTURA_1)).not.toBe(facturaKey(UID_A, FACTURA_1));
  });

  it.each([
    ['uid with separator', 'a:b', FACTURA_1],
    ['invoice id with separator', UID_A, 'f:1'],
    ['empty uid', '', FACTURA_1],
    ['empty invoice id', UID_A, ''],
  ])('rejects %s so scopes cannot overlap', (_label, uid, facturaId) => {
    expect(() => facturaKey(uid, facturaId)).toThrow(RangeError);
  });
});

describe('reconstruction restores what was persisted', () => {
  it('returns every field, stable line ids, order, repeated lines, attachments and checkpoint unchanged', async () => {
    const storage = new FakeStorage();
    const original = recordFor(UID_A, FACTURA_1, 4);

    const written = await createFacturaLocalStore(storage).write(original);
    expect(written).toEqual({ status: 'written', seq: 4 });

    const restored = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);
    expect(restored.status).toBe('restored');
    if (restored.status !== 'restored') return;
    expect(restored.record).toEqual(original);
    expect(restored.record.draft.lineas.map(linea => linea.lineaId)).toEqual([L1, L2]);
    expect(restored.record.draft.lineas.map(linea => linea.codigoProducto)).toEqual(['TOR-01', 'TOR-01']);
    expect(restored.record.draft.lineas.map(linea => linea.costoUnitario)).toEqual(['1,5', '2.25']);
  });

  it('keeps raw draft text that is not yet a valid amount instead of cleaning it', async () => {
    const storage = new FakeStorage();
    const original = recordFor(UID_A, FACTURA_1, 1);
    original.draft = { ...original.draft, lineas: [{ ...original.draft.lineas[0], cantidad: 'abc', total: '' }] };
    original.intent = null;

    await createFacturaLocalStore(storage).write(original);
    const restored = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);

    expect(restored).toEqual({ status: 'restored', record: original });
  });

  it('returns the checkpoint immutable so a consumer cannot alter the frozen payload', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    await store.write(recordFor(UID_A, FACTURA_1, 2));

    const restored = await store.hydrate(UID_A, FACTURA_1);
    if (restored.status !== 'restored' || restored.record.intent === null) throw new Error('expected a checkpoint');
    const intent = restored.record.intent;

    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.payload.lineas)).toBe(true);
    expect(Object.isFrozen(intent.payload.lineas[0])).toBe(true);
    try {
      (intent as { key: string }).key = 'other';
    } catch {
      // Strict mode throws on a frozen object; sloppy mode ignores the write. Either way it must not change.
    }
    expect(intent.key).toBe('idem-key-1');
  });

  it('reports an invoice that was never persisted as empty', async () => {
    const storage = new FakeStorage();
    expect(await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1)).toEqual({ status: 'empty' });
  });

  it('restores a draft without attachment, checkpoint or markers', async () => {
    const storage = new FakeStorage();
    const bare: FacturaLocalRecord = {
      ...recordFor(UID_A, FACTURA_1, 1),
      savedDocumentPath: null,
      intent: null,
      uploads: [],
      protectedPaths: [],
    };
    bare.draft = { ...bare.draft, documento: null };

    await createFacturaLocalStore(storage).write(bare);
    expect(await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1)).toEqual({
      status: 'restored',
      record: bare,
    });
  });
});

describe('account isolation', () => {
  it('lists, reads and writes only the requesting account even for the same invoice id', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    await store.write(recordFor(UID_A, FACTURA_1, 1));
    await store.write(recordFor(UID_B, FACTURA_1, 7));
    await store.write(recordFor(UID_B, FACTURA_2, 2));
    const untouchedB = storage.data.get(facturaKey(UID_B, FACTURA_1));

    const listedA = await store.listDrafts(UID_A);
    expect(listedA.status).toBe('ok');
    if (listedA.status !== 'ok') return;
    expect(listedA.drafts.map(record => [record.uid, record.facturaId, record.seq])).toEqual([
      [UID_A, FACTURA_1, 1],
    ]);

    await store.write({ ...recordFor(UID_A, FACTURA_1, 2), savedDocumentPath: null });
    expect(storage.data.get(facturaKey(UID_B, FACTURA_1))).toBe(untouchedB);

    const readB = await store.hydrate(UID_B, FACTURA_1);
    expect(readB.status === 'restored' && readB.record.seq).toBe(7);
  });

  it('does not treat another account whose id shares a prefix as its own', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    await store.write(recordFor('user-1', FACTURA_1, 1));
    await store.write(recordFor('user-10', FACTURA_1, 1));

    const listed = await store.listDrafts('user-1');
    expect(listed.status === 'ok' && listed.drafts.map(record => record.uid)).toEqual(['user-1']);
  });

  it('refuses a record planted under one account that claims another owner, without touching the other account', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    await store.write(recordFor(UID_B, FACTURA_1, 5));
    const ownB = storage.data.get(facturaKey(UID_B, FACTURA_1));
    plant(storage, UID_A, FACTURA_1, recordFor(UID_B, FACTURA_1, 9));

    const result = await store.hydrate(UID_A, FACTURA_1);

    expect(result.status === 'error' && result.error.code).toBe('corrupt');
    expect(storage.data.get(facturaKey(UID_B, FACTURA_1))).toBe(ownB);
    const listedA = await store.listDrafts(UID_A);
    expect(listedA.status === 'ok' && listedA.drafts).toEqual([]);
  });
});

describe('storage failures are explicit and Spanish', () => {
  it('reports unavailable when reading fails', async () => {
    const storage = new FakeStorage();
    storage.failGet = () => new Error('disk offline');

    const result = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('unavailable');
    expect(result.error.userMessage).toBe('No se pudo acceder al almacenamiento de este dispositivo.');
  });

  it.each([
    ['QuotaExceededError name', Object.assign(new Error('x'), { name: 'QuotaExceededError' })],
    ['quota in message', new Error('The quota has been exceeded')],
    ['SQLite full', new Error('database or disk is full')],
  ])('reports quota (never success) when writing fails with %s, leaving the prior value', async (_label, failure) => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    await store.write(recordFor(UID_A, FACTURA_1, 1));
    const before = storage.data.get(facturaKey(UID_A, FACTURA_1));
    storage.failSet = () => failure;

    const result = await store.write(recordFor(UID_A, FACTURA_1, 2));

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('quota');
    expect(result.error.userMessage).toBe('El almacenamiento de este dispositivo está lleno; el borrador no se guardó.');
    expect(storage.data.get(facturaKey(UID_A, FACTURA_1))).toBe(before);
  });

  it('reports unavailable when writing fails for any other reason', async () => {
    const storage = new FakeStorage();
    storage.failSet = () => new Error('native module crashed');

    const result = await createFacturaLocalStore(storage).write(recordFor(UID_A, FACTURA_1, 1));

    expect(result.status === 'error' && result.error.code).toBe('unavailable');
    expect(storage.data.size).toBe(0);
  });

  it('reports unavailable when the keys cannot be listed', async () => {
    const storage = new FakeStorage();
    storage.failKeys = new Error('keys unavailable');

    const result = await createFacturaLocalStore(storage).listDrafts(UID_A);

    expect(result.status === 'error' && result.error.code).toBe('unavailable');
  });
});

describe('untrusted hydration', () => {
  it('quarantines corrupt JSON, never replays it, and still restores the valid drafts', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    await store.write(recordFor(UID_A, FACTURA_2, 3));
    plant(storage, UID_A, FACTURA_1, '{"schema":1,"uid":');

    const listed = await store.listDrafts(UID_A);

    expect(listed.status).toBe('ok');
    if (listed.status !== 'ok') return;
    expect(listed.drafts.map(record => record.facturaId)).toEqual([FACTURA_2]);
    expect(listed.problems).toHaveLength(1);
    expect(listed.problems[0].facturaId).toBe(FACTURA_1);
    expect(listed.problems[0].error.code).toBe('corrupt');
    expect(listed.problems[0].quarantined).toBe(true);
    expect(storage.data.get(`${facturaKey(UID_A, FACTURA_1)}:quarantine`)).toBe('{"schema":1,"uid":');
    expect(storage.data.has(facturaKey(UID_A, FACTURA_1))).toBe(false);
    const again = await store.listDrafts(UID_A);
    expect(again.status === 'ok' && again.problems).toEqual([]);
  });

  const invalid: [string, (record: Record<string, any>) => void][] = [
    ['missing seq', record => delete record.seq],
    ['fractional seq', record => (record.seq = 1.5)],
    ['negative seq', record => (record.seq = -1)],
    ['numeric uid', record => (record.uid = 42)],
    ['draft for another invoice', record => (record.draft.facturaId = FACTURA_2)],
    ['lines that are not a list', record => (record.draft.lineas = {})],
    ['duplicate line ids', record => (record.draft.lineas[1].lineaId = L1)],
    ['more lines than the invoice allows', record => {
      record.draft.lineas = Array.from({ length: MAX_LINEAS + 1 }, (_unused, index) => ({
        ...record.draft.lineas[0],
        lineaId: `line-${index}`,
      }));
    }],
    ['oversized amount text', record => (record.draft.lineas[0].cantidad = '9'.repeat(65))],
    ['document with a signed URL path', record => (record.draft.documento.path = 'https://x.supabase.co/sign/a.pdf?token=abc')],
    ['document with an unsupported mime', record => (record.draft.documento.mime = 'text/html')],
    ['document above the size limit', record => (record.draft.documento.bytes = MAX_DOCUMENT_BYTES + 1)],
    ['document with a malformed hash', record => (record.draft.documento.sha256 = 'zz')],
    ['upload marked as completed', record => (record.uploads[0].status = 'uploaded')],
    ['protected path that is not text', record => (record.protectedPaths[0] = 7)],
    ['checkpoint without key', record => delete record.intent.key],
    ['checkpoint with non-integer base version', record => (record.intent.baseVersion = '3')],
    ['checkpoint with more lines than allowed', record => {
      record.intent.payload.lineas = Array.from({ length: MAX_LINEAS + 1 }, () => ({}));
    }],
  ];

  it.each(invalid)('treats %s as corrupt and returns nothing', async (_label, mutate) => {
    const storage = new FakeStorage();
    const record = JSON.parse(JSON.stringify(recordFor(UID_A, FACTURA_1, 2)));
    mutate(record);
    plant(storage, UID_A, FACTURA_1, record);

    const result = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('corrupt');
    expect(result.error.userMessage).toBe('Se encontró un borrador dañado y no se usará.');
    expect('record' in result).toBe(false);
  });

  it('never coerces a newer schema: keeps the original, copies it aside and restores valid siblings', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    await store.write(recordFor(UID_A, FACTURA_2, 3));
    const newer = JSON.stringify({ ...recordFor(UID_A, FACTURA_1, 9), schema: 2, extra: 'future' });
    plant(storage, UID_A, FACTURA_1, newer);

    const listed = await store.listDrafts(UID_A);

    expect(listed.status).toBe('ok');
    if (listed.status !== 'ok') return;
    expect(listed.drafts.map(record => record.facturaId)).toEqual([FACTURA_2]);
    expect(listed.problems.map(problem => problem.error.code)).toEqual(['unsupported_schema']);
    expect(listed.problems[0].error.userMessage).toBe(
      'El borrador fue creado por una versión más nueva de la app y no se puede abrir.',
    );
    expect(storage.data.get(facturaKey(UID_A, FACTURA_1))).toBe(newer);
    expect(storage.data.get(`${facturaKey(UID_A, FACTURA_1)}:quarantine`)).toBe(newer);
  });

  it('keeps the original and still reports corrupt when the quarantine write fails', async () => {
    const storage = new FakeStorage();
    plant(storage, UID_A, FACTURA_1, 'not json');
    storage.failSet = key => (key.endsWith(':quarantine') ? new Error('quota exceeded') : undefined);

    const result = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);

    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('corrupt');
    expect(result.quarantined).toBe(false);
    expect(storage.data.get(facturaKey(UID_A, FACTURA_1))).toBe('not json');
    expect(storage.data.has(`${facturaKey(UID_A, FACTURA_1)}:quarantine`)).toBe(false);
  });

  it('still reports corrupt when removing the quarantined original fails', async () => {
    const storage = new FakeStorage();
    plant(storage, UID_A, FACTURA_1, 'not json');
    storage.failRemove = () => new Error('remove failed');

    const result = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);

    expect(result.status === 'error' && result.error.code).toBe('corrupt');
    expect(storage.data.get(`${facturaKey(UID_A, FACTURA_1)}:quarantine`)).toBe('not json');
  });
});

describe('what is never serialized', () => {
  it('persists only allowlisted fields: no bytes, signed URLs or tokens', async () => {
    const storage = new FakeStorage();
    const record = recordFor(UID_A, FACTURA_1, 1);
    const dirty = {
      ...record,
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      signedUrl: 'https://x.supabase.co/sign/a.pdf?token=abc',
      bytes: new Uint8Array([37, 80, 68, 70]),
      draft: { ...record.draft, bytes: new Uint8Array([1, 2, 3]), previewUrl: 'blob:http://x/1' },
    } as FacturaLocalRecord;

    const result = await createFacturaLocalStore(storage).write(dirty);

    expect(result.status).toBe('written');
    const stored = storage.data.get(facturaKey(UID_A, FACTURA_1)) ?? '';
    expect(stored).not.toMatch(/accessToken|signedUrl|previewUrl|eyJhbGci|token=abc|blob:/);
    const parsed = JSON.parse(stored);
    expect(Object.keys(parsed).sort()).toEqual(
      ['draft', 'facturaId', 'intent', 'protectedPaths', 'savedDocumentPath', 'schema', 'seq', 'uid', 'uploads'],
    );
    expect(Object.keys(parsed.draft).sort()).toEqual(Object.keys(record.draft).sort());
    expect(JSON.stringify(parsed.draft)).not.toContain('"0":');
  });

  it('rejects a document path that is a signed URL and stores nothing', async () => {
    const storage = new FakeStorage();
    const record = recordFor(UID_A, FACTURA_1, 1);
    record.draft = {
      ...record.draft,
      documento: { ...documentFor(UID_A, FACTURA_1), path: 'https://x.supabase.co/sign/a.pdf?token=abc' },
    };

    const result = await createFacturaLocalStore(storage).write(record);

    expect(result.status === 'error' && result.error.code).toBe('corrupt');
    expect(storage.data.size).toBe(0);
  });

  it('rejects a checkpoint that carries raw bytes and stores nothing', async () => {
    const storage = new FakeStorage();
    const record = recordFor(UID_A, FACTURA_1, 1);
    if (record.intent === null) throw new Error('fixture needs a checkpoint');
    record.intent = {
      ...record.intent,
      payload: { ...record.intent.payload, cabecera: { ...record.intent.payload.cabecera, archivo: new Uint8Array([1, 2]) } },
    };

    const result = await createFacturaLocalStore(storage).write(record);

    expect(result.status === 'error' && result.error.code).toBe('corrupt');
    expect(storage.data.size).toBe(0);
  });
});

describe('monotonic revisions', () => {
  it('issues increasing sequence numbers per key, independent between keys', () => {
    const store = createFacturaLocalStore(new FakeStorage());

    expect([1, 2, 3].map(() => store.nextSeq(UID_A, FACTURA_1))).toEqual([1, 2, 3]);
    expect(store.nextSeq(UID_A, FACTURA_2)).toBe(1);
    expect(store.nextSeq(UID_B, FACTURA_1)).toBe(1);
    expect(store.nextSeq(UID_A, FACTURA_1)).toBe(4);
  });

  it('adopts the stored sequence on hydration so the next mutation continues above it', async () => {
    const storage = new FakeStorage();
    await createFacturaLocalStore(storage).write(recordFor(UID_A, FACTURA_1, 7));
    const reconstructed = createFacturaLocalStore(restart(storage));
    expect(reconstructed.nextSeq(UID_A, FACTURA_2)).toBe(1);

    await reconstructed.hydrate(UID_A, FACTURA_1);

    expect(reconstructed.nextSeq(UID_A, FACTURA_1)).toBe(8);
  });

  it('keeps the higher in-memory counter when the stored sequence is older', async () => {
    const storage = new FakeStorage();
    await createFacturaLocalStore(storage).write(recordFor(UID_A, FACTURA_1, 7));
    const store = createFacturaLocalStore(restart(storage));
    for (let issued = 0; issued < 10; issued += 1) store.nextSeq(UID_A, FACTURA_1);

    await store.hydrate(UID_A, FACTURA_1);

    expect(store.nextSeq(UID_A, FACTURA_1)).toBe(11);
  });

  it('shares counters across store instances over the same storage', () => {
    const storage = new FakeStorage();
    const first = createFacturaLocalStore(storage);
    first.nextSeq(UID_A, FACTURA_1);
    first.nextSeq(UID_A, FACTURA_1);

    expect(createFacturaLocalStore(storage).nextSeq(UID_A, FACTURA_1)).toBe(3);
    expect(createFacturaLocalStore(new FakeStorage()).nextSeq(UID_A, FACTURA_1)).toBe(1);
  });
});

describe('serialized writes', () => {
  it('lets a delayed seq 4 write finish before a reconstructed store writes seq 5 and ends at 5', async () => {
    const storage = new FakeStorage();
    const gate = deferred();
    storage.beforeSet = (_key, value) => (seqOf(value) === 4 ? gate.promise : undefined);
    const original = createFacturaLocalStore(storage);
    for (let issued = 0; issued < 4; issued += 1) original.nextSeq(UID_A, FACTURA_1);

    const write4 = original.write(recordFor(UID_A, FACTURA_1, 4));
    await flush();
    const reconstructed = createFacturaLocalStore(storage);
    const seq5 = reconstructed.nextSeq(UID_A, FACTURA_1);
    const write5 = reconstructed.write(recordFor(UID_A, FACTURA_1, seq5));
    await flush();

    expect(seq5).toBe(5);
    expect(storage.started.map(entry => entry.seq)).toEqual([4]);
    expect(storage.completed).toEqual([]);

    gate.release();
    expect(await write4).toEqual({ status: 'written', seq: 4 });
    expect(await write5).toEqual({ status: 'written', seq: 5 });
    const log = storage.completed.map(entry => entry.seq);
    expect(log).toEqual([4, 5]);
    expect(log.every((seq, index) => index === 0 || (log[index - 1] ?? 0) <= (seq ?? 0))).toBe(true);
    const restored = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);
    expect(restored.status === 'restored' && restored.record.seq).toBe(5);
  });

  it('skips a queued older revision once a newer one is enqueued and does not report it as persisted', async () => {
    const storage = new FakeStorage();
    const gate = deferred();
    storage.beforeSet = (_key, value) => (seqOf(value) === 1 ? gate.promise : undefined);
    const store = createFacturaLocalStore(storage);

    const write1 = store.write(recordFor(UID_A, FACTURA_1, 1));
    await flush();
    const write4 = store.write(recordFor(UID_A, FACTURA_1, 4));
    const write5 = store.write(recordFor(UID_A, FACTURA_1, 5));
    gate.release();

    expect(await write1).toEqual({ status: 'written', seq: 1 });
    expect(await write4).toEqual({ status: 'stale', seq: 4, latest: 5 });
    expect(await write5).toEqual({ status: 'written', seq: 5 });
    expect(storage.completed.map(entry => entry.seq)).toEqual([1, 5]);
  });

  it('rejects a late lower revision after a higher one is persisted', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    await store.write(recordFor(UID_A, FACTURA_1, 5));

    const late = await store.write(recordFor(UID_A, FACTURA_1, 3));

    expect(late).toEqual({ status: 'stale', seq: 3, latest: 5 });
    expect(seqOf(storage.data.get(facturaKey(UID_A, FACTURA_1)) ?? '')).toBe(5);
  });

  it('rejects a lower revision than the one adopted by hydration', async () => {
    const storage = new FakeStorage();
    await createFacturaLocalStore(storage).write(recordFor(UID_A, FACTURA_1, 7));
    const restarted = restart(storage);
    const reconstructed = createFacturaLocalStore(restarted);
    await reconstructed.hydrate(UID_A, FACTURA_1);

    const late = await reconstructed.write(recordFor(UID_A, FACTURA_1, 6));

    expect(late).toEqual({ status: 'stale', seq: 6, latest: 7 });
    expect(seqOf(restarted.data.get(facturaKey(UID_A, FACTURA_1)) ?? '')).toBe(7);
    expect(restarted.started).toEqual([]);
  });

  it('does not let a failed write poison the queue', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    storage.failSet = () => Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    const failed = await store.write(recordFor(UID_A, FACTURA_1, 1));
    storage.failSet = undefined;

    const next = await store.write(recordFor(UID_A, FACTURA_1, 2));

    expect(failed.status === 'error' && failed.error.code).toBe('quota');
    expect(next).toEqual({ status: 'written', seq: 2 });
    expect(seqOf(storage.data.get(facturaKey(UID_A, FACTURA_1)) ?? '')).toBe(2);
  });

  it('does not let one invoice key block another', async () => {
    const storage = new FakeStorage();
    const gate = deferred();
    storage.beforeSet = key => (key === facturaKey(UID_A, FACTURA_1) ? gate.promise : undefined);
    const store = createFacturaLocalStore(storage);

    const blocked = store.write(recordFor(UID_A, FACTURA_1, 1));
    const other = await store.write(recordFor(UID_A, FACTURA_2, 1));

    expect(other).toEqual({ status: 'written', seq: 1 });
    gate.release();
    expect(await blocked).toEqual({ status: 'written', seq: 1 });
  });

  it('makes hydration wait for pending writes so it reads the newest persisted state', async () => {
    const storage = new FakeStorage();
    const gate = deferred();
    storage.beforeSet = () => gate.promise;
    const store = createFacturaLocalStore(storage);

    const pending = store.write(recordFor(UID_A, FACTURA_1, 2));
    const hydrating = createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);
    await flush();
    gate.release();

    await pending;
    const restored = await hydrating;
    expect(restored.status === 'restored' && restored.record.seq).toBe(2);
  });
});

describe('acknowledged state and tombstones (U6)', () => {
  async function roundTrip(extra: Record<string, unknown>): Promise<FacturaLocalRecord | null> {
    const storage = new FakeStorage();
    plant(storage, UID_A, FACTURA_1, { ...recordFor(UID_A, FACTURA_1, 1), ...extra });
    const restored = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);
    return restored.status === 'restored' ? restored.record : null;
  }

  it.each([true, false])('persists the dirty flag %s so a restored draft keeps its acknowledged state', async dirty => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    expect(await store.write({ ...recordFor(UID_A, FACTURA_1, 1), dirty })).toEqual({ status: 'written', seq: 1 });

    const restored = await createFacturaLocalStore(restart(storage)).hydrate(UID_A, FACTURA_1);
    expect(restored.status === 'restored' && restored.record.dirty).toBe(dirty);
  });

  it('hydrates a record written before the flag existed without inventing one', async () => {
    const record = await roundTrip({});
    expect(record).not.toBeNull();
    expect(record).not.toHaveProperty('dirty');
    expect(record).not.toHaveProperty('tombstone');
  });

  it.each(['no', 0, null])('treats a non-boolean dirty flag %p as a corrupt entry', async dirty => {
    expect(await roundTrip({ dirty })).toBeNull();
  });

  it('keeps the intent and protected paths of a tombstone so they can never be swept or replayed blindly', async () => {
    const storage = new FakeStorage();
    const original = recordFor(UID_A, FACTURA_1, 4);
    const written = await createFacturaLocalStore(storage).write({ ...original, tombstone: true });
    expect(written).toEqual({ status: 'written', seq: 4 });

    const restored = await createFacturaLocalStore(restart(storage)).hydrate(UID_A, FACTURA_1);
    expect(restored.status).toBe('restored');
    const record = restored.status === 'restored' ? restored.record : null;
    expect(record?.tombstone).toBe(true);
    expect(record?.intent).toEqual(original.intent);
    expect(record?.protectedPaths).toEqual(original.protectedPaths);
  });

  it.each([false, 'yes', 1])('rejects a tombstone value %p that is not exactly true', async tombstone => {
    expect(await roundTrip({ tombstone })).toBeNull();
  });

  it('hides tombstones from the list of local drafts without reporting them as problems', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    await store.write(recordFor(UID_A, FACTURA_1, 1));
    await store.write({ ...recordFor(UID_A, FACTURA_2, 1), tombstone: true });

    const listed = await createFacturaLocalStore(restart(storage)).listDrafts(UID_A);
    expect(listed.status).toBe('ok');
    if (listed.status !== 'ok') return;
    expect(listed.drafts.map(draft => draft.facturaId)).toEqual([FACTURA_1]);
    expect(listed.problems).toEqual([]);
  });
});

describe('unexpected failure reporting', () => {
  const SECRET = 'SECRET Ferretería Norte 1234.56 /data/user/0/app/files/doc.pdf';
  // Every clock read lands a minute after the last, so the reporter's per-failure throttle never hides a report.
  let clock = Date.now() + 86_400_000;

  beforeEach(() => {
    mockCaptureEvent.mockReset();
    jest.spyOn(Date, 'now').mockImplementation(() => (clock += 61_000));
  });
  afterEach(() => jest.restoreAllMocks());

  const reported = (): string[] => mockCaptureEvent.mock.calls.map(([event]) => (event as Event).message ?? '');
  const expectNoLeak = (): void => expect(JSON.stringify(mockCaptureEvent.mock.calls)).not.toMatch(/SECRET|Ferreter|user\/0/);

  it('reports an unreadable store once, without the platform message', async () => {
    const storage = new FakeStorage();
    storage.failGet = () => new Error(SECRET);

    const result = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);

    expect(result.status === 'error' && result.error.code).toBe('unavailable');
    expect(reported()).toEqual(['factura.local_read.unavailable']);
    expectNoLeak();
  });

  it('reports a full device as quota when a write fails', async () => {
    const storage = new FakeStorage();
    storage.failSet = () => Object.assign(new Error(SECRET), { name: 'QuotaExceededError' });

    const result = await createFacturaLocalStore(storage).write(recordFor(UID_A, FACTURA_1, 1));

    expect(result.status === 'error' && result.error.code).toBe('quota');
    expect(reported()).toEqual(['factura.local_write.quota']);
    expectNoLeak();
  });

  it('reports a record that fails its own validation as a corrupt write', async () => {
    const storage = new FakeStorage();
    const invalid = { ...recordFor(UID_A, FACTURA_1, 1), seq: -1 };

    const result = await createFacturaLocalStore(storage).write(invalid);

    expect(result.status === 'error' && result.error.code).toBe('corrupt');
    expect(reported()).toEqual(['factura.local_write.corrupt']);
  });

  it('reports a key listing failure', async () => {
    const storage = new FakeStorage();
    storage.failKeys = new Error(SECRET);

    await createFacturaLocalStore(storage).listDrafts(UID_A);

    expect(reported()).toEqual(['factura.local_list.unavailable']);
    expectNoLeak();
  });

  it('reports corrupt stored data once even when the quarantine copy succeeds', async () => {
    const storage = new FakeStorage();
    plant(storage, UID_A, FACTURA_1, SECRET);

    const result = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);

    expect(result.status === 'error' && result.error.code).toBe('corrupt');
    expect(reported()).toEqual(['factura.local_read.corrupt']);
    expectNoLeak();
  });

  it('reports a failing quarantine copy and a failing original removal separately', async () => {
    const copyFails = new FakeStorage();
    plant(copyFails, UID_A, FACTURA_1, SECRET);
    copyFails.failSet = () => new Error('quota exceeded');
    const removeFails = new FakeStorage();
    plant(removeFails, UID_A, FACTURA_1, SECRET);
    removeFails.failRemove = () => new Error(SECRET);

    await createFacturaLocalStore(copyFails).hydrate(UID_A, FACTURA_1);
    await createFacturaLocalStore(removeFails).hydrate(UID_A, FACTURA_1);

    expect(reported()).toEqual([
      'factura.local_quarantine.quota',
      'factura.local_read.corrupt',
      'factura.local_quarantine.unavailable',
      'factura.local_read.corrupt',
    ]);
    expectNoLeak();
  });

  it('does not report a draft written by a newer app version', async () => {
    const storage = new FakeStorage();
    plant(storage, UID_A, FACTURA_1, JSON.stringify({ ...recordFor(UID_A, FACTURA_1, 9), schema: 2 }));

    const result = await createFacturaLocalStore(storage).hydrate(UID_A, FACTURA_1);

    expect(result.status === 'error' && result.error.code).toBe('unsupported_schema');
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('does not report healthy reads, writes, stale writes or empty keys', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);

    await store.hydrate(UID_A, FACTURA_1);
    await store.write(recordFor(UID_A, FACTURA_1, 2));
    await store.write(recordFor(UID_A, FACTURA_1, 1));
    await store.hydrate(UID_A, FACTURA_1);
    await store.listDrafts(UID_A);

    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('keeps the same outcome when Sentry itself fails', async () => {
    mockCaptureEvent.mockImplementation(() => {
      throw new Error('sentry down');
    });
    const storage = new FakeStorage();
    storage.failSet = () => new Error(SECRET);

    const result = await createFacturaLocalStore(storage).write(recordFor(UID_A, FACTURA_1, 1));

    expect(result.status === 'error' && result.error.code).toBe('unavailable');
  });
});
