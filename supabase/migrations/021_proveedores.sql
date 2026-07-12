-- Migration 021: tabla proveedores (espejo de TProveedores.Dat de HybridLite)
--
-- El backend (sync_proveedores.py) hace upsert completo de los ~34 proveedores
-- en cada corrida (tabla chica, sin cache de hashes). La app la consume para el
-- selector de proveedor de la Lista de Compras.

CREATE TABLE IF NOT EXISTS proveedores (
  codigo         text PRIMARY KEY,          -- PRV_CODIGO
  nombre         text NOT NULL,             -- PRV_DESCRIPCION
  rif            text,                      -- PRV_RIF
  telefono       text,                      -- PRV_TELEFONO
  contacto       text,                      -- PRV_CONTACTO
  email          text,                      -- PRV_EMAIL
  status         boolean DEFAULT true,      -- PRV_STATUS
  actualizado_en timestamptz DEFAULT now()
);

ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

-- lectura para la app; escritura para el motor de sync (anon, patrón existente
-- del despliegue — ver nota de seguridad en CLAUDE.md del backend)
CREATE POLICY "auth_read" ON proveedores
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync_engine_write" ON proveedores
  FOR ALL TO anon USING (true) WITH CHECK (true);
