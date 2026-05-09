-- ════════════════════════════════════════════════════════════════════
-- Migration 009 — Post backend-fix: restore views to native form
-- ════════════════════════════════════════════════════════════════════
-- Contexto: el widget Python V2 introdujo regresiones que rompieron
-- la integridad de datos (ventas en VES, FK ventas_detalle.venta_id NULL,
-- productos.costo en 0). Mientras se arreglaba el backend, parchamos
-- las vistas en Supabase para que la app móvil mostrara valores
-- razonables.
--
-- El equipo de backend confirmó el fix el 2026-05-09 (ver
-- BACKEND_FIX_REQUEST.md y POST_BACKEND_FIX_CHECKLIST.md). Esta
-- migration revierte los parches: las vistas vuelven a su forma nativa
-- (sin división por tasa, JOIN por venta_id en vez de documento).
--
-- Las vistas vw_ventas_items_usd y vw_ventas_usd ya fueron restauradas
-- por el backend (probablemente en su pipeline de migraciones). Esta
-- migration solo actualiza vw_ventas_detalle_usd que faltaba.
-- ════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.vw_ventas_detalle_usd CASCADE;

CREATE VIEW public.vw_ventas_detalle_usd
WITH (security_invoker = true) AS
SELECT
  vd.id,
  vd.venta_id,
  vd.documento,
  vd.codigo_producto,
  vd.cantidad,
  COALESCE(p.descripcion, '[Producto sin nombre]') AS descripcion,
  COALESCE(vd.precio_venta, 0)::numeric(20,4) AS precio_unitario_usd,
  ((CASE
    WHEN vd.cantidad > 1000000::numeric THEN 1.0
    WHEN vd.cantidad <= 0::numeric THEN 0.0
    ELSE vd.cantidad
  END) * COALESCE(vd.precio_venta, 0))::numeric(20,4) AS subtotal_usd
FROM ventas_detalle vd
JOIN ventas v ON v.id = vd.venta_id AND v.status = 1
LEFT JOIN productos p ON vd.codigo_producto = p.codigo_interno;

COMMENT ON VIEW public.vw_ventas_detalle_usd IS
  'Detalle de venta en USD nativo. Restaurado a JOIN por venta_id tras el fix del widget V2.';
