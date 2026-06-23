-- Migration 016: Optimize performance of security functions and sales items view
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Mark security RLS functions as STABLE so they are evaluated once per query
--    instead of once per row scanned (which was causing timeouts on 57k+ rows).
-- 2. Optimize vw_ventas_items_usd to use EXISTS instead of a heavy NOT IN.
-- ─────────────────────────────────────────────────────────────────────────────

-- Optimize RLS security functions stability
ALTER FUNCTION public.is_active_employee() STABLE;
ALTER FUNCTION public.is_admin() STABLE;
ALTER FUNCTION public.validate_session() STABLE;

-- Optimize vw_ventas_items_usd view query using EXISTS
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
  -- Excluir ventas de cierre: una venta no es de cierre si tiene al menos un
  -- ítem que NO sea el producto '01404' con cantidad 1.
  AND EXISTS (
    SELECT 1
    FROM ventas_detalle vd3
    WHERE vd3.venta_id = v.id
      AND NOT (vd3.codigo_producto = '01404' AND vd3.cantidad = 1)
  );
