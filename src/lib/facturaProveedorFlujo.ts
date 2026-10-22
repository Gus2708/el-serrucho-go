import {
  hydrateFacturaEditor,
  type DocumentGateway,
  type EditorController,
  type HydrationInput,
  type RejectReason,
  type SubmitResult,
} from './facturaEditorController';
import type { FacturaLocalStore } from './facturaLocalStore';
import {
  FacturaError,
  mapFacturaError,
  type FacturaErrorCode,
  type FacturaRepository,
  type GuardarInput,
} from './facturaProveedorRepository';
import {
  buildSavePayload,
  resolveSaveKey,
  type FacturaDraft,
  type PendingSave,
} from './facturaProveedor';

/**
 * Save and attach orchestration, kept apart from React so the retry and cleanup
 * rules are testable. Order matters: a document is uploaded first and referenced
 * by the save; an old file is only deleted after the save that replaced it commits.
 */

export type FlowRepository = Pick<FacturaRepository, 'guardar' | 'subirDocumento' | 'limpiarHuerfano'>;

export interface SaveContext {
  repo: Pick<FlowRepository, 'guardar' | 'limpiarHuerfano'>;
  newKey: () => string;
}

export interface SaveInput {
  draft: FacturaDraft;
  /** Path of the document the server currently has, or null. */
  savedDocumentPath: string | null;
  /** Idempotency key of an earlier attempt with the same content, if it failed. */
  pending: PendingSave | null;
}

export type SaveOutcome =
  | { status: 'invalid'; errors: Record<string, string>; pending: PendingSave | null }
  | { status: 'saved'; draft: FacturaDraft; replay: boolean; documentPath: string | null; pending: null }
  | { status: 'failed'; error: FacturaError; pending: PendingSave };

export async function saveDraft(context: SaveContext, input: SaveInput): Promise<SaveOutcome> {
  const { draft, savedDocumentPath } = input;

  const built = buildSavePayload(draft);
  if (!built.ok) return { status: 'invalid', errors: built.errors, pending: input.pending };

  const pending = resolveSaveKey(input.pending, built, context.newKey);
  try {
    const result = await context.repo.guardar({
      facturaId: draft.facturaId,
      version: draft.version,
      key: pending.key,
      payload: built,
    });

    const documentPath = draft.documento?.path ?? null;
    if (savedDocumentPath !== null && savedDocumentPath !== documentPath) {
      await context.repo.limpiarHuerfano(savedDocumentPath);
    }
    return {
      status: 'saved',
      draft: { ...draft, version: result.version },
      replay: result.replay,
      documentPath,
      pending: null,
    };
  } catch (error) {
    const typed = error instanceof FacturaError ? error : mapFacturaError(error as Error);
    return { status: 'failed', error: typed, pending };
  }
}

/** Deletes an uploaded document the server never referenced (replaced or abandoned). */
export async function releaseUnsavedDocument(
  repo: Pick<FlowRepository, 'limpiarHuerfano'>,
  draft: FacturaDraft,
  savedDocumentPath: string | null,
): Promise<void> {
  const path = draft.documento?.path ?? null;
  if (path !== null && path !== savedDocumentPath) {
    await repo.limpiarHuerfano(path);
  }
}

export interface AttachContext {
  repo: Pick<FlowRepository, 'subirDocumento' | 'limpiarHuerfano'>;
  newId: () => string;
  sha256: (bytes: Uint8Array) => Promise<string>;
}

export interface AttachInput {
  draft: FacturaDraft;
  savedDocumentPath: string | null;
  ownerId: string;
  bytes: Uint8Array;
  nombre: string;
}

/** Uploads the file and returns the draft pointing at it; the server only learns about it on the next save. */
export async function attachDocument(context: AttachContext, input: AttachInput): Promise<FacturaDraft> {
  const { draft, savedDocumentPath } = input;
  const sha256 = await context.sha256(input.bytes);
  const documento = await context.repo.subirDocumento({
    ownerId: input.ownerId,
    facturaId: draft.facturaId,
    documentId: context.newId(),
    bytes: input.bytes,
    nombre: input.nombre,
    sha256,
  });

  await releaseUnsavedDocument(context.repo, draft, savedDocumentPath);
  return { ...draft, documento };
}

const REJECTIONS: Partial<Record<FacturaErrorCode, RejectReason>> = {
  version_obsoleta: 'conflict',
  clave_reutilizada: 'key_reused',
  datos_invalidos: 'invalid',
  no_autorizado: 'unauthorized',
  no_encontrada: 'unknown',
};

const SQLSTATE_SHAPE = /^[0-9A-Z]{5}$/;
const REQUEST_TIMEOUT_STATUS = 408;

type SubmitFailure = Exclude<SubmitResult, { kind: 'committed' }>;

function rejected(reason: RejectReason): SubmitFailure {
  return { kind: 'rejected', reason };
}

/**
 * Tells a definite server answer from a lost one. A SQLSTATE or a 4xx means the server answered and did
 * not apply the call; no response, a timeout, a 5xx without SQLSTATE or a malformed 2xx may have been applied.
 */
export function classifySubmitFailure(error: unknown): SubmitFailure {
  if (!(error instanceof FacturaError)) return { kind: 'ambiguous' };

  const byCode = REJECTIONS[error.code];
  if (byCode !== undefined) return rejected(byCode);
  if (error.code === 'red') return { kind: 'ambiguous' };

  const { sqlState, httpStatus } = error;
  if (sqlState !== undefined && SQLSTATE_SHAPE.test(sqlState)) return rejected('unknown');
  if (httpStatus === 401 || httpStatus === 403) return rejected('unauthorized');
  if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== REQUEST_TIMEOUT_STATUS) {
    return rejected('unknown');
  }
  return { kind: 'ambiguous' };
}

/** The controller's `submit`: sends the frozen intent through the repository exactly as received. */
export function createSubmitAdapter(repo: Pick<FlowRepository, 'guardar'>): (input: GuardarInput) => Promise<SubmitResult> {
  return async function submit(input: GuardarInput): Promise<SubmitResult> {
    try {
      const result = await repo.guardar(input);
      return { kind: 'committed', version: result.version, replay: result.replay };
    } catch (error) {
      return classifySubmitFailure(error);
    }
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOCUMENT_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$/;

export interface DocumentGatewayDeps {
  ownerId: string;
  newId: () => string;
  sha256: (bytes: Uint8Array) => Promise<string>;
}

/** `<owner>/<invoice uuid>/<document uuid>.<ext>` and nothing else: the only paths this account ever created. */
function isOwnDocumentPath(ownerId: string, path: string): boolean {
  const [owner, invoice, name, ...extra] = path.split('/');
  return (
    extra.length === 0 &&
    owner === ownerId &&
    UUID_PATTERN.test(invoice ?? '') &&
    DOCUMENT_NAME_PATTERN.test(name ?? '')
  );
}

/** Private-bucket operations for one account. Removal is by exact own path; the bucket is never listed. */
export function createDocumentGateway(
  repo: Pick<FlowRepository, 'subirDocumento' | 'limpiarHuerfano'>,
  deps: DocumentGatewayDeps,
): DocumentGateway {
  const ownerId = deps.ownerId.toLowerCase();
  return {
    newDocumentId: deps.newId,
    sha256: deps.sha256,
    async upload(input) {
      if (input.ownerId.toLowerCase() !== ownerId) throw new FacturaError('no_autorizado');
      return repo.subirDocumento(input);
    },
    async remove(path) {
      if (!isOwnDocumentPath(ownerId, path)) return false;
      return repo.limpiarHuerfano(path);
    },
  };
}

export interface EditorServiceDeps {
  repo: FlowRepository;
  store: FacturaLocalStore;
  /** Currently signed-in account, read live by every controller before it starts an operation. */
  getUid: () => string | null;
  newKey: () => string;
  newDocumentId: () => string;
  sha256: (bytes: Uint8Array) => Promise<string>;
}

export interface AcquireInput extends HydrationInput {
  uid: string;
  facturaId: string;
}

export interface FacturaEditorService {
  /**
   * One controller per account and invoice. Concurrent calls share the hydration in progress, and a call
   * made while a save is in flight gets the same controller. `draft` and `savedDocumentPath` only seed a
   * new controller; an existing one keeps its own state. A closed controller is replaced by a fresh one.
   */
  acquire(input: AcquireInput): Promise<EditorController>;
}

export function createEditorService(deps: EditorServiceDeps): FacturaEditorService {
  const submit = createSubmitAdapter(deps.repo);
  const controllers = new Map<string, Promise<EditorController>>();

  function start(key: string, input: AcquireInput): Promise<EditorController> {
    const hydrating = hydrateFacturaEditor(
      {
        uid: input.uid,
        facturaId: input.facturaId,
        store: deps.store,
        getUid: deps.getUid,
        newKey: deps.newKey,
        submit,
        documents: createDocumentGateway(deps.repo, {
          ownerId: input.uid,
          newId: deps.newDocumentId,
          sha256: deps.sha256,
        }),
      },
      { draft: input.draft, savedDocumentPath: input.savedDocumentPath },
    );
    controllers.set(key, hydrating);
    hydrating.catch(() => {
      if (controllers.get(key) === hydrating) controllers.delete(key);
    });
    return hydrating;
  }

  async function acquire(input: AcquireInput): Promise<EditorController> {
    const key = `${input.uid}:${input.facturaId}`;
    const current = controllers.get(key);
    if (current === undefined) return start(key, input);

    const controller = await current;
    if (!controller.getState().closed) return controller;
    // Another caller may have replaced the closed controller while this one waited.
    return controllers.get(key) === current ? start(key, input) : acquire(input);
  }

  return { acquire };
}
