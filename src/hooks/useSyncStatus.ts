import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Platform } from 'react-native';

const WIDGET_URL = process.env.EXPO_PUBLIC_WIDGET_API_URL || 'http://192.168.1.143:5000';

type ActiveCommand = {
  id:             number;
  comando:        string;
  status:         string;
  creado_en:      string;
  runningMinutes: number;
};

type SyncStatusResult = {
  lastSync:      Date | null;
  minutesAgo:    number | null;
  activeCommand: ActiveCommand | null;
};

export type SyncMode = 'sync_all' | 'sync_inventory' | 'sync_sales';

export function useSyncStatus() {
  const queryClient = useQueryClient();

  // 1. Monitorear el estado de la sincronización (Productos + Comandos Activos)
  const { data, isLoading } = useQuery({
    queryKey: ['sync-status'],
    queryFn: fetchSyncStatus,
    staleTime: 5_000, // Polling más frecuente para detectar cambios de estado
    refetchInterval: (query) => {
      // Si hay un comando pendiente o ejecutando, hacer polling cada 3s
      const active = query.state.data?.activeCommand;
      return (active && active.status !== 'completado' && active.status !== 'error_local') ? 3000 : 30000;
    }
  });

  const { mutate: triggerSync, isPending: isMutationPending } = useMutation({
    mutationFn: async (mode: SyncMode = 'sync_all') => {
      // On web, skip the local widget (mixed-content blocked over HTTPS)
      // and go straight to the cloud queue
      if (Platform.OS !== 'web') {
        try {
          const endpoint = mode === 'sync_all'
            ? '/api/v1/sync/run'
            : mode === 'sync_sales'
              ? '/api/v1/sync/sales'
              : '/api/v1/sync/inventory';

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);

          const response = await fetch(`${WIDGET_URL}${endpoint}`, {
            method: 'POST',
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (response.ok) {
            return { via: 'local' as const, body: await response.json() };
          }
        } catch (e) {
          // Ignorar error local y pasar a Opción A
        }
      }

      // Opción A: Sincronización Remota (Estándar V2.1)
      const { error } = await supabase
        .from('comandos_remotos')
        .insert([{ 
          comando: mode, 
          status: 'pendiente' 
        }]);

      if (error) throw new Error('Error al encolar comando: ' + error.message);
      return { via: 'cloud' as const, queued: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });

  const forceResetSync = async () => {
    if (!data?.activeCommand?.id) return;
    
    const { error } = await supabase
      .from('comandos_remotos')
      .update({ status: 'error_local' })
      .eq('id', data.activeCommand.id);

    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ['sync-status'] });
  };

  const activeCommand = data?.activeCommand || null;
  const isSyncing = isMutationPending || (activeCommand && (activeCommand.status === 'pendiente' || activeCommand.status === 'ejecutando'));

  return {
    lastSync: data?.lastSync ?? null,
    minutesAgo: data?.minutesAgo ?? null,
    activeCommand,
    isLoading,
    triggerSync,
    forceResetSync,
    isSyncing,
  };
}

async function fetchSyncStatus(): Promise<SyncStatusResult> {
  // Narrow select: only the timestamp column is needed.
  // Do NOT widen this to select('*') — this query runs every 3–30 seconds.
  // 1. Obtener última actualización de productos
  const { data: prodData } = await supabase
    .from('productos')
    .select('actualizado_en')
    .order('actualizado_en', { ascending: false })
    .limit(1)
    .single();

  // 2. Obtener comando remoto activo (si existe)
  const { data: cmdData } = await supabase
    .from('comandos_remotos')
    .select('id, comando, status, creado_en')
    .order('creado_en', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastSync = prodData ? new Date(prodData.actualizado_en) : null;
  const minutesAgo = lastSync ? Math.floor((Date.now() - lastSync.getTime()) / 60_000) : null;

  // Solo considerar comando activo si es reciente (últimos 10 min) y no ha fallado/terminado
  let activeCommand = null;
  if (cmdData && cmdData.status !== 'completado' && cmdData.status !== 'error_local') {
    const created = new Date(cmdData.creado_en).getTime();
    const now = Date.now();
    const diffMin = (now - created) / 60_000;
    
    if (diffMin < 10) {
      activeCommand = {
        ...cmdData,
        runningMinutes: Math.floor(diffMin)
      };
    }
  }

  return { lastSync, minutesAgo, activeCommand };
}
