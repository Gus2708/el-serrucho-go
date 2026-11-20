import type { OrdenConItems } from '../hooks/useOrdenesHistory';

export interface MovimientoProducto {
  id:              string;
  tipo:            'venta' | 'ingreso' | 'ajuste';
  cantidad:        number;
  referencia:      string;
  nota?:           string;
  fechaFormateada: string;
  timestamp:       number;
  ventaId?:        number;
  backend_status?: string;
  backend_resultado?: string | null;
  /** Change order that holds this movement; opens its detail modal. */
  orden?:          OrdenConItems;
  /** When the write-back backend applied this app adjustment in HybridLite. */
  aplicadoTs?:     number;
  /** True for `[Local Inv ID: n]` mirrors that sync_ajustes copies from the HybridLite kardex. */
  esEcoLocal?:     boolean;
}

// The HybridLite document is created while the backend applies the item, so its
// timestamp sits next to `backend_aplicado_en`. The window absorbs POS clock drift.
const ECHO_WINDOW_MS = 12 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 10 * 60 * 1000;

function isAppliedAppAdjustment(mov: MovimientoProducto): boolean {
  return !mov.esEcoLocal && mov.tipo !== 'venta' && mov.backend_status === 'completado';
}

function findEcho(
  mov: MovimientoProducto,
  echoes: MovimientoProducto[],
  consumed: Set<string>,
): MovimientoProducto | undefined {
  const appliedTs = mov.aplicadoTs ?? mov.timestamp;
  let best: MovimientoProducto | undefined;
  let bestDistance = Infinity;

  for (const echo of echoes) {
    if (consumed.has(echo.id) || echo.cantidad !== mov.cantidad) continue;
    if (echo.timestamp < mov.timestamp - CLOCK_SKEW_MS) continue;

    const distance = Math.abs(echo.timestamp - appliedTs);
    if (distance <= ECHO_WINDOW_MS && distance < bestDistance) {
      best = echo;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * When the backend applies an app adjustment, sync_ajustes later mirrors the
 * resulting HybridLite document as a second order (docs/WRITEBACK-PIPELINE.md,
 * "Eco esperado"). Collapses each pair into the app row, which keeps its order
 * link and status, and shows the HybridLite document as its note.
 */
export function mergeLocalEchoes(movimientos: MovimientoProducto[]): MovimientoProducto[] {
  const echoes = movimientos.filter((mov) => mov.esEcoLocal);
  const consumed = new Set<string>();
  const merged: MovimientoProducto[] = [];

  for (const mov of movimientos) {
    if (mov.esEcoLocal) continue;

    const echo = isAppliedAppAdjustment(mov) ? findEcho(mov, echoes, consumed) : undefined;
    if (!echo) {
      merged.push(mov);
      continue;
    }

    consumed.add(echo.id);
    const hasOwnNote = !!mov.nota && mov.nota !== mov.referencia;
    merged.push({ ...mov, nota: hasOwnNote ? mov.nota : echo.referencia });
  }

  return [...merged, ...echoes.filter((echo) => !consumed.has(echo.id))];
}
