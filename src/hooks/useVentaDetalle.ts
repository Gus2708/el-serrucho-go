import { useQuery } from '@tanstack/react-query';
import { supabase, VentaDetalleUSD } from '../lib/supabase';

export function useVentaDetalle(ventaId: number | null) {
  return useQuery({
    queryKey: ['venta-detalle', ventaId],
    queryFn: () => fetchVentaDetalle(ventaId!),
    enabled: !!ventaId,
  });
}

async function fetchVentaDetalle(ventaId: number): Promise<VentaDetalleUSD[]> {
  const { data, error } = await supabase
    .from('vw_ventas_detalle_usd')
    .select('*')
    .eq('venta_id', ventaId);

  if (error) throw error;

  // Handle Supabase numeric as strings
  return (data || []).map(row => ({
    ...row,
    cantidad:            Number(row.cantidad || 0),
    precio_unitario_usd: Number(row.precio_unitario_usd || 0),
    subtotal_usd:        Number(row.subtotal_usd || 0),
  })) as VentaDetalleUSD[];
}
