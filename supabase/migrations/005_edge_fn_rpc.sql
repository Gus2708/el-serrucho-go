-- RPC used by the detect-anomalies Edge Function
-- Returns products with their 30-day sales velocity for anomaly analysis

CREATE OR REPLACE FUNCTION get_products_for_anomaly_check()
RETURNS TABLE (
  codigo_interno  text,
  descripcion     text,
  unidad          text,
  existencia      numeric,
  costo           numeric,
  precio_venta    numeric,
  actualizado_en  timestamptz,
  vendido_30d     numeric
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    p.codigo_interno,
    p.descripcion,
    p.unidad,
    p.existencia,
    p.costo,
    p.precio_venta,
    p.actualizado_en,
    COALESCE(SUM(vd.cantidad), 0) AS vendido_30d
  FROM productos p
  LEFT JOIN ventas_detalle vd ON vd.codigo_producto = p.codigo_interno
  LEFT JOIN ventas v ON v.id = vd.venta_id AND v.status = 1
    AND v.fecha_emision >= current_date - interval '30 days'
  WHERE
    -- Only check products not already resolved in last 24h
    NOT EXISTS (
      SELECT 1 FROM anomalias a
      WHERE a.codigo_producto = p.codigo_interno
        AND a.resuelto = false
        AND a.detectado_en > now() - interval '24 hours'
    )
  GROUP BY p.codigo_interno, p.descripcion, p.unidad,
           p.existencia, p.costo, p.precio_venta, p.actualizado_en
  ORDER BY p.actualizado_en DESC
  LIMIT 100; -- process max 100 per run to control Gemini cost
$$;
