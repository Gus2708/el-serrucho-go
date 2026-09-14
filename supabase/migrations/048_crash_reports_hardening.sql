-- 048_crash_reports_hardening.sql
-- Ajustes a 047 tras auditar el logger de crashes:
--
--  1. Un crash ANTES de tener sesión (pantalla de login: justo el bug que se
--     investiga) no se podía subir, porque la policy de insert era solo para
--     authenticated. Se permite insert anónimo, pero siempre sin empleado_id
--     (un anónimo no puede atribuirle un reporte a nadie).
--  2. La FK a profiles no tenía ON DELETE: borrar un empleado con reportes
--     fallaba (profiles cascadea desde auth.users). Pasa a SET NULL.
--  3. Topes de tamaño: con insert anónimo, que nadie pueda inflar la tabla con
--     payloads gigantes. El cliente recorta a estos mismos límites
--     (src/lib/crashTrail.ts).

alter table public.crash_reports
  drop constraint crash_reports_empleado_id_fkey,
  add constraint crash_reports_empleado_id_fkey
    foreign key (empleado_id) references public.profiles(id) on delete set null;

alter table public.crash_reports
  add constraint crash_reports_mensaje_len
    check (mensaje is null or char_length(mensaje) <= 2000),
  add constraint crash_reports_stack_len
    check (stack is null or char_length(stack) <= 20000),
  add constraint crash_reports_breadcrumbs_size
    check (breadcrumbs is null
           or (jsonb_typeof(breadcrumbs) = 'array' and octet_length(breadcrumbs::text) <= 65536)),
  add constraint crash_reports_device_len
    check (char_length(plataforma) <= 20
           and (marca is null or char_length(marca) <= 100)
           and (modelo is null or char_length(modelo) <= 100)
           and (version_so is null or char_length(version_so) <= 50)
           and (app_version is null or char_length(app_version) <= 50));

-- Mismo criterio que el INSERT público de comandos_remotos: escribir sí, leer no.
create policy crash_reports_insert_anon on public.crash_reports
  for insert to anon
  with check (empleado_id is null);
