-- 033_notif_prefs.sql
-- Per-user notification opt-out, managed by admins from the user manager.
--
-- Opt-out semantics: an absent key means the category is ENABLED. Only an
-- explicit `false` disables it, so every existing user keeps receiving
-- everything until an admin toggles a category off.
--
-- Categories:
--   "bots"  -> atenciones_pendientes + solicitudes_ayuda
--   "zelle" -> pagos_zelle + alertas_zelle_spoof (pagos + alerta de estafa)
--
-- This pref layers ON TOP of the role gates inside the send-push edge function;
-- it can only REDUCE what a role already allows (e.g. an empleado still never
-- receives zelle pagos, because the role gate runs first).

alter table public.profiles
  add column if not exists notif_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.notif_prefs is
  'Per-user notification opt-out. Keys: bots, zelle. Absent/true = enabled, false = disabled. Read by the send-push edge function.';
