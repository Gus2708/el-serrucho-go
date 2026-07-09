-- Migration 018: estado de aplicación en HybridLite para items de orden de cambio
--
-- El backend de la ferretería (backend serrucho / hybrid_writeback) sondea estas
-- columnas para aplicar el ajuste de stock directamente en HybridLite (con input
-- real de hardware, ver hybrid_writeback/README.md), en vez de que quede solo
-- como PDF para aplicar a mano. No reemplaza nada del flujo existente de la app
-- (ordenes_cambio.status / pdf_url siguen igual); son columnas nuevas, aparte.

ALTER TABLE ordenes_cambio_items
  ADD COLUMN IF NOT EXISTS backend_status text NOT NULL DEFAULT 'pendiente'
    CHECK (backend_status IN ('pendiente', 'aplicando', 'aplicado', 'error')),
  ADD COLUMN IF NOT EXISTS backend_resultado text,
  ADD COLUMN IF NOT EXISTS backend_intentos int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backend_aplicado_en timestamptz;

CREATE INDEX IF NOT EXISTS idx_ordenes_cambio_items_backend_status
  ON ordenes_cambio_items (backend_status);

-- El backend usa la SERVICE ROLE KEY (bypassa RLS) para leer/actualizar estas
-- filas entre usuarios; no se necesita política nueva para anon/authenticated.
