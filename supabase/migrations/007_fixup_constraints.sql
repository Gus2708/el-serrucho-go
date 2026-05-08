-- Migration 007: fix missing constraints, defaults, and generated column
-- Run in Supabase SQL Editor

-- ── ordenes_cambio_items: recreate delta as GENERATED column ─────────────────
-- The original migration created it as a plain nullable column.
-- Drop and re-add it as a computed column.

ALTER TABLE ordenes_cambio_items DROP COLUMN IF EXISTS delta;

ALTER TABLE ordenes_cambio_items
  ADD COLUMN delta numeric GENERATED ALWAYS AS (nueva_existencia - existencia_actual) STORED;

-- ── ordenes_cambio: add missing defaults and CHECK ───────────────────────────

ALTER TABLE ordenes_cambio
  ALTER COLUMN status    SET DEFAULT 'borrador',
  ALTER COLUMN creado_en SET DEFAULT now();

ALTER TABLE ordenes_cambio
  ADD CONSTRAINT chk_ordenes_status
  CHECK (status IN ('borrador', 'emitido'));

-- ── anomalias: add missing defaults, CHECK, and unique constraint ─────────────

ALTER TABLE anomalias
  ALTER COLUMN detectado_en SET DEFAULT now(),
  ALTER COLUMN resuelto     SET DEFAULT false;

ALTER TABLE anomalias
  ADD CONSTRAINT chk_anomalias_severidad
  CHECK (severidad IN ('alta', 'media', 'baja'));

-- Required for the edge function UPSERT ON CONFLICT (codigo_producto, tipo)
ALTER TABLE anomalias
  ADD CONSTRAINT uq_anomalias_producto_tipo
  UNIQUE (codigo_producto, tipo);

-- ── ordenes_cambio_items: make orden_id NOT NULL (safe if no orphan rows) ────
-- Only run this if you have no NULL orden_id rows.
-- ALTER TABLE ordenes_cambio_items ALTER COLUMN orden_id SET NOT NULL;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- After running, confirm with:
-- SELECT column_name, column_default, is_nullable, generation_expression
-- FROM information_schema.columns
-- WHERE table_name IN ('ordenes_cambio_items','ordenes_cambio','anomalias')
-- ORDER BY table_name, ordinal_position;
