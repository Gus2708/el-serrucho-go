export interface OrdenParaDedupe {
  id: number;
  creado_por?: string | null;
  nota?: string | null;
  creado_en: string;
}

export interface ItemParaDedupe {
  codigo_producto: string;
  delta: number | string | null;
  backend_aplicado_en?: string | null;
}

const PRE_WINDOW_MS = 15_000;
const POST_WINDOW_MS = 60_000;

export function esEspejoLocal(orden: {
  creado_por?: string | null;
  nota?: string | null;
}): boolean {
  return (
    !orden.creado_por &&
    !!orden.nota &&
    (orden.nota.includes('[Local Inv ID:') || orden.nota.includes('[Local Com ID:'))
  );
}

export function esEspejoAjusteLocal(orden: {
  creado_por?: string | null;
  nota?: string | null;
}): boolean {
  return !orden.creado_por && !!orden.nota && orden.nota.includes('[Local Inv ID:');
}

export function extraerPcLocal(nota?: string | null): string | null {
  if (!nota) return null;
  const match = nota.match(/\[PC:\s*([^\]]+)\]/i);
  const pc = match?.[1]?.trim();
  return pc ? pc : null;
}

export function limpiarNotaLocal(nota?: string | null): string {
  if (!nota) return '';
  return nota
    .replace(/\[Local (?:Inv|Com) ID:\s*\d+\]\s*(?:-\s*)?/gi, '')
    .replace(/\[PC:\s*[^\]]+\]\s*(?:-\s*)?/gi, '')
    .trim();
}

export function resolverOrigenLocal(nota?: string | null): string | undefined {
  if (!nota || (!nota.includes('[Local Inv ID:') && !nota.includes('[Local Com ID:'))) {
    return undefined;
  }
  const pc = extraerPcLocal(nota);
  return pc ? `HybridLite (${pc})` : 'HybridLite (Local)';
}

export function resolverCreadorOrden(orden: {
  creado_por?: string | null;
  creado_por_nombre?: string | null;
  nota?: string | null;
}): string {
  const nombre = orden.creado_por_nombre?.trim();
  if (nombre) return nombre;
  if (!orden.creado_por) {
    const origenLocal = resolverOrigenLocal(orden.nota);
    if (origenLocal) return origenLocal;
  }
  return 'Desconocido';
}

function normalizarItemKey(codigo: string, delta: number | string | null): string | null {
  const num = Number(delta);
  const code = (codigo ?? '').trim().toUpperCase();
  if (!code || delta === null || delta === undefined || !Number.isFinite(num)) {
    return null;
  }
  const scaled = Math.round(num * 100);
  if (scaled === 0) return null;
  return `${code}#${scaled}`;
}

function consumirSubconjunto(pool: string[], targetKeys: string[]): string[] | null {
  const copy = [...pool];
  for (const key of targetKeys) {
    const idx = copy.indexOf(key);
    if (idx === -1) return null;
    copy.splice(idx, 1);
  }
  return copy;
}

/**
 * Filtra espejos duplicados `[Local Inv ID: ...]` generados por sync_ajustes cuando
 * existe en la misma lista la orden de app ya aplicada en HybridLite que los originó.
 * Conserva siempre compras locales `[Local Com ID: ...]` y ajustes manuales hechos en tienda.
 */
export function filtrarEspejosDuplicados<T extends OrdenParaDedupe>(
  ordenes: T[],
  itemsPorOrden: Record<number, ItemParaDedupe[]>,
): T[] {
  interface AppCandidate {
    id: number;
    windowStart: number;
    windowEnd: number;
    remainingKeys: string[];
  }

  const appCandidates: AppCandidate[] = [];
  for (const orden of ordenes) {
    if (!orden.creado_por) continue;
    const createdMs = Date.parse(orden.creado_en);
    if (!Number.isFinite(createdMs)) continue;

    const rawItems = itemsPorOrden[orden.id] ?? [];
    const remainingKeys: string[] = [];
    let maxAppliedMs = Number.NEGATIVE_INFINITY;

    for (const item of rawItems) {
      if (!item.backend_aplicado_en) continue;
      const appliedMs = Date.parse(item.backend_aplicado_en);
      if (!Number.isFinite(appliedMs)) continue;
      const key = normalizarItemKey(item.codigo_producto, item.delta);
      if (!key) continue;
      remainingKeys.push(key);
      if (appliedMs > maxAppliedMs) maxAppliedMs = appliedMs;
    }

    if (remainingKeys.length === 0 || !Number.isFinite(maxAppliedMs)) continue;

    appCandidates.push({
      id: orden.id,
      windowStart: createdMs - PRE_WINDOW_MS,
      windowEnd: Math.max(createdMs, maxAppliedMs) + POST_WINDOW_MS,
      remainingKeys,
    });
  }

  if (appCandidates.length === 0) return ordenes;

  appCandidates.sort((a, b) => a.windowStart - b.windowStart || a.id - b.id);

  const mirrorsOrdered = ordenes
    .filter(esEspejoAjusteLocal)
    .map(orden => ({ orden, ms: Date.parse(orden.creado_en) }))
    .filter(entry => Number.isFinite(entry.ms))
    .sort((a, b) => a.ms - b.ms || a.orden.id - b.orden.id);

  const hiddenIds = new Set<number>();

  for (const { orden, ms } of mirrorsOrdered) {
    const mirrorItems = itemsPorOrden[orden.id] ?? [];
    const mirrorKeys: string[] = [];
    let valid = mirrorItems.length > 0;

    for (const item of mirrorItems) {
      const key = normalizarItemKey(item.codigo_producto, item.delta);
      if (key) {
        mirrorKeys.push(key);
      } else {
        const num = Number(item.delta);
        if (item.delta === null || !Number.isFinite(num) || Math.round(num * 100) !== 0) {
          valid = false;
          break;
        }
      }
    }

    if (!valid || mirrorKeys.length === 0) continue;

    for (const candidate of appCandidates) {
      if (ms < candidate.windowStart || ms > candidate.windowEnd) continue;
      const leftover = consumirSubconjunto(candidate.remainingKeys, mirrorKeys);
      if (leftover !== null) {
        candidate.remainingKeys = leftover;
        hiddenIds.add(orden.id);
        break;
      }
    }
  }

  if (hiddenIds.size === 0) return ordenes;
  return ordenes.filter(orden => !hiddenIds.has(orden.id));
}
