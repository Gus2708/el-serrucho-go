import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Presupuesto, PresupuestoDetalle } from '../lib/supabase';

const PAGE_SIZE = 20;

export type PresupuestoHistoryRow = Presupuesto & {
  cliente_nombre?: string;
  items_count?: number;
};

export function usePresupuestosHistory(search?: string) {
  return useInfiniteQuery({
    queryKey: ['presupuestos-history', search],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam as number;
      const to = from + PAGE_SIZE - 1;

        let query = supabase
        .from('presupuestos')
        .select(`
          *,
          clientes ( nombre ),
          items_count
        `)
        .order('creado_en', { ascending: false })
        .range(from, to);

      const trimmed = search?.trim();
      if (trimmed && trimmed.length > 0) {
        // If it looks like a number, search by ID, else search note
        if (!isNaN(Number(trimmed))) {
           query = query.eq('id', Number(trimmed));
        } else {
           query = query.ilike('nota', `%${trimmed}%`);
        }
      }

      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching presupuestos:', error);
        throw error;
      }

      return (data || []).map(row => ({
        ...row,
        cliente_nombre: Array.isArray(row.clientes) 
          ? row.clientes[0]?.nombre 
          : (row.clientes as any)?.nombre,
        items_count: row.items_count || 0,
      })) as PresupuestoHistoryRow[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined;
    },
    staleTime: 30_000,
  });
}

export function usePresupuestoWithDetails(presupuestoId: number | null) {
  return useQuery({
    queryKey: ['presupuesto', presupuestoId],
    queryFn: async () => {
      if (!presupuestoId) return null;

      const { data: header, error: headerErr } = await supabase
        .from('presupuestos')
        .select(`
          *,
          clientes ( nombre, rif, telefono, direccion )
        `)
        .eq('id', presupuestoId)
        .single();
        
      if (headerErr) throw headerErr;

      const { data: detail, error: detailErr } = await supabase
        .from('presupuestos_detalle')
        .select('*')
        .eq('presupuesto_id', presupuestoId);

      if (detailErr) throw detailErr;

      return { header, detail: detail as PresupuestoDetalle[] };
    },
    enabled: !!presupuestoId,
  });
}
