-- Migration 014 — Excluir ventas de cierre del producto 01404
-- ─────────────────────────────────────────────────────────────
-- Las ventas donde el ÚNICO item es 1 unidad del producto 01404
-- son ventas ficticias usadas para completar cierres de caja.
-- Se excluyen de todas las vistas de ventas y del dashboard.
--
-- Regla: una venta es "de cierre" si todos sus items (y al menos
-- uno) cumplen: codigo_producto = '01404' AND cantidad = 1.
-- Si la venta tiene otros productos además del 01404, no se excluye.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.vw_ventas_items_usd
WITH (security_invoker = true) AS
SELECT
  v.id                                                                    AS venta_id,
  v.fecha_emision,
  v.status,
  vd.codigo_producto,
  (CASE
    WHEN vd.cantidad > 1000000::numeric THEN 1.0
    WHEN vd.cantidad <= 0::numeric       THEN 0.0
    ELSE vd.cantidad
  END)::numeric(20,4)                                                     AS cantidad,
  (COALESCE(vd.precio_venta, 0::numeric))::numeric(20,4)                  AS precio_unitario_usd,
  (COALESCE(p.costo,         0::numeric))::numeric(20,4)                  AS costo_unitario_usd,
  ((CASE
    WHEN vd.cantidad > 1000000::numeric THEN 1.0
    WHEN vd.cantidad <= 0::numeric       THEN 0.0
    ELSE vd.cantidad
  END * COALESCE(vd.precio_venta, 0::numeric)))::numeric(20,4)            AS subtotal_usd,
  ((CASE
    WHEN vd.cantidad > 1000000::numeric THEN 1.0
    WHEN vd.cantidad <= 0::numeric       THEN 0.0
    ELSE vd.cantidad
  END * (COALESCE(vd.precio_venta, 0::numeric)
       - COALESCE(p.costo,         0::numeric))))::numeric(20,4)          AS ganancia_item_usd
FROM ventas v
JOIN ventas_detalle vd ON v.id = vd.venta_id
LEFT JOIN productos p  ON vd.codigo_producto = p.codigo_interno
WHERE v.status = 1
  -- Excluir ventas de cierre: todos sus items son 01404 × 1 unidad
  AND v.id NOT IN (
    SELECT vd2.venta_id
    FROM ventas_detalle vd2
    GROUP BY vd2.venta_id
    HAVING
      COUNT(*) > 0
      AND COUNT(*) = SUM(CASE WHEN vd2.codigo_producto = '01404' AND vd2.cantidad = 1 THEN 1 ELSE 0 END)
  );
