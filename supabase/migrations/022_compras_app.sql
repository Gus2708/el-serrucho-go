-- Migration 022: compras desde la app (Lista de Compras) → write-back a HybridLite
--
-- La app emite una compra (proveedor + items con cantidad/costo/precio) y el
-- backend la registra en HybridLite como "Compra de mercancías" con clase 5
-- (NOTAS DE ENTREGA), automatizando la UI (flujo_compra_real.py, grabación
-- FLUJO-COMPRA-CAPTURADO.log 2026-07-11).
--
-- A diferencia de ordenes_cambio (estado por item), acá el estado backend_* va
-- en la CABECERA: una compra = UN documento de Hybrid (un solo Totalizar).

CREATE TABLE IF NOT EXISTS compras_app (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_por          uuid REFERENCES auth.users(id),
  proveedor_codigo    text NOT NULL,
  proveedor_nombre    text,
  nota                text,
  status              text DEFAULT 'borrador' CHECK (status IN ('borrador', 'emitido')),
  creado_en           timestamptz DEFAULT now(),
  -- pipeline write-back (mismo vocabulario que ordenes_cambio_items)
  backend_status      text NOT NULL DEFAULT 'pendiente'
                        CHECK (backend_status IN ('pendiente', 'aplicando', 'error', 'completado')),
  backend_resultado   text,
  backend_intentos    int NOT NULL DEFAULT 0,
  backend_aplicado_en timestamptz
);

CREATE TABLE IF NOT EXISTS compras_app_items (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compra_id       bigint NOT NULL REFERENCES compras_app(id) ON DELETE CASCADE,
  codigo_producto text NOT NULL,
  descripcion     text,
  cantidad        numeric NOT NULL CHECK (cantidad > 0),
  costo           numeric NOT NULL CHECK (costo >= 0),   -- USD sin IVA (columna Costo, con '$')
  precio          numeric NOT NULL CHECK (precio >= 0),  -- USD con IVA (diálogo Costos y Precios)
  creado_en       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compras_app_backend_status ON compras_app (backend_status);
CREATE INDEX IF NOT EXISTS idx_compras_app_items_compra ON compras_app_items (compra_id);

ALTER TABLE compras_app       ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras_app_items ENABLE ROW LEVEL SECURITY;

-- mismo patrón vivo de ordenes_cambio: empleados activos leen todo, escriben lo suyo
CREATE POLICY "Active employees - read all compras" ON compras_app
  FOR SELECT TO authenticated USING (is_active_employee());
CREATE POLICY "Active employees - write own compras" ON compras_app
  FOR ALL TO authenticated
  USING (is_active_employee() AND creado_por = auth.uid() AND validate_session());

CREATE POLICY "Active employees - read all compra items" ON compras_app_items
  FOR SELECT TO authenticated USING (is_active_employee());
CREATE POLICY "Active employees - write own compra items" ON compras_app_items
  FOR ALL TO authenticated
  USING (is_active_employee() AND compra_id IN (
    SELECT id FROM compras_app WHERE creado_por = auth.uid()
  ) AND validate_session());

-- el backend usa SUPABASE_SERVICE_KEY (bypassa RLS); realtime para chips en vivo
ALTER PUBLICATION supabase_realtime ADD TABLE public.compras_app;
