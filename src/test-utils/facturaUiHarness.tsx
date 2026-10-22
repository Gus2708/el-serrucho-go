import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { ThemeProvider } from '../theme/ThemeContext';

/**
 * Fakes for the invoice UI suites. Only the boundaries are faked: the Supabase client (RPC, tables,
 * private bucket) and the device storage. The controller, store, service, repository and components
 * under test are the real modules.
 */

export const OWNER_A = 'a0000000-0000-4000-8000-00000000000a';
export const OWNER_B = 'b0000000-0000-4000-8000-00000000000b';
export const FACTURA_1 = 'f0000000-0000-4000-8000-000000000001';
export const FACTURA_2 = 'f0000000-0000-4000-8000-000000000002';

export const PDF_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

export interface RpcAnswer {
  data: unknown;
  error: { code?: string; message: string } | null;
  status: number;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function committed(facturaId: string, version: number, replay = false): RpcAnswer {
  return { data: { factura_id: facturaId, version, replay }, error: null, status: 200 };
}

export function refused(code: string, status: number): RpcAnswer {
  return { data: null, error: { code, message: 'rechazado' }, status };
}

type Scripted = RpcAnswer | Error | Promise<RpcAnswer>;

/** Device storage that survives a remount, like AsyncStorage does between app opens. */
const persisted = new Map<string, string>();
export const storageFaults = { failWrites: false };

export const asyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return persisted.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (storageFaults.failWrites) throw new Error('storage unavailable');
    persisted.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    persisted.delete(key);
  },
  async getAllKeys(): Promise<string[]> {
    return [...persisted.keys()];
  },
};

export function storedRecords(): unknown[] {
  return [...persisted.entries()]
    .filter(([key]) => key.startsWith('serrucho-factura-v1:') && !key.endsWith(':quarantine'))
    .map(([, value]) => JSON.parse(value));
}

const script: Scripted[] = [];
const bucket = {
  upload: jest.fn(async (..._args: unknown[]) => ({ data: { path: 'x' }, error: null as { message: string } | null })),
  remove: jest.fn(async (..._args: unknown[]) => ({ data: [], error: null as { message: string } | null })),
  createSignedUrl: jest.fn(async (..._args: unknown[]) => ({ data: { signedUrl: 'https://private.test/doc' }, error: null })),
};

const tables = { list: [] as unknown[], detail: new Map<string, unknown>() };

const rpc = jest.fn(async (..._args: unknown[]): Promise<RpcAnswer> => {
  const next = script.shift();
  if (next === undefined) throw new Error('unscripted rpc');
  if (next instanceof Error) throw next;
  return next;
});

function queryChain(result: () => unknown): unknown {
  const chain: Record<string, unknown> = {};
  const settle = () => Promise.resolve({ data: result(), error: null });
  for (const method of ['select', 'order', 'limit', 'eq']) chain[method] = () => chain;
  chain.maybeSingle = settle;
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => settle().then(resolve, reject);
  return chain;
}

let openedId: string | null = null;
const client = {
  rpc,
  storage: { from: jest.fn(() => bucket) },
  from: jest.fn(() => {
    const chain = queryChain(() => (openedId === null ? tables.list : tables.detail.get(openedId) ?? null)) as Record<string, unknown>;
    chain.eq = (_column: string, id: string) => {
      openedId = id;
      return chain;
    };
    chain.limit = () => {
      openedId = null;
      return chain;
    };
    return chain;
  }),
};

export const backend = { client, rpc, bucket, tables, script };

export function resetBackend(): void {
  persisted.clear();
  storageFaults.failWrites = false;
  script.length = 0;
  tables.list = [];
  tables.detail.clear();
  openedId = null;
  jest.clearAllMocks();
}

/** Queue what the next RPC calls return, in order. */
export function scriptRpc(...answers: Scripted[]): void {
  script.push(...answers);
}

const queryClients: QueryClient[] = [];

/** React Query's garbage-collection timers would keep the Jest process alive after the suite ends. */
afterEach(() => {
  queryClients.splice(0).forEach(client => client.clear());
});

export function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  queryClients.push(queryClient);
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  const wrap = (element: React.ReactElement) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{element}</ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(wrap(ui));
  /** Re-renders the same tree with new props, keeping the providers (and the query cache). */
  const rerenderUi = (next: React.ReactElement) => view.rerender(wrap(next));
  return { ...view, queryClient, invalidate, rerenderUi };
}

/** Presses a button of the most recent `Alert.alert` (what `confirm()` shows on a device). */
export async function pressAlertButton(alert: jest.SpyInstance, text: string): Promise<void> {
  const call = alert.mock.calls[alert.mock.calls.length - 1] as [string, string | undefined, AlertButton[] | undefined];
  const button = call[2]?.find(candidate => candidate.text === text);
  if (!button) throw new Error(`Alert has no "${text}" button`);
  // A cancel button may have no handler; pressing it only dismisses the alert.
  await act(async () => {
    button.onPress?.();
  });
}

/** Lets pending promise chains (store queue, controller awaits) settle inside act. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
}

export function spyOnAlert(): jest.SpyInstance {
  return jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
}
