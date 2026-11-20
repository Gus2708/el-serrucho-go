-- 20261120152000_auditoria_eventos.sql
-- Bitácora append-only de actividad y auditoría de empleados.
-- Registra aperturas/vueltas a primer plano de la app, inicio/cierre de sesión,
-- y cada paso sensible (ajustes de stock/precio/datos, aprobaciones, compras,
-- eliminaciones y sincronizaciones), tanto desde la app ('app') como desde
-- triggers independientes en base de datos ('db_trigger').

create table public.auditoria_eventos (
  id           uuid primary key default gen_random_uuid(),
  creado_en    timestamptz not null default now(),
  cliente_ts   timestamptz,
  empleado_id  uuid references auth.users(id) on delete set null,
  sesion_id    text check (sesion_id is null or char_length(sesion_id) <= 80),
  origen       text not null default 'app' check (origen in ('app', 'db_trigger')),
  evento       text not null check (char_length(evento) between 1 and 80),
  entidad      text check (entidad is null or char_length(entidad) <= 60),
  entidad_id   text check (entidad_id is null or char_length(entidad_id) <= 80),
  detalle      jsonb not null default '{}'::jsonb
               check (jsonb_typeof(detalle) = 'object' and octet_length(detalle::text) <= 16384),
  plataforma   text check (plataforma is null or char_length(plataforma) <= 20),
  marca        text check (marca is null or char_length(marca) <= 100),
  modelo       text check (modelo is null or char_length(modelo) <= 100),
  version_so   text check (version_so is null or char_length(version_so) <= 50),
  app_version  text check (app_version is null or char_length(app_version) <= 50)
);

create index auditoria_eventos_creado_idx
  on public.auditoria_eventos (creado_en desc);

create index auditoria_eventos_empleado_creado_idx
  on public.auditoria_eventos (empleado_id, creado_en desc);

create index auditoria_eventos_evento_creado_idx
  on public.auditoria_eventos (evento, creado_en desc);

create index auditoria_eventos_entidad_idx
  on public.auditoria_eventos (entidad, entidad_id)
  where entidad is not null;

-- Fuerza hora real del servidor y extrae session_id del JWT verificado.
create or replace function public.fn_auditoria_enforce_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_claims jsonb;
  jwt_sid    text;
begin
  NEW.creado_en := now();

  begin
    jwt_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    jwt_claims := null;
  end;

  jwt_sid := nullif(jwt_claims ->> 'session_id', '');
  if jwt_sid is not null then
    NEW.sesion_id := left(jwt_sid, 80);
  elsif NEW.origen = 'app' then
    NEW.sesion_id := null;
  end if;

  return NEW;
end;
$$;

create trigger trg_auditoria_enforce_defaults
  before insert on public.auditoria_eventos
  for each row
  execute function public.fn_auditoria_enforce_defaults();

alter table public.auditoria_eventos enable row level security;

revoke all on public.auditoria_eventos from public, anon, authenticated;
grant insert, select on public.auditoria_eventos to authenticated;

create policy auditoria_eventos_insert_own on public.auditoria_eventos
  for insert to authenticated
  with check (
    empleado_id = auth.uid()
    and origen = 'app'
  );

create policy auditoria_eventos_read_admin on public.auditoria_eventos
  for select to authenticated
  using (public.is_admin());

-- Vista de consulta rápida para admins (security_invoker hereda la RLS de auditoria_eventos).
create or replace view public.vw_auditoria_actividad
with (security_invoker = true)
as
select
  a.id,
  a.creado_en,
  (a.creado_en at time zone 'America/Caracas') as hora_venezuela,
  a.cliente_ts,
  (a.cliente_ts at time zone 'America/Caracas') as hora_telefono_venezuela,
  case
    when a.cliente_ts is not null then extract(epoch from (a.creado_en - a.cliente_ts))::bigint
    else null
  end as desfase_segundos,
  a.empleado_id,
  p.display_name as usuario,
  p.email,
  p.role as rol,
  a.sesion_id,
  a.origen,
  a.evento,
  a.entidad,
  a.entidad_id,
  a.detalle,
  a.plataforma,
  a.marca,
  a.modelo,
  a.version_so,
  a.app_version
from public.auditoria_eventos a
left join public.profiles p on p.id = a.empleado_id;

revoke all on public.vw_auditoria_actividad from public, anon, authenticated;
grant select on public.vw_auditoria_actividad to authenticated;

-- ── Triggers independientes en base de datos ────────────────────────────────

create or replace function public.fn_audit_ordenes_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
begin
  if TG_OP = 'INSERT' then
    -- Ignorar espejos históricos sincronizados desde HybridLite (sin usuario)
    if NEW.creado_por is null and auth.uid() is null then
      return NEW;
    end if;

    actor_id := coalesce(auth.uid(), NEW.creado_por);
    insert into public.auditoria_eventos (empleado_id, origen, evento, entidad, entidad_id, detalle)
    values (
      actor_id,
      'db_trigger',
      'db_orden_creada',
      'ordenes_cambio',
      NEW.id::text,
      jsonb_build_object(
        'status', NEW.status,
        'aprobacion_estado', NEW.aprobacion_estado,
        'nota', left(coalesce(NEW.nota, ''), 300),
        'creado_por', NEW.creado_por
      )
    );
    return NEW;
  elsif TG_OP = 'UPDATE' then
    if NEW.creado_por is null and OLD.creado_por is null and auth.uid() is null then
      return NEW;
    end if;

    if NEW.status is not distinct from OLD.status
       and NEW.aprobacion_estado is not distinct from OLD.aprobacion_estado
       and (NEW.pdf_url is not null) is not distinct from (OLD.pdf_url is not null) then
      return NEW;
    end if;

    actor_id := coalesce(auth.uid(), NEW.aprobado_por, NEW.creado_por);
    insert into public.auditoria_eventos (empleado_id, origen, evento, entidad, entidad_id, detalle)
    values (
      actor_id,
      'db_trigger',
      'db_orden_estado',
      'ordenes_cambio',
      NEW.id::text,
      jsonb_build_object(
        'status_anterior', OLD.status,
        'status_nuevo', NEW.status,
        'aprobacion_anterior', OLD.aprobacion_estado,
        'aprobacion_nueva', NEW.aprobacion_estado,
        'aprobado_por', NEW.aprobado_por,
        'rechazo_motivo', left(coalesce(NEW.rechazo_motivo, ''), 300),
        'pdf_subido', (NEW.pdf_url is not null)
      )
    );
    return NEW;
  elsif TG_OP = 'DELETE' then
    if OLD.creado_por is null and auth.uid() is null then
      return OLD;
    end if;

    actor_id := coalesce(auth.uid(), OLD.creado_por);
    insert into public.auditoria_eventos (empleado_id, origen, evento, entidad, entidad_id, detalle)
    values (
      actor_id,
      'db_trigger',
      'db_orden_eliminada',
      'ordenes_cambio',
      OLD.id::text,
      jsonb_build_object(
        'status', OLD.status,
        'aprobacion_estado', OLD.aprobacion_estado,
        'nota', left(coalesce(OLD.nota, ''), 300),
        'creado_por', OLD.creado_por
      )
    );
    return OLD;
  end if;

  return null;
end;
$$;

create trigger trg_audit_ordenes_cambio
  after insert or update or delete on public.ordenes_cambio
  for each row
  execute function public.fn_audit_ordenes_cambio();

create or replace function public.fn_audit_ordenes_cambio_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_owner uuid;
  actor_id     uuid;
begin
  select o.creado_por into parent_owner
  from public.ordenes_cambio o
  where o.id = NEW.orden_id;

  -- Ignorar espejos históricos sincronizados desde HybridLite
  if parent_owner is null and auth.uid() is null then
    return NEW;
  end if;

  actor_id := coalesce(auth.uid(), parent_owner);

  if TG_OP = 'INSERT' then
    insert into public.auditoria_eventos (empleado_id, origen, evento, entidad, entidad_id, detalle)
    values (
      actor_id,
      'db_trigger',
      'db_orden_item_creado',
      'ordenes_cambio_items',
      NEW.id::text,
      jsonb_build_object(
        'orden_id', NEW.orden_id,
        'codigo_producto', NEW.codigo_producto,
        'descripcion', left(coalesce(NEW.descripcion, ''), 200),
        'existencia_actual', NEW.existencia_actual,
        'nueva_existencia', NEW.nueva_existencia,
        'delta', NEW.delta,
        'precio_actual', NEW.precio_actual,
        'nuevo_precio', NEW.nuevo_precio,
        'costo', NEW.costo,
        'nueva_descripcion', left(coalesce(NEW.nueva_descripcion, ''), 200),
        'nueva_referencia', left(coalesce(NEW.nueva_referencia, ''), 100),
        'backend_status', NEW.backend_status,
        'nota', left(coalesce(NEW.nota, ''), 300)
      )
    );
  elsif TG_OP = 'UPDATE' then
    if NEW.backend_status is not distinct from OLD.backend_status then
      return NEW;
    end if;

    insert into public.auditoria_eventos (empleado_id, origen, evento, entidad, entidad_id, detalle)
    values (
      actor_id,
      'db_trigger',
      'db_orden_item_estado',
      'ordenes_cambio_items',
      NEW.id::text,
      jsonb_build_object(
        'orden_id', NEW.orden_id,
        'codigo_producto', NEW.codigo_producto,
        'delta', NEW.delta,
        'backend_status_anterior', OLD.backend_status,
        'backend_status_nuevo', NEW.backend_status,
        'backend_resultado', left(coalesce(NEW.backend_resultado, ''), 300),
        'backend_intentos', NEW.backend_intentos,
        'backend_aplicado_en', NEW.backend_aplicado_en
      )
    );
  end if;

  return NEW;
end;
$$;

create trigger trg_audit_ordenes_cambio_items
  after insert or update on public.ordenes_cambio_items
  for each row
  execute function public.fn_audit_ordenes_cambio_items();

create or replace function public.fn_audit_compras_app()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
begin
  if TG_OP = 'INSERT' then
    actor_id := coalesce(auth.uid(), NEW.creado_por);
    insert into public.auditoria_eventos (empleado_id, origen, evento, entidad, entidad_id, detalle)
    values (
      actor_id,
      'db_trigger',
      'db_compra_creada',
      'compras_app',
      NEW.id::text,
      jsonb_build_object(
        'status', NEW.status,
        'backend_status', NEW.backend_status,
        'proveedor_codigo', NEW.proveedor_codigo,
        'proveedor_nombre', left(coalesce(NEW.proveedor_nombre, ''), 200),
        'titulo', left(coalesce(NEW.titulo, ''), 200)
      )
    );
    return NEW;
  elsif TG_OP = 'UPDATE' then
    if NEW.status is not distinct from OLD.status
       and NEW.backend_status is not distinct from OLD.backend_status then
      return NEW;
    end if;

    actor_id := coalesce(auth.uid(), NEW.creado_por);
    insert into public.auditoria_eventos (empleado_id, origen, evento, entidad, entidad_id, detalle)
    values (
      actor_id,
      'db_trigger',
      'db_compra_estado',
      'compras_app',
      NEW.id::text,
      jsonb_build_object(
        'status_anterior', OLD.status,
        'status_nuevo', NEW.status,
        'backend_status_anterior', OLD.backend_status,
        'backend_status_nuevo', NEW.backend_status,
        'backend_resultado', left(coalesce(NEW.backend_resultado, ''), 300)
      )
    );
    return NEW;
  elsif TG_OP = 'DELETE' then
    actor_id := coalesce(auth.uid(), OLD.creado_por);
    insert into public.auditoria_eventos (empleado_id, origen, evento, entidad, entidad_id, detalle)
    values (
      actor_id,
      'db_trigger',
      'db_compra_eliminada',
      'compras_app',
      OLD.id::text,
      jsonb_build_object(
        'status', OLD.status,
        'proveedor_nombre', left(coalesce(OLD.proveedor_nombre, ''), 200),
        'titulo', left(coalesce(OLD.titulo, ''), 200)
      )
    );
    return OLD;
  end if;

  return null;
end;
$$;

create trigger trg_audit_compras_app
  after insert or update or delete on public.compras_app
  for each row
  execute function public.fn_audit_compras_app();
