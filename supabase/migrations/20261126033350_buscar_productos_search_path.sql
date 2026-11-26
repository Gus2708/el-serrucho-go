-- Local security hardening for public.buscar_productos(text, integer).
--
-- DEPLOYMENT GATE (LOCAL ONLY — DO NOT APPLY WITHOUT SEPARATE AUTHORIZATION):
-- External and anonymous consumers (Python widget, other clients, anon API callers)
-- and live public.productos RLS policies are not verified by local tests. Before
-- applying this migration remotely, complete an authorized live verification of:
--   1. pg_proc definition, ACL, and pg_trgm extension schema (must be public).
--   2. Live RLS policies on public.productos for authenticated callers.
--   3. API logs and external caller inventory confirming no anon/PUBLIC dependency.
--
-- Local repository caller inventory:
--   * supabase/functions/consultar-productos-semantico/handler.ts (caller JWT,
--     after auth/v1/user, is_privileged(), and validate_session()).
--
-- Scope: hardens public.buscar_productos only (SECURITY INVOKER, STABLE, empty
-- search_path, schema-qualified public.productos / public.similarity /
-- OPERATOR(public.%), and REVOKE EXECUTE from PUBLIC and anon while retaining
-- EXECUTE for authenticated and service_role). Sibling RPCs (buscar_semantico,
-- buscar_fuzzy) and all other grants are intentionally untouched.

CREATE OR REPLACE FUNCTION public.buscar_productos(
  p_busqueda text,
  p_limite   integer DEFAULT 5
)
RETURNS TABLE(
  codigo_interno text,
  descripcion    text,
  precio_venta   numeric,
  existencia     numeric,
  total_vendido  numeric,
  score          double precision
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p.codigo_interno,
    p.descripcion,
    p.precio_venta,
    p.existencia,
    p.total_vendido,
    public.similarity(p.descripcion, p_busqueda)::double precision AS score
  FROM public.productos p
  WHERE p.descripcion OPERATOR(public.%) p_busqueda
     OR p.descripcion ILIKE ('%' || p_busqueda || '%')
  ORDER BY score DESC, p.total_vendido DESC, p.existencia DESC
  LIMIT p_limite;
END;
$function$;

-- CREATE OR REPLACE preserves existing function ACLs, so revoking PUBLIC and anon is explicit.
REVOKE EXECUTE ON FUNCTION public.buscar_productos(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_productos(text, integer) TO authenticated, service_role;
