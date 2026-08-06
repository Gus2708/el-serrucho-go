-- Migration 044: cabecera de factura consultable por documento sin agregar todo
--
-- Problema medido: pedirle UNA factura a `vw_ventas_usd` tardaba 337 ms y leía
-- 88.910 buffers. Esa vista calcula sus totales con un GroupAggregate sobre
-- ventas × ventas_detalle, y el filtro por `documento` no puede empujarse por
-- debajo del agregado: para mostrar una factura, Postgres agregaba las 26.920
-- ventas y los 58.176 renglones completos. La usa El Serrucho Fiado cada vez
-- que alguien abre el detalle de una factura.
--
-- Esta vista no agrega nada: es un index scan por `documento` más un lookup del
-- nombre del cliente. Milisegundos en vez de centenas.
--
-- `total_usd` sale de `ventas.total_neto`, que es el total real de la factura y
-- el mismo que `vw_ventas_credito_disponibles` usa para el cargo. Importa que
-- coincidan: en el 1,30% de las facturas (380 de 29.278) la suma de los
-- renglones NO da el total de la cabecera, y el número que se muestra tiene que
-- ser el que se le carga a la cuenta.
--
-- El LATERAL con LIMIT 1 resuelve el nombre de forma determinista: un mismo RIF
-- puede matchear varias filas de `clientes` (el caso 11246149 / V11246149), y
-- un join directo duplicaría la fila de la factura.

CREATE OR REPLACE VIEW vw_factura_cabecera AS
SELECT
  v.documento,
  v.fecha_emision,
  v.created_at,
  v.metodo_pago,
  v.rif_cliente,
  v.total_neto AS total_usd,
  sug.nombre   AS nombre_cliente
FROM ventas v
LEFT JOIN LATERAL (
  SELECT c.nombre
  FROM clientes c
  WHERE c.rif = v.rif_cliente
    AND v.rif_cliente IS NOT NULL
  ORDER BY c.codigo_cliente
  LIMIT 1
) sug ON TRUE
WHERE v.status = 1;

-- Convención del proyecto: todas las vistas corren con los permisos de quien
-- consulta, para que mande la RLS de las tablas base.
ALTER VIEW vw_factura_cabecera SET (security_invoker = true);

REVOKE ALL  ON vw_factura_cabecera FROM anon;
GRANT SELECT ON vw_factura_cabecera TO authenticated;
