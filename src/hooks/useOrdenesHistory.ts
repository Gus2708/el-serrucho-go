import { useQuery } from '@tanstack/react-query';
import { supabase, OrdenCambio } from '../lib/supabase';

export interface BackendResumen {
  pendientes:         number;
  aplicando:          number;
  errores:            number;
  completados:        number;
  espera_aprobacion:  number;
  rechazados:         number;
  total:              number;
}

export type OrdenConItems = OrdenCambio & {
  item_count: number;
  creado_por_nombre?: string;
  backend_resumen?: BackendResumen;
};

export function useOrdenesHistory() {
  return useQuery({
    queryKey:  ['ordenes-history'],
    queryFn:   fetchOrdenes,
    staleTime: 60_000,
  });
}

async function fetchOrdenes(): Promise<OrdenConItems[]> {
  const { data, error } = await supabase
    .from('ordenes_cambio')
    .select(`
      id, creado_por, nota, status, pdf_url, creado_en,
      aprobacion_estado, aprobado_por, aprobado_en, rechazo_motivo,
      item_count
    `)
    .order('creado_en', { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows = data ?? [];

  // Batch-fetch creator names from profiles
  const uniqueIds = [...new Set(rows.map((o: any) => o.creado_por).filter(Boolean))];
  let profileMap: Record<string, string> = {};

  if (uniqueIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', uniqueIds);

    if (profiles) {
      profileMap = Object.fromEntries(
        profiles.map((p: any) => [p.id, p.display_name])
      );
    }
  }

  // Batch-fetch backend status resumen (todos los items para resumir el total)
  const ids = rows.map((o: any) => o.id);
  let resumenMap: Record<number, BackendResumen> = {};

  if (ids.length > 0) {
    const { data: backendItems, error: backendError } = await supabase
      .from('ordenes_cambio_items')
      .select('orden_id, backend_status')
      .in('orden_id', ids);

    if (backendError) {
      console.warn('No se pudo cargar backend_resumen del historial:', backendError.message);
    } else if (backendItems) {
      resumenMap = backendItems.reduce((acc: Record<number, BackendResumen>, item: any) => {
        const ordenId = Number(item.orden_id);
        const resumen = acc[ordenId] ?? {
          pendientes: 0, aplicando: 0, errores: 0, completados: 0,
          espera_aprobacion: 0, rechazados: 0, total: 0,
        };

        resumen.total += 1;
        if (item.backend_status === 'pendiente') resumen.pendientes += 1;
        else if (item.backend_status === 'aplicando') resumen.aplicando += 1;
        else if (item.backend_status === 'error') resumen.errores += 1;
        else if (item.backend_status === 'completado') resumen.completados += 1;
        else if (item.backend_status === 'espera_aprobacion') resumen.espera_aprobacion += 1;
        else if (item.backend_status === 'rechazado') resumen.rechazados += 1;

        acc[ordenId] = resumen;
        return acc;
      }, {});
    }
  }

  return rows.map((o: any) => ({
    id:         o.id,
    creado_por: o.creado_por,
    nota:       o.nota,
    status:     o.status,
    pdf_url:    o.pdf_url,
    creado_en:  o.creado_en,
    aprobacion_estado: o.aprobacion_estado ?? 'no_aplica',
    aprobado_por:      o.aprobado_por ?? null,
    aprobado_en:       o.aprobado_en ?? null,
    rechazo_motivo:    o.rechazo_motivo ?? null,
    item_count: o.item_count || 0,
    creado_por_nombre: profileMap[o.creado_por] ?? undefined,
    backend_resumen: resumenMap[Number(o.id)],
  }));
}
