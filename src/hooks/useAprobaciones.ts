import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { BackendResumen, OrdenConItems } from './useOrdenesHistory';

// ── Bandeja de aprobaciones ───────────────────────────────────────────────────
// Ajustes creados por empleados normales que quedaron en espera. Solo admin y
// superempleado los ven/resuelven (RPCs aprobar_orden / rechazar_orden validan
// el privilegio en la base). Ver migración 026 y docs/WRITEBACK-PIPELINE.md.

export function useAprobaciones() {
  return useQuery({
    queryKey:  ['aprobaciones-pendientes'],
    queryFn:   fetchAprobacionesPendientes,
    staleTime: 30_000,
  });
}

async function fetchAprobacionesPendientes(): Promise<OrdenConItems[]> {
  const { data, error } = await supabase
    .from('ordenes_cambio')
    .select(`
      id, creado_por, nota, status, pdf_url, creado_en,
      aprobacion_estado, aprobado_por, aprobado_en, rechazo_motivo,
      item_count
    `)
    .eq('aprobacion_estado', 'pendiente')
    .order('creado_en', { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Nombre del creador
  const uniqueIds = [...new Set(rows.map((o: any) => o.creado_por).filter(Boolean))];
  let profileMap: Record<string, string> = {};
  if (uniqueIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', uniqueIds);
    if (profiles) {
      profileMap = Object.fromEntries(profiles.map((p: any) => [p.id, p.display_name]));
    }
  }

  // Resumen de items por orden
  const ids = rows.map((o: any) => o.id);
  let resumenMap: Record<number, BackendResumen> = {};
  const { data: backendItems } = await supabase
    .from('ordenes_cambio_items')
    .select('orden_id, backend_status')
    .in('orden_id', ids);

  if (backendItems) {
    resumenMap = backendItems.reduce((acc: Record<number, BackendResumen>, item: any) => {
      const ordenId = Number(item.orden_id);
      const resumen = acc[ordenId] ?? {
        pendientes: 0, aplicando: 0, errores: 0, completados: 0,
        espera_aprobacion: 0, rechazados: 0, total: 0,
      };
      resumen.total += 1;
      if (item.backend_status === 'espera_aprobacion') resumen.espera_aprobacion += 1;
      else if (item.backend_status === 'pendiente') resumen.pendientes += 1;
      else if (item.backend_status === 'aplicando') resumen.aplicando += 1;
      else if (item.backend_status === 'error') resumen.errores += 1;
      else if (item.backend_status === 'completado') resumen.completados += 1;
      else if (item.backend_status === 'rechazado') resumen.rechazados += 1;
      acc[ordenId] = resumen;
      return acc;
    }, {});
  }

  return rows.map((o: any) => ({
    id:                o.id,
    creado_por:        o.creado_por,
    nota:              o.nota,
    status:            o.status,
    pdf_url:           o.pdf_url,
    creado_en:         o.creado_en,
    aprobacion_estado: o.aprobacion_estado ?? 'pendiente',
    aprobado_por:      o.aprobado_por ?? null,
    aprobado_en:       o.aprobado_en ?? null,
    rechazo_motivo:    o.rechazo_motivo ?? null,
    item_count:        o.item_count || 0,
    creado_por_nombre: profileMap[o.creado_por] ?? undefined,
    backend_resumen:   resumenMap[Number(o.id)],
  }));
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['aprobaciones-pendientes'] });
  queryClient.invalidateQueries({ queryKey: ['ordenes-history'] });
  queryClient.invalidateQueries({ queryKey: ['orden-cambio-detalle'] });
}

export function useAprobarOrden() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ordenId: number) => {
      const { error } = await supabase.rpc('aprobar_orden', { p_orden: ordenId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useRechazarOrden() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ordenId, motivo }: { ordenId: number; motivo?: string }) => {
      const { error } = await supabase.rpc('rechazar_orden', {
        p_orden: ordenId,
        p_motivo: motivo ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}
