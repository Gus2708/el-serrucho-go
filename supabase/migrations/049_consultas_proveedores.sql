-- 049_consultas_proveedores.sql
-- Tablas puente para consultar a los proveedores desde la app: "este producto está
-- agotado, ¿lo tiene Maxcam / Corporación Norte?".
--
-- La app inserta una fila (status 'pendiente'); un listener en el backend de la
-- tienda (microservicios/maxcam y microservicios/corpnorte del repo del backend) la
-- toma, consulta al proveedor y escribe `resultado`; la app lee la fila por polling
-- (src/hooks/useConsultaProveedor.ts). Así funciona fuera de la red de la tienda sin
-- abrir puertos.
--
-- Permisos: los empleados (authenticated) solo pueden crear consultas y leer
-- respuestas. Cambiar status/resultado es del listener (service_role, que ignora
-- RLS). `anon` no ve nada: el resultado trae precios del proveedor.
--
-- Estas tablas ya fueron creadas a mano con sql/crear_consultas_maxcam.sql y
-- sql/crear_corpnorte.sql del repo del backend; esta migración es idempotente, así
-- que aplicarla sobre una base que ya las tiene no cambia nada. Las tablas de
-- embeddings y las funciones *_equivalentes viven solo en el backend: la app no las
-- llama.

do $$
declare
  t text;
begin
  foreach t in array array['consultas_maxcam', 'consultas_corpnorte'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id             uuid primary key default gen_random_uuid(),
        codigo_interno text not null,
        status         text not null default 'pendiente'
                       check (status in ('pendiente', 'procesando', 'listo', 'error')),
        resultado      jsonb,
        error          text,
        creado_en      timestamptz not null default now(),
        actualizado_en timestamptz not null default now()
      )$f$, t);

    execute format($f$create index if not exists %1$I
      on public.%2$I (creado_en) where status in ('pendiente', 'procesando')$f$,
      'idx_' || t || '_cola', t);
    execute format($f$create index if not exists %1$I
      on public.%2$I (codigo_interno, creado_en desc)$f$,
      'idx_' || t || '_codigo', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert on public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($f$create policy %1$I on public.%2$I
      for select to authenticated using (true)$f$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($f$create policy %1$I on public.%2$I
      for insert to authenticated
      with check (status = 'pendiente' and resultado is null and error is null)$f$,
      t || '_insert', t);
  end loop;
end
$$;
