-- Migration 038: soporte para editar DESCRIPCIÓN / REFERENCIA de un producto
-- existente vía la Orden de Cambio (write-back a la Ficha de HybridLite).
-- Mismo patrón que la migración 021 (precios): solo columnas objetivo nuevas.
-- `descripcion` (columna existente) es el snapshot/etiqueta del producto; estas
-- dos columnas son los VALORES NUEVOS a escribir (NULL = ese campo no cambia).
ALTER TABLE public.ordenes_cambio_items
  ADD COLUMN IF NOT EXISTS nueva_descripcion text,
  ADD COLUMN IF NOT EXISTS nueva_referencia  text;
