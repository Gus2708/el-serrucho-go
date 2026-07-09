-- Migration 021: soporte para cambios de precios en items de ordenes de cambio

-- 1. Permitir que nueva_existencia sea NULL (para items que solo cambian de precio)
ALTER TABLE public.ordenes_cambio_items 
  ALTER COLUMN nueva_existencia DROP NOT NULL;

-- 2. Agregar columnas precio_actual y nuevo_precio
ALTER TABLE public.ordenes_cambio_items
  ADD COLUMN IF NOT EXISTS precio_actual numeric,
  ADD COLUMN IF NOT EXISTS nuevo_precio numeric;
