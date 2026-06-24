import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * One editable budget line. Existing rows carry their `rowId`
 * (presupuestos_detalle.id); newly added lines omit it so the DB generates one.
 */
export type EditItemPayload = {
  rowId?: number;
  codigo_producto: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
};

export type ActualizarPresupuestoArgs = {
  presupuestoId: number;
  items: EditItemPayload[];
  removedIds: number[];
  nota: string | null;
};

async function actualizarPresupuesto({
  presupuestoId,
  items,
  removedIds,
  nota,
}: ActualizarPresupuestoArgs): Promise<{ presupuestoId: number; totalUsd: number }> {
  if (items.length === 0) {
    throw new Error('El presupuesto debe tener al menos un producto');
  }

  const totalUsd = items.reduce((acc, it) => acc + it.cantidad * it.precio_unitario, 0);

  // 1. Delete lines the user removed.
  if (removedIds.length > 0) {
    const { error } = await supabase
      .from('presupuestos_detalle')
      .delete()
      .in('id', removedIds);
    if (error) throw error;
  }

  // 2. Update lines that keep their original id (upsert on PK).
  const existentes = items.filter((it) => it.rowId != null);
  if (existentes.length > 0) {
    const rows = existentes.map((it) => ({
      id: it.rowId,
      presupuesto_id: presupuestoId,
      codigo_producto: it.codigo_producto,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
    }));
    const { error } = await supabase
      .from('presupuestos_detalle')
      .upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  // 3. Insert newly added lines (no id -> DB generates one).
  const nuevos = items.filter((it) => it.rowId == null);
  if (nuevos.length > 0) {
    const rows = nuevos.map((it) => ({
      presupuesto_id: presupuestoId,
      codigo_producto: it.codigo_producto,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
    }));
    const { error } = await supabase.from('presupuestos_detalle').insert(rows);
    if (error) throw error;
  }

  // 4. Refresh header total + nota and clear pdf_url so the PDF regenerates
  //    from the updated data the next time it is requested.
  const { error: headerErr } = await supabase
    .from('presupuestos')
    .update({ total_usd: totalUsd, nota: nota || null, pdf_url: null })
    .eq('id', presupuestoId);
  if (headerErr) throw headerErr;

  return { presupuestoId, totalUsd };
}

export function useActualizarPresupuesto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: actualizarPresupuesto,
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['presupuesto', vars.presupuestoId] });
      queryClient.invalidateQueries({ queryKey: ['presupuestos-history'] });
    },
  });
}
