-- 024: perf — vw_profit_hourly/daily directas sobre tablas base.
-- (Aplicada en producción el 2026-07-12 como "profit_views_direct_perf".)
--
-- Problema: ambas vistas pasaban por vw_ventas_usd, que agrega TODO el
-- histórico (26k ventas × 56k renglones, con spill a disco) ANTES de que el
-- filtro de fecha del cliente pudiera aplicarse, y arrastra un LATERAL a
-- clientes sin índice (seq scan por fila). El sparkline del dashboard
-- (vw_profit_hourly) promediaba ~950ms por consulta en producción.
--
-- Fix: definirlas directo sobre ventas + ventas_detalle. Así el predicado
-- sobre la columna de agrupación (hora/dia) se empuja al scan de ventas y
-- solo se agregan las filas del período pedido. Medido: hourly 322ms → 18ms,
-- vw_dashboard_stats (construida sobre vw_profit_daily) 293ms → 30ms.
-- Resultados verificados idénticos (salvo redondeo de 0.0001 por orden de
-- casts a numeric(20,4)).

CREATE INDEX IF NOT EXISTS idx_clientes_rif ON public.clientes (rif);

CREATE OR REPLACE VIEW public.vw_profit_hourly WITH (security_invoker = true) AS
SELECT
  date_trunc('hour', v.created_at) AS hora,
  count(DISTINCT v.id) AS num_ventas,
  (sum(CASE WHEN vd.cantidad > 1000000 THEN 1.0 WHEN vd.cantidad <= 0 THEN 0.0 ELSE vd.cantidad END * COALESCE(vd.precio_venta, 0)))::numeric(20,4) AS ingreso_bruto,
  (sum(CASE WHEN vd.cantidad > 1000000 THEN 1.0 WHEN vd.cantidad <= 0 THEN 0.0 ELSE vd.cantidad END))::numeric(20,4) AS num_items,
  (sum(CASE WHEN vd.cantidad > 1000000 THEN 1.0 WHEN vd.cantidad <= 0 THEN 0.0 ELSE vd.cantidad END * (COALESCE(vd.precio_venta, 0) - COALESCE(p.costo, 0))))::numeric(20,4) AS ganancia
FROM ventas v
JOIN ventas_detalle vd ON vd.venta_id = v.id
LEFT JOIN productos p ON p.codigo_interno = vd.codigo_producto
WHERE v.status = 1
  AND EXISTS (
    SELECT 1 FROM ventas_detalle vd3
    WHERE vd3.venta_id = v.id
      AND NOT (vd3.codigo_producto = '01404' AND vd3.cantidad = 1)
  )
GROUP BY 1
ORDER BY 1;

CREATE OR REPLACE VIEW public.vw_profit_daily WITH (security_invoker = true) AS
SELECT
  v.fecha_emision AS dia,
  count(DISTINCT v.id) AS num_ventas,
  (sum(CASE WHEN vd.cantidad > 1000000 THEN 1.0 WHEN vd.cantidad <= 0 THEN 0.0 ELSE vd.cantidad END * COALESCE(vd.precio_venta, 0)))::numeric(20,4) AS ingreso_bruto,
  (sum(CASE WHEN vd.cantidad > 1000000 THEN 1.0 WHEN vd.cantidad <= 0 THEN 0.0 ELSE vd.cantidad END))::numeric(20,4) AS num_items,
  (sum(CASE WHEN vd.cantidad > 1000000 THEN 1.0 WHEN vd.cantidad <= 0 THEN 0.0 ELSE vd.cantidad END * (COALESCE(vd.precio_venta, 0) - COALESCE(p.costo, 0))))::numeric(20,4) AS ganancia
FROM ventas v
JOIN ventas_detalle vd ON vd.venta_id = v.id
LEFT JOIN productos p ON p.codigo_interno = vd.codigo_producto
WHERE v.status = 1
  AND EXISTS (
    SELECT 1 FROM ventas_detalle vd3
    WHERE vd3.venta_id = v.id
      AND NOT (vd3.codigo_producto = '01404' AND vd3.cantidad = 1)
  )
GROUP BY 1;
