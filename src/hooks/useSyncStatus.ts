import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const WIDGET_URL = process.env.EXPO_PUBLIC_WIDGET_API_URL || 'http://192.168.1.143:5000';

export type SyncMode = 'sync_all' | 'sync_inventory' | 'sync_sales';

export function useSyncStatus() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['sync-status'],
    queryFn:  fetchSyncStatus,
    refetchInterval:             60_000,
    refetchIntervalInBackground: false,
    staleTime:                   30_000,
  });

  const { mutate: triggerSync, isPending: isSyncing } = useMutation({
    mutationFn: async (mode: SyncMode = 'sync_inventory') => {
      // Path 1: Local API (mismo WiFi, instantáneo)
      try {
        const endpoint = mode === 'sync_all'
          ? '/api/v1/sync/run'
          : mode === 'sync_sales'
            ? '/api/v1/sync/sales'
            : '/api/v1/sync/inventory';

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${WIDGET_URL}${endpoint}`, {
          method: 'POST',
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.ok) {
          return { via: 'local' as const, body: await response.json() };
        }
        throw new Error(`Local API error: ${response.status}`);
      } catch (localErr) {
        // Path 2: Cloud (comandos_remotos) — funciona desde cualquier red.
        // El listener remoto (remote_listener.py) hace polling cada 10s y procesa
        // los registros con status='pendiente'. Insert restringido a usuarios
        // autenticados via RLS.
        const { error } = await supabase
          .from('comandos_remotos')
          .insert({ comando: mode, status: 'pendiente' });

        if (error) throw new Error('No se pudo encolar el comando remoto: ' + error.message);
        return { via: 'cloud' as const, body: { queued: true, mode } };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });

  return {
    lastSync:   data?.lastSync   ?? null,
    minutesAgo: data?.minutesAgo ?? null,
    isLoading,
    triggerSync,
    isSyncing,
  };
}

async function fetchSyncStatus() {
  const { data, error } = await supabase
    .from('productos')
    .select('actualizado_en')
    .order('actualizado_en', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return { lastSync: null, minutesAgo: null };

  const lastSync   = new Date(data.actualizado_en);
  const minutesAgo = Math.floor((Date.now() - lastSync.getTime()) / 60_000);

  return { lastSync, minutesAgo };
}
