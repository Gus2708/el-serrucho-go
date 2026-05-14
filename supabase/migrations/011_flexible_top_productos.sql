-- Redefinir vw_top_productos para ser más flexible
-- Eliminamos el ORDER BY y LIMIT fijos para que el frontend pueda decidir cómo ordenar (por cantidad o por ganancia)

DROP VIEW IF EXISTS vw_top_productos;

CREATE OR REPLACE VIEW vw_top_productos AS
SELECT 
    vd.codigo_producto,
    p.descripcion as nombre,
    SUM(vd.cantidad) as unidades_vendidas,
    SUM(vd.cantidad * vd.precio_venta) as ingreso,
    SUM(vd.cantidad * (vd.precio_venta - safe_numeric(vd.costo_str))) as ganancia
FROM ventas_detalle vd
JOIN ventas v ON vd.venta_id = v.id
JOIN productos p ON vd.codigo_producto = p.codigo_interno
WHERE v.status = 1
  AND v.created_at >= NOW() - INTERVAL '30 days'
GROUP BY vd.codigo_producto, p.descripcion;

-- Otorgar permisos (si es necesario, aunque usualmente heredan)
GRANT SELECT ON vw_top_productos TO authenticated;
GRANT SELECT ON vw_top_productos TO anon;
GRANT SELECT ON vw_top_productos TO service_role;
