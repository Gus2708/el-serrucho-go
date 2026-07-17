-- 030_pagos_zelle_estado.sql
-- Clasificacion de pagos Zelle segun el aviso de Bank of America:
--   'recibido'    → el dinero se está depositando (aviso instantáneo, ~5 min).
--   'en_revision' → el banco retuvo el pago a la espera de revisión (~1 día hábil).
-- Los avisos "en revisión" vienen de onlinebanking@ealerts.bankofamerica.com con
-- el monto/nombre en el cuerpo ("Su pago de NOMBRE ... Cantidad $MONTO").

alter table public.pagos_zelle
  add column estado text not null default 'recibido'
    check (estado in ('recibido', 'en_revision'));

create index pagos_zelle_estado_idx on public.pagos_zelle (estado);
