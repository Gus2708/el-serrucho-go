-- Migration 040: precio manual por ítem en los pedidos de la app
--
-- Hasta ahora el pedido usaba SIEMPRE el precio maestro del producto en Hybrid:
-- el backend solo tecleaba código y cantidad (flujo_pedido_real.cargar_item), y
-- por eso pedidos_app_items nació sin precio (ver migración 034).
--
-- Ahora el vendedor puede fijar un precio distinto por ítem y ese precio debe
-- llegar a caja, así que el backend lo teclea en la columna Precio de la grilla
-- de Pedidos usando la MISMA convención que compras: número + '$' (el sufijo le
-- dice a HybridLite que el valor va en dólares, ver flujo_compra_real.cargar_item).
--
-- UNIDAD: USD **con IVA 16%**, igual que productos.precio_venta y que todo lo que
-- se ve en la app. El backend lo teclea TAL CUAL (sin convertir): se verificó
-- contra el pedido real doc 00004749 que TDetalleVta.TBT_PRECIODEVENTA dividido
-- por THT_FACTORREFERENCIAL da exactamente productos.precio_venta (9.00 == 9.00,
-- 0.50 == 0.50), y que THT_TOTALIMPUESTO es el IVA CONTENIDO, no agregado encima.
-- (El comentario de scratch/compare_sales.py que dice "sin IVA" es incorrecto.)
--
-- NULL = no se tocó el precio -> el backend NO teclea nada y Hybrid aplica el
-- precio maestro, o sea el comportamiento histórico. Esto mantiene compatible
-- cualquier pedido ya emitido y hace que la ruta nueva sea estrictamente opt-in.

ALTER TABLE pedidos_app_items
  ADD COLUMN IF NOT EXISTS precio numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_app_items_precio_positivo') THEN
    ALTER TABLE pedidos_app_items ADD CONSTRAINT pedidos_app_items_precio_positivo
      CHECK (precio IS NULL OR precio > 0);
  END IF;
END $$;

COMMENT ON COLUMN pedidos_app_items.precio IS
  'Precio manual del ítem en USD CON IVA 16%. NULL = usar el precio maestro de Hybrid.';
