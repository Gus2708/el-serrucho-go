-- Migration 052: soporte de modo ajuste ("5...") en items de compra
--
-- Cuando el usuario escribe "..." al final de la cantidad de un ítem de compra (ej. "5..."),
-- indica que la existencia final del producto debe ajustarse a esa cifra (5)
-- mediante Ajustes de Inventario en el write-back del backend, en lugar de
-- sumarse al stock actual en la pantalla de Compras de HybridLite.

ALTER TABLE public.compras_app_items
  ADD COLUMN IF NOT EXISTS es_ajuste boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.compras_app_items.es_ajuste IS
  'true cuando el usuario ingresó la cantidad con "..." al final (ej. 5...): el backend debe ajustar la existencia en HybridLite a esta cifra vía Ajustes de Inventario en vez de sumarla al stock previo.';
