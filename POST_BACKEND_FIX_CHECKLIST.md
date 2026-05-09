# ✅ Checklist Post-Fix de Backend

**Cuándo aplicar:** Después de que el equipo de backend confirme que terminaron los items de `BACKEND_FIX_REQUEST.md`.

**Por qué hace falta:** Mientras el bug del widget Python estaba activo, parchamos las vistas de Supabase para que la app no mostrara basura. Esos parches dividen valores por la tasa BCV. **Si el backend ahora envía datos correctos en USD nativo y dejamos los parches, los valores se dividirán dos veces → mostraremos cifras 500× más pequeñas que la realidad.**

Por eso este cleanup es OBLIGATORIO una vez el backend termine.

---

## Paso 0 — Pre-validación: ¿el backend realmente terminó?

Antes de tocar nada, ejecuta estas queries en el SQL Editor de Supabase. **Solo continúa con el cleanup si los 5 chequeos pasan.**

### 0.1 Productos con costos reales (bug #1)

```sql
SELECT
  COUNT(*) FILTER (WHERE costo > 0)            AS con_costo,
  COUNT(*) FILTER (WHERE precio_venta > 0)     AS con_precio,
  ROUND(AVG(costo) FILTER (WHERE costo > 0), 2) AS costo_avg
FROM productos;
```
**Resultado esperado:**
- `con_costo` ≥ 5,000 (de 7,212)
- `con_precio` ≥ 5,000
- `costo_avg` típicamente entre $2 - $50

❌ Si `con_costo = 0` → el backend NO ha terminado. **Detente aquí.**

### 0.2 Ventas en USD nativo (bug #2)

```sql
-- Tickets razonables (USD reales, no VES)
SELECT
  ROUND(AVG(total_neto), 2) AS ticket_promedio_usd,
  ROUND(MAX(total_neto), 2) AS factura_max_usd,
  COUNT(*) FILTER (WHERE total_neto > 5000) AS facturas_sospechosas
FROM ventas
WHERE status = 1
  AND fecha_emision >= current_date - 30
  AND id_unico IS NOT NULL;
```
**Resultado esperado:**
- `ticket_promedio_usd` entre $30 - $100
- `factura_max_usd` < $5,000
- `facturas_sospechosas` ≤ 5

❌ Si `ticket_promedio_usd > $1000` → backend NO arregló las ventas. **Detente.**

### 0.3 `total_bruto` poblado (bug #3)

```sql
SELECT
  COUNT(*) FILTER (WHERE total_bruto = 0 OR total_bruto IS NULL) AS sin_bruto,
  COUNT(*) AS total
FROM ventas
WHERE status = 1 AND id_unico IS NOT NULL;
```
**Resultado esperado:** `sin_bruto` ≈ 0 (puede haber unas pocas con $0 legítimos)

### 0.4 FK `vd.venta_id` poblada (bug #4)

```sql
SELECT
  COUNT(*) FILTER (WHERE venta_id IS NULL)     AS sin_fk,
  COUNT(*) FILTER (WHERE venta_id IS NOT NULL) AS con_fk
FROM ventas_detalle;
```
**Resultado esperado:** `sin_fk` ≤ 100 (huérfanos legítimos), `con_fk` ≥ 52,000

### 0.5 Sin duplicados de `id_unico` (bug #5)

```sql
SELECT id_unico, COUNT(*) AS dup_count
FROM ventas
WHERE id_unico IS NOT NULL
GROUP BY id_unico
HAVING COUNT(*) > 1;
```
**Resultado esperado:** **0 filas** devueltas.

---

## Paso 1 — Backup defensivo de las vistas actuales

Por si algo sale mal y necesitas volver al parche:

```sql
-- Captura el SQL actual de las vistas parchadas (cópialo a un archivo
-- de respaldo en supabase/migrations/backup_views_pre_cleanup.sql)
SELECT
  '-- vw_ventas_items_usd' AS sep,
  pg_get_viewdef('public.vw_ventas_items_usd'::regclass, true) AS def
UNION ALL
SELECT
  '-- vw_ventas_usd',
  pg_get_viewdef('public.vw_ventas_usd'::regclass, true);
```

Guarda la salida en `supabase/migrations/backup_views_pre_cleanup.sql` antes del paso 2.

---

## Paso 2 — Restaurar `vw_ventas_items_usd` a la versión nativa

Quita las divisiones por tasa BCV y vuelve al JOIN clásico por `venta_id`.

```sql
-- Restaura la vista a su estado original.
-- - JOIN por venta_id (FK ahora poblada por backend)
-- - Sin división por tasa (el widget ahora sube USD nativo)
CREATE OR REPLACE VIEW public.vw_ventas_items_usd AS
SELECT v.id AS venta_id,
  v.fecha_emision,
  v.status,
  vd.codigo_producto,
  CASE
    WHEN vd.cantidad > 1000000::numeric THEN 1.0
    WHEN vd.cantidad <= 0::numeric THEN 0.0
    ELSE vd.cantidad
  END::numeric(20,4) AS cantidad,
  COALESCE(vd.precio_venta, 0::numeric)::numeric(20,4) AS precio_unitario_usd,
  COALESCE(p.costo, 0::numeric)::numeric(20,4) AS costo_unitario_usd,
  (CASE
    WHEN vd.cantidad > 1000000::numeric THEN 1.0
    WHEN vd.cantidad <= 0::numeric THEN 0.0
    ELSE vd.cantidad
  END * COALESCE(vd.precio_venta, 0::numeric))::numeric(20,4) AS subtotal_usd,
  (CASE
    WHEN vd.cantidad > 1000000::numeric THEN 1.0
    WHEN vd.cantidad <= 0::numeric THEN 0.0
    ELSE vd.cantidad
  END * (COALESCE(vd.precio_venta, 0::numeric) - COALESCE(p.costo, 0::numeric)))::numeric(20,4) AS ganancia_item_usd
FROM ventas v
JOIN ventas_detalle vd ON v.id = vd.venta_id
LEFT JOIN productos p ON vd.codigo_producto = p.codigo_interno
WHERE v.status = 1;
```

---

## Paso 3 — Restaurar `vw_ventas_usd` a la versión nativa

```sql
CREATE OR REPLACE VIEW public.vw_ventas_usd AS
SELECT agg.venta_id,
  agg.fecha_emision,
  agg.status,
  agg.total_usd,
  agg.ganancia_total_usd,
  agg.items_count,
  v.documento,
  v.created_at,
  v.rif_cliente,
  v.total_neto AS original_total_neto_ves,
  v.total_impuesto AS original_total_impuesto_ves,
  COALESCE(v.total_neto, 0::numeric)::numeric(20,4) AS total_neto_usd,
  COALESCE(v.total_bruto, 0::numeric)::numeric(20,4) AS total_bruto_usd,
  COALESCE(v.total_impuesto, 0::numeric)::numeric(20,4) AS total_impuesto_usd,
  COALESCE(c.nombre, 'Cliente Genérico'::text) AS nombre_cliente,
  v.metodo_pago,
  v.id_unico
FROM (
  SELECT vw_ventas_items_usd.venta_id,
    vw_ventas_items_usd.fecha_emision,
    vw_ventas_items_usd.status,
    sum(vw_ventas_items_usd.subtotal_usd)::numeric(20,4) AS total_usd,
    sum(vw_ventas_items_usd.ganancia_item_usd)::numeric(20,4) AS ganancia_total_usd,
    sum(vw_ventas_items_usd.cantidad)::numeric(20,4) AS items_count
  FROM vw_ventas_items_usd
  GROUP BY vw_ventas_items_usd.venta_id, vw_ventas_items_usd.fecha_emision, vw_ventas_items_usd.status
) agg
JOIN ventas v ON v.id = agg.venta_id
LEFT JOIN LATERAL (
  SELECT clientes.nombre FROM clientes
  WHERE clientes.rif = v.rif_cliente
  LIMIT 1
) c ON true;
```

---

## Paso 4 — Validar que las vistas dan datos correctos

```sql
-- A) Tickets en USD razonables
SELECT
  ROUND(AVG(total_neto_usd), 2) AS ticket_promedio,
  ROUND(MIN(total_neto_usd) FILTER (WHERE total_neto_usd > 0), 2) AS min_ticket,
  ROUND(MAX(total_neto_usd), 2) AS max_ticket,
  COUNT(*) AS total_facturas
FROM vw_ventas_usd
WHERE fecha_emision >= current_date - 30;
```
**Esperado:** ticket promedio $30 - $100, max < $5,000, min > $0.50

```sql
-- B) Ganancia ≠ Ingreso (porque ahora hay costos reales)
SELECT
  ROUND(SUM(ganancia_total_usd), 2) AS ganancia_total,
  ROUND(SUM(total_usd), 2)          AS ingreso_total,
  ROUND(SUM(ganancia_total_usd) / NULLIF(SUM(total_usd), 0) * 100, 1) AS margen_pct
FROM vw_ventas_usd
WHERE fecha_emision >= current_date - 30;
```
**Esperado:**
- `ganancia_total` < `ingreso_total` (estrictamente menor)
- `margen_pct` típicamente 15-40% para una ferretería

❌ Si `ganancia_total == ingreso_total` → costos siguen en cero. Re-revisa Paso 0.1

```sql
-- C) Distribución por hora coherente (con created_at real)
SELECT
  EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Caracas')::int AS hora,
  COUNT(*) AS num_ventas
FROM vw_ventas_usd
WHERE fecha_emision >= current_date - 7
GROUP BY 1 ORDER BY 1;
```
**Esperado:** pico 8AM-12PM, dip 1PM, pico 3-6PM, casi nada después de 7PM.

```sql
-- D) Dashboard stats
SELECT * FROM vw_dashboard_stats;
```
**Esperado:** todos los valores en USD razonables, ganancia < ingreso en cada período.

---

## Paso 5 — Test visual en la app

Recarga Metro (`r` en la terminal de `npx expo start`) y verifica cada pantalla:

### Dashboard (Inicio)
- [ ] Banner amarillo "Costos sin sincronizar" **DESAPARECIÓ** (la detección automática lo oculta cuando ganancia ≠ ingreso)
- [ ] Big card muestra "Ganancia últimos 30 días" (no "Ingreso")
- [ ] Sparkline tiene curva variable (no flat)
- [ ] Las 4 KPI cards muestran números coherentes:
  - Ventas mes: ~1000-2000
  - Ticket promedio: $30-$100
  - Unidades del mes: ~5000-15000
  - Ingreso mes: ~$30K-$150K
- [ ] "Tendencia de Ganancia" y "Tendencia de Ingreso" son **distintas** (no idénticas)

### Ventas
- [ ] Tickets individuales son razonables ($1-$200 normalmente)
- [ ] Modal de detalle muestra desglose correcto:
  - `Subtotal Base + IVA(16%) = TOTAL`
  - Método de pago con chip correcto
  - Items individuales con precios coherentes

### Inventario
- [ ] Productos muestran precios reales (no $0.00)
- [ ] Existencias > 0 en productos típicos
- [ ] Filtro "Margen negativo" funciona y devuelve casos reales (si hay)
- [ ] Búsqueda por código y descripción funciona

### Alertas
- [ ] `vw_alertas_stock` carga alertas reales:
  - "Sin stock" en productos con existencia = 0
  - "Margen negativo" donde `costo > precio_venta / 1.16`
  - "Stock muerto" en productos sin ventas en 90 días

### Reportes (admin)
- [ ] Bar chart muestra ganancias reales (no idénticas al ingreso)
- [ ] Top 20 productos en el rango razonable
- [ ] Donut de velocidad muestra rapido/lento/sin movimiento con conteos coherentes

---

## Paso 6 — Cleanup de código de la app

El banner de "costos pendientes" en `app/(tabs)/index.tsx` está **autodescubrible**: cuando `ganancia ≠ ingreso`, deja de mostrarse automáticamente. **No hay código que removerse manualmente** — la app reanuda comportamiento normal por sí sola.

Si quieres remover la lógica defensiva por completo (porque ya no esperas más bugs de costos), puedes simplificar:

```diff
// app/(tabs)/index.tsx

- const costosPendientes =
-   stats.ingreso > 0 && Math.abs(stats.ganancia - stats.ingreso) < 0.01;

  // Big card:
- <Text style={[styles.bigLabel, ...]}>
-   {costosPendientes ? stats.label.replace('Ganancia', 'Ingreso') : stats.label}
- </Text>
+ <Text style={[styles.bigLabel, ...]}>{stats.label}</Text>

- {!loadingSum && costosPendientes && (
-   <View style={styles.warnBanner}>
-     ⚠️ Costos sin sincronizar...
-   </View>
- )}
```

**Recomendación:** déjalo. El cost de mantenerlo es 0 y si en algún momento el bug regresa (algún sync futuro mal hecho), te avisa automáticamente.

---

## Paso 7 — Versionar todo en migrations

Para que cualquier ambiente nuevo (otro Supabase, staging) tenga el estado correcto:

```bash
# Crea la migration con las vistas restauradas
supabase migration new restore_views_post_backend_fix

# Pega los CREATE OR REPLACE VIEW de los pasos 2 y 3 dentro del archivo nuevo
# Luego aplica:
supabase db push
```

---

## Paso 8 — TypeScript + tests + build de smoke

```bash
cd "G:\Projects\el-serrucho-go"
npx tsc --noEmit                # debe pasar 0 errores
npx expo-doctor                  # debe pasar 17/17

# Build de smoke con preview
npx eas build --profile preview --platform android
```

---

## Paso 9 — Documentación

Actualiza `CLAUDE.md` para que el contexto refleje el estado limpio:

- [ ] Borra cualquier `TODO` referente a "parche temporal" en SQL views
- [ ] Borra `BACKEND_FIX_REQUEST.md` y este archivo (`POST_BACKEND_FIX_CHECKLIST.md`) **o** muévelos a `docs/historic/` como evidencia histórica del incidente
- [ ] Confirma que la sección "Sync Architecture" sigue describiendo correctamente el flujo

---

## Paso 10 — Commit + PR

```bash
git checkout -b chore/cleanup-post-backend-fix
git add -A
git commit -m "chore: revert temporary VES→USD view patches after backend fix"
git push -u origin chore/cleanup-post-backend-fix
gh pr create --title "chore: cleanup post-backend-fix" \
  --body "Revert SQL view patches in vw_ventas_items_usd / vw_ventas_usd. Backend confirmed fixed per BACKEND_FIX_REQUEST.md."
```

---

## 🚨 Plan B: si después del cleanup algo se ve mal

```sql
-- Restaura las vistas con el parche temporal usando el backup del Paso 1
\i supabase/migrations/backup_views_pre_cleanup.sql
```

Y avisa de inmediato al equipo de backend que el fix no está completo.

---

## TL;DR — orden mínimo de operaciones

1. Validar que backend terminó (Paso 0, los 5 checks)
2. Backup de vistas (Paso 1)
3. Ejecutar SQL de Paso 2 + 3 (restaurar las 2 vistas)
4. Validar resultados (Paso 4)
5. Recargar app y verificar visualmente (Paso 5)
6. Versionar en `supabase/migrations/` (Paso 7)
7. Commit + PR (Paso 10)

Tiempo estimado: **15-30 minutos** asumiendo backend ya validado.
