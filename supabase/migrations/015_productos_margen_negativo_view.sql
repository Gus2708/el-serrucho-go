-- Migration 015: products with negative margin (IVA-aware)
-- Moves the margen_negativo client-side filter into a dedicated server-side view
-- so infinite-scroll pagination works correctly against the full 7,200-product catalog.
--
-- Rule: precio_venta includes IVA 16%; costo is ex-IVA.
--       Negative margin = costo > precio_venta / 1.16 (with precio_venta > 0).

CREATE OR REPLACE VIEW public.productos_margen_negativo_view
WITH (security_invoker = true) AS
SELECT *
FROM public.productos_view
WHERE precio_venta > 0
  AND costo > precio_venta / 1.16;

GRANT SELECT ON public.productos_margen_negativo_view TO authenticated, anon;
