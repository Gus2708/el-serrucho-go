-- 050_proveedor_elegible.sql
-- ¿Vale la pena consultar a los proveedores (Maxcam / Corporación Norte) por este
-- producto agotado? Solo si rota bien o es nuevo; los viejos sin ventas recientes no
-- gastan consultas, embeddings ni llamadas al proveedor.
--
-- Criterio (parámetros con valor por defecto, ajustables sin tocar la app):
--   * Alta rotación: al menos `p_min_facturas` facturas distintas con el producto en
--     los últimos `p_dias` días (se cuentan facturas y no unidades para que una venta
--     grande por mayor no lo haga parecer de alta rotación). Solo facturas vigentes
--     (status = 1), igual que get_top_productos.
--   * Nuevo (excepción): alta hecha desde la app con una compra marcada es_nuevo
--     (compras_app_items) en los últimos `p_dias_nuevo` días. Un producto nuevo aún no
--     tiene historial de ventas, por eso entra aunque no cumpla la rotación.
--     Limitación: no detecta productos creados directamente en Hybrid, porque
--     `productos` no tiene fecha de creación.
--
-- La usan la app (src/hooks/useProveedorElegible.ts) y los listeners del backend
-- (microservicios/*/…_listener.py), con la misma regla en ambos lados.

create index if not exists idx_ventas_detalle_codigo
  on public.ventas_detalle (codigo_producto, venta_id);

create or replace function public.proveedor_elegible(
  p_codigo        text,
  p_min_facturas  int default 3,
  p_dias          int default 90,
  p_dias_nuevo    int default 60
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with rot as (
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
    'elegible',     (rot.facturas >= p_min_facturas) or nuevo.es_nuevo,
    'motivo',       case when rot.facturas >= p_min_facturas then 'rotacion'
                         when nuevo.es_nuevo                 then 'nuevo'
                         else 'baja_rotacion' end,
    'facturas',     rot.facturas,
    'ultima_venta', rot.ultima_venta
  )
  from rot, nuevo;
$$;

-- security definer: devuelve solo conteos y un veredicto, nunca filas de ventas.
revoke all on function public.proveedor_elegible(text, int, int, int) from public, anon;
grant execute on function public.proveedor_elegible(text, int, int, int) to authenticated, service_role;
