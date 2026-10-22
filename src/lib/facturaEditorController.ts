import { buildDocumentPath, displayNameFor, validateDocumentBytes } from './facturaDocumento';
import {
  FacturaStoreError,
  facturaKey,
  type FacturaIntent,
  type FacturaLocalRecord,
  type FacturaLocalStore,
  type FacturaUpload,
  type WriteOutcome,
} from './facturaLocalStore';
import {
  buildSavePayload,
  createDraft,
  payloadFingerprint,
  type FacturaDocumento,
  type FacturaDraft,
} from './facturaProveedor';
import type { GuardarInput, SubirDocumentoInput } from './facturaProveedorRepository';
import { reportFacturaThrown } from './facturaTelemetry';

/**
 * Save core of the supplier-invoice editor: framework-free, no timers, no network of its own.
 * It owns the draft, the immutable retry intent, the order of local writes and the document
 * lifecycle (attach, interrupted uploads, sweeps).
 *
 * Rule for the RPC: an intent is written to the store and confirmed (`written`) before it is
 * sent. Any other write outcome means nothing is sent.
 *
 * Rule for the account: the key always comes from the bound `uid`, never from `getUid()`. Starting
 * an operation (edit write, checkpoint, upload, sweep) requires `getUid() === uid`; the result of an
 * operation that was already started under the owner is still recorded, on the owner's key only.
 */

/** Why the server definitively answered no. Produced by the injected adapter from the raw SQLSTATE. */
export type RejectReason = 'conflict' | 'key_reused' | 'invalid' | 'unauthorized' | 'unknown';

/**
 * What the injected adapter reports for one RPC. `ambiguous` covers no response, timeout and 5xx:
 * the request may have been applied. `rejected` is only for a definite answer (a SQLSTATE or an
 * auth rejection). A thrown error is treated as `ambiguous`.
 */
export type SubmitResult =
  | { kind: 'committed'; version: number; replay: boolean }
  | { kind: 'ambiguous' }
  | { kind: 'rejected'; reason: RejectReason };

export type FeedbackKind =
  | RejectReason
  | 'nondurable'
  | 'retry_pending'
  | 'cuenta_cambiada'
  | 'storage'
  | 'upload_failed'
  | 'upload_interrupted';

export interface Feedback {
  kind: FeedbackKind;
  message: string;
}

export interface EditorState {
  readonly draft: FacturaDraft;
  /** Path of the document the server holds, as of the last acknowledged payload. */
  readonly savedDocumentPath: string | null;
  /** The draft differs from what the server acknowledged. */
  readonly dirty: boolean;
  readonly saving: boolean;
  /** A frozen intent awaits its outcome; the next save replays it before anything newer. */
  readonly retryPending: boolean;
  /** The latest revision is confirmed on this device. */
  readonly localSaved: boolean;
  /** Hydration could not read the stored entry, so writing would replace it: nothing is written or sent. */
  readonly writesBlocked: boolean;
  /** An upload is running; its path is persisted as pending and protected from sweeps. */
  readonly uploading: boolean;
  /** Uploads that a previous session left pending. Nothing was attached for them. */
  readonly interruptedUploads: readonly string[];
  /** Closed or discarded: every further mutation is refused. */
  readonly closed: boolean;
  readonly feedback: Feedback | null;
}

export type EditorSaveOutcome =
  | { status: 'saved'; version: number; replay: boolean; localDurable: boolean }
  | { status: 'invalid'; errors: Record<string, string> }
  | { status: 'nondurable'; message: string }
  | { status: 'pending'; message: string }
  | { status: 'blocked'; message: string }
  | { status: 'rejected'; reason: RejectReason; message: string }
  | { status: 'cuenta_cambiada'; message: string };

export type AttachOutcome =
  | { status: 'attached'; path: string; localDurable: boolean }
  | { status: 'invalid'; message: string }
  | {
      status: 'busy' | 'nondurable' | 'blocked' | 'upload_failed' | 'cuenta_cambiada';
      message: string;
    };

export type SweepOutcome =
  | { status: 'swept'; removed: string[]; kept: string[] }
  | { status: 'skipped'; reason: 'saving' | 'uploading' | 'blocked' }
  | { status: 'cuenta_cambiada'; message: string };

export type DiscardOutcome =
  | { status: 'discarded' }
  | {
      status: 'confirmation_required' | 'in_progress' | 'blocked' | 'nondurable' | 'cuenta_cambiada';
      message: string;
    };

export type CloseOutcome =
  | { status: 'closed'; draftKept: boolean }
  | { status: 'blocked' | 'nondurable' | 'cuenta_cambiada'; message: string };

/** Private bucket operations, injected so the controller never touches the network itself. */
export interface DocumentGateway {
  newDocumentId(): string;
  sha256(bytes: Uint8Array): Promise<string>;
  /** Stores the bytes under `buildDocumentPath(ownerId, facturaId, documentId, mime)`. Throws when nothing was stored. */
  upload(input: SubirDocumentoInput): Promise<FacturaDocumento>;
  /** True only when the file is gone. The bucket policy refuses files that a record still references. */
  remove(path: string): Promise<boolean>;
}

export interface EditorController {
  subscribe(listener: () => void): () => void;
  /** Same reference until the state changes. */
  getState(): EditorState;
  edit(update: (draft: FacturaDraft) => FacturaDraft): void;
  /** One save at a time: calls made while one is in flight return the same promise. */
  save(): Promise<EditorSaveOutcome>;
  /** Uploads a validated file, then attaches it to the draft. One at a time; other edits stay possible. */
  attach(bytes: Uint8Array, nombre: string): Promise<AttachOutcome>;
  /** Removes failed or replaced uploads that nothing references any more. Never runs mid-save or mid-upload. */
  sweep(): Promise<SweepOutcome>;
  /**
   * Needs `confirmed === true`. Replaces the draft with a hidden tombstone that keeps the unresolved
   * intent and every path it may reference: they are never replayed and never swept. Refused mid-save.
   */
  discard(confirmed: boolean): Promise<DiscardOutcome>;
  /** Never discards: unsaved content stays a local draft. Refused mid-save, mid-upload or when it cannot be kept. */
  close(): Promise<CloseOutcome>;
  /** Resolves once every local write requested so far has finished. */
  persisted(): Promise<void>;
}

export interface EditorDependencies {
  uid: string;
  facturaId: string;
  /** Must be the same store instance (or share its storage object) across controllers of one runtime. */
  store: FacturaLocalStore;
  /** Currently signed-in account, or null. */
  getUid: () => string | null;
  newKey: () => string;
  documents: DocumentGateway;
  submit: (input: GuardarInput) => Promise<SubmitResult>;
}

type LocalWrite = WriteOutcome | { status: 'account_changed' } | { status: 'blocked' };

export interface HydrationInput {
  /** Used when nothing is stored locally. */
  draft: FacturaDraft;
  savedDocumentPath: string | null;
}

const MESSAGES: Record<Exclude<FeedbackKind, 'storage'> | 'blocked' | 'busy' | 'confirmation_required' | 'in_progress', string> = {
  nondurable: 'No se pudo guardar en este dispositivo; no se envió.',
  blocked: 'No se puede guardar en este dispositivo hasta resolver el borrador existente; no se envió.',
  retry_pending:
    'No se recibió respuesta del servidor. La factura sigue en este dispositivo; vuelve a guardar para confirmar.',
  conflict: 'Esta factura cambió desde otro dispositivo. Tus cambios siguen aquí y no se sobrescribió nada.',
  key_reused: 'Esta operación ya se registró con otro contenido. Vuelve a guardar.',
  invalid: 'Hay datos que no se pudieron guardar. Revisa los campos e inténtalo otra vez.',
  unauthorized: 'No tienes permiso para esta factura. Inicia sesión de nuevo e inténtalo otra vez.',
  unknown: 'No se pudo completar la operación. Inténtalo otra vez.',
  upload_failed: 'No se pudo subir el archivo. Inténtalo otra vez.',
  upload_interrupted: 'Carga interrumpida: el archivo no se adjuntó. Vuelve a adjuntarlo.',
  busy: 'Ya se está subiendo un archivo; espera a que termine.',
  confirmation_required: 'Confirma que quieres descartar este borrador.',
  in_progress: 'Hay una operación en curso; espera a que termine antes de cerrar o descartar.',
  cuenta_cambiada: 'La sesión cambió; no se envió nada. Inicia sesión con la cuenta de esta factura.',
};

function feedbackFor(kind: Exclude<FeedbackKind, 'storage'>): Feedback {
  return { kind, message: MESSAGES[kind] };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function noop(): void {}

/** Every storage path an unresolved intent may still ask the server to attach. */
function intentPaths(intent: FacturaIntent | null): string[] {
  if (intent === null) return [];
  const inPayload = (intent.payload.cabecera.documento as { path?: unknown } | null | undefined)?.path;
  return [intent.documentPath, typeof inPayload === 'string' ? inPayload : null].filter(
    (path): path is string => path !== null,
  );
}

/** True when the draft would send a different payload than the one already frozen. */
function differsFromIntent(draft: FacturaDraft, intent: FacturaIntent): boolean {
  const built = buildSavePayload(draft);
  return !built.ok || payloadFingerprint(built) !== payloadFingerprint(intent.payload);
}

export async function hydrateFacturaEditor(
  deps: EditorDependencies,
  initial: HydrationInput,
): Promise<EditorController> {
  const { uid, facturaId, store } = deps;
  facturaKey(uid, facturaId); // throws RangeError for ids that cannot form an account-scoped key

  let draft = initial.draft;
  let savedDocumentPath = initial.savedDocumentPath;
  let intent: FacturaIntent | null = null;
  let uploads: FacturaUpload[] = [];
  let protectedPaths: string[] = [];
  let interrupted: string[] = [];
  let attaching = false;
  let lifecycle: 'open' | 'closing' | 'closed' = 'open';
  let closeOutcome: CloseOutcome | null = null;
  /** Replaced documents: the server may still hold one until the save that replaced it commits. */
  const abandoned = new Set<string>();
  let dirty = false;
  let saving = false;
  let localSaved = true;
  let writesBlocked = false;
  let feedback: Feedback | null = null;
  let revision = 0;
  let writeChain: Promise<unknown> = Promise.resolve();
  let inFlight: Promise<EditorSaveOutcome> | null = null;
  const listeners = new Set<() => void>();

  function isOwnerCurrent(): boolean {
    return deps.getUid() === uid;
  }

  function buildState(): EditorState {
    return {
      draft,
      savedDocumentPath,
      dirty,
      saving,
      retryPending: intent !== null,
      localSaved,
      writesBlocked,
      uploading: attaching,
      interruptedUploads: interrupted,
      closed: lifecycle === 'closed',
      feedback,
    };
  }

  let state = buildState();

  function publish(): void {
    state = buildState();
    [...listeners].forEach(listener => listener());
  }

  /** The model changed: the new revision is not on disk until a write covering it is confirmed. */
  function changed(): void {
    revision += 1;
    localSaved = false;
    publish();
  }

  function assertOpen(): void {
    if (lifecycle !== 'open') throw new RangeError('the editor is closed');
  }

  /** The cleared draft plus everything an unresolved intent or the server may still reference. */
  function tombstone(): FacturaLocalRecord {
    const paths = [
      ...protectedPaths,
      ...intentPaths(intent),
      ...(savedDocumentPath === null ? [] : [savedDocumentPath]),
      ...(draft.documento === null ? [] : [draft.documento.path]),
      ...uploads.map(upload => upload.path),
    ];
    return {
      schema: 1,
      uid,
      facturaId,
      seq: store.nextSeq(uid, facturaId),
      draft: { ...createDraft({ facturaId }), version: draft.version },
      savedDocumentPath,
      intent,
      uploads: [],
      protectedPaths: [...new Set(paths)],
      dirty: false,
      tombstone: true,
    };
  }

  function snapshot(): FacturaLocalRecord {
    return {
      schema: 1,
      uid,
      facturaId,
      seq: store.nextSeq(uid, facturaId),
      draft,
      savedDocumentPath,
      intent,
      uploads,
      protectedPaths,
      dirty,
    };
  }

  /**
   * A write is skipped, not queued for later, when it could replace an unreadable entry or when another
   * account is signed in. `guard: false` is only for recording the result of an operation that was
   * already sent under the owner; it still writes the owner's key and nothing else.
   */
  async function writeCurrent(guard: boolean, asTombstone: boolean): Promise<LocalWrite> {
    if (writesBlocked) {
      localSaved = false;
      publish();
      return { status: 'blocked' };
    }
    if (guard && !isOwnerCurrent()) {
      localSaved = false;
      feedback = feedbackFor('cuenta_cambiada');
      publish();
      return { status: 'account_changed' };
    }

    const covers = revision;
    let outcome: WriteOutcome;
    try {
      outcome = await store.write(asTombstone ? tombstone() : snapshot());
    } catch (error) {
      reportFacturaThrown('local_write', error);
      outcome = { status: 'error', error: new FacturaStoreError('unavailable') };
    }
    if (outcome.status === 'written') {
      if (covers === revision) {
        localSaved = true;
        if (feedback?.kind === 'nondurable' || feedback?.kind === 'cuenta_cambiada') feedback = null;
      }
    } else {
      localSaved = false;
      feedback = feedbackFor('nondurable');
    }
    publish();
    return outcome;
  }

  /** Every write carries the full current model and runs after the previous one, so the newest always lands last. */
  function persist(guard = true, asTombstone = false): Promise<LocalWrite> {
    const run = writeChain.then(() => writeCurrent(guard, asTombstone));
    writeChain = run.then(noop, noop);
    return run;
  }

  /** Why a local write that had to be confirmed first was not: nothing downstream may run. */
  function refusal(outcome: Exclude<LocalWrite, { status: 'written' }>): {
    status: 'cuenta_cambiada' | 'blocked' | 'nondurable';
    message: string;
  } {
    if (outcome.status === 'account_changed') return { status: 'cuenta_cambiada', message: MESSAGES.cuenta_cambiada };
    if (outcome.status === 'blocked') return { status: 'blocked', message: MESSAGES.blocked };
    return { status: 'nondurable', message: MESSAGES.nondurable };
  }

  function accountChanged(): { status: 'cuenta_cambiada'; message: string } {
    feedback = feedbackFor('cuenta_cambiada');
    publish();
    return { status: 'cuenta_cambiada', message: MESSAGES.cuenta_cambiada };
  }

  async function acknowledge(
    frozen: FacturaIntent,
    result: Extract<SubmitResult, { kind: 'committed' }>,
  ): Promise<EditorSaveOutcome> {
    intent = null;
    draft = { ...draft, version: result.version };
    savedDocumentPath = frozen.documentPath;
    dirty = differsFromIntent(draft, frozen);
    feedback = null;
    changed();
    const written = await persist(false);
    return { status: 'saved', version: result.version, replay: result.replay, localDurable: written.status === 'written' };
  }

  async function reject(reason: RejectReason): Promise<EditorSaveOutcome> {
    intent = null;
    dirty = true;
    feedback = null;
    changed();
    await persist(false);
    feedback = feedbackFor(reason);
    publish();
    return { status: 'rejected', reason, message: MESSAGES[reason] };
  }

  function keepPending(): EditorSaveOutcome {
    feedback = feedbackFor('retry_pending');
    publish();
    return { status: 'pending', message: MESSAGES.retry_pending };
  }

  async function transmit(frozen: FacturaIntent): Promise<EditorSaveOutcome> {
    if (!isOwnerCurrent()) return accountChanged();

    let result: SubmitResult;
    try {
      result = await deps.submit({
        facturaId,
        version: frozen.baseVersion,
        key: frozen.key,
        payload: cloneJson(frozen.payload),
      });
    } catch (error) {
      reportFacturaThrown('save', error);
      result = { kind: 'ambiguous' };
    }

    switch (result.kind) {
      case 'committed':
        return acknowledge(frozen, result);
      case 'rejected':
        return reject(result.reason);
      case 'ambiguous':
        return keepPending();
    }
  }

  async function sendFresh(): Promise<EditorSaveOutcome> {
    const built = buildSavePayload(draft);
    if (!built.ok) return { status: 'invalid', errors: built.errors };

    const frozen = deepFreeze(
      cloneJson<FacturaIntent>({
        key: deps.newKey(),
        baseVersion: draft.version,
        payload: { cabecera: built.cabecera, lineas: built.lineas },
        documentPath: draft.documento?.path ?? null,
      }),
    );
    intent = frozen;
    changed();

    const written = await persist();
    if (written.status !== 'written') {
      intent = null;
      changed();
      return refusal(written);
    }
    return transmit(frozen);
  }

  /** Replays an existing intent first; edits made since are sent afterwards under a new key. */
  async function saveSequence(): Promise<EditorSaveOutcome> {
    if (!isOwnerCurrent()) return accountChanged();
    if (writesBlocked) return { status: 'blocked', message: MESSAGES.blocked };
    if (intent === null) return sendFresh();

    const frozen = intent;
    const replayed = await transmit(frozen);
    if (replayed.status !== 'saved' || !differsFromIntent(draft, frozen)) return replayed;
    return sendFresh();
  }

  async function runSave(): Promise<EditorSaveOutcome> {
    await null; // lets save() register the in-flight promise before any listener can re-enter
    try {
      return await saveSequence();
    } finally {
      inFlight = null;
      saving = false;
      publish();
    }
  }

  /** Sweep targets are failed uploads and replaced documents only, so pending uploads are never candidates. */
  function isProtected(path: string): boolean {
    return (
      path === savedDocumentPath ||
      path === draft.documento?.path ||
      intentPaths(intent).includes(path) ||
      protectedPaths.includes(path)
    );
  }

  function markUpload(path: string, status: FacturaUpload['status']): void {
    uploads = uploads.map(upload => (upload.path === path ? { ...upload, status } : upload));
  }

  async function failUpload(path: string): Promise<AttachOutcome> {
    markUpload(path, 'failed');
    feedback = feedbackFor('upload_failed');
    changed();
    await persist(false);
    return { status: 'upload_failed', message: MESSAGES.upload_failed };
  }

  async function runAttach(bytes: Uint8Array, nombre: string, mime: FacturaDocumento['mime']): Promise<AttachOutcome> {
    const documentId = deps.documents.newDocumentId();
    const path = buildDocumentPath(uid, facturaId, documentId, mime);
    let sha256: string;
    try {
      sha256 = await deps.documents.sha256(bytes);
    } catch (error) {
      reportFacturaThrown('hash_document', error);
      return { status: 'upload_failed', message: MESSAGES.upload_failed };
    }

    // The path is on disk before any byte leaves the device, so a crash cannot orphan an unknown file.
    uploads = [...uploads, { path, status: 'pending' }];
    changed();
    const written = await persist();
    if (written.status !== 'written') {
      uploads = uploads.filter(upload => upload.path !== path);
      changed();
      return refusal(written);
    }
    if (!isOwnerCurrent()) {
      await failUpload(path);
      return accountChanged();
    }

    let stored: FacturaDocumento | null = null;
    try {
      stored = await deps.documents.upload({ ownerId: uid, facturaId, documentId, bytes, nombre, sha256 });
    } catch (error) {
      reportFacturaThrown('upload', error);
      stored = null;
    }
    if (stored === null || stored.path !== path) return failUpload(path);

    // A new attachment proves the earlier interrupted uploads are dead, so they may now be swept.
    uploads = uploads.filter(upload => upload.path !== path).map(upload =>
      interrupted.includes(upload.path) ? { ...upload, status: 'failed' as const } : upload,
    );
    interrupted = [];
    const previous = draft.documento?.path;
    if (previous !== undefined) abandoned.add(previous);
    draft = {
      ...draft,
      documento: { path, nombre: displayNameFor(nombre), mime, bytes: bytes.length, sha256 },
    };
    dirty = true;
    feedback = null;
    changed();
    const recorded = await persist(false);
    return { status: 'attached', path, localDurable: recorded.status === 'written' };
  }

  async function sweepTargets(): Promise<SweepOutcome> {
    const targets = [
      ...new Set([...uploads.filter(upload => upload.status === 'failed').map(upload => upload.path), ...abandoned]),
    ];
    const removed: string[] = [];
    const kept: string[] = [];
    let interruptedByAccount = false;

    for (const path of targets) {
      if (isProtected(path)) {
        kept.push(path);
        continue;
      }
      if (!isOwnerCurrent()) {
        interruptedByAccount = true;
        break;
      }
      let gone = false;
      try {
        gone = await deps.documents.remove(path);
      } catch (error) {
        reportFacturaThrown('cleanup', error);
        gone = false;
      }
      (gone ? removed : kept).push(path);
    }

    if (removed.length > 0) {
      uploads = uploads.filter(upload => !removed.includes(upload.path));
      removed.forEach(path => abandoned.delete(path));
      changed();
      await persist(false);
    }
    if (interruptedByAccount) return accountChanged();
    return { status: 'swept', removed, kept };
  }

  async function runDiscard(): Promise<DiscardOutcome> {
    lifecycle = 'closing';
    const written = await persist(true, true);
    if (written.status !== 'written') {
      lifecycle = 'open';
      return refusal(written);
    }
    draft = { ...createDraft({ facturaId }), version: draft.version };
    intent = null;
    uploads = [];
    interrupted = [];
    abandoned.clear();
    dirty = false;
    localSaved = true;
    feedback = null;
    lifecycle = 'closed';
    closeOutcome = { status: 'closed', draftKept: false };
    publish();
    return { status: 'discarded' };
  }

  if (!isOwnerCurrent()) {
    // The stored entry was never read, so this editor must not write over it once the owner returns.
    writesBlocked = true;
    feedback = feedbackFor('cuenta_cambiada');
  } else {
    const hydrated = await store.hydrate(uid, facturaId);
    if (hydrated.status === 'restored' && hydrated.record.tombstone === true) {
      // Discarded earlier: start from the given draft, keep only what must never be swept, never replay.
      const { record } = hydrated;
      protectedPaths = [...new Set([...record.protectedPaths, ...intentPaths(record.intent)])];
    } else if (hydrated.status === 'restored') {
      const { record } = hydrated;
      draft = record.draft;
      savedDocumentPath = record.savedDocumentPath;
      intent = record.intent;
      uploads = record.uploads;
      protectedPaths = record.protectedPaths;
      interrupted = record.uploads.filter(upload => upload.status === 'pending').map(upload => upload.path);
      dirty = intent !== null || record.dirty !== false;
      if (intent !== null) feedback = feedbackFor('retry_pending');
      else if (interrupted.length > 0) feedback = feedbackFor('upload_interrupted');
    } else if (hydrated.status === 'error') {
      feedback = { kind: 'storage', message: hydrated.error.userMessage };
      // Only a corrupt entry that was moved aside is gone; any other unreadable entry is still stored.
      writesBlocked = !(hydrated.error.code === 'corrupt' && hydrated.quarantined);
    }
  }
  state = buildState();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getState() {
      return state;
    },

    edit(update) {
      assertOpen();
      const next = update(draft);
      if (next.facturaId !== facturaId) throw new RangeError('an edit cannot change the invoice id');
      draft = next;
      dirty = true;
      changed();
      void persist();
    },

    save() {
      if (lifecycle !== 'open') return Promise.reject(new RangeError('the editor is closed'));
      if (inFlight === null) {
        saving = true;
        inFlight = runSave();
        publish();
      }
      return inFlight;
    },

    async attach(bytes, nombre) {
      assertOpen();
      if (!isOwnerCurrent()) return accountChanged();
      if (writesBlocked) return { status: 'blocked', message: MESSAGES.blocked };
      if (attaching) return { status: 'busy', message: MESSAGES.busy };

      const validation = validateDocumentBytes(bytes);
      if (!validation.ok) return { status: 'invalid', message: validation.error };

      attaching = true;
      publish();
      try {
        return await runAttach(bytes, nombre, validation.mime);
      } finally {
        attaching = false;
        publish();
      }
    },

    async sweep() {
      assertOpen();
      if (!isOwnerCurrent()) return accountChanged();
      if (writesBlocked) return { status: 'skipped', reason: 'blocked' };
      if (inFlight !== null) return { status: 'skipped', reason: 'saving' };
      if (attaching) return { status: 'skipped', reason: 'uploading' };
      return sweepTargets();
    },

    async discard(confirmed) {
      assertOpen();
      if (!confirmed) return { status: 'confirmation_required', message: MESSAGES.confirmation_required };
      if (!isOwnerCurrent()) return accountChanged();
      if (writesBlocked) return { status: 'blocked', message: MESSAGES.blocked };
      if (inFlight !== null || attaching) return { status: 'in_progress', message: MESSAGES.in_progress };
      return runDiscard();
    },

    async close() {
      if (lifecycle === 'closed' && closeOutcome !== null) return closeOutcome;
      if (lifecycle === 'closing' || inFlight !== null || attaching) {
        return { status: 'blocked', message: MESSAGES.in_progress };
      }

      lifecycle = 'closing';
      await writeChain;
      const unsaved = dirty || intent !== null;
      if (unsaved && !localSaved) {
        lifecycle = 'open';
        if (writesBlocked) return { status: 'blocked', message: MESSAGES.blocked };
        if (!isOwnerCurrent()) return accountChanged();
        return { status: 'nondurable', message: MESSAGES.nondurable };
      }
      lifecycle = 'closed';
      closeOutcome = { status: 'closed', draftKept: unsaved };
      publish();
      return closeOutcome;
    },

    async persisted() {
      await writeChain;
    },
  };
}
