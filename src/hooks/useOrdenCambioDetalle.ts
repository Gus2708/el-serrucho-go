import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface OrdenCambioItem {
  id:                number;
  orden_id:          number;
  codigo_producto:   string;
  descripcion:       string;
  existencia_actual: number;
  nueva_existencia:  number;
  delta:             number;
  nota:              string | null;
}

export function useOrdenCambioDetalle(ordenId: number | null) {
  return useQuery({
    queryKey:  ['orden-cambio-detalle', ordenId],
    queryFn:   () => fetchOrdenCambioDetalle(ordenId!),
    enabled:   !!ordenId,
    staleTime: 30_000,
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
  })) as OrdenCambioItem[];
}
