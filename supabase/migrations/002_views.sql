-- Migration 002: views
-- Requires: 001_helper_fn.sql

-- Profit by day (last 90 days, status=1 = valid invoices only)
CREATE OR REPLACE VIEW vw_profit_daily AS
SELECT
  v.fecha_emision                                              AS dia,
  COUNT(DISTINCT v.id)                                         AS num_ventas,
  SUM(vd.cantidad * vd.precio_venta)                           AS ingreso_bruto,
  SUM(vd.cantidad * safe_numeric(vd.costo_str))                AS costo_total,
  SUM(vd.cantidad * vd.precio_venta)
    - SUM(vd.cantidad * safe_numeric(vd.costo_str))            AS ganancia
FROM ventas v
JOIN ventas_detalle vd ON vd.venta_id = v.id
WHERE v.status = 1
  AND v.fecha_emision >= current_date - interval '90 days'
GROUP BY v.fecha_emision
ORDER BY dia DESC;

-- Summary KPI cards (today / this week / this month)
CREATE OR REPLACE VIEW vw_profit_summary AS
WITH base AS (
  SELECT
    v.fecha_emision,
    vd.cantidad * vd.precio_venta                              AS ingreso,
    vd.cantidad * safe_numeric(vd.costo_str)                   AS costo
  FROM ventas v
  JOIN ventas_detalle vd ON vd.venta_id = v.id
  WHERE v.status = 1
)
SELECT
  COALESCE(SUM(ingreso - costo) FILTER (WHERE fecha_emision = current_date), 0)
    AS ganancia_hoy,
  COALESCE(SUM(ingreso) FILTER (WHERE fecha_emision = current_date), 0)
    AS ingreso_hoy,
  COALESCE(SUM(ingreso - costo) FILTER (WHERE fecha_emision >= date_trunc('week', current_date)), 0)
    AS ganancia_semana,
  COALESCE(SUM(ingreso - costo) FILTER (WHERE fecha_emision >= date_trunc('month', current_date)), 0)
    AS ganancia_mes,
  COALESCE(SUM(ingreso) FILTER (WHERE fecha_emision >= date_trunc('month', current_date)), 0)
    AS ingreso_mes
FROM base;

-- Top 20 products by revenue (rolling 30 days)
CREATE OR REPLACE VIEW vw_top_productos AS
SELECT
  vd.codigo_producto,
  COALESCE(p.descripcion, '[Producto eliminado]')              AS descripcion,
  SUM(vd.cantidad)                                             AS unidades_vendidas,
  SUM(vd.cantidad * vd.precio_venta)                           AS ingreso,
  SUM(vd.cantidad * vd.precio_venta
    - vd.cantidad * safe_numeric(vd.costo_str))                AS ganancia
FROM ventas_detalle vd
JOIN ventas v         ON v.id = vd.venta_id AND v.status = 1
LEFT JOIN productos p ON p.codigo_interno = vd.codigo_producto
WHERE v.fecha_emision >= current_date - interval '30 days'
GROUP BY vd.codigo_producto, p.descripcion
ORDER BY ingreso DESC
LIMIT 20;

-- Fast / slow / dead movers (donut chart)
CREATE OR REPLACE VIEW vw_velocidad_productos AS
SELECT
  p.codigo_interno,
  p.descripcion,
  p.existencia,
  COALESCE(SUM(vd.cantidad), 0)                                AS vendido_30d,
  CASE
    WHEN COALESCE(SUM(vd.cantidad), 0) > 10 THEN 'rapido'
    WHEN COALESCE(SUM(vd.cantidad), 0) > 0  THEN 'lento'
    ELSE 'sin_movimiento'
  END                                                          AS velocidad
FROM productos p
LEFT JOIN ventas_detalle vd ON vd.codigo_producto = p.codigo_interno
LEFT JOIN ventas v ON v.id = vd.venta_id
  AND v.status = 1
  AND v.fecha_emision >= current_date - interval '30 days'
GROUP BY p.codigo_interno, p.descripcion, p.existencia;

-- Stock alerts (deterministic — no AI needed)
CREATE OR REPLACE VIEW vw_alertas_stock AS
SELECT
  p.codigo_interno,
  p.descripcion,
  p.existencia,
  p.costo,
  p.precio_venta,
  CASE
    WHEN p.existencia <= 0          THEN 'sin_stock'
    WHEN p.costo > p.precio_venta   THEN 'margen_negativo'
    ELSE                                 'stock_muerto'
  END AS tipo_alerta
FROM productos p
WHERE
  p.existencia <= 0
  OR p.costo > p.precio_venta
  OR (
    p.existencia > 0
    AND NOT EXISTS (
      SELECT 1
      FROM ventas_detalle vd2
      JOIN ventas v2 ON v2.id = vd2.venta_id AND v2.status = 1
      WHERE vd2.codigo_producto = p.codigo_interno
        AND v2.fecha_emision >= current_date - interval '90 days'
    )
  );

-- Average ticket current month
CREATE OR REPLACE VIEW vw_ticket_promedio AS
SELECT
  ROUND(AVG(v.total_neto), 2) AS ticket_promedio,
  COUNT(v.id)                  AS ventas_mes
FROM ventas v
WHERE v.status = 1
  AND v.fecha_emision >= date_trunc('month', current_date);
