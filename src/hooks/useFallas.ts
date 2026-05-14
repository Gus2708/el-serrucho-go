import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface FallaNegocio {
  id: string;
  texto: string;
  codigo_producto: string | null;
  creado_por: string;
  pedido: boolean;
  creado_en: string;
  perfil?: {
    display_name: string;
  } | null;
}

export function useFallas() {
  const queryClient = useQueryClient();

  const { data: fallas = [], isLoading, error } = useQuery({
    queryKey: ['fallas-negocio'],
    queryFn: async () => {
      // Fetch fallas
      const { data: fallasData, error: fallasError } = await supabase
        .from('fallas_negocio')
        .select('*')
        .order('creado_en', { ascending: false });

      if (fallasError) throw fallasError;

      // Fetch profiles mapping
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name');

      const profileMap = new Map();
      if (profiles) {
        profiles.forEach((p: any) => profileMap.set(p.id, p.display_name));
      }

      // Map display_name
      return (fallasData || []).map((falla: any) => ({
        ...falla,
        perfil: {
          display_name: profileMap.get(falla.creado_por) || 'Desconocido'
        }
      }));
    },
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('fallas-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fallas_negocio' }, () => {
        queryClient.invalidateQueries({ queryKey: ['fallas-negocio'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const addFallaMutation = useMutation({
    mutationFn: async ({ texto, codigo_producto, creado_por }: { texto: string; codigo_producto?: string; creado_por: string }) => {
      const { error } = await supabase
        .from('fallas_negocio')
        .insert({ texto, codigo_producto: codigo_producto || null, creado_por });
      if (error) throw error;
    },
  });

  const togglePedidoMutation = useMutation({
    mutationFn: async ({ id, currentStatus }: { id: string; currentStatus: boolean }) => {
      const { error } = await supabase
        .from('fallas_negocio')
        .update({ pedido: !currentStatus })
        .eq('id', id);
      if (error) throw error;
    },
  });

  const deleteFallaMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('fallas_negocio')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
  });

  return {
    fallas,
    isLoading,
    error,
    addFalla: addFallaMutation.mutateAsync,
    togglePedido: togglePedidoMutation.mutateAsync,
    deleteFalla: deleteFallaMutation.mutateAsync,
  };
}
