import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type BackendStatus =
  | 'pendiente'
  | 'aplicando'
  | 'completado'
  | 'error'
  | 'espera_aprobacion'
  | 'rechazado';

export interface OrdenCambioItem {
  id:                number;
  orden_id:          number;
  codigo_producto:   string;
  descripcion:       string;
  existencia_actual: number;
  nueva_existencia:  number;
  delta:             number;
  nota:              string | null;
  backend_status:      BackendStatus;
  backend_resultado:   string | null;
  backend_intentos:    number;
  backend_aplicado_en: string | null;
  precio_actual?:    number | null;
  nuevo_precio?:     number | null;
  costo?:            number | null;
}

export function useOrdenCambioDetalle(ordenId: number | null) {
  const queryClient = useQueryClient();

  // Realtime subscription: refresca el detalle y el historial cuando el
  // backend local reporta avance en ordenes_cambio_items.
  useEffect(() => {
    if (!ordenId) return;

    const channel = supabase
      .channel(`orden-items-${ordenId}`)
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'ordenes_cambio_items',
        filter: `orden_id=eq.${ordenId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['orden-cambio-detalle', ordenId] });
        queryClient.invalidateQueries({ queryKey: ['ordenes-history'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ordenId, queryClient]);

  return useQuery({
    queryKey:  ['orden-cambio-detalle', ordenId],
    queryFn:   () => fetchOrdenCambioDetalle(ordenId!),
    enabled:   !!ordenId,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const items = query.state.data;
      const activo = Array.isArray(items) && items.some(i => i.backend_status === 'pendiente' || i.backend_status === 'aplicando');
      return activo ? 15_000 : false;
    },
  });
}

async function fetchOrdenCambioDetalle(ordenId: number): Promise<OrdenCambioItem[]> {
  const { data, error } = await supabase
    .from('ordenes_cambio_items')
    .select('*')
    .eq('orden_id', ordenId);

  if (error) throw error;

  return (data || []).map(row => ({
    id:                Number(row.id),
    orden_id:          Number(row.orden_id),
    codigo_producto:   row.codigo_producto,
    descripcion:       row.descripcion || '',
    existencia_actual: Number(row.existencia_actual || 0),
    nueva_existencia:  Number(row.nueva_existencia || 0),
    delta:             Number(row.delta || 0),
    nota:              row.nota,
    backend_status:      (row.backend_status ?? 'completado') as BackendStatus,
    backend_resultado:   row.backend_resultado ?? null,
    backend_intentos:    Number(row.backend_intentos || 0),
    backend_aplicado_en: row.backend_aplicado_en ?? null,
    precio_actual:      row.precio_actual !== null && row.precio_actual !== undefined ? Number(row.precio_actual) : null,
    nuevo_precio:       row.nuevo_precio !== null && row.nuevo_precio !== undefined ? Number(row.nuevo_precio) : null,
    costo:              row.costo !== null && row.costo !== undefined ? Number(row.costo) : null,
  })) as OrdenCambioItem[];
}

export function useReencolarItem(ordenId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: number) => {
      const { data, error } = await supabase
        .from('ordenes_cambio_items')
        .update({ backend_status: 'pendiente', backend_intentos: 0, backend_resultado: null })
        .eq('id', itemId)
        .eq('backend_status', 'error') // guard: solo reencolar items en error
        .select('id');

      if (error) throw error;

      if (!data || data.length === 0) {
        // RLS solo permite UPDATE al dueño de la orden y falla en silencio con 0 filas.
        throw new Error('No se pudo reencolar: el item ya no está en error o no eres el creador de la orden.');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orden-cambio-detalle', ordenId] });
      queryClient.invalidateQueries({ queryKey: ['ordenes-history'] });
    },
  });
}
