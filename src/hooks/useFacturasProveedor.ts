import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import {
  createFacturaLocalStore,
  type DraftProblem,
  type FacturaLocalRecord,
  type StorageLike,
} from '../lib/facturaLocalStore';
import {
  createFacturaRepository,
  type FacturaRepository,
  type FacturaResumen,
} from '../lib/facturaProveedorRepository';
import {
  createEditorService,
  saveDraft,
  type FacturaEditorService,
  type SaveContext,
  type SaveInput,
  type SaveOutcome,
} from '../lib/facturaProveedorFlujo';
import type { FacturaRecord } from '../lib/facturaProveedor';
import { newUuid, sha256Hex } from '../lib/facturaDocumentoPicker';

export const facturasQueryKey = ['facturas-proveedor'] as const;

export const facturaRepository: FacturaRepository = createFacturaRepository(supabase);

/** Same async surface as AsyncStorage over `localStorage`; a missing or throwing `localStorage` rejects so the store can classify it. */
function webStorage(getLocal: () => Storage): StorageLike {
  return {
    async getItem(key) {
      return getLocal().getItem(key);
    },
    async setItem(key, value) {
      getLocal().setItem(key, value);
    },
    async removeItem(key) {
      getLocal().removeItem(key);
    },
    async getAllKeys() {
      const local = getLocal();
      return Array.from({ length: local.length }, (_, index) => local.key(index) as string);
    },
  };
}

export function selectFacturaStorage(os: string, device: StorageLike, getLocal: () => Storage): StorageLike {
  return os === 'web' ? webStorage(getLocal) : device;
}

/**
 * The signed-in account as the editor controllers see it. The screen that knows the session publishes it;
 * until then it is null and every controller refuses to write or send (fail closed).
 */
let sessionUid: string | null = null;

export function setFacturaSessionUid(uid: string | null): void {
  sessionUid = uid;
}

export function getFacturaSessionUid(): string | null {
  return sessionUid;
}

interface SessionLike {
  user?: { id?: string | null } | null;
}

/** Called by the auth root on every session change; a missing or empty uid signs the editors out. */
export function publishFacturaSession(session: SessionLike | null | undefined): void {
  const id = session?.user?.id;
  setFacturaSessionUid(typeof id === 'string' && id !== '' ? id : null);
}

const facturaLocalStore = createFacturaLocalStore(selectFacturaStorage(Platform.OS, AsyncStorage, () => globalThis.localStorage));

/** Durable invoice editors: one controller per account and invoice, backed by the real repository and device storage. */
export const facturaEditorService: FacturaEditorService = createEditorService({
  repo: facturaRepository,
  store: facturaLocalStore,
  getUid: () => sessionUid,
  newKey: newUuid,
  newDocumentId: newUuid,
  sha256: sha256Hex,
});

export interface FacturaBorradores {
  drafts: FacturaLocalRecord[];
  problems: DraftProblem[];
}

/** A local record is a draft while it differs from the server or still holds an unresolved send. */
export function isPendingDraft(record: FacturaLocalRecord): boolean {
  return record.dirty !== false || record.intent !== null;
}

/** This account's drafts on this device. Acknowledged and discarded records are not drafts. */
export async function listFacturaBorradores(uid: string): Promise<FacturaBorradores> {
  const outcome = await facturaLocalStore.listDrafts(uid);
  if (outcome.status === 'error') throw outcome.error;
  return { drafts: outcome.drafts.filter(isPendingDraft), problems: outcome.problems };
}

export function facturaBorradoresQueryKey(uid: string | null): readonly unknown[] {
  return [...facturasQueryKey, 'borradores', uid];
}

export function useFacturaBorradores(uid: string | null, enabled: boolean): UseQueryResult<FacturaBorradores> {
  return useQuery({
    queryKey: facturaBorradoresQueryKey(uid),
    queryFn: () => listFacturaBorradores(uid as string),
    enabled: enabled && uid !== null,
    staleTime: 0,
  });
}

/** Own invoices, newest first. Only fetched while the panel is open. */
export function useFacturasList(enabled: boolean): UseQueryResult<FacturaResumen[]> {
  return useQuery({
    queryKey: [...facturasQueryKey, 'lista'],
    queryFn: () => facturaRepository.listar(),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Always refetched on open (a stale copy would hide another device's newer version) but never in the
 * background: the editor is seeded from this once, and a silent refetch must not replace unsaved edits.
 */
export function useFacturaRecord(facturaId: string | null): UseQueryResult<FacturaRecord | null> {
  return useQuery({
    queryKey: [...facturasQueryKey, 'detalle', facturaId],
    queryFn: () => facturaRepository.abrir(facturaId as string),
    enabled: facturaId !== null,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useGuardarFactura(): UseMutationResult<SaveOutcome, Error, SaveInput> {
  const queryClient = useQueryClient();
  const context: SaveContext = { repo: facturaRepository, newKey: newUuid };

  return useMutation({
    mutationFn: (input: SaveInput) => saveDraft(context, input),
    onSuccess: outcome => {
      if (outcome.status === 'saved') {
        queryClient.invalidateQueries({ queryKey: [...facturasQueryKey, 'lista'] });
      }
    },
  });
}
