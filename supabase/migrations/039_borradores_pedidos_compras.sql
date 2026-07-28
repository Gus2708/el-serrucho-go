-- Migration 039: borradores ("listas sin terminar") de pedidos y compras
--
-- pedidos_app / compras_app ya nacieron con status IN ('borrador','emitido') y
-- los listeners del backend filtran status=eq.emitido (listener_pedidos.py:79,
-- listener_compras.py:107). O sea: una fila en 'borrador' NUNCA se registra en
-- HybridLite. Esta migración solo habilita guardarlas a medio armar:
--
--   1. cliente_codigo / proveedor_codigo pasan a NULL-ables: se puede guardar
--      una lista de productos antes de saber a quién va. Un CHECK garantiza que
--      al emitir (status='emitido') ya no puedan ser NULL, que es la única
--      condición que le importa al backend.
--   2. titulo: nombre que le pone el usuario a la lista ("Pedido ferretería
--      Tovar"), para reconocerla en la pestaña Borradores.
--   3. actualizado_en: la app lo escribe en cada guardado; ordena la lista de
--      borradores por "lo último que estuve armando".

ALTER TABLE pedidos_app ALTER COLUMN cliente_codigo   DROP NOT NULL;
ALTER TABLE compras_app ALTER COLUMN proveedor_codigo DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_app_emitido_requiere_cliente') THEN
    ALTER TABLE pedidos_app ADD CONSTRAINT pedidos_app_emitido_requiere_cliente
      CHECK (status IS DISTINCT FROM 'emitido' OR cliente_codigo IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compras_app_emitido_requiere_proveedor') THEN
    ALTER TABLE compras_app ADD CONSTRAINT compras_app_emitido_requiere_proveedor
      CHECK (status IS DISTINCT FROM 'emitido' OR proveedor_codigo IS NOT NULL);
  END IF;
END $$;

ALTER TABLE pedidos_app ADD COLUMN IF NOT EXISTS titulo         text;
ALTER TABLE compras_app ADD COLUMN IF NOT EXISTS titulo         text;
ALTER TABLE pedidos_app ADD COLUMN IF NOT EXISTS actualizado_en timestamptz DEFAULT now();
ALTER TABLE compras_app ADD COLUMN IF NOT EXISTS actualizado_en timestamptz DEFAULT now();

-- La pestaña Borradores lista solo lo propio y sin emitir.
CREATE INDEX IF NOT EXISTS idx_pedidos_app_borradores
  ON pedidos_app (creado_por, actualizado_en DESC) WHERE status = 'borrador';
CREATE INDEX IF NOT EXISTS idx_compras_app_borradores
  ON compras_app (creado_por, actualizado_en DESC) WHERE status = 'borrador';
