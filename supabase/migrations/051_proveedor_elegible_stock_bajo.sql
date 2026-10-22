-- 051_proveedor_elegible_stock_bajo.sql
-- Amplía proveedor_elegible (050): además de los agotados, se consulta a los
-- proveedores por productos con POCO stock que rotan bien, para pedirlos antes de que
-- se agoten. Los productos con stock suficiente no se consultan.
--
-- Regla completa (parámetros con valor por defecto):
--   elegible = existencia <= p_stock_max
--              Y (alta rotación O producto nuevo)
--   * existencia <= p_stock_max (5 por defecto, el mismo tope que la app usa para
--     "Stock bajo"). Incluye agotados y existencias negativas.
--   * alta rotación: >= p_min_facturas facturas vigentes en los últimos p_dias días.
--   * nuevo: compra es_nuevo (compras_app_items) en los últimos p_dias_nuevo días.
--
-- Cambia la firma (parámetro nuevo p_stock_max), así que se elimina la versión de 050:
-- dos sobrecargas con valores por defecto harían ambigua la llamada por RPC.

drop function if exists public.proveedor_elegible(text, int, int, int);

create or replace function public.proveedor_elegible(
  p_codigo        text,
  p_min_facturas  int default 3,
  p_dias          int default 90,
  p_dias_nuevo    int default 60,
  p_stock_max     int default 5
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with prod as (
    select coalesce(
      (select p.existencia from public.productos p where p.codigo_interno = p_codigo), 0
    ) as existencia
  ),
  rot as (
    select count(distinct vd.venta_id)::int as facturas, max(v.created_at) as ultima_venta
    from public.ventas_detalle vd
    join public.ventas v on v.id = vd.venta_id
    where vd.codigo_producto = p_codigo
      and v.status = 1
      and v.created_at >= now() - make_interval(days => p_dias)
  ),
  nuevo as (
    select exists (
      select 1 from public.compras_app_items i
      where i.codigo_producto = p_codigo
        and i.es_nuevo
        and i.creado_en >= now() - make_interval(days => p_dias_nuevo)
    ) as es_nuevo
  )
  select jsonb_build_object(
    'elegible',     (prod.existencia <= p_stock_max)
                    and ((rot.facturas >= p_min_facturas) or nuevo.es_nuevo),
    'motivo',       case when prod.existencia > p_stock_max     then 'con_stock'
                         when rot.facturas >= p_min_facturas    then 'rotacion'
                         when nuevo.es_nuevo                    then 'nuevo'
                         else 'baja_rotacion' end,
    'facturas',     rot.facturas,
    'ultima_venta', rot.ultima_venta,
    'existencia',   prod.existencia
  )
  from prod, rot, nuevo;
$$;

-- security definer: devuelve solo conteos y un veredicto, nunca filas de ventas.
revoke all on function public.proveedor_elegible(text, int, int, int, int) from public, anon;
grant execute on function public.proveedor_elegible(text, int, int, int, int) to authenticated, service_role;
