-- 032_alertas_zelle_spoof.sql
-- Intentos de estafa detectados por zelle_listener.py: correos que aparentan ser
-- un aviso de pago Zelle pero NO pasaron el filtro anti-spoofing (dirección no
-- confiable o falló DMARC). Visible para TODOS los empleados activos, no solo
-- privilegiados — un intento de fraude importa a todo el que atiende clientes.

create table public.alertas_zelle_spoof (
  id             uuid primary key default gen_random_uuid(),
  message_id     text not null unique,
  from_addr      text not null,
  asunto         text not null,
  motivo         text not null
    check (motivo in ('dominio_no_autorizado', 'dmarc_fallido', 'header_from_no_alinea')),
  auth_snippet   text,
  cuerpo_snippet text,
  recibido_en    timestamptz,
  detectado_en   timestamptz not null default now(),
  revisado       boolean not null default false,
  revisado_por   uuid references public.profiles(id)
);

create index alertas_zelle_spoof_detectado_idx on public.alertas_zelle_spoof (detectado_en desc);

alter table public.alertas_zelle_spoof enable row level security;

-- Todos los empleados activos ven y pueden marcar como revisado (tema de
-- seguridad de la tienda, no financiero — a diferencia de pagos_zelle).
create policy alertas_zelle_spoof_read on public.alertas_zelle_spoof
  for select to authenticated
  using (public.is_active_employee());

create policy alertas_zelle_spoof_update on public.alertas_zelle_spoof
  for update to authenticated
  using (public.is_active_employee())
  with check (public.is_active_employee());

-- El listener de la PC oficina escribe con la anon key (mismo patrón que pagos_zelle).
create policy alertas_zelle_spoof_insert on public.alertas_zelle_spoof
  for insert to anon, authenticated
  with check (true);

create or replace function public.notify_push_spoof()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://rgniqjfooifchyctnbzu.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-trigger-key', 'srx_push_b3f1a9c2e7d54486a0f2'
    ),
    body := jsonb_build_object('table', 'alertas_zelle_spoof', 'record', to_jsonb(NEW)),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$$;

create trigger trg_notify_push_spoof
  after insert on public.alertas_zelle_spoof
  for each row execute function public.notify_push_spoof();

alter publication supabase_realtime add table public.alertas_zelle_spoof;
