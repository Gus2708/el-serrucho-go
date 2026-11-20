import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SUPER_ID = '22222222-2222-4222-8222-222222222222';
const EMP_A_ID = '33333333-3333-4333-8333-333333333333';
const EMP_B_ID = '44444444-4444-4444-8444-444444444444';

const AUDIT_FIXTURE = `
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
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('admin', 'superempleado', 'empleado')),
  email        text,
  display_name text,
  is_active    boolean not null default true
);

create function public.is_admin()
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
end;
$$;

create table public.ordenes_cambio (
  id                bigint generated always as identity primary key,
  creado_por        uuid references public.profiles(id),
  nota              text,
  status            text not null default 'borrador',
  pdf_url           text,
  creado_en         timestamptz not null default now(),
  aprobacion_estado text not null default 'no_aplica',
  aprobado_por      uuid references public.profiles(id),
  aprobado_en       timestamptz,
  rechazo_motivo    text
);

create table public.ordenes_cambio_items (
  id                  bigint generated always as identity primary key,
  orden_id            bigint not null references public.ordenes_cambio(id) on delete cascade,
  codigo_producto     text not null,
  descripcion         text,
  existencia_actual   numeric,
  nueva_existencia    numeric,
  delta               numeric,
  precio_actual       numeric,
  nuevo_precio        numeric,
  costo               numeric,
  nueva_descripcion   text,
  nueva_referencia    text,
  nota                text,
  backend_status      text not null default 'pendiente',
  backend_resultado   text,
  backend_intentos    integer not null default 0,
  backend_aplicado_en timestamptz
);

create table public.compras_app (
  id                  bigint generated always as identity primary key,
  creado_por          uuid references public.profiles(id),
  titulo              text,
  proveedor_codigo    text,
  proveedor_nombre    text,
  numero_documento    text,
  nota                text,
  status              text not null default 'borrador',
  backend_status      text not null default 'pendiente',
  backend_resultado   text,
  backend_intentos    integer not null default 0,
  backend_aplicado_en timestamptz,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);
`;

function loadAuditMigration(): string {
  const file = readdirSync(MIGRATIONS_DIR).find((name) => name.endsWith('_auditoria_eventos.sql'));
  if (!file) throw new Error('Audit migration *_auditoria_eventos.sql not found');
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

async function setupDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUDIT_FIXTURE);
  await db.exec(loadAuditMigration());

  for (const [id, role, name, email] of [
    [ADMIN_ID, 'admin', 'Gustavo', 'admin@admin.com'],
    [SUPER_ID, 'superempleado', 'Oficina', 'oficina@test.com'],
    [EMP_A_ID, 'empleado', 'Nelson', 'nelson@test.com'],
    [EMP_B_ID, 'empleado', 'Jorge', 'jorge@test.com'],
  ] as const) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query(
      'insert into public.profiles (id, role, display_name, email, is_active) values ($1, $2, $3, $4, true)',
      [id, role, name, email],
    );
  }
  return db;
}

async function actAs(db: PGlite, userId: string, sessionId = 'sid-test-123'): Promise<void> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query(
    "select set_config('request.jwt.claims', $1, false)",
    [JSON.stringify({ sub: userId, session_id: sessionId })],
  );
  await db.exec('set role authenticated');
}

async function actAsAnon(db: PGlite): Promise<void> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("select set_config('request.jwt.claims', '', false)");
  await db.exec('set role anon');
}

async function actAsOwner(db: PGlite): Promise<void> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("select set_config('request.jwt.claims', '', false)");
}

describe('auditoria_eventos migration (RLS, tamper resistance, DB triggers)', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await setupDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it('allows an authenticated employee to insert their own app event and enforces server clock + JWT session_id', async () => {
    await actAs(db, EMP_A_ID, 'sid-nelson-999');

    await db.query(
      `insert into public.auditoria_eventos (
         empleado_id, origen, evento, cliente_ts, creado_en, sesion_id,
         plataforma, marca, modelo, version_so, app_version, detalle
       ) values (
         $1, 'app', 'app_open', '2026-11-19T12:30:00Z', '2020-01-01T00:00:00Z', 'spoofed-sid',
         'android', 'POCO', '2412DPC0AG', '16', '1.2.8', '{"pantalla":"home"}'::jsonb
       )`,
      [EMP_A_ID],
    );

    await actAs(db, ADMIN_ID, 'sid-admin');
    const { rows } = await db.query<{
      creado_en: string;
      sesion_id: string;
      origen: string;
    }>('select creado_en, sesion_id, origen from public.auditoria_eventos');

    expect(rows).toHaveLength(1);
    expect(rows[0].origen).toBe('app');
    expect(rows[0].sesion_id).toBe('sid-nelson-999');
    expect(new Date(rows[0].creado_en).getUTCFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it('blocks an employee from spoofing another employee_id or origen=db_trigger', async () => {
    await actAs(db, EMP_A_ID);

    await expect(
      db.query(
        `insert into public.auditoria_eventos (empleado_id, origen, evento)
         values ($1, 'app', 'app_open')`,
        [EMP_B_ID],
      ),
    ).rejects.toThrow();

    await expect(
      db.query(
        `insert into public.auditoria_eventos (empleado_id, origen, evento)
         values ($1, 'db_trigger', 'db_orden_creada')`,
        [EMP_A_ID],
      ),
    ).rejects.toThrow();
  });

  it('blocks anon inserts and reads', async () => {
    await actAsAnon(db);

    await expect(
      db.query(
        `insert into public.auditoria_eventos (empleado_id, origen, evento)
         values (null, 'app', 'app_open')`,
      ),
    ).rejects.toThrow();

    await expect(
      db.query('select id from public.auditoria_eventos'),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      db.query('select id from public.vw_auditoria_actividad'),
    ).rejects.toThrow(/permission denied/i);
  });

  it('allows only admin to read auditoria_eventos and vw_auditoria_actividad', async () => {
    await actAs(db, EMP_A_ID, 'sid-a');
    await db.query(
      `insert into public.auditoria_eventos (empleado_id, origen, evento, cliente_ts)
       values ($1, 'app', 'app_open', now())`,
      [EMP_A_ID],
    );

    const empRows = await db.query('select id from public.auditoria_eventos');
    expect(empRows.rows).toHaveLength(0);
    const empView = await db.query('select id from public.vw_auditoria_actividad');
    expect(empView.rows).toHaveLength(0);

    await actAs(db, SUPER_ID, 'sid-s');
    const superRows = await db.query('select id from public.auditoria_eventos');
    expect(superRows.rows).toHaveLength(0);

    await actAs(db, ADMIN_ID, 'sid-admin');
    const adminRows = await db.query<{ usuario: string; evento: string; sesion_id: string }>(
      'select usuario, evento, sesion_id from public.vw_auditoria_actividad',
    );
    expect(adminRows.rows).toHaveLength(1);
    expect(adminRows.rows[0]).toEqual({
      usuario: 'Nelson',
      evento: 'app_open',
      sesion_id: 'sid-a',
    });
  });

  it('enforces append-only: neither employee nor admin can update or delete audit rows', async () => {
    await actAs(db, EMP_A_ID);
    await db.query(
      `insert into public.auditoria_eventos (empleado_id, origen, evento)
       values ($1, 'app', 'app_open')`,
      [EMP_A_ID],
    );

    await actAs(db, ADMIN_ID);
    await expect(
      db.query(`update public.auditoria_eventos set evento = 'tampered'`),
    ).rejects.toThrow();
    await expect(
      db.query(`delete from public.auditoria_eventos`),
    ).rejects.toThrow();

    const check = await db.query('select evento from public.auditoria_eventos');
    expect(check.rows).toEqual([{ evento: 'app_open' }]);

    await expect(
      db.query('truncate table public.auditoria_eventos'),
    ).rejects.toThrow();

    await actAsAnon(db);
    await expect(
      db.query('truncate table public.auditoria_eventos'),
    ).rejects.toThrow();
  });

  it('handles extreme cliente_ts values in vw_auditoria_actividad without int4 overflow', async () => {
    await actAs(db, EMP_A_ID, 'sid-clock-bad');
    await db.query(
      `insert into public.auditoria_eventos (empleado_id, origen, evento, cliente_ts)
       values ($1, 'app', 'app_open', '1900-01-01T00:00:00Z')`,
      [EMP_A_ID],
    );

    await actAs(db, ADMIN_ID);
    const { rows } = await db.query<{ desfase_segundos: string | number }>(
      'select desfase_segundos from public.vw_auditoria_actividad',
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].desfase_segundos)).toBeGreaterThan(2_147_483_647);
  });

  it('does not fail triggers when creado_por exists in auth.users without a profiles row', async () => {
    const ORPHAN_ID = '55555555-5555-4555-8555-555555555555';
    await actAsOwner(db);
    await db.query('insert into auth.users (id) values ($1)', [ORPHAN_ID]);
    // Note: intentionally NOT inserting into public.profiles; relax fixture FK on ordenes_cambio to match prod auth.users
    await db.exec(`
      alter table public.ordenes_cambio drop constraint ordenes_cambio_creado_por_fkey;
      alter table public.ordenes_cambio add constraint ordenes_cambio_creado_por_fkey foreign key (creado_por) references auth.users(id);
    `);

    await db.query(
      `insert into public.ordenes_cambio (creado_por, nota, status)
       values ($1, 'legacy', 'emitido')`,
      [ORPHAN_ID],
    );

    const { rows } = await db.query<{ empleado_id: string }>(
      'select empleado_id from public.auditoria_eventos',
    );
    expect(rows).toEqual([{ empleado_id: ORPHAN_ID }]);
  });

  it('rejects oversized or non-object detalle payloads', async () => {
    await actAs(db, EMP_A_ID);

    await expect(
      db.query(
        `insert into public.auditoria_eventos (empleado_id, origen, evento, detalle)
         values ($1, 'app', 'app_open', '["array_not_allowed"]'::jsonb)`,
        [EMP_A_ID],
      ),
    ).rejects.toThrow();

    const huge = JSON.stringify({ pad: 'x'.repeat(17000) });
    await expect(
      db.query(
        `insert into public.auditoria_eventos (empleado_id, origen, evento, detalle)
         values ($1, 'app', 'app_open', $2::jsonb)`,
        [EMP_A_ID, huge],
      ),
    ).rejects.toThrow();
  });

  it('logs ordenes_cambio + items lifecycle via DB triggers and ignores HybridLite mirrors', async () => {
    await actAs(db, EMP_A_ID, 'sid-nelson-1');
    const { rows: [orden] } = await db.query<{ id: number }>(
      `insert into public.ordenes_cambio (creado_por, nota, status, aprobacion_estado)
       values ($1, 'Ajuste rápido', 'borrador', 'pendiente') returning id`,
      [EMP_A_ID],
    );

    await db.query(
      `insert into public.ordenes_cambio_items
         (orden_id, codigo_producto, descripcion, existencia_actual, nueva_existencia, delta, backend_status)
       values ($1, 'CEMCSC', 'CEMENTO', 356, 714, 358, 'espera_aprobacion')`,
      [orden.id],
    );

    await db.query(
      `update public.ordenes_cambio set status = 'emitido', pdf_url = 'https://pdf' where id = $1`,
      [orden.id],
    );

    // HybridLite mirror (owner role, no auth.uid(), creado_por IS NULL) must NOT pollute audit log on INSERT or UPDATE
    await actAsOwner(db);
    const { rows: [mirror] } = await db.query<{ id: number }>(
      `insert into public.ordenes_cambio (creado_por, nota, status)
       values (null, '[Local Inv ID: 630] - Ajuste #00000363', 'borrador') returning id`,
    );
    await db.query(
      `update public.ordenes_cambio set status = 'emitido' where id = $1`,
      [mirror.id],
    );
    await db.query(
      `insert into public.ordenes_cambio_items
         (orden_id, codigo_producto, existencia_actual, nueva_existencia, delta, backend_status)
       values ($1, 'CEMCSC', 354, 712, 358, 'completado')`,
      [mirror.id],
    );

    // Worker marks real item as completado
    await db.query(
      `update public.ordenes_cambio_items
       set backend_status = 'completado', backend_resultado = 'OK', backend_intentos = 1
       where orden_id = $1`,
      [orden.id],
    );

    // Admin approves/deletes
    await actAs(db, ADMIN_ID, 'sid-admin-1');
    await db.query(`delete from public.ordenes_cambio where id = $1`, [orden.id]);

    const { rows: logs } = await db.query<{
      evento: string;
      origen: string;
      empleado_id: string | null;
      detalle: Record<string, unknown>;
    }>('select evento, origen, empleado_id, detalle from public.auditoria_eventos order by creado_en asc, id asc');

    expect(logs.map((r) => r.evento)).toEqual([
      'db_orden_creada',
      'db_orden_item_creado',
      'db_orden_estado',
      'db_orden_item_estado',
      'db_orden_eliminada',
    ]);
    expect(logs.every((r) => r.origen === 'db_trigger')).toBe(true);
    expect(logs[0].empleado_id).toBe(EMP_A_ID);
    expect(logs[1].detalle).toMatchObject({ codigo_producto: 'CEMCSC', delta: 358 });
    expect(logs[4].empleado_id).toBe(ADMIN_ID);
  });

  it('logs compras_app creation and status transitions via DB triggers', async () => {
    await actAs(db, ADMIN_ID, 'sid-admin-2');
    const { rows: [compra] } = await db.query<{ id: number }>(
      `insert into public.compras_app (creado_por, titulo, proveedor_nombre, status)
       values ($1, 'Compra ARCI', 'FERRETERIA ARCI', 'borrador') returning id`,
      [ADMIN_ID],
    );

    await db.query(
      `update public.compras_app set status = 'emitido' where id = $1`,
      [compra.id],
    );

    const { rows: logs } = await db.query<{ evento: string; origen: string; detalle: Record<string, unknown> }>(
      'select evento, origen, detalle from public.auditoria_eventos order by creado_en asc, id asc',
    );

    expect(logs.map((r) => r.evento)).toEqual(['db_compra_creada', 'db_compra_estado']);
    expect(logs[1].detalle).toMatchObject({ status_anterior: 'borrador', status_nuevo: 'emitido' });
  });
});
