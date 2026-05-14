-- Función para obtener top productos con rango de días dinámico
CREATE OR REPLACE FUNCTION get_top_productos(days_ago int)
RETURNS TABLE (
    codigo_producto text,
    descripcion text,
    unidades_vendidas numeric,
    ingreso numeric,
    ganancia numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        vd.codigo_producto,
        p.descripcion,
        SUM(vd.cantidad)::numeric as unidades_vendidas,
        SUM(vd.cantidad * vd.precio_venta)::numeric as ingreso,
        SUM(vd.cantidad * (vd.precio_venta - safe_numeric(vd.costo_str)))::numeric as ganancia
    FROM ventas_detalle vd
    JOIN ventas v ON vd.venta_id = v.id
    JOIN productos p ON vd.codigo_producto = p.codigo_interno
    WHERE v.status = 1
      AND v.created_at >= (NOW() - (days_ago || ' days')::interval)
    GROUP BY vd.codigo_producto, p.descripcion;
END;
$$ LANGUAGE plpgsql;

-- Otorgar permisos
GRANT EXECUTE ON FUNCTION get_top_productos(int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_productos(int) TO anon;
GRANT EXECUTE ON FUNCTION get_top_productos(int) TO service_role;
