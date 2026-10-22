import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

// Minimal Supabase surface (auth, storage, roles) so the real migration can run
// on an isolated engine. is_privileged() is copied from migration 026.
// validate_session() is a STUB: its production body is not in this repository,
// so the harness models it with the `test.session_valid` setting.
const SUPABASE_FIXTURE = `
create role anon nologin;
create role authenticated nologin;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

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

create function public.validate_session()
returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('test.session_valid', true), ''), 'true')::boolean
$$;

create schema storage;
create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text,
  owner_id  text,
  metadata  jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end;
$$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
`;

export type TestRole = 'admin' | 'superempleado' | 'empleado';

export function findMigrationSql(): string {
  const file = readdirSync(MIGRATIONS_DIR).find(name => name.endsWith('_facturas_proveedores_persistencia.sql'));
  if (!file) throw new Error('Invoice persistence migration not found');
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

// Forward migrations of the same feature, applied after the original in filename order.
export function findFollowUpMigrationsSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('_fix_factura_documento_delete_race.sql'))
    .sort()
    .map(name => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
}

export async function createMigratedDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_FIXTURE);
  await db.exec(findMigrationSql());
  for (const sql of findFollowUpMigrationsSql()) await db.exec(sql);
  return db;
}

export async function addUser(db: PGlite, id: string, role: TestRole, isActive = true): Promise<void> {
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query('insert into public.profiles (id, role, is_active) values ($1, $2, $3)', [id, role, isActive]);
}

export async function actAs(db: PGlite, userId: string, sessionValid = true): Promise<void> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('test.session_valid', $1, false)", [String(sessionValid)]);
  await db.exec('set role authenticated');
}

export async function actAsAnon(db: PGlite): Promise<void> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec('set role anon');
}

export async function actAsOwner(db: PGlite): Promise<void> {
  await db.exec('reset role');
}
