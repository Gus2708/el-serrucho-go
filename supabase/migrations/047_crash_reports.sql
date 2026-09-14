-- 047_crash_reports.sql
-- Diagnóstico de crashes en dispositivos reales (arrancó por el reporte de
-- Android "dejó de funcionar" al iniciar sesión, sin stack trace disponible).
--
-- La app sube dos tipos de fila:
--  - 'session_trail': el rastro de breadcrumbs de la sesión ANTERIOR, subido
--    apenas la app vuelve a abrir. Si el proceso murió sin excepción JS
--    capturable (crash nativo), esto es la única pista que va a quedar.
--  - 'js_error': una excepción JS no capturada, vía ErrorUtils.setGlobalHandler.
--    Cubre la mayoría de los "dejó de funcionar" en RN, porque el bridge suele
--    darle a JS la chance de reportar antes de tumbar el proceso nativo.

create table public.crash_reports (
  id            uuid primary key default gen_random_uuid(),
  empleado_id   uuid references public.profiles(id),
  plataforma    text not null,                 -- Platform.OS: 'android' | 'ios' | 'web'
  marca         text,                          -- Platform.constants.Brand (ej. 'Xiaomi')
  modelo        text,                          -- Platform.constants.Model
  version_so    text,                          -- Platform.constants.Release (Android) u OS version
  app_version   text,                          -- Constants.expoConfig.version
  tipo          text not null check (tipo in ('js_error', 'session_trail')),
  mensaje       text,                          -- error.message, si hubo excepción JS capturable
  stack         text,                          -- error.stack
  breadcrumbs   jsonb,                         -- [{ts, evento, meta}] — timeline previo al crash
  creado_en     timestamptz not null default now()
);

create index crash_reports_creado_idx on public.crash_reports (creado_en desc);

alter table public.crash_reports enable row level security;

-- Cualquier empleado autenticado puede subir SU PROPIO reporte (o uno sin
-- empleado_id, para el caso límite de un crash antes de resolver la sesión).
create policy crash_reports_insert on public.crash_reports
  for insert to authenticated
  with check (empleado_id is null or empleado_id = auth.uid());

-- Solo admin/superempleado leen los reportes (son diagnóstico interno, no
-- algo que un empleado necesite ver de otro).
create policy crash_reports_read on public.crash_reports
  for select to authenticated
  using (public.is_privileged());

-- Sin policy de update/delete: append-only, igual que el resto de los logs
-- de auditoría de este proyecto (creditos_movimiento, etc.).
