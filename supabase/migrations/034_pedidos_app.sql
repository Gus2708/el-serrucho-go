-- Migration 034: pedidos desde la app → write-back a HybridLite (documento Tipo 10)
--
-- La app emite un PEDIDO (cliente + items con cantidad) y el backend lo registra
-- en HybridLite como "Pédidos de clientes" (documento Tipo 10 / Status 4),
-- automatizando la UI (hybrid_writeback/flujo_pedido_real.py, grabación
-- grabar_flujo_20260721_144806.log). Caja lo factura enlazando por DOCUMENTOORIGEN.
--
-- Como en compras_app, el estado backend_* va en la CABECERA: un pedido = UN
-- documento de Hybrid (un solo Totalizar). A diferencia de compras, los items NO
-- llevan costo ni precio: el pedido usa el PRECIO MAESTRO del producto en Hybrid.
--
-- Permisos: un pedido es una acción de venta de primera línea (el vendedor lo
-- arma, caja lo factura) y NO mueve el kardex (el stock baja al facturar). Por eso
-- CUALQUIER empleado activo puede crearlo — patrón de la 022 original, sin el gate
-- de is_privileged() que sí tienen las compras, ni aprobación como los ajustes.

CREATE TABLE IF NOT EXISTS pedidos_app (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_por          uuid REFERENCES auth.users(id),
  cliente_codigo      text NOT NULL,
  cliente_nombre      text,
  nota                text,
  status              text DEFAULT 'borrador' CHECK (status IN ('borrador', 'emitido')),
  creado_en           timestamptz DEFAULT now(),
  -- pipeline write-back (mismo vocabulario que compras_app / ordenes_cambio_items)
  backend_status      text NOT NULL DEFAULT 'pendiente'
                        CHECK (backend_status IN ('pendiente', 'aplicando', 'error', 'completado')),
  backend_resultado   text,
  backend_intentos    int NOT NULL DEFAULT 0,
  backend_aplicado_en timestamptz,
  -- número de pedido Tipo 10 que Hybrid autoasigna (ej '00004692'); lo llena el
  -- backend al verificar contra la DBISAM, para que la app muestre "listo en caja".
  documento_hybrid    text
);

CREATE TABLE IF NOT EXISTS pedidos_app_items (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_id       bigint NOT NULL REFERENCES pedidos_app(id) ON DELETE CASCADE,
  codigo_producto text NOT NULL,
  descripcion     text,
  cantidad        numeric NOT NULL CHECK (cantidad > 0),
  creado_en       timestamptz DEFAULT now()
  -- SIN costo/precio: el pedido usa el precio maestro del producto en Hybrid.
);

CREATE INDEX IF NOT EXISTS idx_pedidos_app_backend_status ON pedidos_app (backend_status);
CREATE INDEX IF NOT EXISTS idx_pedidos_app_items_pedido   ON pedidos_app_items (pedido_id);

ALTER TABLE pedidos_app       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_app_items ENABLE ROW LEVEL SECURITY;

-- empleados activos leen todo, escriben lo suyo (patrón 022 original de compras,
-- antes de que 026 la restringiera a privilegiados; un pedido es venta de primera
-- línea, no compra ni ajuste de inventario).
CREATE POLICY "Active employees - read all pedidos" ON pedidos_app
  FOR SELECT TO authenticated USING (is_active_employee());
CREATE POLICY "Active employees - write own pedidos" ON pedidos_app
  FOR ALL TO authenticated
  USING      (is_active_employee() AND creado_por = auth.uid() AND validate_session())
  WITH CHECK (is_active_employee() AND creado_por = auth.uid() AND validate_session());

CREATE POLICY "Active employees - read all pedido items" ON pedidos_app_items
  FOR SELECT TO authenticated USING (is_active_employee());
CREATE POLICY "Active employees - write own pedido items" ON pedidos_app_items
  FOR ALL TO authenticated
  USING (is_active_employee() AND pedido_id IN (
    SELECT id FROM pedidos_app WHERE creado_por = auth.uid()
  ) AND validate_session())
  WITH CHECK (is_active_employee() AND pedido_id IN (
    SELECT id FROM pedidos_app WHERE creado_por = auth.uid()
  ) AND validate_session());

-- el backend usa SUPABASE_SERVICE_KEY (bypassa RLS); realtime para chips en vivo
ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos_app;
