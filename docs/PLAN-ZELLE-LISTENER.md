# Plan — Notificación instantánea de Zelle (Outlook → Supabase → App)

> Estado: **implementado, con pivote de transporte** (2026-07-17). Guía paso a
> paso: `backend serrucho/ZELLE-LISTENER.md`.
>
> **Pivote IMAP → Microsoft Graph**: al probar en la PC de la tienda, el puerto
> IMAP (993) resultó bloqueado por el ISP (confirmado: falla igual contra
> Outlook y contra Gmail; sin regla de firewall local; el router tiene IP
> pública directa, sin módem intermedio). Se reescribió la capa de transporte
> de `zelle_listener.py` para usar **Microsoft Graph API por polling HTTPS**
> (puerto 443, ya confirmado que funciona) en vez de IMAP IDLE. El parser
> (monto/remitente/dedupe) no cambió — son funciones puras sobre bytes RFC822,
> los 19 tests siguen en verde sin tocarlos. Latencia: ~5-10s en vez de ~1-2s.
>
> - Fase 1 ✅ migración `029_pagos_zelle.sql` aplicada en producción
>   (tabla + RLS privileged + trigger `notify_push_zelle` + Realtime).
> - Fase 2 ✅ `zelle_listener.py` v2 (Graph polling + msal + catch-up + dedupe),
>   registrado en `backend_watchdog.py`; tests 19/19 en verde.
> - Fase 3 ✅ Edge Function `send-push` v4 desplegada (branch pagos_zelle +
>   push solo a admin/superempleado, `verify_jwt` sigue en false).
> - Fase 4 ✅ app: type `PagoZelle`, hook `usePagosZelle`, Realtime con sonido
>   en `useRealtimeSync`, pantalla `app/pagos.tsx`, botón `$` en Home.
> - Fase 0 (usuario): registro Azure ✅, permiso Graph `Mail.Read` ✅, login ✅.
> - Fase 5 ✅ verificación end-to-end: 6 pagos reales de Bank of America (ES)
>   parseados OK con --probe; 3 insertados en `pagos_zelle` (1 fila c/u, sin
>   duplicados); listener corriendo bajo el watchdog, polling cada 5s.
>
> **Banco real: Bank of America en español.** Remitente
> `customerservice@ealerts.bankofamerica.com`, asunto "NOMBRE le envió $MONTO".
> El filtro es por patrón de asunto de pago (`_RE_ZELLE_ASUNTO`), no por dominio,
> porque del mismo banco llegan también ACH, códigos de autorización y publicidad.
>
> **Fix de polling Graph:** `receivedDateTime` viene truncado a segundos pero
> `$filter gt` compara con sub-segundos, así que el último correo re-matchea cada
> ciclo. Se resolvió guardando en `zelle_state.json` el timestamp + un set de IDs
> ya vistos en ese último segundo (`vistos`). No causaba pushes/filas duplicadas
> (el `ON CONFLICT DO NOTHING` lo evita), solo ruido en el log.

## Objetivo

Cada vez que llegue al correo Outlook un email notificando un pago Zelle:
1. Detectarlo **al instante** (push IMAP, no polling lento).
2. Parsearlo (monto, remitente) y subirlo a Supabase (`pagos_zelle`).
3. La app suena una notificación push (app abierta, en background o cerrada)
   y la lista se actualiza en realtime.

Latencia esperada de punta a punta: **~3–6 segundos** desde que llega el correo.

## Lo que YA existe (se reutiliza, no se construye)

| Pieza | Estado |
|---|---|
| Edge Function `send-push` (Web Push VAPID + Expo Push → FCM) | ✅ desplegada (v3) |
| Tabla `push_subscriptions` (tokens web + nativos por empleado) | ✅ en producción |
| Patrón trigger → `pg_net.http_post` → `send-push` (`notify_push()`) | ✅ en producción |
| `usePushNotifications.ts` en la app (permiso + registro de token) | ✅ en producción |
| `backend_watchdog.py` que supervisa procesos 24/7 en la PC oficina | ✅ en producción |
| `supabase_rest.py` (cliente REST del backend Python) | ✅ en producción |
| Extensiones `pg_net` y `pg_cron` en Supabase | ✅ instaladas |

**Lo único nuevo de verdad**: un listener de correo + una tabla + un branch en
`send-push` + una vista/pantalla en la app.

## Decisión de arquitectura — cómo vigilar el correo

### Opción elegida: **A. Listener Python local con IMAP IDLE** ⭐

`zelle_listener.py` en `C:\Proyect\backend serrucho`, supervisado por
`backend_watchdog.py` (mismo patrón que `remote_listener.py`).

- **IMAP IDLE** = push real del servidor de Microsoft (`outlook.office365.com:993`).
  El servidor avisa en 1–2 s cuando entra un correo. No hay polling.
- Autenticación: **OAuth2 (XOAUTH2)** con `msal` — Microsoft eliminó la
  autenticación básica y los app passwords para cuentas personales de
  outlook.com. Requiere un registro de app gratuito en Azure/Entra (una sola
  vez) y un login inicial por device-code; después el refresh token se renueva
  solo indefinidamente mientras el listener corra.
- Librerías: `imapclient` (IDLE nativo) + `msal` (token cache en disco).
- La PC oficina ya es la infraestructura crítica 24/7 del sistema (todo el
  sync depende de ella), así que no agrega un punto de fallo nuevo.

### Alternativas descartadas

- **B. Webhook de Microsoft Graph → Edge Function (cloud puro)**: verdadero
  realtime sin depender de la PC, pero exige registro Azure con secret,
  almacenar/renovar tokens en la nube, renovar la suscripción cada <7 días
  (máx. 10.080 min) con pg_cron, y el handshake de validación. Muchas más
  piezas móviles para el mismo resultado. Queda como plan B si algún día la
  PC deja de estar encendida 24/7.
- **C. n8n (corre en localhost:5678)**: el trigger de Outlook de n8n es
  polling con mínimo 1 minuto — no cumple "instantáneo", y n8n no está
  supervisado por el watchdog.
- **D. Power Automate**: el conector HTTP para llamar a Supabase es premium
  (de pago).

## Fases

### Fase 0 — Registro en Azure + login inicial (manual, una vez, ~10 min)

1. En https://entra.microsoft.com → App registrations → New:
   - Nombre: `Serrucho Zelle Listener`.
   - Supported account types: **Personal Microsoft accounts** (outlook.com/hotmail).
   - Sin secret — cliente público con device-code flow habilitado
     (`allowPublicClient: true`).
2. API permissions (delegadas): `IMAP.AccessAsUser.All` + `offline_access`.
3. `python zelle_listener.py --login` → muestra código → iniciar sesión con la
   cuenta Outlook → token cache guardado en disco (`zelle_token_cache.json`,
   junto a los demás archivos de estado del backend).

### Fase 1 — Base de datos (migración `029_pagos_zelle.sql`)

```sql
create table pagos_zelle (
  id            uuid primary key default gen_random_uuid(),
  message_id    text unique not null,        -- Message-ID del correo (dedupe)
  monto         numeric,                     -- USD parseado
  remitente     text,                        -- quién envió el Zelle
  banco         text,                        -- origen (BofA, Zelle, etc.)
  asunto        text not null,
  cuerpo_snippet text,                       -- ~500 chars para verificar a ojo
  raw_parse_ok  boolean not null default true, -- false si el regex no extrajo monto
  recibido_en   timestamptz,                 -- Date del correo
  procesado_en  timestamptz not null default now(),
  conciliado    boolean not null default false, -- check manual en la app
  conciliado_por uuid references profiles(id)
);
```

- RLS: lectura/`conciliado`-update solo `is_privileged()` (montos de dinero no
  visibles para empleados rasos — **confirmar con el usuario**). Insert: el
  listener usa la anon key como el resto del backend (misma política que
  `comandos_remotos`), o idealmente un claim propio.
- Realtime: `alter publication supabase_realtime add table pagos_zelle;`
- Trigger **dedicado** `notify_push_zelle()` → `net.http_post` a `send-push`
  con `table: 'pagos_zelle'` (⚠️ no reutilizar `notify_push()`: referencia
  `NEW.status` y `pagos_zelle` no tiene esa columna → error en runtime).

### Fase 2 — Listener Python (`backend serrucho/zelle_listener.py`)

- `msal.PublicClientApplication` + `SerializableTokenCache` persistido;
  `--login` para device flow; después `acquire_token_silent` (refresh
  automático).
- `IMAPClient('outlook.office365.com', ssl=True)` → `oauth2_login` (XOAUTH2)
  → `SELECT INBOX`.
- **Catch-up al arrancar**: busca UIDs > último UID procesado (guardado en un
  state file local) — los correos que llegaron con el listener caído no se
  pierden.
- **Loop IDLE**: `idle()` / `idle_check(timeout=60)`, renovando el IDLE cada
  ~25 min (límite del servidor ~29 min). Ante evento `EXISTS` → fetch de los
  UIDs nuevos.
- **Filtro Zelle**: lista configurable en `config.py` (`ZELLE_SENDERS`,
  `ZELLE_SUBJECT_RE`) — remitentes tipo `zellepay.com`, banco, etc.
- **Parser**: regex de monto/remitente sobre asunto+cuerpo. Si no matchea,
  inserta igual con `raw_parse_ok=false` (la notificación sale igual, con el
  asunto crudo). Se ajusta con 1–2 correos reales de ejemplo.
- Insert vía `supabase_rest.py` con dedupe por `message_id`
  (`on_conflict=message_id, ignore`).
- Robustez: reconexión con backoff exponencial, log a `zelle_listener.log`,
  registrado en la lista de procesos de `backend_watchdog.py`.
- Tests `pytest` del parser con los correos de ejemplo.

### Fase 3 — Edge Function `send-push` v4

- Branch para `table === 'pagos_zelle'`:
  `title: '💰 Zelle recibido'`, `body: '$monto — remitente'`, `url: '/pagos'`.
- Filtrar destinatarios: solo suscripciones cuyo `empleado_id` sea
  admin/superempleado (join con `profiles`) — solo para este tipo de evento;
  el comportamiento actual para las demás tablas no cambia.
- El early-return existente (`rec.status !== 'pendiente'`) no afecta:
  `pagos_zelle` no tiene `status`.

### Fase 4 — App (el-serrucho-go)

- **Sonido**: ya resuelto — el handler de `expo-notifications` tiene
  `shouldPlaySound: true` incluso en foreground; el push cubre app cerrada,
  en background y abierta.
- Hook `usePagosZelle.ts`: `useQuery` (lista del día/semana) + canal Realtime
  en INSERT → invalidate (actualización instantánea de la UI).
- UI: pantalla `app/pagos.tsx` (stack, gated por `useUserRole` privileged) con
  la lista de zelles: monto, remitente, hora, badge `raw_parse_ok`, y toggle
  "conciliado". Acceso desde una card en Home que muestra el total Zelle de
  hoy + último recibido.
- Deep link del push (`url: '/pagos'`) abre esa pantalla.
- (Opcional, requiere nuevo dev build) sonido custom "cha-ching" vía canal de
  notificación Android.

### Fase 5 — Verificación end-to-end

1. Enviarse un correo de prueba con formato Zelle → fila en `pagos_zelle` +
   push en el teléfono en <6 s.
2. Matar el listener, enviar correo, reiniciar → catch-up lo recupera.
3. Correo duplicado / reenviado → dedupe por `message_id`, sin doble push.
4. `pytest` del parser en verde.
5. Reiniciar procesos del backend tras el deploy (regla del proyecto).

## Datos que faltan del usuario (bloqueantes para Fase 2)

1. **Cuenta**: ¿es personal @outlook.com/@hotmail.com o Microsoft 365?
2. **1–2 correos Zelle reales de ejemplo** (remitente exacto, asunto y cuerpo)
   para el filtro y el regex del monto/remitente.
3. **¿Quién recibe la notificación?** ¿Solo admin/superempleado o todos los
   empleados activos?
