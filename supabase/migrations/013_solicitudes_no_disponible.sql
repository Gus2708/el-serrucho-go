-- Permite resolver una solicitud de ayuda respondiendo "no lo hay" al cliente,
-- sin obligar a elegir un producto. n8n lee esta bandera y envía el mensaje
-- de "no disponible" en lugar de la lista de productos.
ALTER TABLE public.solicitudes_ayuda
  ADD COLUMN IF NOT EXISTS no_disponible boolean NOT NULL DEFAULT false;
