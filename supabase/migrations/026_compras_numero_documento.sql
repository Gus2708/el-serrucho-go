-- Número de orden/factura escribible desde la app para el documento de compra.
-- Si el usuario lo deja en blanco, el backend sigue usando el id de la compra
-- como relleno para los dos campos de 'Total Operación' en Hybrid (comportamiento
-- previo, sin cambios).
ALTER TABLE public.compras_app
  ADD COLUMN IF NOT EXISTS numero_documento text;

COMMENT ON COLUMN public.compras_app.numero_documento IS
  'Numero de orden/factura que el usuario escribe en la app para los dos campos de Total Operacion en Hybrid. Si es NULL, el backend usa el id de la compra como relleno (comportamiento previo).';
