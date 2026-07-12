-- Migration 023: soporte de PRODUCTO NUEVO en items de compra
--
-- Una compra puede incluir productos que TODAVÍA no existen en el inventario de
-- HybridLite. Para esos, la app captura código + descripción + costo + precio
-- (obligatorios) y referencia (opcional); el backend, al registrar la compra,
-- primero dará de alta el producto en HybridLite (Ficha -> Incluir) y luego lo
-- comprará. Los productos ya existentes siguen igual (es_nuevo=false).

ALTER TABLE compras_app_items
  ADD COLUMN IF NOT EXISTS referencia text,
  ADD COLUMN IF NOT EXISTS es_nuevo   boolean NOT NULL DEFAULT false;
