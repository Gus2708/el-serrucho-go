import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PresupuestoItem } from './usePresupuestoStore';

/**
 * Resuelve una solicitud de ayuda del bot: guarda los productos elegidos y la marca 'resuelto'.
 *
 * El REENVÍO al cliente lo hace n8n por su cuenta: un workflow consulta cada 15s las solicitudes
 * en estado 'resuelto' (aún no enviadas) y las reenvía por WhatsApp. La app NO llama a n8n —
 * el puente es Supabase (no requiere exponer n8n a internet ni EXPO_PUBLIC_N8N_URL). Si el envío
 * fallara, n8n reintenta solo en el siguiente ciclo.
 */
export function useResolverSolicitud() {
  const queryClient = useQueryClient();

  const resolverMutation = useMutation({
    mutationFn: async ({
      solicitudId,
      empleadoId,
      items,
    }: {
      solicitudId: number;
      empleadoId: string;
      items: PresupuestoItem[];
    }) => {
      if (items.length === 0) throw new Error('Elige al menos un producto');

      // 1. Reclamar la solicitud (solo si sigue 'pendiente') — evita doble resolución.
      const { data: updated, error: updError } = await supabase
        .from('solicitudes_ayuda')
        .update({
          status: 'resuelto',
          resuelto_por: empleadoId,
          resuelto_en: new Date().toISOString(),
        })
        .eq('id', solicitudId)
        .eq('status', 'pendiente')
        .select();

      if (updError) throw updError;
      if (!updated || updated.length === 0) {
        throw new Error('La solicitud ya fue resuelta por otro empleado.');
      }

      // 2. Guardar los productos elegidos. n8n (poll cada 15s) los tomará y reenviará al cliente.
      const { error: itemsError } = await supabase
        .from('solicitudes_ayuda_items')
        .insert(
          items.map(item => ({
            solicitud_id: solicitudId,
            codigo_producto: item.producto.codigo_interno,
            descripcion: item.producto.descripcion,
            cantidad: item.cantidad,
            precio_unitario: item.precio_unitario,
          }))
        );

      // Si fallara guardar los items, revertir la reclamación para poder reintentar.
      if (itemsError) {
        await supabase
          .from('solicitudes_ayuda')
          .update({ status: 'pendiente', resuelto_por: null, resuelto_en: null })
          .eq('id', solicitudId);
        throw itemsError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solicitudes-pendientes'] });
    },
  });

  return {
    resolverSolicitud: (solicitudId: number, empleadoId: string, items: PresupuestoItem[]) =>
      resolverMutation.mutateAsync({ solicitudId, empleadoId, items }),
    // El reenvío es automático (n8n reintenta solo cada 15s); esto solo refresca la lista.
    reintentarEnvio: async (_solicitudId: number) => {
      queryClient.invalidateQueries({ queryKey: ['solicitudes-pendientes'] });
    },
    isResolving: resolverMutation.isPending,
    isReintentando: false,
  };
}
