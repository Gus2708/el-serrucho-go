-- Migration 004: Row Level Security

-- Enable RLS on all tables
ALTER TABLE productos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas_detalle       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tazas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomalias            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_cambio       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_cambio_items ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read inventory & sales data (read-only tables)
CREATE POLICY "auth_read" ON productos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read" ON ventas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read" ON ventas_detalle
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read" ON clientes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read" ON tazas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read" ON anomalias
  FOR SELECT TO authenticated USING (true);

-- Edge Function can write anomalias (uses service_role, bypasses RLS)

-- Change orders: each user manages only their own
CREATE POLICY "owner_all" ON ordenes_cambio
  FOR ALL TO authenticated
  USING      (creado_por = auth.uid())
  WITH CHECK (creado_por = auth.uid());

CREATE POLICY "owner_items" ON ordenes_cambio_items
  FOR ALL TO authenticated
  USING (
    orden_id IN (
      SELECT id FROM ordenes_cambio WHERE creado_por = auth.uid()
    )
  );
