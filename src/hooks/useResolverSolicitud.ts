import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PresupuestoItem } from './usePresupuestoStore';

const N8N_URL = process.env.EXPO_PUBLIC_N8N_URL;

/**
 * Realiza el envío POST al webhook de n8n para notificar el envío de la ayuda.
 */
async function postWebhook(solicitudId: number) {
  if (!N8N_URL) {
    throw new Error('La variable de entorno EXPO_PUBLIC_N8N_URL no está definida.');
  }

  // Sanitizar URL removiendo slash final si lo tiene
  const baseUrl = N8N_URL.endsWith('/') ? N8N_URL.slice(0, -1) : N8N_URL;
  const url = `${baseUrl}/webhook/reenviar-ayuda`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ solicitud_id: solicitudId }),
  });

  if (!response.ok) {
    throw new Error(`Error al enviar webhook: ${response.status} ${response.statusText}`);
  }

  return response;
}

/**
 * Hook para resolver solicitudes de ayuda y reintentar su envío.
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
      // 1. Concurrency Check: Update solicitudes_ayuda only if status is 'pendiente'
      const { data: updatedData, error: updateError } = await supabase
        .from('solicitudes_ayuda')
        .update({
          status: 'resuelto',
          resuelto_por: empleadoId,
          resuelto_en: new Date().toISOString(),
        })
        .eq('id', solicitudId)
        .eq('status', 'pendiente')
        .select();

      if (updateError) throw updateError;
      if (!updatedData || updatedData.length === 0) {
        throw new Error('La solicitud ya no está pendiente o fue resuelta por otro empleado.');
      }

      // 2. Insert items into solicitudes_ayuda_items
      if (items.length > 0) {
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

        if (itemsError) throw itemsError;
      }

      // 3. POST to webhook
      await postWebhook(solicitudId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solicitudes-pendientes'] });
    },
  });

  const reintentarMutation = useMutation({
    mutationFn: async (solicitudId: number) => {
      await postWebhook(solicitudId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solicitudes-pendientes'] });
    },
  });

  return {
    resolverSolicitud: async (solicitudId: number, empleadoId: string, items: PresupuestoItem[]) => {
      return resolverMutation.mutateAsync({ solicitudId, empleadoId, items });
    },
    reintentarEnvio: async (solicitudId: number) => {
      return reintentarMutation.mutateAsync(solicitudId);
    },
    isResolving: resolverMutation.isPending,
    isReintentando: reintentarMutation.isPending,
  };
}
