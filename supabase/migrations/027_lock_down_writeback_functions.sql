-- Migration 027: cerrar la superficie de ejecución de las funciones de la 026
--
-- Postgres concede EXECUTE a PUBLIC por defecto al crear funciones, así que anon
-- podía invocar por REST (/rpc/...) las funciones SECURITY DEFINER de la 026.
-- Todas están gateadas por dentro (auth.uid()/is_privileged), pero por ser
-- críticas (aprobación + anti-escalada) las restringimos explícitamente.
--
--   • Triggers (fn_gate_*, fn_protect_*): se disparan por el trigger, no por
--     EXECUTE del llamador → se revoca a PUBLIC por completo (no se llaman por RPC).
--   • is_privileged(): la usan las policies RLS evaluadas por `authenticated`
--     (compras) → se mantiene solo para authenticated.
--   • aprobar_orden / rechazar_orden: solo authenticated aprueba → idem.

-- Trigger functions: nadie debe poder invocarlas directamente.
REVOKE EXECUTE ON FUNCTION public.fn_gate_item_aprobacion()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_gate_orden_aprobacion()     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_protect_profile_privileges() FROM PUBLIC;

-- Helper de privilegio: fuera de anon, disponible para RLS de authenticated.
REVOKE EXECUTE ON FUNCTION public.is_privileged() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_privileged() TO authenticated;

-- RPCs de resolución: solo authenticated (y la lógica interna exige privilegio).
REVOKE EXECUTE ON FUNCTION public.aprobar_orden(bigint)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rechazar_orden(bigint, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.aprobar_orden(bigint)        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rechazar_orden(bigint, text) TO authenticated;
