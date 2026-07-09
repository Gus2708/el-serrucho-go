# Write-back de stock: Orden de Cambio → HybridLite (contrato para la app)

**(2026-07-09)** Cuando un usuario emite una **Orden de Cambio** en El Serrucho Go, el
backend de la ferretería la detecta y **aplica el ajuste de stock él solo en
HybridLite** (automatizando la app de escritorio con input real de hardware). Ya no
hace falta aplicar el PDF a mano. Este documento es el contrato de datos para
implementar la parte visual/UX en la app.

```
App (useOrdenCambio.submit)          Backend (listener_writeback.py)
────────────────────────────         ─────────────────────────────────
ordenes_cambio  status='emitido'  →  sondea items backend_status='pendiente'
ordenes_cambio_items (delta)      →  aplica delta en HybridLite (ajuste kardex)
                                  →  marca backend_status + backend_resultado
sync normal de inventario         ←  la existencia nueva vuelve a `productos`
```

## Columnas nuevas en `ordenes_cambio_items` (migraciones 018/019, ya ejecutadas)

| Columna | Tipo | Semántica |
|---|---|---|
| `backend_status` | text | `pendiente` → `aplicando` → `completado` \| `error` |
| `backend_resultado` | text | Detalle del resultado o del error (para mostrar al usuario). |
| `backend_intentos` | int | Reintentos consumidos (máx. 3, solo fallos "seguros"). |
| `backend_aplicado_en` | timestamptz | Cuándo se confirmó el commit en HybridLite. |

### Ciclo de vida de `backend_status`

- **`pendiente`** — en cola. Es el default al insertar; el backend solo procesa items
  de órdenes con `status='emitido'` **y `creado_por` NOT NULL** (ver "doble uso").
- **`aplicando`** — el backend lo está ejecutando ahora (transitorio, ~30s por item).
- **`completado`** — aplicado y **verificado contra la base real** de HybridLite
  (o `delta=0`: nada que aplicar). `backend_aplicado_en` queda seteado.
- **`error`** — no se aplicó (o no se sabe si se aplicó; ver advertencia). El motivo
  está en `backend_resultado`.

## Qué debería hacer la app (fase siguiente)

1. **Mostrar el estado por item** (p. ej. chip en `OrdenCambioDetailModal`):
   pendiente ⏳ / aplicando ⚙ / completado ✅ / error ⚠, con `backend_resultado`
   visible (tooltip/expandible) y `backend_aplicado_en` formateado.
2. **Reencolar manual** de items en `error`: RLS (`owner_items`) ya permite al dueño
   de la orden actualizar sus items → `UPDATE ... SET backend_status='pendiente',
   backend_intentos=0`. **UX obligatoria:** si `backend_resultado` contiene
   `"ATENCIÓN"` / `"riesgo de ajuste doble"`, pedir confirmación explícita: el
   ajuste es **relativo** (delta) y reencolar un commit ambiguo puede aplicarlo dos
   veces. El usuario debe verificar la existencia en HybridLite (o en `productos`
   tras un sync) antes de reencolar.
3. **Realtime opcional**: suscribirse a cambios de `ordenes_cambio_items` filtrando
   por `orden_id` para ver el avance en vivo (el patrón ya existe en
   `useRealtimeSync.ts`).
4. **No editar `existencia_actual`/`nueva_existencia` después de emitir** (el `delta`
   es columna generada; el backend usa el delta del momento de la emisión).

## Detalles que importan

- **Doble uso de la tabla:** `sync_ajustes.py` (backend) inserta en estas mismas
  tablas **espejos históricos** de movimientos locales de HybridLite, con
  `creado_por` NULL y firma `[Local Inv ID: n]` / `[Local Com ID: n]` en `nota`.
  Nacen ya `completado` y el backend además los filtra por `creado_por` — **nunca**
  se (re)aplican. La app ya los distingue hoy como "Ajuste (Local)".
- **Eco esperado:** cuando el backend aplica una orden de la app, ese ajuste queda
  en el kardex de HybridLite y `sync_ajustes` lo espejará después como una orden
  local más. O sea: un mismo cambio puede aparecer dos veces en el historial de
  movimientos (la orden de la app + su espejo local). Considerarlo en la UI si se
  quiere deduplicar.
- **Tiempos:** el backend procesa de a un item (~30s de input real cada uno, lotes
  de hasta 10 por pasada, sondeo cada 8s) y solo dentro de su ventana horaria
  (`HYBRID_WRITE_WINDOW`, típicamente fuera del horario de la tienda). Un item
  puede quedar `pendiente` durante horas legítimamente: reflejarlo en la UX
  ("se aplicará fuera de horario").
- **Preview del backend:** mientras el backend corre sin `HYBRID_WRITE_ENABLED=1`,
  los items procesados en prueba quedan `pendiente` con `backend_resultado`
  prefijado `[PREVIEW]` — no confundir con un error.
- **`delta` NULL** (no debería pasar con la UI actual): el backend lo marca `error`
  pidiendo recrear el item; asegurar que `existencia_actual` siempre viaje en el
  insert.

## Referencias

- Backend/motor: `backend serrucho/hybrid_writeback/README.md` (pipeline, seguridad,
  protecciones) y `listener_writeback.py`.
- Migraciones: `supabase/migrations/018_ordenes_cambio_items_backend_status.sql` y
  `019_backend_status_backfill_completado.sql` (este repo).
