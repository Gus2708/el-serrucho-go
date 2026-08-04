-- Migration 042: endurecer los objetos de créditos (hallazgos de los advisors)
--
-- Dos desviaciones de la 041 respecto al resto del proyecto, ambas detectadas por
-- `get_advisors` tras aplicar y probar la 041:
--
-- 1. security_definer_view — las 4 vistas de créditos se crearon sin
--    `security_invoker`, así que corrían con los permisos de `postgres` en vez de
--    los del empleado que consulta. TODAS las demás vistas del proyecto
--    (productos_view, vw_ventas_usd, vw_dashboard_stats, vw_alertas_stock…) ya
--    usan security_invoker=true. Alinearlas hace que la RLS de las tablas base
--    sea la que manda de verdad, en vez de quedar puenteada por la vista.
--
--    Sigue funcionando el nombre del autor en el historial: `profiles` tiene la
--    policy "Profiles are viewable by all authenticated users" USING (true).
--
-- 2. function_search_path_mutable — las 3 funciones de trigger no fijaban
--    `search_path`. Los 8 RPC sí lo hacían. Un `search_path` mutable en una
--    función que corre con privilegios elevados es la vía clásica para
--    secuestrarla plantando una función homónima en un esquema propio. Estas tres
--    son justamente los guardianes del libro contable: son las últimas que
--    conviene dejar abiertas.

ALTER VIEW vw_creditos_saldo             SET (security_invoker = true);
ALTER VIEW vw_creditos_movimientos       SET (security_invoker = true);
ALTER VIEW vw_creditos_resumen           SET (security_invoker = true);
ALTER VIEW vw_ventas_credito_disponibles SET (security_invoker = true);

ALTER FUNCTION fn_creditos_mov_inmutable()   SET search_path = public;
ALTER FUNCTION fn_creditos_mov_no_borrar()   SET search_path = public;
ALTER FUNCTION fn_creditos_reversa_valida()  SET search_path = public;
