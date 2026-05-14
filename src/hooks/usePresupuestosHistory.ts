import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Presupuesto, PresupuestoDetalle } from '../lib/supabase';

const PAGE_SIZE = 20;

export type PresupuestoHistoryRow = Presupuesto & {
  cliente_nombre?: string;
  items_count?: number;
  creado_por_nombre?: string;
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

      const rows = data || [];

      // Batch-fetch creator names from profiles
      const uniqueIds = [...new Set(rows.map((r: any) => r.creado_por).filter(Boolean))];
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

      return rows.map(row => ({
        ...row,
        cliente_nombre: Array.isArray(row.clientes) 
          ? row.clientes[0]?.nombre 
          : (row.clientes as any)?.nombre,
        items_count: row.items_count || 0,
        creado_por_nombre: profileMap[(row as any).creado_por] ?? undefined,
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

      // Fetch creator name
      let creado_por_nombre: string | undefined;
      if (header.creado_por) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', header.creado_por)
          .single();
        creado_por_nombre = profileData?.display_name ?? undefined;
      }

      return { header: { ...header, creado_por_nombre }, detail: detail as PresupuestoDetalle[] };
    },
    enabled: !!presupuestoId,
  });
}
