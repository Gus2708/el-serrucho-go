import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { CompraDraftItem } from './useCompra';
import { isDemoActive } from '../demo/useDemoStore';
import { isMissingDiscountColumnError, normalizarDescuentos } from '../lib/compraDescuentos';

export interface CompraConItems {
  id:                   number;
  proveedor_codigo:     string;
  proveedor_nombre:     string | null;
  nota:                 string | null;
  numero_documento:     string | null;
  descuentos_generales?: number[];
  status:               string;
  creado_en:            string;
  item_count:           number;
  backend_status:       'pendiente' | 'aplicando' | 'completado' | 'error';
  backend_resultado:    string | null;
  backend_aplicado_en:  string | null;
  creado_por_nombre?:   string;
}

export function useComprasHistory(): UseQueryResult<CompraConItems[], Error> {
  return useQuery({
    queryKey:  ['compras-history'],
    queryFn:   fetchComprasHistory,
    staleTime: 60_000,
  });
}

async function fetchComprasHistory(): Promise<CompraConItems[]> {
  if (isDemoActive()) {
    return [
      {
        id:                  201,
        proveedor_codigo:    'PROV-001',
        proveedor_nombre:    'DISTRIBUIDORA FERRETERA NACIONAL C.A.',
        nota:                'Reposición de cemento y electrodos Lincoln',
        numero_documento:    'FAC-PROV-9921',
        status:              'emitido',
        creado_en:           new Date(Date.now() - 240 * 60_000).toISOString(),
        item_count:          8,
        backend_status:      'completado',
        backend_resultado:   'Aplicado correctamente en HybridLite',
        backend_aplicado_en: new Date().toISOString(),
        creado_por_nombre:   'Reclutador Demo',
      },
    ];
  }
  const baseCols = `
      id, creado_por, proveedor_codigo, proveedor_nombre, nota, numero_documento, status, creado_en,
      backend_status, backend_resultado, backend_aplicado_en
    `;
  const withDiscountCols = `${baseCols}, descuentos_generales`;

  const primary = await supabase
    .from('compras_app')
    .select(withDiscountCols)
    .eq('status', 'emitido')   // los borradores viven en su propia pestaña, no en el historial
    .order('creado_en', { ascending: false })
    .limit(50);

  let rawRows: any[] | null = primary.data;
  let error = primary.error;

  if (error && isMissingDiscountColumnError(error)) {
    const fallback = await supabase
      .from('compras_app')
      .select(baseCols)
      .eq('status', 'emitido')
      .order('creado_en', { ascending: false })
      .limit(50);
    rawRows = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;

  const rows = rawRows ?? [];

  // Batch-fetch creator names from profiles
  const uniqueIds = [...new Set(rows.map((c: any) => c.creado_por).filter(Boolean))];
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

  // Batch-fetch item counts (grouped by compra_id)
  const ids = rows.map((c: any) => c.id);
  let countMap: Record<number, number> = {};

  if (ids.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from('compras_app_items')
      .select('compra_id')
      .in('compra_id', ids);

    if (itemsError) {
      console.warn('No se pudo cargar item_count del historial:', itemsError.message);
    } else if (items) {
      countMap = items.reduce((acc: Record<number, number>, item: any) => {
        const compraId = Number(item.compra_id);
        acc[compraId] = (acc[compraId] ?? 0) + 1;
        return acc;
      }, {});
    }
  }

  return rows.map((c: any) => ({
    id:                   c.id,
    proveedor_codigo:     c.proveedor_codigo,
    proveedor_nombre:     c.proveedor_nombre,
    nota:                 c.nota,
    numero_documento:     c.numero_documento,
    descuentos_generales: normalizarDescuentos(c.descuentos_generales),
    status:               c.status,
    creado_en:            c.creado_en,
    item_count:           countMap[Number(c.id)] ?? 0,
    backend_status:       c.backend_status,
    backend_resultado:    c.backend_resultado,
    backend_aplicado_en:  c.backend_aplicado_en,
    creado_por_nombre:    profileMap[c.creado_por] ?? undefined,
  }));
}

/** Ítems de una compra puntual, para precargar el draft de "editar y reintentar". */
export async function fetchCompraItemsForEdit(compraId: number): Promise<CompraDraftItem[]> {
  const baseCols = 'codigo_producto, descripcion, cantidad, costo, precio, referencia, es_nuevo, es_ajuste';
  const primary = await supabase
    .from('compras_app_items')
    .select(`${baseCols}, costo_lista, descuentos, excluir_descuento_general`)
    .eq('compra_id', compraId);

  let rawItems: any[] | null = primary.data;
  let error = primary.error;

  if (error && isMissingDiscountColumnError(error)) {
    const fallback = await supabase
      .from('compras_app_items')
      .select(baseCols)
      .eq('compra_id', compraId);
    rawItems = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;

  return (rawItems ?? []).map((it: any) => ({
    codigo_producto:           it.codigo_producto,
    descripcion:               it.descripcion ?? '',
    cantidad:                  Number(it.cantidad),
    costo:                     Number(it.costo),
    costo_lista:               it.costo_lista != null ? Number(it.costo_lista) : Number(it.costo),
    descuentos:                normalizarDescuentos(it.descuentos),
    excluir_descuento_general: Boolean(it.excluir_descuento_general),
    precio:                    Number(it.precio),
    referencia:                it.referencia,
    es_nuevo:                  Boolean(it.es_nuevo),
    es_ajuste:                 Boolean(it.es_ajuste),
  }));
}
