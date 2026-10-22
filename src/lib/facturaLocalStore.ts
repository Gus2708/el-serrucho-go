import { MAX_DOCUMENT_BYTES, type FacturaMime } from './facturaDocumento';
import {
  MAX_LINEAS,
  type FacturaDocumento,
  type FacturaDraft,
  type FacturaLineaDraft,
  type SavePayload,
} from './facturaProveedor';

/**
 * Durable, account-scoped local store for supplier-invoice drafts and the immutable retry
 * checkpoint. Persistence only: it never calls the RPC, uploads or deletes files, and
 * hydration restores state without acting on it. Ordering is guaranteed within one app
 * runtime only (module-scoped queue per key); there is no cross-tab locking.
 */

const KEY_PREFIX = 'serrucho-factura-v1';
const QUARANTINE_SUFFIX = ':quarantine';
const SCHEMA_VERSION = 1;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const QUOTA_PATTERN = /quota|disk is full|SQLITE_FULL|no space/i;

const MAX_TEXT = 2000;
const MAX_AMOUNT_TEXT = 64;
const MAX_PATH = 512;
const MAX_PATHS = 200;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_STRING = 20000;

const MIMES: readonly FacturaMime[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/** Minimal async key-value surface; AsyncStorage and a localStorage wrapper both fit. */
export interface StorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

export type FacturaStoreErrorCode = 'unavailable' | 'quota' | 'corrupt' | 'unsupported_schema';

const USER_MESSAGES: Record<FacturaStoreErrorCode, string> = {
  unavailable: 'No se pudo acceder al almacenamiento de este dispositivo.',
  quota: 'El almacenamiento de este dispositivo está lleno; el borrador no se guardó.',
  corrupt: 'Se encontró un borrador dañado y no se usará.',
  unsupported_schema: 'El borrador fue creado por una versión más nueva de la app y no se puede abrir.',
};

export class FacturaStoreError extends Error {
  code: FacturaStoreErrorCode;
  userMessage: string;

  constructor(code: FacturaStoreErrorCode) {
    super(USER_MESSAGES[code]);
    this.name = 'FacturaStoreError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
  }
}

/** Exactly what a future controller sends on replay: frozen key, payload and base version. */
export interface FacturaIntent {
  key: string;
  baseVersion: number;
  payload: SavePayload;
  documentPath: string | null;
}

export interface FacturaUpload {
  path: string;
  status: 'pending' | 'failed';
}

export interface FacturaLocalRecord {
  schema: 1;
  uid: string;
  facturaId: string;
  seq: number;
  draft: FacturaDraft;
  savedDocumentPath: string | null;
  intent: FacturaIntent | null;
  uploads: FacturaUpload[];
  protectedPaths: string[];
  /** The draft differs from the last acknowledged save. Absent in records written before U6: treat as dirty. */
  dirty?: boolean;
  /** The owner discarded this draft: kept only so its intent and protected paths are never swept or replayed. */
  tombstone?: true;
}

/** `written` is the only outcome that proves the record is durable. */
export type WriteOutcome =
  | { status: 'written'; seq: number }
  | { status: 'stale'; seq: number; latest: number }
  | { status: 'error'; error: FacturaStoreError };

export type HydrateOutcome =
  | { status: 'empty' }
  | { status: 'restored'; record: FacturaLocalRecord }
  | { status: 'error'; error: FacturaStoreError; quarantined: boolean };

export interface DraftProblem {
  facturaId: string;
  error: FacturaStoreError;
  quarantined: boolean;
}

export type ListOutcome =
  | { status: 'ok'; drafts: FacturaLocalRecord[]; problems: DraftProblem[] }
  | { status: 'error'; error: FacturaStoreError };

export interface FacturaLocalStore {
  /** Next revision for this key; shared by every store instance over the same storage. */
  nextSeq(uid: string, facturaId: string): number;
  write(record: FacturaLocalRecord): Promise<WriteOutcome>;
  hydrate(uid: string, facturaId: string): Promise<HydrateOutcome>;
  listDrafts(uid: string): Promise<ListOutcome>;
}

interface KeyState {
  /** Highest revision handed out, written or adopted from storage. */
  issued: number;
  /** Highest revision enqueued or persisted; anything lower is obsolete. */
  highest: number;
  tail: Promise<unknown>;
}

const statesByStorage = new WeakMap<StorageLike, Map<string, KeyState>>();

function stateFor(storage: StorageLike, key: string): KeyState {
  let states = statesByStorage.get(storage);
  if (states === undefined) {
    states = new Map();
    statesByStorage.set(storage, states);
  }
  let state = states.get(key);
  if (state === undefined) {
    state = { issued: 0, highest: 0, tail: Promise.resolve() };
    states.set(key, state);
  }
  return state;
}

function adopt(state: KeyState, seq: number): void {
  state.issued = Math.max(state.issued, seq);
  state.highest = Math.max(state.highest, seq);
}

function enqueue<T>(state: KeyState, task: () => Promise<T>): Promise<T> {
  const run = state.tail.then(task);
  state.tail = run.then(noop, noop);
  return run;
}

function noop(): void {}

export function facturaKey(uid: string, facturaId: string): string {
  if (!ID_PATTERN.test(uid) || !ID_PATTERN.test(facturaId)) {
    throw new RangeError('uid and facturaId must be 1-64 characters of letters, digits, "_" or "-"');
  }
  return `${KEY_PREFIX}:${uid}:${facturaId}`;
}

function scopePrefix(uid: string): string {
  return facturaKey(uid, 'x').slice(0, -1);
}

function classifyFailure(cause: unknown, operation: 'read' | 'write'): FacturaStoreError {
  if (operation === 'write') {
    const { name = '', message = '' } = (cause ?? {}) as { name?: string; message?: string };
    if (QUOTA_PATTERN.test(`${name} ${message}`)) return new FacturaStoreError('quota');
  }
  return new FacturaStoreError('unavailable');
}

// --- Validation of untrusted data (storage content and write input) ---------------------

function reject(reason: string): never {
  throw new Error(`invalid record: ${reason}`);
}

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) reject(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) reject(`${what} must be text up to ${max} characters`);
  return value as string;
}

function asNonEmpty(value: unknown, what: string, max: number): string {
  const text = asString(value, what, max);
  if (text === '') reject(`${what} must not be empty`);
  return text;
}

function asCount(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) reject(`${what} must be a non-negative integer`);
  return value as number;
}

function asId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) reject(`${what} is not a valid id`);
  return value as string;
}

/** A storage path, never a URL: signed URLs and blob URLs must not be persisted. */
function asPath(value: unknown, what: string): string {
  const path = asNonEmpty(value, what, MAX_PATH);
  if (SCHEME_PATTERN.test(path) || /[?#]/.test(path)) reject(`${what} must be a storage path, not a URL`);
  return path;
}

function asOptionalPath(value: unknown, what: string): string | null {
  return value === null ? null : asPath(value, what);
}

function asList(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) reject(`${what} must be a list of at most ${max}`);
  return value as unknown[];
}

function asDocument(value: unknown): FacturaDocumento {
  const source = asObject(value, 'documento');
  const mime = source.mime as FacturaMime;
  if (!MIMES.includes(mime)) reject('documento.mime is not supported');
  const bytes = asCount(source.bytes, 'documento.bytes');
  if (bytes > MAX_DOCUMENT_BYTES) reject('documento.bytes exceeds the limit');
  const sha256 = asString(source.sha256, 'documento.sha256', 64);
  if (!SHA256_PATTERN.test(sha256)) reject('documento.sha256 is malformed');
  return {
    path: asPath(source.path, 'documento.path'),
    nombre: asNonEmpty(source.nombre, 'documento.nombre', 255),
    mime,
    bytes,
    sha256,
  };
}

function asLinea(value: unknown): FacturaLineaDraft {
  const source = asObject(value, 'linea');
  return {
    lineaId: asNonEmpty(source.lineaId, 'lineaId', 64),
    codigoProveedor: asString(source.codigoProveedor, 'codigoProveedor', MAX_TEXT),
    codigoProducto: asString(source.codigoProducto, 'codigoProducto', MAX_TEXT),
    descripcion: asString(source.descripcion, 'descripcion', MAX_TEXT),
    cantidad: asString(source.cantidad, 'cantidad', MAX_AMOUNT_TEXT),
    unidad: asString(source.unidad, 'unidad', MAX_TEXT),
    costoUnitario: asString(source.costoUnitario, 'costoUnitario', MAX_AMOUNT_TEXT),
    total: asString(source.total, 'total', MAX_AMOUNT_TEXT),
    nota: asString(source.nota, 'nota', MAX_TEXT),
  };
}

function asDraft(value: unknown, facturaId: string): FacturaDraft {
  const source = asObject(value, 'draft');
  if (source.facturaId !== facturaId) reject('draft belongs to another invoice');

  const lineas = asList(source.lineas, 'lineas', MAX_LINEAS).map(asLinea);
  if (new Set(lineas.map(linea => linea.lineaId)).size !== lineas.length) reject('line ids must be unique');

  return {
    facturaId,
    version: asCount(source.version, 'version'),
    proveedorCodigo: asString(source.proveedorCodigo, 'proveedorCodigo', MAX_TEXT),
    proveedorNombre: asString(source.proveedorNombre, 'proveedorNombre', MAX_TEXT),
    numeroDocumento: asString(source.numeroDocumento, 'numeroDocumento', MAX_TEXT),
    numeroControl: asString(source.numeroControl, 'numeroControl', MAX_TEXT),
    fechaDocumento: asString(source.fechaDocumento, 'fechaDocumento', MAX_TEXT),
    moneda: asString(source.moneda, 'moneda', MAX_TEXT),
    notas: asString(source.notas, 'notas', MAX_TEXT),
    documento: source.documento === null ? null : asDocument(source.documento),
    lineas,
  };
}

/** Deep-copies plain JSON only; typed arrays, class instances, functions and undefined are refused. */
function asPlainJson(value: unknown, depth = 0): unknown {
  if (depth > MAX_JSON_DEPTH) reject('payload is nested too deeply');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject('payload numbers must be finite');
    return value;
  }
  if (typeof value === 'string') return asString(value, 'payload text', MAX_JSON_STRING);
  if (Array.isArray(value)) return value.map(item => asPlainJson(item, depth + 1));
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) reject('payload must be plain data');
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, asPlainJson(item, depth + 1)]),
    );
  }
  return reject('payload must be plain data');
}

function asPayload(value: unknown): SavePayload {
  const source = asObject(value, 'payload');
  const cabecera = asObject(asPlainJson(source.cabecera), 'payload.cabecera');
  if (cabecera.documento !== null && cabecera.documento !== undefined) asDocument(cabecera.documento);
  const lineas = asList(source.lineas, 'payload.lineas', MAX_LINEAS).map(linea =>
    asObject(asPlainJson(linea), 'payload linea'),
  );
  return { cabecera, lineas };
}

function asIntent(value: unknown): FacturaIntent | null {
  if (value === null) return null;
  const source = asObject(value, 'intent');
  return {
    key: asNonEmpty(source.key, 'intent.key', 200),
    baseVersion: asCount(source.baseVersion, 'intent.baseVersion'),
    payload: asPayload(source.payload),
    documentPath: asOptionalPath(source.documentPath, 'intent.documentPath'),
  };
}

function asOptionalFlag(value: unknown, what: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') reject(`${what} must be a boolean`);
  return value as boolean;
}

function asUpload(value: unknown): FacturaUpload {
  const source = asObject(value, 'upload');
  if (source.status !== 'pending' && source.status !== 'failed') reject('upload status must be pending or failed');
  return { path: asPath(source.path, 'upload.path'), status: source.status };
}

interface Owner {
  uid: string;
  facturaId: string;
}

/** Rebuilds the record from an allowlist, so unknown or forbidden fields never reach storage. */
function parseRecord(value: unknown, owner?: Owner): FacturaLocalRecord {
  const source = asObject(value, 'record');
  if (source.schema !== SCHEMA_VERSION) reject('unsupported schema');
  const uid = asId(source.uid, 'uid');
  const facturaId = asId(source.facturaId, 'facturaId');
  if (owner !== undefined && (uid !== owner.uid || facturaId !== owner.facturaId)) reject('record owner mismatch');

  const dirty = asOptionalFlag(source.dirty, 'dirty');
  if (source.tombstone !== undefined && source.tombstone !== true) reject('tombstone must be true when present');

  return {
    schema: SCHEMA_VERSION,
    uid,
    facturaId,
    seq: asCount(source.seq, 'seq'),
    draft: asDraft(source.draft, facturaId),
    savedDocumentPath: asOptionalPath(source.savedDocumentPath, 'savedDocumentPath'),
    intent: asIntent(source.intent),
    uploads: asList(source.uploads, 'uploads', MAX_PATHS).map(asUpload),
    protectedPaths: asList(source.protectedPaths, 'protectedPaths', MAX_PATHS).map(path =>
      asPath(path, 'protectedPath'),
    ),
    ...(dirty === undefined ? {} : { dirty }),
    ...(source.tombstone === true ? { tombstone: true as const } : {}),
  };
}

type StoredParse =
  | { kind: 'ok'; record: FacturaLocalRecord }
  | { kind: 'corrupt' | 'unsupported_schema' };

function parseStored(raw: string, owner: Owner): StoredParse {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt' };
  }
  const schema = (json as { schema?: unknown } | null)?.schema;
  if (typeof schema === 'number' && Number.isInteger(schema) && schema > SCHEMA_VERSION) {
    return { kind: 'unsupported_schema' };
  }
  try {
    return { kind: 'ok', record: parseRecord(json, owner) };
  } catch {
    return { kind: 'corrupt' };
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function createFacturaLocalStore(storage: StorageLike): FacturaLocalStore {
  /** Copies a bad entry aside; the original is removed only for corrupt data and only after the copy exists. */
  async function quarantine(key: string, raw: string, removeOriginal: boolean): Promise<boolean> {
    try {
      await storage.setItem(`${key}${QUARANTINE_SUFFIX}`, raw);
    } catch {
      return false;
    }
    if (removeOriginal) {
      try {
        await storage.removeItem(key);
      } catch {
        // The copy exists and the original stays; the next hydration reports it again.
      }
    }
    return true;
  }

  async function readRecord(uid: string, facturaId: string): Promise<HydrateOutcome> {
    const key = facturaKey(uid, facturaId);
    let raw: string | null;
    try {
      raw = await storage.getItem(key);
    } catch (cause) {
      return { status: 'error', error: classifyFailure(cause, 'read'), quarantined: false };
    }
    if (raw === null) return { status: 'empty' };

    const parsed = parseStored(raw, { uid, facturaId });
    if (parsed.kind === 'ok') {
      adopt(stateFor(storage, key), parsed.record.seq);
      return { status: 'restored', record: { ...parsed.record, intent: deepFreeze(parsed.record.intent) } };
    }
    const quarantined = await quarantine(key, raw, parsed.kind === 'corrupt');
    return { status: 'error', error: new FacturaStoreError(parsed.kind), quarantined };
  }

  function hydrate(uid: string, facturaId: string): Promise<HydrateOutcome> {
    const state = stateFor(storage, facturaKey(uid, facturaId));
    return enqueue(state, () => readRecord(uid, facturaId));
  }

  return {
    hydrate,

    nextSeq(uid, facturaId) {
      const state = stateFor(storage, facturaKey(uid, facturaId));
      state.issued += 1;
      return state.issued;
    },

    async write(record) {
      let validated: FacturaLocalRecord;
      try {
        validated = parseRecord(record);
      } catch {
        return { status: 'error', error: new FacturaStoreError('corrupt') };
      }
      const key = facturaKey(validated.uid, validated.facturaId);
      const state = stateFor(storage, key);
      state.issued = Math.max(state.issued, validated.seq);
      state.highest = Math.max(state.highest, validated.seq);

      return enqueue<WriteOutcome>(state, async () => {
        if (validated.seq < state.highest) return { status: 'stale', seq: validated.seq, latest: state.highest };
        try {
          await storage.setItem(key, JSON.stringify(validated));
        } catch (cause) {
          return { status: 'error', error: classifyFailure(cause, 'write') };
        }
        return { status: 'written', seq: validated.seq };
      });
    },

    async listDrafts(uid) {
      const prefix = scopePrefix(uid);
      let keys: readonly string[];
      try {
        keys = await storage.getAllKeys();
      } catch (cause) {
        return { status: 'error', error: classifyFailure(cause, 'read') };
      }
      const facturaIds = keys
        .filter(key => key.startsWith(prefix))
        .map(key => key.slice(prefix.length))
        .filter(id => ID_PATTERN.test(id))
        .sort();

      const drafts: FacturaLocalRecord[] = [];
      const problems: DraftProblem[] = [];
      for (const facturaId of facturaIds) {
        const outcome = await hydrate(uid, facturaId);
        if (outcome.status === 'restored' && outcome.record.tombstone !== true) drafts.push(outcome.record);
        if (outcome.status === 'error') {
          problems.push({ facturaId, error: outcome.error, quarantined: outcome.quarantined });
        }
      }
      return { status: 'ok', drafts, problems };
    },
  };
}
