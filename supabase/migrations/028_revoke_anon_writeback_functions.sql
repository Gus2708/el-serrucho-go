-- Migration 028: revocar EXECUTE a anon en las funciones de la 026 (corrige la 027)
--
-- Supabase concede EXECUTE explícitamente a anon/authenticated/service_role en
-- cada función nueva de `public` (no vía PUBLIC), así que el REVOKE ... FROM PUBLIC
-- de la 027 no quitó a anon. Aquí se revoca a anon explícitamente.
--
--   • Triggers: no se invocan por RPC → se revoca también a authenticated.
--   • is_privileged / aprobar_orden / rechazar_orden: authenticated las necesita
--     (RLS de compras / aprobación) → solo se revoca a anon.

REVOKE EXECUTE ON FUNCTION public.fn_gate_item_aprobacion()       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_gate_orden_aprobacion()      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_protect_profile_privileges() FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_privileged()             FROM anon;
REVOKE EXECUTE ON FUNCTION public.aprobar_orden(bigint)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.rechazar_orden(bigint, text) FROM anon;
