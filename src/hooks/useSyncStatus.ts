import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const WIDGET_URL = process.env.EXPO_PUBLIC_WIDGET_API_URL || 'http://192.168.1.143:5000';

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
      // Intentar primero Opción B (Local) por rapidez
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

  const activeCommand = data?.activeCommand || null;
  const isSyncing = isMutationPending || (activeCommand && (activeCommand.status === 'pendiente' || activeCommand.status === 'ejecutando'));

  return {
    lastSync: data?.lastSync ?? null,
    minutesAgo: data?.minutesAgo ?? null,
    activeCommand,
    isLoading,
    triggerSync,
    isSyncing,
  };
}

async function fetchSyncStatus() {
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
    .select('comando, status, creado_en')
    .order('creado_en', { ascending: false })
    .limit(1)
    .single();

  const lastSync = prodData ? new Date(prodData.actualizado_en) : null;
  const minutesAgo = lastSync ? Math.floor((Date.now() - lastSync.getTime()) / 60_000) : null;

  // Solo considerar comando activo si es reciente (últimos 5 min) y no ha fallado/terminado
  const activeCommand = (cmdData && cmdData.status !== 'completado' && cmdData.status !== 'error_local') 
    ? cmdData 
    : null;

  return { lastSync, minutesAgo, activeCommand };
}
