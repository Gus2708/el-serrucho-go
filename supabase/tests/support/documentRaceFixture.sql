-- Minimal app/Storage surface for the two-connection document race probe.
-- Runs on a throwaway Supabase Postgres image (auth schema and roles already exist);
-- storage tables, profiles and the two auth helpers are modelled, as in pgliteHarness.ts.
-- Synthetic data only.
create schema if not exists storage;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text,
  owner_id  text,
  metadata  jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end;
$$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
grant usage on schema public to anon, authenticated;

create table public.profiles (
  id        uuid primary key references auth.users(id),
  role      text not null check (role in ('admin', 'superempleado', 'empleado')),
  is_active boolean not null default true
);

create function public.is_privileged()
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'superempleado') and is_active = true
  );
end;
$$;

create function public.validate_session() returns boolean language sql stable as $$ select true $$;

insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111');
insert into public.profiles (id, role) values ('11111111-1111-4111-8111-111111111111', 'admin');
