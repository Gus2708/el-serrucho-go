import {
  addLinea,
  createDraft,
  payloadFingerprint,
  updateLinea,
  type FacturaDocumento,
  type FacturaDraft,
  type SavePayload,
} from './facturaProveedor';
import {
  createFacturaLocalStore,
  facturaKey,
  type FacturaLocalRecord,
  type FacturaLocalStore,
  type StorageLike,
} from './facturaLocalStore';
import { buildDocumentPath, detectDocumentMime, displayNameFor } from './facturaDocumento';
import type { GuardarInput, SubirDocumentoInput } from './facturaProveedorRepository';
import {
  hydrateFacturaEditor,
  type DocumentGateway,
  type EditorController,
  type RejectReason,
  type SubmitResult,
} from './facturaEditorController';

const UID_A = '11111111-1111-4111-8111-111111111111';
const UID_B = '22222222-2222-4222-8222-222222222222';
const FACTURA = 'f0000000-0000-4000-8000-000000000001';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const L2 = 'a0000000-0000-4000-8000-000000000002';
const L3 = 'a0000000-0000-4000-8000-000000000003';
const SHA = 'a'.repeat(64);
const NONDURABLE_MESSAGE = 'No se pudo guardar en este dispositivo; no se envió.';

// Idempotency keys must stay unique across restarts inside one test, so the counter is never reset.
let keyCounter = 0;
function newKey(): string {
  keyCounter += 1;
  return `idem-${keyCounter}`;
}

/** In-memory StorageLike with gates and failures to control exactly when a write finishes. */
class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  setCount = 0;
  beforeSet?: () => Promise<void> | void;
  failSet?: (attempt: number) => Error | undefined;
  failGet?: Error;

  async getItem(key: string): Promise<string | null> {
    if (this.failGet) throw this.failGet;
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.setCount += 1;
    const attempt = this.setCount;
    await this.beforeSet?.();
    const failure = this.failSet?.(attempt);
    if (failure) throw failure;
    this.data.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
  }

  async getAllKeys(): Promise<readonly string[]> {
    return [...this.data.keys()];
  }
}

/** A new runtime over the same persisted bytes: no queue or counter from the old storage object survives. */
function restart(storage: FakeStorage): FakeStorage {
  const restarted = new FakeStorage();
  restarted.data = new Map(storage.data);
  return restarted;
}

type Script = 'commit' | 'commit-but-lose-response' | 'drop' | 'throw' | { reject: RejectReason };

/** Fake endpoint with the server semantics the controller relies on: idempotent keys and version checks. */
class FakeServer {
  version = 0;
  content: SavePayload | null = null;
  log: GuardarInput[] = [];
  script: Script[] = [];
  gate: Promise<void> | null = null;
  private byKey = new Map<string, { fingerprint: string; version: number }>();

  submit = async (input: GuardarInput): Promise<SubmitResult> => {
    this.log.push(JSON.parse(JSON.stringify(input)) as GuardarInput);
    if (this.gate) await this.gate;
    const mode = this.script.shift() ?? 'commit';
    if (mode === 'throw') throw new Error('network down');
    if (mode === 'drop') return { kind: 'ambiguous' };
    if (typeof mode === 'object') return { kind: 'rejected', reason: mode.reject };
    const result = this.apply(input);
    return mode === 'commit-but-lose-response' && result.kind === 'committed' ? { kind: 'ambiguous' } : result;
  };

  private apply(input: GuardarInput): SubmitResult {
    const fingerprint = payloadFingerprint(input.payload);
    const prior = this.byKey.get(input.key);
    if (prior) {
      return prior.fingerprint === fingerprint
        ? { kind: 'committed', version: prior.version, replay: true }
        : { kind: 'rejected', reason: 'key_reused' };
    }
    if (input.version !== this.version) return { kind: 'rejected', reason: 'conflict' };
    this.version += 1;
    this.content = input.payload;
    this.byKey.set(input.key, { fingerprint, version: this.version });
    return { kind: 'committed', version: this.version, replay: false };
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
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
}

function documentFor(): FacturaDocumento {
  return {
    path: `${UID_A}/${FACTURA}/doc-1.pdf`,
    nombre: 'factura.pdf',
    mime: 'application/pdf',
    bytes: 2048,
    sha256: SHA,
  };
}

function baseDraft(): FacturaDraft {
  let draft = createDraft({ facturaId: FACTURA, proveedorCodigo: 'P-1', proveedorNombre: 'Ferretería Norte' });
  draft = addLinea(draft, L1, { codigoProducto: 'TOR-01', cantidad: '10', costoUnitario: '1,5' });
  return addLinea(draft, L2, { codigoProducto: 'TOR-01', cantidad: '4', costoUnitario: '2.25' });
}

function withNotas(notas: string): (draft: FacturaDraft) => FacturaDraft {
  return draft => ({ ...draft, notas });
}

function recordOn(storage: FakeStorage): FacturaLocalRecord {
  const raw = storage.data.get(facturaKey(UID_A, FACTURA));
  if (raw === undefined) throw new Error('no record persisted');
  return JSON.parse(raw) as FacturaLocalRecord;
}

/** Gateway for tests that never touch documents: any use is a failure. */
class NoDocuments implements DocumentGateway {
  newDocumentId(): string {
    throw new Error('documents were not expected');
  }
  async sha256(): Promise<string> {
    throw new Error('documents were not expected');
  }
  async upload(): Promise<FacturaDocumento> {
    throw new Error('documents were not expected');
  }
  async remove(): Promise<boolean> {
    throw new Error('documents were not expected');
  }
}

interface OpenOptions {
  storage?: FakeStorage;
  server?: FakeServer;
  store?: FacturaLocalStore;
  initial?: FacturaDraft;
  session?: { current: string | null };
  submit?: (input: GuardarInput) => Promise<SubmitResult>;
  documents?: DocumentGateway;
  savedDocumentPath?: string | null;
}

interface Opened {
  controller: EditorController;
  storage: FakeStorage;
  server: FakeServer;
  session: { current: string | null };
}

async function open(options: OpenOptions = {}): Promise<Opened> {
  const storage = options.storage ?? new FakeStorage();
  const server = options.server ?? new FakeServer();
  const session = options.session ?? { current: UID_A };
  const controller = await hydrateFacturaEditor(
    {
      uid: UID_A,
      facturaId: FACTURA,
      store: options.store ?? createFacturaLocalStore(storage),
      getUid: () => session.current,
      newKey,
      submit: options.submit ?? server.submit,
      documents: options.documents ?? new NoDocuments(),
    },
    { draft: options.initial ?? baseDraft(), savedDocumentPath: options.savedDocumentPath ?? null },
  );
  return { controller, storage, server, session };
}

describe('state and subscriptions', () => {
  it('keeps getState referentially stable until the state changes', async () => {
    const { controller } = await open();
    const first = controller.getState();
    expect(controller.getState()).toBe(first);

    controller.edit(withNotas('uno'));
    const second = controller.getState();
    expect(second).not.toBe(first);
    expect(second.draft.notas).toBe('uno');
    expect(second.dirty).toBe(true);
    expect(controller.getState()).toBe(second);
    await controller.persisted();
  });

  it('notifies each subscriber with the new state and stops after its own unsubscribe', async () => {
    const { controller } = await open();
    const seenByA: string[] = [];
    const seenByB: string[] = [];
    const unsubscribeA = controller.subscribe(() => seenByA.push(controller.getState().draft.notas));
    controller.subscribe(() => seenByB.push(controller.getState().draft.notas));

    controller.edit(withNotas('uno'));
    await controller.persisted();
    expect(seenByA.length).toBeGreaterThan(0);
    expect(new Set(seenByA)).toEqual(new Set(['uno']));

    unsubscribeA();
    unsubscribeA();
    const frozenCount = seenByA.length;
    controller.edit(withNotas('dos'));
    await controller.persisted();
    expect(seenByA).toHaveLength(frozenCount);
    expect(seenByB.at(-1)).toBe('dos');
  });

  it('reports a local save only after the store confirmed the write', async () => {
    const { controller, storage } = await open();
    const gate = deferred();
    storage.beforeSet = () => gate.promise;

    controller.edit(withNotas('x'));
    await flush();
    expect(controller.getState().localSaved).toBe(false);
    expect(storage.data.size).toBe(0);

    gate.release();
    await controller.persisted();
    expect(controller.getState().localSaved).toBe(true);
    expect(recordOn(storage).draft.notas).toBe('x');
  });

  it('flags a failed edit write as non-durable and clears the flag once a later write lands', async () => {
    const { controller, storage } = await open();
    storage.failSet = () => new Error('disk error');
    controller.edit(withNotas('x'));
    await controller.persisted();
    expect(controller.getState().localSaved).toBe(false);
    expect(controller.getState().feedback).toEqual({ kind: 'nondurable', message: NONDURABLE_MESSAGE });

    storage.failSet = undefined;
    controller.edit(withNotas('y'));
    await controller.persisted();
    expect(controller.getState().localSaved).toBe(true);
    expect(controller.getState().feedback).toBeNull();
    expect(recordOn(storage).draft.notas).toBe('y');
  });
});

describe('durable checkpoint before the RPC', () => {
  it('writes the frozen intent to storage before the RPC is sent', async () => {
    const storage = new FakeStorage();
    const server = new FakeServer();
    const diskAtSubmit: FacturaLocalRecord[] = [];
    const { controller } = await open({
      storage,
      server,
      submit: async input => {
        diskAtSubmit.push(recordOn(storage));
        return server.submit(input);
      },
    });
    const gate = deferred();
    storage.beforeSet = () => gate.promise;

    const saving = controller.save();
    await flush();
    expect(server.log).toHaveLength(0);

    gate.release();
    await saving;
    expect(server.log).toHaveLength(1);
    expect(diskAtSubmit).toHaveLength(1);
    expect(diskAtSubmit[0].intent).toEqual({
      key: server.log[0].key,
      baseVersion: 0,
      payload: server.log[0].payload,
      documentPath: null,
    });
  });

  it('sends nothing and reports non-durable when the checkpoint write fails, then recovers on retry', async () => {
    const { controller, storage, server } = await open();
    storage.failSet = () => Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
    controller.edit(withNotas('conservar'));

    const outcome = await controller.save();
    expect(outcome).toEqual({ status: 'nondurable', message: NONDURABLE_MESSAGE });
    expect(server.log).toHaveLength(0);
    const state = controller.getState();
    expect(state.retryPending).toBe(false);
    expect(state.saving).toBe(false);
    expect(state.draft.notas).toBe('conservar');
    expect(state.feedback).toEqual({ kind: 'nondurable', message: NONDURABLE_MESSAGE });

    storage.failSet = undefined;
    const retried = await controller.save();
    expect(retried).toMatchObject({ status: 'saved', version: 1 });
    expect(server.log).toHaveLength(1);
  });

  it('sends nothing when the store skips the checkpoint write as stale', async () => {
    const storage = new FakeStorage();
    const real = createFacturaLocalStore(storage);
    const staleStore: FacturaLocalStore = {
      ...real,
      write: async record => ({ status: 'stale', seq: record.seq, latest: record.seq + 1 }),
    };
    const { controller, server } = await open({ storage, store: staleStore });

    const outcome = await controller.save();
    expect(outcome).toEqual({ status: 'nondurable', message: NONDURABLE_MESSAGE });
    expect(server.log).toHaveLength(0);
    expect(controller.getState().retryPending).toBe(false);
  });

  it('rejects an invalid draft without consuming a key or freezing an intent', async () => {
    const { controller, storage, server } = await open();
    controller.edit(draft => updateLinea(draft, L1, { cantidad: 'abc' }));
    await controller.persisted();
    const keysBefore = keyCounter;

    const outcome = await controller.save();
    expect(outcome).toMatchObject({ status: 'invalid' });
    expect(outcome.status === 'invalid' && outcome.errors[`${L1}:cantidad`]).toBeTruthy();
    expect(keyCounter).toBe(keysBefore);
    expect(server.log).toHaveLength(0);
    expect(recordOn(storage).intent).toBeNull();
  });
});

describe('in-flight save', () => {
  it('deduplicates presses made while the checkpoint and while the RPC are pending', async () => {
    const { controller, storage, server } = await open();
    const storageGate = deferred();
    const rpcGate = deferred();
    storage.beforeSet = () => storageGate.promise;
    server.gate = rpcGate.promise;

    const first = controller.save();
    const second = controller.save();
    expect(second).toBe(first);
    await flush();
    expect(controller.getState().saving).toBe(true);
    expect(server.log).toHaveLength(0);

    storageGate.release();
    await flush();
    expect(server.log).toHaveLength(1);
    const third = controller.save();
    expect(third).toBe(first);

    rpcGate.release();
    const outcomes = await Promise.all([first, second, third]);
    expect(outcomes[0]).toMatchObject({ status: 'saved', version: 1, replay: false });
    expect(outcomes[1]).toBe(outcomes[0]);
    expect(server.log).toHaveLength(1);
    expect(controller.getState().saving).toBe(false);
  });

  it('keeps edits made during the RPC, leaves the draft dirty and sends them later with a fresh key', async () => {
    const { controller, storage, server } = await open();
    const rpcGate = deferred();
    server.gate = rpcGate.promise;

    const saving = controller.save();
    await flush();
    expect(server.log).toHaveLength(1);
    controller.edit(draft => updateLinea(draft, L1, { cantidad: '99' }));
    controller.edit(draft => addLinea(draft, L3, { codigoProducto: 'TOR-01', cantidad: '1' }));
    rpcGate.release();

    expect(await saving).toMatchObject({ status: 'saved', version: 1, replay: false });
    const state = controller.getState();
    expect(state.dirty).toBe(true);
    expect(state.draft.version).toBe(1);
    expect(state.draft.lineas.map(linea => [linea.lineaId, linea.cantidad])).toEqual([
      [L1, '99'],
      [L2, '4'],
      [L3, '1'],
    ]);
    expect(server.content?.lineas.map(linea => linea.cantidad_documento)).toEqual(['10', '4']);
    await controller.persisted();
    const persisted = recordOn(storage);
    expect(persisted.intent).toBeNull();
    expect(persisted.draft.version).toBe(1);
    expect(persisted.draft.lineas).toHaveLength(3);

    server.gate = null;
    expect(await controller.save()).toMatchObject({ status: 'saved', version: 2, replay: false });
    expect(server.log[1].version).toBe(1);
    expect(server.log[1].key).not.toBe(server.log[0].key);
    expect(server.content?.lineas.map(linea => linea.cantidad_documento)).toEqual(['99', '4', '1']);
    expect(controller.getState().dirty).toBe(false);
  });

  it('treats the draft as clean when a mid-save edit restores the saved content', async () => {
    const { controller, server } = await open();
    const rpcGate = deferred();
    server.gate = rpcGate.promise;

    const saving = controller.save();
    await flush();
    controller.edit(withNotas('temporal'));
    controller.edit(withNotas(''));
    rpcGate.release();
    await saving;

    expect(controller.getState().dirty).toBe(false);
    expect(controller.getState().draft.version).toBe(1);
  });

  it('keeps an attachment added during the save and records the frozen document path as the saved one', async () => {
    const { controller, server } = await open();
    const rpcGate = deferred();
    server.gate = rpcGate.promise;

    const saving = controller.save();
    await flush();
    controller.edit(draft => ({ ...draft, documento: documentFor() }));
    rpcGate.release();
    await saving;

    const state = controller.getState();
    expect(state.draft.documento).toEqual(documentFor());
    expect(state.savedDocumentPath).toBeNull();
    expect(state.dirty).toBe(true);
  });

  it('records the document path that the acknowledged payload referenced', async () => {
    const { controller, server } = await open({ initial: { ...baseDraft(), documento: documentFor() } });

    await controller.save();
    expect(controller.getState().savedDocumentPath).toBe(documentFor().path);
    expect(server.log[0].payload.cabecera.documento).toEqual(documentFor());
    expect(controller.getState().dirty).toBe(false);
  });

  it('sends a manual entry without attachment in USD with repeated lines kept separate and ordered', async () => {
    const { controller, server } = await open();

    await controller.save();
    const { cabecera, lineas } = server.log[0].payload;
    expect(cabecera.documento).toBeNull();
    expect(cabecera.moneda).toBe('USD');
    expect(lineas.map(linea => [linea.linea_id, linea.codigo_producto])).toEqual([
      [L1, 'TOR-01'],
      [L2, 'TOR-01'],
    ]);
  });
});

describe('ambiguous responses', () => {
  it('replays the exact frozen request after a lost response and an edit, then saves the edit with a new key', async () => {
    const { controller, storage, server } = await open();
    server.script = ['commit-but-lose-response'];

    const first = await controller.save();
    expect(first).toMatchObject({ status: 'pending' });
    expect(controller.getState().retryPending).toBe(true);
    expect(controller.getState().feedback?.kind).toBe('retry_pending');
    expect(recordOn(storage).intent?.key).toBe(server.log[0].key);

    controller.edit(draft => updateLinea(draft, L2, { cantidad: '7' }));
    const second = await controller.save();

    expect(second).toMatchObject({ status: 'saved', version: 2, replay: false });
    expect(server.log).toHaveLength(3);
    expect(server.log[1]).toEqual(server.log[0]);
    expect(server.log[2].key).not.toBe(server.log[0].key);
    expect(server.log[2].version).toBe(1);
    expect(server.content?.lineas.map(linea => linea.cantidad_documento)).toEqual(['10', '7']);
    expect(controller.getState().retryPending).toBe(false);
    expect(controller.getState().dirty).toBe(false);
  });

  it('adds no new version when a replay finds nothing newer to send', async () => {
    const { controller, server } = await open();
    server.script = ['commit-but-lose-response'];
    await controller.save();

    const replayed = await controller.save();
    expect(replayed).toMatchObject({ status: 'saved', version: 1, replay: true });
    expect(server.log).toHaveLength(2);
    expect(server.log[1]).toEqual(server.log[0]);
    expect(server.version).toBe(1);
    expect(controller.getState().dirty).toBe(false);
  });

  it('stops after an unanswered replay and keeps the checkpoint instead of sending newer edits', async () => {
    const { controller, storage, server } = await open();
    server.script = ['drop', 'throw'];
    await controller.save();
    controller.edit(withNotas('nuevo'));

    const second = await controller.save();
    expect(second).toMatchObject({ status: 'pending' });
    expect(server.log).toHaveLength(2);
    expect(server.log[1]).toEqual(server.log[0]);
    expect(controller.getState().retryPending).toBe(true);
    await controller.persisted();
    const persisted = recordOn(storage);
    expect(persisted.intent?.key).toBe(server.log[0].key);
    expect(persisted.draft.notas).toBe('nuevo');
  });

  it('treats a thrown submit as an unanswered request and keeps the same key for the retry', async () => {
    const { controller, server } = await open();
    server.script = ['throw'];
    expect(await controller.save()).toMatchObject({ status: 'pending' });

    expect(await controller.save()).toMatchObject({ status: 'saved', version: 1 });
    expect(server.log[1].key).toBe(server.log[0].key);
  });

  it('gives the adapter a mutable copy, so tampering with the request cannot change the frozen replay', async () => {
    const server = new FakeServer();
    const receivedFrozen: boolean[] = [];
    let tamper = true;
    const { controller } = await open({
      server,
      submit: async input => {
        receivedFrozen.push(Object.isFrozen(input.payload.cabecera));
        if (tamper) {
          input.payload.cabecera.notas = 'manipulado';
          tamper = false;
          return { kind: 'ambiguous' };
        }
        return server.submit(input);
      },
    });
    controller.edit(withNotas('original'));

    await controller.save();
    expect(await controller.save()).toMatchObject({ status: 'saved', version: 1 });
    expect(server.log[0].payload.cabecera.notas).toBe('original');
    expect(receivedFrozen).toEqual([false, false]);
  });
});

describe('acknowledgement persistence', () => {
  it('keeps the frozen checkpoint on disk when the acknowledgement write fails, and the restart replays it', async () => {
    const { controller, storage, server } = await open();
    storage.failSet = attempt => (attempt === 2 ? new Error('disk error') : undefined);

    const outcome = await controller.save();
    expect(outcome).toMatchObject({ status: 'saved', version: 1, replay: false, localDurable: false });
    expect(controller.getState().feedback?.kind).toBe('nondurable');
    expect(controller.getState().localSaved).toBe(false);
    expect(controller.getState().retryPending).toBe(false);
    expect(recordOn(storage).intent?.key).toBe(server.log[0].key);

    const restarted = await open({ storage: restart(storage), server });
    expect(restarted.controller.getState().retryPending).toBe(true);
    expect(await restarted.controller.save()).toMatchObject({ status: 'saved', version: 1, replay: true });
    expect(server.log).toHaveLength(2);
    expect(server.log[1]).toEqual(server.log[0]);
    expect(server.version).toBe(1);
  });
});

describe('definite rejections', () => {
  it.each<RejectReason>(['invalid', 'unauthorized', 'unknown'])(
    'surfaces a %s rejection, clears the rejected intent and keeps the draft dirty',
    async reason => {
      const { controller, storage, server } = await open();
      server.script = [{ reject: reason }];
      controller.edit(withNotas('mío'));

      const outcome = await controller.save();
      expect(outcome).toMatchObject({ status: 'rejected', reason });
      const state = controller.getState();
      expect(state.retryPending).toBe(false);
      expect(state.dirty).toBe(true);
      expect(state.draft.notas).toBe('mío');
      expect(state.feedback?.kind).toBe(reason);
      expect(recordOn(storage).intent).toBeNull();

      expect(await controller.save()).toMatchObject({ status: 'saved', version: 1 });
      expect(server.log[1].key).not.toBe(server.log[0].key);
    },
  );

  it('reports a genuine conflict without overwriting the remote content or retrying', async () => {
    const { controller, server } = await open();
    const remote: SavePayload = { cabecera: { notas: 'otro equipo' }, lineas: [] };
    server.version = 3;
    server.content = remote;
    controller.edit(withNotas('mío'));

    const outcome = await controller.save();
    expect(outcome).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(outcome.status === 'rejected' && outcome.message).toMatch(/otro dispositivo/);
    expect(server.log).toHaveLength(1);
    expect(server.version).toBe(3);
    expect(server.content).toBe(remote);
    expect(controller.getState().draft.notas).toBe('mío');
    expect(controller.getState().dirty).toBe(true);
  });
});

describe('hydration', () => {
  it('restores the pending intent and draft without calling the RPC, then replays on user request', async () => {
    const first = await open();
    first.server.script = ['commit-but-lose-response'];
    first.controller.edit(withNotas('restaurar'));
    await first.controller.save();
    const draftBeforeRestart = first.controller.getState().draft;

    const second = await open({ storage: restart(first.storage), server: first.server, initial: createDraft({ facturaId: FACTURA }) });
    expect(first.server.log).toHaveLength(1);
    const restored = second.controller.getState();
    expect(restored.draft).toEqual(draftBeforeRestart);
    expect(restored.retryPending).toBe(true);
    expect(restored.feedback?.kind).toBe('retry_pending');

    expect(await second.controller.save()).toMatchObject({ status: 'saved', version: 1, replay: true });
    expect(first.server.log[1]).toEqual(first.server.log[0]);
  });

  it('continues the revision above the stored one and keeps uploads and protected paths untouched', async () => {
    const seedStorage = new FakeStorage();
    const uploads = [{ path: `${UID_A}/${FACTURA}/doc-2.png`, status: 'pending' as const }];
    const protectedPaths = [`${UID_A}/${FACTURA}/doc-1.pdf`];
    await createFacturaLocalStore(seedStorage).write({
      schema: 1,
      uid: UID_A,
      facturaId: FACTURA,
      seq: 7,
      draft: baseDraft(),
      savedDocumentPath: null,
      intent: null,
      uploads,
      protectedPaths,
    });
    const { controller, storage } = await open({ storage: restart(seedStorage) });

    controller.edit(withNotas('después'));
    await controller.persisted();
    const persisted = recordOn(storage);
    expect(persisted.seq).toBe(8);
    expect(persisted.draft.notas).toBe('después');
    expect(persisted.uploads).toEqual(uploads);
    expect(persisted.protectedPaths).toEqual(protectedPaths);
  });

  it('starts from the given draft and writes nothing when no local record exists', async () => {
    const { controller, storage } = await open();
    const state = controller.getState();
    expect(state.draft).toEqual(baseDraft());
    expect(state.dirty).toBe(false);
    expect(state.localSaved).toBe(true);
    expect(state.feedback).toBeNull();
    expect(storage.setCount).toBe(0);
  });

  it('reports a corrupt entry in Spanish, keeps the given draft and sends nothing', async () => {
    const storage = new FakeStorage();
    storage.data.set(facturaKey(UID_A, FACTURA), '{not json');
    const { controller, server } = await open({ storage });

    const state = controller.getState();
    expect(state.feedback?.kind).toBe('storage');
    expect(state.feedback?.message).toMatch(/dañado/);
    expect(state.draft).toEqual(baseDraft());
    expect(server.log).toHaveLength(0);
  });
});

describe('account binding', () => {
  it('sends nothing when the session changes while the checkpoint is being written', async () => {
    const { controller, storage, server, session } = await open();
    storage.beforeSet = () => {
      session.current = UID_B;
    };

    const outcome = await controller.save();
    expect(outcome).toMatchObject({ status: 'cuenta_cambiada' });
    expect(server.log).toHaveLength(0);
    expect(controller.getState().feedback?.kind).toBe('cuenta_cambiada');
    expect([...storage.data.keys()]).toEqual([facturaKey(UID_A, FACTURA)]);
    expect(recordOn(storage).intent).not.toBeNull();
  });

  it('does not read or send anything for an account that is not the signed-in one', async () => {
    const session = { current: UID_B as string | null };
    const { controller, storage, server } = await open({ session });
    expect(controller.getState().feedback?.kind).toBe('cuenta_cambiada');

    expect(await controller.save()).toMatchObject({ status: 'cuenta_cambiada' });
    expect(server.log).toHaveLength(0);
    expect(storage.setCount).toBe(0);
  });

  it('applies a late acknowledgement to the original owner record only', async () => {
    const { controller, storage, server, session } = await open();
    const rpcGate = deferred();
    server.gate = rpcGate.promise;

    const saving = controller.save();
    await flush();
    session.current = UID_B;
    rpcGate.release();

    expect(await saving).toMatchObject({ status: 'saved', version: 1 });
    expect([...storage.data.keys()]).toEqual([facturaKey(UID_A, FACTURA)]);
    expect(recordOn(storage).intent).toBeNull();
    expect(recordOn(storage).draft.version).toBe(1);
  });
});

describe('writes after a hydration that could not read the stored entry', () => {
  function plantRecord(storage: FakeStorage, value: unknown): string {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    storage.data.set(facturaKey(UID_A, FACTURA), raw);
    return raw;
  }

  async function expectNoWritesAndNoRpc(opened: Opened, original: string): Promise<void> {
    const { controller, storage, server } = opened;
    expect(controller.getState().writesBlocked).toBe(true);

    controller.edit(withNotas('no debe persistirse'));
    await controller.persisted();
    expect(controller.getState().draft.notas).toBe('no debe persistirse');
    expect(storage.data.get(facturaKey(UID_A, FACTURA))).toBe(original);

    const outcome = await controller.save();
    expect(outcome).toMatchObject({ status: 'blocked' });
    expect(outcome.status === 'blocked' && outcome.message).toMatch(/no se envió/);
    expect(server.log).toHaveLength(0);
    expect(storage.data.get(facturaKey(UID_A, FACTURA))).toBe(original);
    expect(controller.getState().retryPending).toBe(false);
  }

  it('blocks every write and the RPC after a newer-schema entry, so the original is never replaced', async () => {
    const storage = new FakeStorage();
    const original = plantRecord(storage, { schema: 2, uid: UID_A, facturaId: FACTURA, from: 'newer app' });
    const opened = await open({ storage });

    expect(opened.controller.getState().feedback?.kind).toBe('storage');
    await expectNoWritesAndNoRpc(opened, original);
  });

  it('blocks every write and the RPC when the stored entry cannot be read', async () => {
    const storage = new FakeStorage();
    const original = plantRecord(storage, { schema: 1 });
    storage.failGet = new Error('storage offline');
    const opened = await open({ storage });

    expect(opened.controller.getState().feedback?.message).toMatch(/almacenamiento/);
    storage.failGet = undefined;
    await expectNoWritesAndNoRpc(opened, original);
  });

  it('blocks writes when a corrupt entry could not be moved aside, because the original is still there', async () => {
    const storage = new FakeStorage();
    const original = plantRecord(storage, '{not json');
    storage.failSet = attempt => (attempt === 1 ? new Error('cannot copy') : undefined);
    const opened = await open({ storage });

    await expectNoWritesAndNoRpc(opened, original);
  });

  it('keeps writing after a corrupt entry was quarantined, since nothing valid remains to be replaced', async () => {
    const storage = new FakeStorage();
    plantRecord(storage, '{not json');
    const { controller } = await open({ storage });
    expect(controller.getState().writesBlocked).toBe(false);

    controller.edit(withNotas('nuevo'));
    await controller.persisted();
    expect(recordOn(storage).draft.notas).toBe('nuevo');
    expect(storage.data.get(`${facturaKey(UID_A, FACTURA)}:quarantine`)).toBe('{not json');
  });

  it('is not blocked when nothing is stored or the stored record is valid', async () => {
    const empty = await open();
    expect(empty.controller.getState().writesBlocked).toBe(false);

    const first = await open();
    first.controller.edit(withNotas('guardado'));
    await first.controller.persisted();
    const reopened = await open({ storage: restart(first.storage) });
    expect(reopened.controller.getState().writesBlocked).toBe(false);
  });
});

describe('restored acknowledged drafts versus unsaved drafts', () => {
  it('restores an acknowledged draft as clean, with no retry pending and no warning', async () => {
    const first = await open();
    expect(await first.controller.save()).toMatchObject({ status: 'saved', version: 1 });
    expect(recordOn(first.storage).dirty).toBe(false);

    const second = await open({ storage: restart(first.storage), server: first.server });
    const state = second.controller.getState();
    expect(state.draft).toEqual(first.controller.getState().draft);
    expect(state.dirty).toBe(false);
    expect(state.retryPending).toBe(false);
    expect(state.feedback).toBeNull();
    expect(first.server.log).toHaveLength(1);
  });

  it('restores a draft edited after the acknowledgement as unsaved', async () => {
    const first = await open();
    await first.controller.save();
    first.controller.edit(withNotas('sin enviar'));
    await first.controller.persisted();
    expect(recordOn(first.storage).dirty).toBe(true);

    const second = await open({ storage: restart(first.storage), server: first.server });
    expect(second.controller.getState().dirty).toBe(true);
    expect(second.controller.getState().draft.notas).toBe('sin enviar');
  });

  it('restores a never-saved draft as unsaved', async () => {
    const first = await open();
    first.controller.edit(withNotas('borrador'));
    await first.controller.persisted();

    const second = await open({ storage: restart(first.storage), server: first.server });
    expect(second.controller.getState().dirty).toBe(true);
  });

  it('persists edits made while the save was in flight as unsaved', async () => {
    const { controller, storage, server } = await open();
    const rpcGate = deferred();
    server.gate = rpcGate.promise;
    const saving = controller.save();
    await flush();
    controller.edit(withNotas('durante'));
    rpcGate.release();
    await saving;
    await controller.persisted();

    expect(recordOn(storage).dirty).toBe(true);
    const restored = await open({ storage: restart(storage), server });
    expect(restored.controller.getState().dirty).toBe(true);
  });

  it('restores a record written before the flag existed as unsaved', async () => {
    const seed = new FakeStorage();
    await createFacturaLocalStore(seed).write({
      schema: 1,
      uid: UID_A,
      facturaId: FACTURA,
      seq: 3,
      draft: { ...baseDraft(), version: 2 },
      savedDocumentPath: null,
      intent: null,
      uploads: [],
      protectedPaths: [],
    });
    expect(recordOn(seed)).not.toHaveProperty('dirty');

    const { controller } = await open({ storage: restart(seed) });
    expect(controller.getState().dirty).toBe(true);
  });

  it('keeps an unresolved retry unsaved even if the stored flag says clean', async () => {
    const first = await open();
    first.server.script = ['commit-but-lose-response'];
    await first.controller.save();
    const stored = recordOn(first.storage);
    first.storage.data.set(facturaKey(UID_A, FACTURA), JSON.stringify({ ...stored, dirty: false }));

    const second = await open({ storage: restart(first.storage), server: first.server });
    expect(second.controller.getState().retryPending).toBe(true);
    expect(second.controller.getState().dirty).toBe(true);
  });
});

describe('account check before every local write', () => {
  it('skips an edit write while another account is signed in and writes the newest content once back', async () => {
    const { controller, storage, session } = await open();
    session.current = UID_B;

    controller.edit(withNotas('mientras B'));
    await controller.persisted();
    expect(storage.setCount).toBe(0);
    expect(storage.data.size).toBe(0);
    expect(controller.getState().localSaved).toBe(false);
    expect(controller.getState().feedback?.kind).toBe('cuenta_cambiada');
    expect(controller.getState().draft.notas).toBe('mientras B');

    session.current = UID_A;
    controller.edit(withNotas('de vuelta'));
    await controller.persisted();
    expect(recordOn(storage).draft.notas).toBe('de vuelta');
    expect(controller.getState().localSaved).toBe(true);
    expect(controller.getState().feedback).toBeNull();
  });

  it('checks the account again for each queued write, not only when the first was requested', async () => {
    const { controller, storage, session } = await open();
    const gate = deferred();
    storage.beforeSet = () => gate.promise;

    controller.edit(withNotas('uno'));
    await flush();
    controller.edit(withNotas('dos'));
    session.current = UID_B;
    gate.release();
    await controller.persisted();

    expect(storage.setCount).toBe(1);
    expect(recordOn(storage).draft.notas).toBe('uno');
    expect(controller.getState().draft.notas).toBe('dos');
    expect(controller.getState().localSaved).toBe(false);
  });

  it('sends nothing and reports the account change when the session changed before the checkpoint write began', async () => {
    const { controller, storage, server, session } = await open();
    controller.edit(withNotas('x'));
    await controller.persisted();
    const writes = storage.setCount;
    session.current = null;

    const outcome = await controller.save();
    expect(outcome).toMatchObject({ status: 'cuenta_cambiada' });
    expect(server.log).toHaveLength(0);
    expect(storage.setCount).toBe(writes);
  });
});

// --- Attachments, interrupted uploads and sweeps (U6) ----------------------------------------

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const UPLOAD_FAILED_MESSAGE = 'No se pudo subir el archivo. Inténtalo otra vez.';

function documentPath(index: number, extension = 'pdf', owner = UID_A): string {
  return `${owner}/${FACTURA}/d0000000-0000-4000-8000-${String(index).padStart(12, '0')}.${extension}`;
}

type UploadMode = 'ok' | 'throw' | 'wrong-path';

/** Fake private bucket: uploads, removals and the files that exist, with gates to order the awaits. */
class FakeDocuments implements DocumentGateway {
  files = new Set<string>();
  uploadLog: string[] = [];
  removeLog: string[] = [];
  uploadMode: UploadMode = 'ok';
  failRemove = false;
  uploadGate: Promise<void> | null = null;
  beforeRemove?: (path: string) => void;
  afterUpload?: () => void;
  private counter = 0;

  newDocumentId(): string {
    this.counter += 1;
    return `d0000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
  }

  async sha256(): Promise<string> {
    return 'c'.repeat(64);
  }

  async upload(input: SubirDocumentoInput): Promise<FacturaDocumento> {
    const mime = detectDocumentMime(input.bytes);
    if (mime === null) throw new Error('unsupported bytes');
    const path = buildDocumentPath(input.ownerId, input.facturaId, input.documentId, mime);
    this.uploadLog.push(path);
    if (this.uploadGate) await this.uploadGate;
    if (this.uploadMode === 'throw') throw new Error('upload failed');
    this.files.add(path);
    this.afterUpload?.();
    return {
      path: this.uploadMode === 'wrong-path' ? `${path}.other` : path,
      nombre: displayNameFor(input.nombre),
      mime,
      bytes: input.bytes.length,
      sha256: input.sha256,
    };
  }

  async remove(path: string): Promise<boolean> {
    this.beforeRemove?.(path);
    this.removeLog.push(path);
    if (this.failRemove) return false;
    this.files.delete(path);
    return true;
  }
}

interface AttachOpened extends Opened {
  documents: FakeDocuments;
}

async function openWithDocuments(options: OpenOptions & { documents?: FakeDocuments } = {}): Promise<AttachOpened> {
  const documents = options.documents ?? new FakeDocuments();
  const opened = await open({ ...options, documents });
  return { ...opened, documents };
}

describe('attaching a document', () => {
  it('persists the pending upload before any byte leaves the device, then attaches only the acknowledged upload', async () => {
    const storage = new FakeStorage();
    const documents = new FakeDocuments();
    const diskAtUpload: FacturaLocalRecord[] = [];
    documents.afterUpload = () => diskAtUpload.push(recordOn(storage));
    const { controller } = await openWithDocuments({ storage, documents });

    const outcome = await controller.attach(PDF_BYTES, 'C:\\fotos\\factura marzo.pdf');

    const path = documentPath(1);
    expect(outcome).toEqual({ status: 'attached', path, localDurable: true });
    expect(diskAtUpload).toHaveLength(1);
    expect(diskAtUpload[0].uploads).toEqual([{ path, status: 'pending' }]);
    expect(diskAtUpload[0].draft.documento).toBeNull();

    const state = controller.getState();
    expect(state.draft.documento).toEqual({
      path,
      nombre: 'factura marzo.pdf',
      mime: 'application/pdf',
      bytes: PDF_BYTES.length,
      sha256: 'c'.repeat(64),
    });
    expect(state.dirty).toBe(true);
    expect(state.uploading).toBe(false);
    await controller.persisted();
    expect(recordOn(storage).uploads).toEqual([]);
    expect(recordOn(storage).draft.documento?.path).toBe(path);
  });

  it('sends the attached document in the next save and records it as the server document', async () => {
    const { controller, server } = await openWithDocuments();
    await controller.attach(PNG_BYTES, 'foto.png');

    expect(await controller.save()).toMatchObject({ status: 'saved', version: 1 });
    expect(server.log[0].payload.cabecera.documento).toMatchObject({ path: documentPath(1, 'png'), mime: 'image/png' });
    expect(controller.getState().savedDocumentPath).toBe(documentPath(1, 'png'));
    expect(controller.getState().dirty).toBe(false);
  });

  it.each([
    ['text bytes', new TextEncoder().encode('esto no es un documento')],
    ['an empty file', new Uint8Array(0)],
  ])('rejects %s before upload and leaves the invoice unchanged', async (_name, bytes) => {
    const { controller, storage, documents } = await openWithDocuments();
    const before = controller.getState().draft;

    const outcome = await controller.attach(bytes, 'nota.txt');

    expect(outcome.status).toBe('invalid');
    expect(outcome.status === 'invalid' && outcome.message.length).toBeGreaterThan(0);
    expect(documents.uploadLog).toEqual([]);
    expect(storage.setCount).toBe(0);
    expect(controller.getState().draft).toBe(before);
    expect(controller.getState().draft.documento).toBeNull();
  });

  it('uploads nothing when the pending upload cannot be persisted, and forgets that entry', async () => {
    const { controller, storage, documents } = await openWithDocuments();
    storage.failSet = () => new Error('disk error');

    const outcome = await controller.attach(PDF_BYTES, 'factura.pdf');
    expect(outcome).toEqual({ status: 'nondurable', message: NONDURABLE_MESSAGE });
    expect(documents.uploadLog).toEqual([]);
    expect(controller.getState().draft.documento).toBeNull();

    storage.failSet = undefined;
    controller.edit(withNotas('después'));
    await controller.persisted();
    expect(recordOn(storage).uploads).toEqual([]);
  });

  it.each<[string, UploadMode]>([
    ['the upload throws', 'throw'],
    ['the adapter reports a different path than the one persisted', 'wrong-path'],
  ])('stores no reference and tells the user in Spanish when %s', async (_name, mode) => {
    const { controller, storage, server, documents } = await openWithDocuments();
    documents.uploadMode = mode;

    const outcome = await controller.attach(PDF_BYTES, 'factura.pdf');
    expect(outcome).toEqual({ status: 'upload_failed', message: UPLOAD_FAILED_MESSAGE });
    const state = controller.getState();
    expect(state.draft.documento).toBeNull();
    expect(state.feedback).toEqual({ kind: 'upload_failed', message: UPLOAD_FAILED_MESSAGE });
    await controller.persisted();
    expect(recordOn(storage).uploads).toEqual([{ path: documentPath(1), status: 'failed' }]);

    await controller.save();
    expect(server.log[0].payload.cabecera.documento).toBeNull();
  });

  it('answers busy and uploads once when a second attach arrives during the first', async () => {
    const { controller, documents } = await openWithDocuments();
    const gate = deferred();
    documents.uploadGate = gate.promise;

    const first = controller.attach(PDF_BYTES, 'uno.pdf');
    await flush();
    expect(controller.getState().uploading).toBe(true);
    const second = await controller.attach(PNG_BYTES, 'dos.png');
    expect(second).toMatchObject({ status: 'busy' });

    gate.release();
    expect(await first).toMatchObject({ status: 'attached' });
    expect(documents.uploadLog).toHaveLength(1);
    expect(controller.getState().uploading).toBe(false);
  });

  it('keeps an attachment made while a save is in flight and leaves the draft unsaved', async () => {
    const { controller, server } = await openWithDocuments();
    const rpcGate = deferred();
    server.gate = rpcGate.promise;
    const saving = controller.save();
    await flush();

    await controller.attach(PDF_BYTES, 'tarde.pdf');
    rpcGate.release();
    await saving;

    const state = controller.getState();
    expect(state.draft.documento?.path).toBe(documentPath(1));
    expect(state.savedDocumentPath).toBeNull();
    expect(state.dirty).toBe(true);
  });

  it('replaces the attachment and leaves the old file for a later sweep', async () => {
    const { controller, documents } = await openWithDocuments();
    await controller.attach(PDF_BYTES, 'a.pdf');
    await controller.attach(PNG_BYTES, 'b.png');

    expect(controller.getState().draft.documento?.path).toBe(documentPath(2, 'png'));
    expect(documents.removeLog).toEqual([]);
    expect(documents.files.has(documentPath(1))).toBe(true);
  });
});

describe('account check around attach', () => {
  it('uploads nothing when the account changes while the pending upload is being persisted', async () => {
    const { controller, storage, documents, session } = await openWithDocuments();
    storage.beforeSet = () => {
      session.current = UID_B;
    };

    const outcome = await controller.attach(PDF_BYTES, 'factura.pdf');
    expect(outcome).toMatchObject({ status: 'cuenta_cambiada' });
    expect(documents.uploadLog).toEqual([]);
    expect(controller.getState().draft.documento).toBeNull();
    expect([...storage.data.keys()]).toEqual([facturaKey(UID_A, FACTURA)]);
  });

  it('does not touch anything for an account that is not the signed-in one', async () => {
    const session = { current: UID_B as string | null };
    const { controller, storage, documents } = await openWithDocuments({ session });

    expect(await controller.attach(PDF_BYTES, 'factura.pdf')).toMatchObject({ status: 'cuenta_cambiada' });
    expect(documents.uploadLog).toEqual([]);
    expect(storage.setCount).toBe(0);
  });

  it('applies a result that arrives after an account change to the original owner record only', async () => {
    const { controller, storage, documents, session } = await openWithDocuments();
    const gate = deferred();
    documents.uploadGate = gate.promise;

    const attaching = controller.attach(PDF_BYTES, 'factura.pdf');
    await flush();
    session.current = UID_B;
    gate.release();

    expect(await attaching).toMatchObject({ status: 'attached' });
    expect([...storage.data.keys()]).toEqual([facturaKey(UID_A, FACTURA)]);
    expect(recordOn(storage).draft.documento?.path).toBe(documentPath(1));
    expect(recordOn(storage).uploads).toEqual([]);
  });
});

describe('interrupted uploads', () => {
  async function interruptedAt(): Promise<{ storage: FakeStorage; server: FakeServer }> {
    const first = await openWithDocuments();
    const gate = deferred();
    first.documents.uploadGate = gate.promise;
    void first.controller.attach(PDF_BYTES, 'factura.pdf');
    await flush();
    return { storage: restart(first.storage), server: first.server };
  }

  it('shows the interruption in Spanish after a restart and invents no attachment', async () => {
    const { storage, server } = await interruptedAt();
    const documents = new FakeDocuments();

    const { controller } = await openWithDocuments({ storage, server, documents });
    const state = controller.getState();

    expect(state.interruptedUploads).toEqual([documentPath(1)]);
    expect(state.feedback?.kind).toBe('upload_interrupted');
    expect(state.feedback?.message).toMatch(/Carga interrumpida/);
    expect(state.draft.documento).toBeNull();
    expect(documents.uploadLog).toEqual([]);
    expect(server.log).toHaveLength(0);
  });

  it('keeps the interrupted entry on disk and protected through later writes', async () => {
    const { storage, server } = await interruptedAt();
    const { controller, documents } = await openWithDocuments({ storage, server });

    controller.edit(withNotas('sigue'));
    await controller.persisted();
    expect(recordOn(storage).uploads).toEqual([{ path: documentPath(1), status: 'pending' }]);

    expect(await controller.sweep()).toEqual({ status: 'swept', removed: [], kept: [] });
    expect(documents.removeLog).toEqual([]);
  });

  it('lets an unresolved retry notice take precedence but still lists the interrupted upload', async () => {
    const { storage, server } = await interruptedAt();
    const withIntent = recordOn(storage);
    storage.data.set(
      facturaKey(UID_A, FACTURA),
      JSON.stringify({
        ...withIntent,
        intent: {
          key: 'idem-fijo',
          baseVersion: 0,
          payload: { cabecera: { notas: null, documento: null }, lineas: [] },
          documentPath: null,
        },
      }),
    );

    const { controller } = await openWithDocuments({ storage, server });
    expect(controller.getState().feedback?.kind).toBe('retry_pending');
    expect(controller.getState().interruptedUploads).toEqual([documentPath(1)]);
  });

  it('turns the interrupted entry into a sweepable failed one only once a new attachment succeeded', async () => {
    const { storage, server } = await interruptedAt();
    const documents = new FakeDocuments();
    const { controller } = await openWithDocuments({ storage, server, documents });
    documents.uploadMode = 'throw';
    await controller.attach(PNG_BYTES, 'otra.png');
    expect(controller.getState().interruptedUploads).toEqual([documentPath(1)]);

    documents.uploadMode = 'ok';
    await controller.attach(PNG_BYTES, 'otra.png');
    const state = controller.getState();
    expect(state.interruptedUploads).toEqual([]);
    expect(state.feedback).toBeNull();
    await controller.persisted();
    expect(recordOn(storage).uploads).toEqual([
      { path: documentPath(1), status: 'failed' },
      { path: documentPath(1, 'png'), status: 'failed' },
    ]);
  });
});

describe('sweeping unreferenced files', () => {
  async function seedWith(overrides: Partial<FacturaLocalRecord>): Promise<AttachOpened> {
    const seed = new FakeStorage();
    await createFacturaLocalStore(seed).write({
      schema: 1,
      uid: UID_A,
      facturaId: FACTURA,
      seq: 1,
      draft: baseDraft(),
      savedDocumentPath: null,
      intent: null,
      uploads: [],
      protectedPaths: [],
      dirty: true,
      ...overrides,
    });
    const documents = new FakeDocuments();
    documents.files.add(documentPath(1));
    documents.files.add(documentPath(2));
    return openWithDocuments({ storage: restart(seed), documents });
  }

  const failed = (index: number): { path: string; status: 'failed' } => ({ path: documentPath(index), status: 'failed' });

  it('removes a failed upload nobody references and forgets its entry', async () => {
    const { controller, storage, documents } = await seedWith({ uploads: [failed(1)] });

    expect(await controller.sweep()).toEqual({ status: 'swept', removed: [documentPath(1)], kept: [] });
    expect(documents.removeLog).toEqual([documentPath(1)]);
    expect(documents.files.has(documentPath(1))).toBe(false);
    await controller.persisted();
    expect(recordOn(storage).uploads).toEqual([]);
  });

  it('removes only the unreferenced one when two failed uploads exist', async () => {
    const draft = { ...baseDraft(), documento: { ...documentFor(), path: documentPath(2) } };
    const { controller, documents } = await seedWith({ draft, uploads: [failed(1), failed(2)] });

    expect(await controller.sweep()).toEqual({ status: 'swept', removed: [documentPath(1)], kept: [documentPath(2)] });
    expect(documents.files.has(documentPath(2))).toBe(true);
  });

  it.each<[string, () => Partial<FacturaLocalRecord>]>([
    ['the draft document', () => ({ draft: { ...baseDraft(), documento: { ...documentFor(), path: documentPath(1) } } })],
    ['the document the server holds', () => ({ savedDocumentPath: documentPath(1) })],
    [
      'the document of an unresolved intent',
      () => ({
        intent: {
          key: 'idem-fijo',
          baseVersion: 0,
          payload: { cabecera: { documento: null }, lineas: [] },
          documentPath: documentPath(1),
        },
      }),
    ],
    [
      'the document inside an unresolved intent payload',
      () => ({
        intent: {
          key: 'idem-fijo',
          baseVersion: 0,
          payload: { cabecera: { documento: { ...documentFor(), path: documentPath(1) } }, lineas: [] },
          documentPath: null,
        },
      }),
    ],
    ['a protected path', () => ({ protectedPaths: [documentPath(1)] })],
  ])('never removes %s', async (_name, overrides) => {
    const { controller, documents } = await seedWith({ ...overrides(), uploads: [failed(1)] });

    expect(await controller.sweep()).toEqual({ status: 'swept', removed: [], kept: [documentPath(1)] });
    expect(documents.removeLog).toEqual([]);
    expect(documents.files.has(documentPath(1))).toBe(true);
  });

  it('removes the file a replaced attachment left behind only once the server no longer holds it', async () => {
    const seed = new FakeStorage();
    const documents = new FakeDocuments();
    const { controller, storage } = await openWithDocuments({
      storage: seed,
      documents,
      initial: { ...baseDraft(), documento: documentFor() },
      savedDocumentPath: documentFor().path,
    });
    await controller.attach(PDF_BYTES, 'nueva.pdf');

    expect(await controller.sweep()).toEqual({ status: 'swept', removed: [], kept: [documentFor().path] });
    expect(documents.removeLog).toEqual([]);

    expect(await controller.save()).toMatchObject({ status: 'saved' });
    expect(await controller.sweep()).toEqual({ status: 'swept', removed: [documentFor().path], kept: [] });
    expect(documents.removeLog).toEqual([documentFor().path]);
    expect(recordOn(storage).draft.documento?.path).toBe(documentPath(1));
  });

  it('keeps the entry and reports it as kept when the removal fails, then retries on the next sweep', async () => {
    const { controller, storage, documents } = await seedWith({ uploads: [failed(1)] });
    documents.failRemove = true;

    expect(await controller.sweep()).toEqual({ status: 'swept', removed: [], kept: [documentPath(1)] });
    await controller.persisted();
    expect(recordOn(storage).uploads).toEqual([failed(1)]);

    documents.failRemove = false;
    expect(await controller.sweep()).toEqual({ status: 'swept', removed: [documentPath(1)], kept: [] });
  });

  it('does nothing while a save or an upload is in flight', async () => {
    const { controller, server, documents } = await seedWith({ uploads: [failed(1)] });
    const rpcGate = deferred();
    server.gate = rpcGate.promise;
    const saving = controller.save();
    await flush();
    expect(await controller.sweep()).toEqual({ status: 'skipped', reason: 'saving' });
    rpcGate.release();
    await saving;

    const uploadGate = deferred();
    documents.uploadGate = uploadGate.promise;
    const attaching = controller.attach(PDF_BYTES, 'uno.pdf');
    await flush();
    expect(await controller.sweep()).toEqual({ status: 'skipped', reason: 'uploading' });
    uploadGate.release();
    await attaching;
    expect(documents.removeLog).toEqual([]);
  });

  it('does nothing when the stored entry could not be read, because its uploads are unknown', async () => {
    const storage = new FakeStorage();
    storage.data.set(facturaKey(UID_A, FACTURA), JSON.stringify({ schema: 2 }));
    const { controller, documents } = await openWithDocuments({ storage });
    documents.files.add(documentPath(1));

    expect(await controller.sweep()).toEqual({ status: 'skipped', reason: 'blocked' });
    expect(documents.removeLog).toEqual([]);
  });

  it('removes nothing when another account is signed in, and stops at the first account change mid-sweep', async () => {
    const { controller, documents, session } = await seedWith({ uploads: [failed(1), failed(2)] });
    session.current = UID_B;
    expect(await controller.sweep()).toMatchObject({ status: 'cuenta_cambiada' });
    expect(documents.removeLog).toEqual([]);

    session.current = UID_A;
    documents.beforeRemove = () => {
      session.current = UID_B;
    };
    const outcome = await controller.sweep();
    expect(documents.removeLog).toEqual([documentPath(1)]);
    expect(outcome).toEqual({ status: 'cuenta_cambiada', message: expect.any(String) });
    expect(documents.files.has(documentPath(2))).toBe(true);
  });
});

// --- Discard, tombstone, close and reconstruction (U6) ----------------------------------------

const IN_PROGRESS_MESSAGE = 'Hay una operación en curso; espera a que termine antes de cerrar o descartar.';

describe('discarding a draft', () => {
  it('asks for confirmation and changes nothing until it is given', async () => {
    const { controller, storage } = await openWithDocuments();
    controller.edit(withNotas('conservar'));
    await controller.persisted();
    const before = storage.data.get(facturaKey(UID_A, FACTURA));

    const outcome = await controller.discard(false);
    expect(outcome.status).toBe('confirmation_required');
    expect(storage.data.get(facturaKey(UID_A, FACTURA))).toBe(before);
    expect(controller.getState().closed).toBe(false);
    controller.edit(withNotas('sigue abierto'));
    await controller.persisted();
    expect(recordOn(storage).draft.notas).toBe('sigue abierto');
  });

  it('replaces the draft with a tombstone that keeps the unresolved intent but none of the content', async () => {
    const { controller, storage, server } = await openWithDocuments({
      initial: { ...baseDraft(), documento: documentFor() },
    });
    server.script = ['commit-but-lose-response'];
    await controller.save();

    expect(await controller.discard(true)).toEqual({ status: 'discarded' });
    const stored = recordOn(storage);
    expect(stored.tombstone).toBe(true);
    expect(stored.draft.lineas).toEqual([]);
    expect(stored.draft.notas).toBe('');
    expect(stored.draft.documento).toBeNull();
    expect(stored.intent?.key).toBe(server.log[0].key);
    expect(stored.protectedPaths).toEqual(expect.arrayContaining([documentFor().path]));
    expect(controller.getState().closed).toBe(true);
    expect(controller.getState().retryPending).toBe(false);
  });

  it('never replays a discarded intent: a new editor for the invoice starts fresh and sends a new key', async () => {
    const first = await openWithDocuments();
    first.server.script = ['commit-but-lose-response'];
    first.controller.edit(withNotas('descartada'));
    await first.controller.save();
    await first.controller.discard(true);

    const second = await openWithDocuments({
      storage: restart(first.storage),
      server: first.server,
      initial: createDraft({ facturaId: FACTURA }),
    });
    const state = second.controller.getState();
    expect(state.retryPending).toBe(false);
    expect(state.dirty).toBe(false);
    expect(state.draft.notas).toBe('');
    expect(state.feedback).toBeNull();
    expect(first.server.log).toHaveLength(1);

    second.controller.edit(withNotas('nueva'));
    await second.controller.save();
    expect(first.server.log[1].key).not.toBe(first.server.log[0].key);
    expect(first.server.log[1].payload.cabecera.notas).toBe('nueva');
  });

  it('keeps every file an unresolved intent may reference out of reach of later sweeps', async () => {
    const documents = new FakeDocuments();
    const first = await openWithDocuments({ documents });
    await first.controller.attach(PDF_BYTES, 'factura.pdf');
    first.server.script = ['commit-but-lose-response'];
    await first.controller.save();
    documents.uploadMode = 'throw';
    await first.controller.attach(PNG_BYTES, 'fallida.png');
    await first.controller.discard(true);

    const second = await openWithDocuments({
      storage: restart(first.storage),
      server: first.server,
      documents,
      initial: createDraft({ facturaId: FACTURA }),
    });
    expect(await second.controller.sweep()).toEqual({ status: 'swept', removed: [], kept: [] });
    expect(documents.removeLog).toEqual([]);
    expect(documents.files.has(documentPath(1))).toBe(true);

    second.controller.edit(withNotas('ya otra'));
    await second.controller.persisted();
    const live = recordOn(second.storage);
    expect(live).not.toHaveProperty('tombstone');
    expect(live.protectedPaths).toEqual(expect.arrayContaining([documentPath(1), documentPath(2, 'png')]));
    expect(await second.controller.sweep()).toEqual({ status: 'swept', removed: [], kept: [] });
  });

  it('removes only the selected owner draft and leaves another account record byte for byte', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    await store.write({
      schema: 1,
      uid: UID_B,
      facturaId: FACTURA,
      seq: 1,
      draft: baseDraft(),
      savedDocumentPath: null,
      intent: null,
      uploads: [],
      protectedPaths: [],
    });
    const otherRaw = storage.data.get(facturaKey(UID_B, FACTURA));
    const { controller } = await openWithDocuments({ storage, store });
    controller.edit(withNotas('de A'));

    expect(await controller.discard(true)).toEqual({ status: 'discarded' });
    expect(storage.data.get(facturaKey(UID_B, FACTURA))).toBe(otherRaw);
    const listedB = await createFacturaLocalStore(storage).listDrafts(UID_B);
    expect(listedB.status === 'ok' && listedB.drafts.map(draft => draft.facturaId)).toEqual([FACTURA]);
    const listedA = await createFacturaLocalStore(storage).listDrafts(UID_A);
    expect(listedA.status === 'ok' && listedA.drafts).toEqual([]);
  });

  it('is refused while a save or an upload is in flight, then works', async () => {
    const { controller, server, documents } = await openWithDocuments();
    const rpcGate = deferred();
    server.gate = rpcGate.promise;
    const saving = controller.save();
    await flush();
    expect(await controller.discard(true)).toEqual({ status: 'in_progress', message: IN_PROGRESS_MESSAGE });
    rpcGate.release();
    await saving;

    const uploadGate = deferred();
    documents.uploadGate = uploadGate.promise;
    const attaching = controller.attach(PDF_BYTES, 'a.pdf');
    await flush();
    expect(await controller.discard(true)).toEqual({ status: 'in_progress', message: IN_PROGRESS_MESSAGE });
    uploadGate.release();
    await attaching;

    expect(await controller.discard(true)).toEqual({ status: 'discarded' });
  });

  it('stays open with the draft intact when the tombstone cannot be written, and can be retried', async () => {
    const { controller, storage } = await openWithDocuments();
    controller.edit(withNotas('no perder'));
    await controller.persisted();
    storage.failSet = () => new Error('disk error');

    expect(await controller.discard(true)).toEqual({ status: 'nondurable', message: NONDURABLE_MESSAGE });
    expect(controller.getState().closed).toBe(false);
    expect(controller.getState().draft.notas).toBe('no perder');
    expect(recordOn(storage)).not.toHaveProperty('tombstone');

    storage.failSet = undefined;
    expect(await controller.discard(true)).toEqual({ status: 'discarded' });
    expect(recordOn(storage).tombstone).toBe(true);
  });

  it('writes nothing for another signed-in account or an unreadable stored entry', async () => {
    const other = await openWithDocuments({ session: { current: UID_B } });
    expect(await other.controller.discard(true)).toMatchObject({ status: 'cuenta_cambiada' });
    expect(other.storage.setCount).toBe(0);

    const storage = new FakeStorage();
    storage.data.set(facturaKey(UID_A, FACTURA), JSON.stringify({ schema: 2 }));
    const blocked = await openWithDocuments({ storage });
    expect(await blocked.controller.discard(true)).toMatchObject({ status: 'blocked' });
    expect(storage.data.get(facturaKey(UID_A, FACTURA))).toBe(JSON.stringify({ schema: 2 }));
  });

  it('rejects every later mutation once discarded', async () => {
    const { controller, storage } = await openWithDocuments();
    await controller.discard(true);
    const writes = storage.setCount;

    expect(() => controller.edit(withNotas('tarde'))).toThrow(RangeError);
    await expect(controller.save()).rejects.toThrow(RangeError);
    await expect(controller.attach(PDF_BYTES, 'a.pdf')).rejects.toThrow(RangeError);
    await expect(controller.sweep()).rejects.toThrow(RangeError);
    await expect(controller.discard(true)).rejects.toThrow(RangeError);
    expect(storage.setCount).toBe(writes);
  });
});

describe('closing the editor', () => {
  it('is blocked while a save or an upload is in flight and never discards', async () => {
    const { controller, server } = await openWithDocuments();
    controller.edit(withNotas('pendiente'));
    const rpcGate = deferred();
    server.gate = rpcGate.promise;
    const saving = controller.save();
    await flush();

    expect(await controller.close()).toEqual({ status: 'blocked', message: IN_PROGRESS_MESSAGE });
    expect(controller.getState().closed).toBe(false);
    rpcGate.release();
    await saving;
    expect(await controller.close()).toEqual({ status: 'closed', draftKept: false });
  });

  it('keeps a dirty draft as a local draft and restores it exactly after reconstruction', async () => {
    const documents = new FakeDocuments();
    const first = await openWithDocuments({ documents });
    await first.controller.attach(PNG_BYTES, 'foto.png');
    await first.controller.save();
    first.controller.edit(draft => updateLinea(draft, L2, { cantidad: '7' }));
    const before = first.controller.getState().draft;

    expect(await first.controller.close()).toEqual({ status: 'closed', draftKept: true });
    expect(recordOn(first.storage)).not.toHaveProperty('tombstone');

    const listed = await createFacturaLocalStore(first.storage).listDrafts(UID_A);
    expect(listed.status === 'ok' && listed.drafts.map(draft => draft.facturaId)).toEqual([FACTURA]);

    const second = await openWithDocuments({ storage: restart(first.storage), server: first.server, documents });
    const restored = second.controller.getState();
    expect(restored.draft).toEqual(before);
    expect(restored.draft.lineas.map(linea => [linea.lineaId, linea.codigoProducto, linea.cantidad])).toEqual([
      [L1, 'TOR-01', '10'],
      [L2, 'TOR-01', '7'],
    ]);
    expect(restored.draft.documento?.path).toBe(documentPath(1, 'png'));
    expect(restored.dirty).toBe(true);
    expect(first.server.log).toHaveLength(1);
  });

  it('closes a fully acknowledged draft without keeping anything dirty', async () => {
    const { controller } = await openWithDocuments();
    await controller.save();

    expect(await controller.close()).toEqual({ status: 'closed', draftKept: false });
    expect(controller.getState().closed).toBe(true);
  });

  it('keeps an unresolved retry as a draft', async () => {
    const { controller, server } = await openWithDocuments();
    server.script = ['commit-but-lose-response'];
    await controller.save();

    expect(await controller.close()).toEqual({ status: 'closed', draftKept: true });
  });

  it('waits for queued local writes, so what the user typed is on disk when it reports closed', async () => {
    const { controller, storage } = await openWithDocuments();
    const gate = deferred();
    storage.beforeSet = () => gate.promise;
    controller.edit(withNotas('tecleado'));
    await flush();

    const closing = controller.close();
    await flush();
    expect(storage.data.size).toBe(0);
    gate.release();

    expect(await closing).toEqual({ status: 'closed', draftKept: true });
    expect(recordOn(storage).draft.notas).toBe('tecleado');
  });

  it('refuses to close while unsaved content could not be written locally, and closes once it can', async () => {
    const { controller, storage } = await openWithDocuments();
    storage.failSet = () => new Error('disk error');
    controller.edit(withNotas('sin guardar'));

    const refused = await controller.close();
    expect(refused).toEqual({ status: 'nondurable', message: NONDURABLE_MESSAGE });
    expect(controller.getState().closed).toBe(false);

    storage.failSet = undefined;
    controller.edit(withNotas('ahora sí'));
    expect(await controller.close()).toEqual({ status: 'closed', draftKept: true });
    expect(recordOn(storage).draft.notas).toBe('ahora sí');
  });

  it('reports an account change instead of closing over unsaved content, and a blocked store the same way', async () => {
    const changed = await openWithDocuments();
    changed.controller.edit(withNotas('de A'));
    changed.session.current = UID_B;
    await changed.controller.persisted();
    expect(await changed.controller.close()).toMatchObject({ status: 'cuenta_cambiada' });

    const storage = new FakeStorage();
    storage.data.set(facturaKey(UID_A, FACTURA), JSON.stringify({ schema: 2 }));
    const blocked = await openWithDocuments({ storage });
    blocked.controller.edit(withNotas('bloqueado'));
    expect(await blocked.controller.close()).toMatchObject({ status: 'blocked' });
  });

  it('is idempotent and rejects later mutations', async () => {
    const { controller } = await openWithDocuments();
    controller.edit(withNotas('x'));
    const first = await controller.close();
    expect(await controller.close()).toEqual(first);
    expect(() => controller.edit(withNotas('y'))).toThrow(RangeError);
    await expect(controller.save()).rejects.toThrow(RangeError);
  });
});

describe('controller reuse across reconstruction', () => {
  it('continues after a delayed write of a disposed instance without regressing the revision', async () => {
    const storage = new FakeStorage();
    const store = createFacturaLocalStore(storage);
    const first = await openWithDocuments({ storage, store });
    const gate = deferred();
    storage.beforeSet = () => gate.promise;
    first.controller.edit(withNotas('uno'));
    await flush();

    const secondOpening = openWithDocuments({ storage, store });
    await flush();
    gate.release();
    const second = await secondOpening;
    expect(second.controller.getState().draft.notas).toBe('uno');

    second.controller.edit(withNotas('dos'));
    await second.controller.persisted();
    const persisted = recordOn(storage);
    expect(persisted.draft.notas).toBe('dos');
    expect(persisted.seq).toBeGreaterThan(1);
  });
});
