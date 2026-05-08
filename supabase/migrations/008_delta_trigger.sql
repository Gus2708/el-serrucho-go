-- Migration 008: trigger-based delta computation + storage bucket
-- Use this instead of GENERATED ALWAYS AS (Supabase MCP compatibility workaround)

-- ── Trigger: compute delta on insert/update ───────────────────────────────────

CREATE OR REPLACE FUNCTION fn_compute_orden_delta()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.delta := NEW.nueva_existencia - NEW.existencia_actual;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orden_delta ON ordenes_cambio_items;

CREATE TRIGGER trg_orden_delta
  BEFORE INSERT OR UPDATE ON ordenes_cambio_items
  FOR EACH ROW EXECUTE FUNCTION fn_compute_orden_delta();

-- ── Storage bucket for PDF change orders ─────────────────────────────────────
-- Run these separately if INSERT to storage.buckets fails (dashboard may be needed)

INSERT INTO storage.buckets (id, name, public)
VALUES ('change-orders', 'change-orders', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: authenticated users can upload to their own prefix
CREATE POLICY "auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'change-orders');

CREATE POLICY "auth_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'change-orders');
