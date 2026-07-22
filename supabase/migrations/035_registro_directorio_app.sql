-- Migration 035: registro de clientes y proveedores desde la app → write-back a HybridLite
--
-- La app registra un CLIENTE o un PROVEEDOR (ficha nueva) y el backend lo da de alta en
-- HybridLite automatizando la UI (hybrid_writeback/flujo_cliente_real.py /
-- flujo_proveedor_real.py, a grabar frente a la PC como compras/pedidos). Hybrid autoasigna
-- el código (CLI_CODIGO / PRV_CODIGO); el backend lo verifica contra la DBISAM y lo devuelve
-- en codigo_*_hybrid, para que la app muestre "registrado" y el nuevo aparezca en el selector
-- tras el próximo sync-espejo de clientes/proveedores.
--
-- Como en compras_app/pedidos_app, el estado backend_* va en la CABECERA: un registro = UNA
-- ficha de Hybrid (un solo Guardar). Tablas de solo-cabecera, sin items.
--
-- Permisos (contrato con el usuario):
--   • Cliente   → CUALQUIER empleado activo (acción de primera línea, como pedidos_app).
--   • Proveedor → SOLO privilegiado (admin/superempleado), igual que Compras.
--
-- Contrato de datos para la fase backend: docs/REGISTRO-DIRECTORIO-PIPELINE.md

CREATE TABLE IF NOT EXISTS registro_clientes_app (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_por            uuid REFERENCES auth.users(id),
  nombre                text NOT NULL,
  rif                   text,                 -- RIF / cédula
  telefono              text,
  direccion             text,
  nota                  text,
  status                text DEFAULT 'emitido' CHECK (status IN ('borrador', 'emitido')),
  creado_en             timestamptz DEFAULT now(),
  -- pipeline write-back (mismo vocabulario que compras_app / pedidos_app)
  backend_status        text NOT NULL DEFAULT 'pendiente'
                          CHECK (backend_status IN ('pendiente', 'aplicando', 'error', 'completado')),
  backend_resultado     text,
  backend_intentos      int NOT NULL DEFAULT 0,
  backend_aplicado_en   timestamptz,
  -- código que Hybrid autoasigna (CLI_CODIGO); lo llena el backend al verificar contra la DBISAM
  codigo_cliente_hybrid text
);

CREATE TABLE IF NOT EXISTS registro_proveedores_app (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_por              uuid REFERENCES auth.users(id),
  nombre                  text NOT NULL,
  rif                     text,
  telefono                text,
  contacto                text,
  email                   text,
  nota                    text,
  status                  text DEFAULT 'emitido' CHECK (status IN ('borrador', 'emitido')),
  creado_en               timestamptz DEFAULT now(),
  backend_status          text NOT NULL DEFAULT 'pendiente'
                            CHECK (backend_status IN ('pendiente', 'aplicando', 'error', 'completado')),
  backend_resultado       text,
  backend_intentos        int NOT NULL DEFAULT 0,
  backend_aplicado_en     timestamptz,
  -- código que Hybrid autoasigna (PRV_CODIGO)
  codigo_proveedor_hybrid text
);

CREATE INDEX IF NOT EXISTS idx_registro_clientes_backend_status    ON registro_clientes_app (backend_status);
CREATE INDEX IF NOT EXISTS idx_registro_proveedores_backend_status ON registro_proveedores_app (backend_status);

ALTER TABLE registro_clientes_app    ENABLE ROW LEVEL SECURITY;
ALTER TABLE registro_proveedores_app ENABLE ROW LEVEL SECURITY;

-- Clientes: cualquier empleado activo lee todo y escribe lo suyo (patrón pedidos_app 034)
CREATE POLICY "Active employees - read all registro clientes" ON registro_clientes_app
  FOR SELECT TO authenticated USING (is_active_employee());
CREATE POLICY "Active employees - write own registro clientes" ON registro_clientes_app
  FOR ALL TO authenticated
  USING      (is_active_employee() AND creado_por = auth.uid() AND validate_session())
  WITH CHECK (is_active_employee() AND creado_por = auth.uid() AND validate_session());

-- Proveedores: lectura para empleados activos; ESCRITURA solo privilegiados (modelo Compras)
CREATE POLICY "Active employees - read all registro proveedores" ON registro_proveedores_app
  FOR SELECT TO authenticated USING (is_active_employee());
CREATE POLICY "Privileged - write own registro proveedores" ON registro_proveedores_app
  FOR ALL TO authenticated
  USING      (is_privileged() AND creado_por = auth.uid() AND validate_session())
  WITH CHECK (is_privileged() AND creado_por = auth.uid() AND validate_session());

-- el backend usa SUPABASE_SERVICE_KEY (bypassa RLS); realtime para chips en vivo
ALTER PUBLICATION supabase_realtime ADD TABLE public.registro_clientes_app;
ALTER PUBLICATION supabase_realtime ADD TABLE public.registro_proveedores_app;
