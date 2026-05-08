# El Serrucho to GO — Contexto de Sesión

Resumen de todo lo implementado y configurado. Complementa el `CLAUDE.md` principal.

---

## 1. Gemini AI — Detección de Anomalías

### Configuración completada
- **Secret seteado** en Supabase: `GEMINI_API_KEY=AIzaSyBlV7sw0SV_H3d618J3RZBRMEa2NgOeFtM`
- **Edge function desplegada**: `detect-anomalies` (ya existía en `supabase/functions/detect-anomalies/index.ts`)
- **pg_cron** configurado para correr cada 2 horas: `0 */2 * * *`

### RPC creada en Supabase
```sql
CREATE OR REPLACE FUNCTION get_products_for_anomaly_check()
RETURNS TABLE (codigo_interno, descripcion, unidad, existencia, costo, precio_venta, vendido_30d, actualizado_en)
```
- Analiza hasta **100 productos** priorizados:
  1. Sin stock pero con ventas recientes (más sospechoso)
  2. Margen negativo (costo > precio)
  3. Sin stock general
  4. Resto por volumen de ventas

### pg_cron (SQL aplicado)
```sql
SELECT cron.schedule('detect-anomalies-2h', '0 */2 * * *', $$ SELECT net.http_post(...) $$);
```

---

## 2. Botón "Analizar con IA" — `app/(tabs)/alertas.tsx`

Botón en el header de Alertas que invoca la edge function manualmente:
- Icono `cpu` de Feather, pill dorado semi-transparente
- Estados: idle → spinner "Analizando…" → banner con resultado
- Banner resultado: `"Revisados X productos · Y sospechosos detectados"`
- Refresca automáticamente la lista de anomalías al terminar
- Usa `supabase.functions.invoke('detect-anomalies')` con las credenciales de sesión

---

## 3. Alertas de Stock — Reducción de Ruido

**Problema**: `vw_alertas_stock` marcaba 1000 productos como `stock_muerto` (sin ventas en 90 días).

**Fix aplicado** — nueva condición para `stock_muerto`:
```sql
p.existencia >= 5  -- solo productos con stock significativo
AND NOT EXISTS (ventas en últimos 90 días)
```
Antes marcaba cualquier producto sin ventas, incluidos los que tienen 1-2 unidades residuales.

---

## 4. Inventario — Paginación Infinita

**Problema**: Supabase devuelve máximo 1000 filas por query. La ferretería tiene 7000+ productos.

**Solución**: `useInfiniteQuery` de TanStack Query con páginas de 50 productos.

### `src/hooks/useProductos.ts` — cambios clave
- `useQuery` → `useInfiniteQuery`
- `PAGE_SIZE = 50`, usa `.range(offset, offset + PAGE_SIZE - 1)` en cada página
- Expone: `productos`, `isLoading`, `isFetchingMore`, `hasMore`, `fetchMore`

### `app/(tabs)/inventario.tsx` — cambios clave
- `onEndReached` en FlatList carga la siguiente página al llegar al 30% del final
- `ListFooterComponent` muestra spinner mientras carga más
- Contador de productos **eliminado** del header

---

## 5. Dashboard — Toggle de Período (Hoy / Semana / Mes)

**Problema**: Los stats mostraban solo datos del mes actual, sin posibilidad de ver hoy o la semana.

### Nueva vista SQL: `vw_profit_monthly`
```sql
CREATE OR REPLACE VIEW vw_profit_monthly AS
SELECT
  to_char(v.fecha_emision, 'YYYY-MM') AS mes,
  COUNT(DISTINCT v.id)                AS num_ventas,
  SUM(...)                            AS ingreso_bruto,
  SUM(...)                            AS costo_total,
  SUM(...)                            AS ganancia
FROM ventas v JOIN ventas_detalle vd ...
WHERE v.status = 1
  AND v.fecha_emision >= current_date - interval '12 months'
GROUP BY to_char(v.fecha_emision, 'YYYY-MM');
```
Devuelve 1 fila por mes — nunca toca el límite de 1000 filas.

### Vista actualizada: `vw_profit_summary`
Añadidos `ingreso_semana` (antes solo tenía `ganancia_semana` sin el ingreso bruto correspondiente):
```sql
-- Drop + recreate fue necesario por restricción de Postgres al renombrar columnas
DROP VIEW vw_profit_summary;
CREATE VIEW vw_profit_summary AS
SELECT ganancia_hoy, ingreso_hoy,
       ganancia_semana, ingreso_semana,   -- ← nuevo
       ganancia_mes, ingreso_mes
FROM ventas v JOIN ventas_detalle vd ...
WHERE v.status = 1;
```

### Nuevo hook: `useProfitMonthly` en `src/hooks/useProfitSummary.ts`
```ts
export interface ProfitMonthlyRow {
  mes: string; num_ventas: number;
  ingreso_bruto: number; costo_total: number; ganancia: number;
}
export function useProfitMonthly() { ... }  // queryKey: ['profit-monthly']
```

### `app/(tabs)/index.tsx` — rediseño del big card
- **Toggle Hoy / Semana / Mes** encima del big card (3 botones pill)
- Big card muestra ganancia + ingreso + facturas del período seleccionado
- Sparkline usa `daily7` (7 días) para Hoy/Semana, `monthly` (12 meses) para Mes
- KPI "Ingreso" cambia de label dinámicamente según período

---

## 6. Principio de Agregación en DB

> **Regla establecida**: nunca hacer queries a `ventas` o `ventas_detalle` directamente para agregados — siempre usar las vistas que agregan en Postgres.

| Vista | Filas devueltas | Uso |
|-------|----------------|-----|
| `vw_profit_summary` | 1 | KPIs del dashboard |
| `vw_profit_daily` | ≤ 90 | Sparkline diario, Top Hoy |
| `vw_profit_monthly` | ≤ 12 | Sparkline mensual |
| `vw_top_productos` | ≤ 20 | Top productos |
| `vw_alertas_stock` | variable | Alertas (ya filtrada) |
| `vw_ticket_promedio` | 1 | Ticket promedio del mes |

Esto garantiza que nunca se topa con el límite de 1000 filas de Supabase, independientemente de cuántas ventas haya.

---

## 7. Errores Resueltos

| Error | Causa | Fix |
|-------|-------|-----|
| `cannot change return type of existing function` | RPC ya existía con firma diferente | `DROP FUNCTION` antes de recrear |
| `cannot change name of view column` | `CREATE OR REPLACE VIEW` no puede renombrar columnas | `DROP VIEW` + `CREATE VIEW` |
| `column "ingreso" does not exist` | CTE alias no resuelto en versión de Postgres | Reescribir sin CTE, inline expressions |
| Supabase CLI sin auth en este entorno | Token no compartido entre sesiones | Usuario ejecutó comandos en su terminal |

---

## 8. Estado Actual de la App

### Funcional
- Login con Supabase Auth
- Dashboard con toggle Hoy/Semana/Mes
- Inventario con scroll infinito (7000+ productos)
- Alertas con botón "Analizar con IA"
- Detección automática cada 2h via pg_cron
- Reportes, Órdenes de cambio, PDFs
- Realtime sync badge

### Pendiente / Posibles mejoras
- Vista de detalle de producto podría mostrar historial de ventas del producto
- El botón "Analizar con IA" analiza 100 productos; con plan Gemini pagado se puede subir
- `margen_negativo` en inventario filtra client-side (no server-side) porque Supabase PostgREST no soporta `col > col`
