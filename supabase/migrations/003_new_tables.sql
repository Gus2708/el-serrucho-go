-- Migration 003: new app-writable tables

CREATE TABLE IF NOT EXISTS anomalias (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo_producto  text REFERENCES productos(codigo_interno),
  tipo             text NOT NULL,
  severidad        text NOT NULL CHECK (severidad IN ('alta', 'media', 'baja')),
  explicacion      text,
  detectado_en     timestamptz DEFAULT now(),
  resuelto         boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS ordenes_cambio (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_por  uuid REFERENCES auth.users(id),
  nota        text,
  status      text DEFAULT 'borrador' CHECK (status IN ('borrador', 'emitido')),
  pdf_url     text,
  creado_en   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ordenes_cambio_items (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  orden_id            bigint REFERENCES ordenes_cambio(id) ON DELETE CASCADE,
  codigo_producto     text NOT NULL,
  descripcion         text,
  existencia_actual   numeric,
  nueva_existencia    numeric NOT NULL,
  delta               numeric GENERATED ALWAYS AS (nueva_existencia - existencia_actual) STORED,
  nota                text
);

-- Storage bucket for PDFs (run in dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('change-orders', 'change-orders', false);
