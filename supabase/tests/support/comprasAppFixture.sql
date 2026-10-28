-- Narrow stubs for objects that earlier migrations expect but this repository does not define.
-- Everything else for the purchase queue (tables, constraints, owner policies) is loaded from
-- the real migrations 022, 023, 026 (numero_documento), 034, 039 and the 026 roles policy text.
--
-- LIMITS: both stubs model, they do not prove, production behavior.
--   * is_active_employee(): its production body is not in this repository. Modeled as an
--     active profile; only the read policies of 022 use it.
--   * supabase_realtime: PGlite has no Supabase Realtime; the empty publication only lets
--     `ALTER PUBLICATION supabase_realtime ADD TABLE ...` in 022/034 run.
create function public.is_active_employee()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active = true)
$$;

create publication supabase_realtime;
