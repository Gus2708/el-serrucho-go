-- Migration 006: unique constraint on anomalias so the edge function
-- can upsert without creating duplicates per product+type.

ALTER TABLE anomalias
  ADD CONSTRAINT uq_anomalias_producto_tipo
  UNIQUE (codigo_producto, tipo);
