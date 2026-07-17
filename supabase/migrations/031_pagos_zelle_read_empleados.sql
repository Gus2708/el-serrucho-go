-- 031_pagos_zelle_read_empleados.sql
-- La app ahora muestra la pantalla de Zelle a todos los roles: admin ve todo
-- (resumen + filtros + historial completo), superempleado/empleado ven solo
-- los últimos 5 pagos (recorte hecho en el cliente, app/pagos.tsx). Para que
-- ese recorte tenga datos que mostrar, hay que abrir la lectura a cualquier
-- empleado activo; la conciliación sigue restringida a admin/superempleado.

drop policy pagos_zelle_read on public.pagos_zelle;

create policy pagos_zelle_read on public.pagos_zelle
  for select to authenticated
  using (public.is_active_employee());
