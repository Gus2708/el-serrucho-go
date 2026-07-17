-- 029_pagos_zelle.sql
-- Pagos Zelle detectados en el correo Outlook por zelle_listener.py (PC oficina).
-- El listener inserta con la anon key (mismo patrón que comandos_remotos); la app
-- solo lee/concilia y únicamente para admin/superempleado (montos de dinero).

create table public.pagos_zelle (
  id             uuid primary key default gen_random_uuid(),
  message_id     text not null unique,          -- Message-ID del correo (dedupe)
  monto          numeric,                       -- USD parseado del correo
  remitente      text,                          -- quién envió el Zelle
  banco          text,                          -- dominio del remitente del correo
  asunto         text not null,
  cuerpo_snippet text,                          -- primeros ~500 chars para verificar a ojo
  raw_parse_ok   boolean not null default true, -- false si el regex no extrajo el monto
  recibido_en    timestamptz,                   -- header Date del correo
  procesado_en   timestamptz not null default now(),
  conciliado     boolean not null default false,
  conciliado_por uuid references public.profiles(id)
);

create index pagos_zelle_procesado_idx on public.pagos_zelle (procesado_en desc);

alter table public.pagos_zelle enable row level security;

-- Solo admin/superempleado ven montos y concilian.
create policy pagos_zelle_read on public.pagos_zelle
  for select to authenticated
  using (public.is_privileged());

create policy pagos_zelle_update on public.pagos_zelle
  for update to authenticated
  using (public.is_privileged())
  with check (public.is_privileged());

-- El listener de la PC oficina escribe con la anon key (igual que el resto del
-- backend; ver nota de seguridad en CLAUDE.md del backend).
create policy pagos_zelle_insert on public.pagos_zelle
  for insert to anon, authenticated
  with check (true);

-- Push instantáneo: trigger dedicado (notify_push() genérico referencia
-- NEW.status, columna que esta tabla no tiene).
create or replace function public.notify_push_zelle()
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
    body := jsonb_build_object('table', 'pagos_zelle', 'record', to_jsonb(NEW)),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$$;

create trigger trg_notify_push_zelle
  after insert on public.pagos_zelle
  for each row execute function public.notify_push_zelle();

-- Realtime para que la app actualice la lista al instante.
alter publication supabase_realtime add table public.pagos_zelle;
