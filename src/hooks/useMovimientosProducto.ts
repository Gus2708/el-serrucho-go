import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface MovimientoProducto {
  id:              string;
  tipo:            'venta' | 'ingreso' | 'ajuste';
  cantidad:        number;
  referencia:      string;
  nota?:           string;
  fechaFormateada: string;
  timestamp:       number;
  ventaId?:        number;
}

/**
 * Formatea una fecha ISO o YYYY-MM-DD a formato local DD/MM/YYYY.
 */
function formatIsoDateToLocal(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  
  // Si la fecha ya viene en formato YYYY-MM-DD
  const yyyyMmDdMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (yyyyMmDdMatch) {
    const [_, year, month, day] = yyyyMmDdMatch;
    return `${day}/${month}/${year}`;
  }
  
  // Intento de conversión estándar
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const day   = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year  = date.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch (_) {
    // Fallback silencioso al string original
  }
  
  return dateStr;
}

/**
 * Hook para obtener el historial unificado de movimientos de un producto.
 */
export function useMovimientosProducto(codigoProducto: string): UseQueryResult<MovimientoProducto[], Error> {
  return useQuery<MovimientoProducto[], Error>({
    queryKey:  ['movimientos-producto', codigoProducto],
    queryFn:   () => fetchMovimientos(codigoProducto),
    staleTime: 30_000,
  });
}

/**
 * Obtiene las ventas y los ajustes de stock del producto, los unifica y ordena.
 */
async function fetchMovimientos(codigoProducto: string): Promise<MovimientoProducto[]> {
  if (!codigoProducto) return [];

  // 1. Obtener ventas del producto (últimas 50)
  const { data: salesData, error: salesError } = await supabase
    .from('ventas_detalle')
    .select(`
      id,
      venta_id,
      documento,
      cantidad,
      created_at,
      ventas:venta_id (
        fecha_emision,
        status
      )
    `)
    .eq('codigo_producto', codigoProducto)
    .eq('ventas.status', 1)
    .order('created_at', { ascending: false })
    .limit(50);

  if (salesError) {
    console.error('Error cargando ventas:', salesError);
  }

  // 2. Obtener ajustes de inventario de las órdenes de cambio (últimos 50)
  const { data: adjData, error: adjError } = await supabase
    .from('ordenes_cambio_items')
    .select(`
      id,
      delta,
      nota,
      ordenes_cambio:orden_id (
        creado_en,
        nota,
        status
      )
    `)
    .eq('codigo_producto', codigoProducto)
    .eq('ordenes_cambio.status', 'emitido')
    .order('id', { ascending: false })
    .limit(50);

  if (adjError) {
    console.error('Error cargando ajustes:', adjError);
  }

  const movimientos: MovimientoProducto[] = [];

  // 3. Mapear Ventas (Salidas)
  if (salesData) {
    salesData.forEach((s: any) => {
      // Ignorar ventas que no tengan cabecera activa (status != 1) o que tengan cantidad igual a 0
      if (!s.ventas || Number(s.cantidad || 0) === 0) return;

      const dateStr = s.ventas?.fecha_emision || s.created_at;
      const dateObj = new Date(dateStr);
      const ts      = isNaN(dateObj.getTime()) ? 0 : dateObj.getTime();

      movimientos.push({
        id:              `venta-${s.id}`,
        tipo:            'venta',
        cantidad:        -Math.abs(Number(s.cantidad || 0)), // Venta siempre resta stock
        referencia:      `Factura ${s.documento || ''}`,
        fechaFormateada: formatIsoDateToLocal(dateStr),
        timestamp:       ts,
        ventaId:         s.venta_id,
      });
    });
  }

  // 4. Mapear Ajustes y Compras locales/móviles
  if (adjData) {
    adjData.forEach((o: any) => {
      const cabeceraNota = o.ordenes_cambio?.nota || '';
      const deltaVal = Number(o.delta || 0);
      const dateStr  = o.ordenes_cambio?.creado_en;
      const dateObj  = dateStr ? new Date(dateStr) : new Date();
      const ts       = isNaN(dateObj.getTime()) ? 0 : dateObj.getTime();
      
      let tipoMov: 'ingreso' | 'ajuste' = deltaVal > 0 ? 'ingreso' : 'ajuste';
      let referencia = 'Ajuste manual';
      let notaDetalle = o.nota || '';
      if (notaDetalle.trim().toLowerCase() === 'fail') {
        notaDetalle = '';
      }

      // Detectar si proviene del backend como COMPRA (Ingreso)
      if (cabeceraNota.includes('[Local Com ID:')) {
        tipoMov = 'ingreso';
        referencia = cabeceraNota.replace(/\[Local Com ID:\s*\d+\]\s*-\s*/g, '');
      } 
      // Detectar si proviene del backend como AJUSTE
      else if (cabeceraNota.includes('[Local Inv ID:')) {
        tipoMov = deltaVal > 0 ? 'ingreso' : 'ajuste';
        referencia = cabeceraNota.replace(/\[Local Inv ID:\s*\d+\]\s*-\s*/g, '');
      }
      // Ajustes hechos directamente desde la App móvil
      else {
        referencia = cabeceraNota || 'Ajuste de App';
      }

      movimientos.push({
        id:              `ajuste-${o.id}`,
        tipo:            tipoMov,
        cantidad:        deltaVal,
        referencia:      referencia,
        nota:            notaDetalle || undefined,
        fechaFormateada: formatIsoDateToLocal(dateStr),
        timestamp:       ts,
      });
    });
  }

  // 5. Fusionar, ordenar por fecha descendente y limitar a 50
  const merged = movimientos
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);

  return merged;
}
