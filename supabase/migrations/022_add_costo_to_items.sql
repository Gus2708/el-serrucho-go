-- Migration 022: add costo column to ordenes_cambio_items
--
-- Adds support for tracking product cost at the moment of adjustment

ALTER TABLE ordenes_cambio_items
  ADD COLUMN IF NOT EXISTS costo numeric;
