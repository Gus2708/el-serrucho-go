import type { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { actAs, actAsAnon, actAsOwner, addUser, createMigratedDb } from './support/pgliteHarness';

// Models the frozen production pre-state of public.buscar_productos (SECURITY DEFINER,
// VOLATILE, mutable search_path, PUBLIC/anon EXECUTE) and repo migration 004_rls.sql
// auth_read policy on an isolated PGlite engine with pg_trgm. This verifies the local
// migration contract only and does NOT prove real production RLS policies or live grants.

jest.setTimeout(120_000);

const ADMIN = '11111111-1111-4111-8111-111111111111';
const SUPER = '22222222-2222-4222-8222-222222222222';
const EMPLEADO = '33333333-3333-4333-8333-333333333333';
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const TARGET_SIG = 'public.buscar_productos(text, integer)';
const SIBLING_SIG = 'public.buscar_fuzzy(text)';

interface BuscarProductoRow {
  codigo_interno: string;
  descripcion: string;
  precio_venta: string;
  existencia: string;
  total_vendido: string;
  score: number;
}

interface BaselineSnapshot {
  empleado: Record<string, BuscarProductoRow[]>;
  admin: Record<string, BuscarProductoRow[]>;
  superempleado: Record<string, BuscarProductoRow[]>;
  serviceRole: Record<string, BuscarProductoRow[]>;
  columnTypes: Array<{ name: string; dataTypeID: number }>;
  argDefaults: string;
  resultType: string;
  productosJson: string;
  siblingDef: string;
  siblingAcl: string | null;
}

const PRE_STATE_FIXTURE = `
create extension pg_trgm schema public;

create role service_role nologin bypassrls;
create role public_only_caller nologin;

grant usage on schema public to service_role, public_only_caller;

create table public.productos (
  codigo_interno text primary key,
  descripcion    text not null,
  precio_venta   numeric not null,
  existencia     numeric not null,
  total_vendido  numeric not null default 0
);

alter table public.productos enable row level security;

-- Matches supabase/migrations/004_rls.sql (modeled local policy, not live DB proof).
create policy "auth_read" on public.productos
  for select to authenticated using (true);

grant select on public.productos to authenticated, service_role;

insert into public.productos (codigo_interno, descripcion, precio_venta, existencia, total_vendido) values
  ('SKU-M1',       'MARTILLO GALPONERO MANGO MADERA 16OZ',                                12.50, 10, 45),
  ('SKU-M2',       'MARTILLO DE BOLA ACERO FORJADO 24OZ',                                 18.00,  4, 20),
  ('SKU-M3',       'MARTILLO GOMA NEGRA MANGO FIBRA 16OZ',                                11.00, 15, 35),
  ('SKU-M4',       'MARTILLO CARPINTERO UÑA CURVA 20OZ',                                  14.75,  7, 60),
  ('SKU-M5',       'MARTILLO MAZO PESADO CABEZA ACERO 32OZ',                               24.00,  2, 12),
  ('SKU-M6',       'MARTILLO TAPICERO MINI PRECISION 8OZ',                                 9.50, 18,  8),
  ('SKU-ILIKE',    'LAMPARA EMPOTRABLE INDUSTRIAL DE TECHO CON BOMBILLO LED BLANCO FRIO', 25.00,  8, 12),
  ('SKU-TRGM',     'DESTORNILLADOR PLANO MAGNETICO AISLADO',                               6.25, 22, 30),
  ('SKU-TIE-LOW',  'LLAVE MIXTA CROMO VANADIO 14MM',                                       8.00, 30, 10),
  ('SKU-TIE-MID',  'LLAVE MIXTA CROMO VANADIO 14MM',                                       8.00,  5, 40),
  ('SKU-TIE-HIGH', 'LLAVE MIXTA CROMO VANADIO 14MM',                                       8.00, 19, 40),
  ('SKU-RLS-ONLY', 'TALADRO PERCUTOR INDUSTRIAL CONTROL RLS 750W',                        89.00,  3,  1);

-- Frozen pre-state body and grants from db/rpc-definitions.sql.
create or replace function public.buscar_productos(p_busqueda text, p_limite integer default 5)
 returns table(codigo_interno text, descripcion text, precio_venta numeric, existencia numeric, total_vendido numeric, score double precision)
 language plpgsql
 security definer
as $function$
begin
  return query
  select
    p.codigo_interno,
    p.descripcion,
    p.precio_venta,
    p.existencia,
    p.total_vendido,
    similarity(p.descripcion, p_busqueda)::float as score
  from public.productos p
  where p.descripcion % p_busqueda or p.descripcion ilike ('%' || p_busqueda || '%')
  order by score desc, p.total_vendido desc, p.existencia desc
  limit p_limite;
end;
$function$;

grant execute on function public.buscar_productos(text, integer) to public, anon, authenticated, service_role;

-- Unrelated sibling RPC used to assert no other RPC or grant is altered.
create or replace function public.buscar_fuzzy(p_term text)
 returns table(codigo_interno text)
 language sql
 stable
as $function$
  select p.codigo_interno from public.productos p where p.descripcion ilike ('%' || p_term || '%') limit 5
$function$;

grant execute on function public.buscar_fuzzy(text) to public, anon, authenticated, service_role;
`;

const FIXED_QUERIES: Array<{ key: string; term: string; limit?: number }> = [
  { key: 'default_limit', term: 'martillo' },
  { key: 'explicit_limit_2', term: 'martillo', limit: 2 },
  { key: 'ilike_only', term: 'led', limit: 8 },
  { key: 'trigram_only', term: 'destornilador plano', limit: 8 },
  { key: 'tie_break', term: 'LLAVE MIXTA CROMO VANADIO 14MM', limit: 8 },
  { key: 'no_match', term: 'zzzz_producto_inexistente_999', limit: 8 },
];

function findHardeningMigrationSql(): string {
  const matches = readdirSync(MIGRATIONS_DIR).filter(name => name.endsWith('_buscar_productos_search_path.sql'));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one *_buscar_productos_search_path.sql migration, found ${matches.length}`);
  }
  return readFileSync(join(MIGRATIONS_DIR, matches[0]), 'utf8');
}

async function actAsServiceRole(database: PGlite): Promise<void> {
  await database.exec('reset role');
  await database.query("select set_config('request.jwt.claim.role', 'service_role', false)");
  await database.query("select set_config('request.jwt.claim.sub', '', false)");
  await database.exec('set role service_role');
}

async function actAsPublicOnly(database: PGlite): Promise<void> {
  await database.exec('reset role');
  await database.query("select set_config('request.jwt.claim.sub', '', false)");
  await database.exec('set role public_only_caller');
}

async function callBuscarProductos(
  database: PGlite,
  term: string,
  limit?: number
): Promise<BuscarProductoRow[]> {
  if (limit === undefined) {
    const res = await database.query<BuscarProductoRow>('select * from public.buscar_productos($1)', [term]);
    return res.rows;
  }
  const res = await database.query<BuscarProductoRow>('select * from public.buscar_productos($1, $2)', [term, limit]);
  return res.rows;
}

async function runFixedQueries(database: PGlite): Promise<Record<string, BuscarProductoRow[]>> {
  const results: Record<string, BuscarProductoRow[]> = {};
  for (const q of FIXED_QUERIES) {
    results[q.key] = await callBuscarProductos(database, q.term, q.limit);
  }
  return results;
}

async function snapshotProductos(database: PGlite): Promise<string> {
  await actAsOwner(database);
  const res = await database.query('select * from public.productos order by codigo_interno');
  return JSON.stringify(res.rows);
}

async function readSiblingMetadata(database: PGlite): Promise<{ def: string; acl: string | null }> {
  await actAsOwner(database);
  const res = await database.query<{ def: string; acl: string | null }>(
    'select pg_get_functiondef(oid) as def, proacl::text as acl from pg_proc where oid = $1::regprocedure',
    [SIBLING_SIG]
  );
  return res.rows[0];
}

async function hasExecutePrivilege(database: PGlite, role: string): Promise<boolean> {
  const res = await database.query<{ ok: boolean }>(
    "select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as ok",
    [role, TARGET_SIG]
  );
  return res.rows[0].ok;
}

describe('buscar_productos local search_path and privilege hardening', () => {
  let db: PGlite;
  let baseline: BaselineSnapshot;

  beforeAll(async () => {
    db = await createMigratedDb({ pg_trgm });
    await db.exec(PRE_STATE_FIXTURE);
    await addUser(db, ADMIN, 'admin');
    await addUser(db, SUPER, 'superempleado');
    await addUser(db, EMPLEADO, 'empleado');

    // Capture exact authorized baseline outputs BEFORE applying the hardening migration.
    await actAs(db, EMPLEADO);
    const empleado = await runFixedQueries(db);
    const sampleRes = await db.query<BuscarProductoRow>('select * from public.buscar_productos($1, $2)', ['martillo', 2]);

    await actAs(db, ADMIN);
    const admin = await runFixedQueries(db);

    await actAs(db, SUPER);
    const superempleado = await runFixedQueries(db);

    await actAsServiceRole(db);
    const serviceRole = await runFixedQueries(db);

    await actAsOwner(db);
    const sigRes = await db.query<{ args: string; ret: string }>(
      'select pg_get_function_arguments(oid) as args, pg_get_function_result(oid) as ret from pg_proc where oid = $1::regprocedure',
      [TARGET_SIG]
    );
    const sibling = await readSiblingMetadata(db);
    const productosJson = await snapshotProductos(db);

    baseline = {
      empleado,
      admin,
      superempleado,
      serviceRole,
      columnTypes: sampleRes.fields.map(f => ({ name: f.name, dataTypeID: f.dataTypeID })),
      argDefaults: sigRes.rows[0].args,
      resultType: sigRes.rows[0].ret,
      productosJson,
      siblingDef: sibling.def,
      siblingAcl: sibling.acl,
    };

    // Apply the local hardening migration onto the modeled pre-state.
    await actAsOwner(db);
    await db.exec(findHardeningMigrationSql());
  });

  afterAll(async () => {
    await db.close();
  });

  it('exercises genuinely ILIKE-only and trigram-only fixture paths', async () => {
    await actAsOwner(db);
    const ilikeCheck = await db.query<{ by_trgm: boolean; by_ilike: boolean }>(
      `select (descripcion operator(public.%) $1) as by_trgm,
              (descripcion ilike ('%' || $1 || '%')) as by_ilike
         from public.productos
        where codigo_interno = 'SKU-ILIKE'`,
      ['led']
    );
    expect(ilikeCheck.rows[0]).toEqual({ by_trgm: false, by_ilike: true });

    const trgmCheck = await db.query<{ by_trgm: boolean; by_ilike: boolean }>(
      `select (descripcion operator(public.%) $1) as by_trgm,
              (descripcion ilike ('%' || $1 || '%')) as by_ilike
         from public.productos
        where codigo_interno = 'SKU-TRGM'`,
      ['destornilador plano']
    );
    expect(trgmCheck.rows[0]).toEqual({ by_trgm: true, by_ilike: false });
  });

  it('preserves signature, defaults, return column types, rows, order and scores for authenticated roles and service_role', async () => {
    await actAsOwner(db);
    const sigRes = await db.query<{ args: string; ret: string }>(
      'select pg_get_function_arguments(oid) as args, pg_get_function_result(oid) as ret from pg_proc where oid = $1::regprocedure',
      [TARGET_SIG]
    );
    expect(sigRes.rows[0].args).toBe(baseline.argDefaults);
    expect(sigRes.rows[0].ret).toBe(baseline.resultType);

    await actAs(db, EMPLEADO);
    const postEmpleado = await runFixedQueries(db);
    expect(postEmpleado).toEqual(baseline.empleado);
    expect(postEmpleado.default_limit).toHaveLength(5);
    expect(postEmpleado.explicit_limit_2).toHaveLength(2);
    expect(postEmpleado.ilike_only.map(r => r.codigo_interno)).toEqual(['SKU-ILIKE']);
    expect(postEmpleado.trigram_only.map(r => r.codigo_interno)).toEqual(['SKU-TRGM']);
    expect(postEmpleado.tie_break.map(r => r.codigo_interno)).toEqual(['SKU-TIE-HIGH', 'SKU-TIE-MID', 'SKU-TIE-LOW']);
    expect(postEmpleado.no_match).toEqual([]);

    const sampleRes = await db.query<BuscarProductoRow>('select * from public.buscar_productos($1, $2)', ['martillo', 2]);
    expect(sampleRes.fields.map(f => ({ name: f.name, dataTypeID: f.dataTypeID }))).toEqual(baseline.columnTypes);

    await actAs(db, ADMIN);
    expect(await runFixedQueries(db)).toEqual(baseline.admin);

    await actAs(db, SUPER);
    expect(await runFixedQueries(db)).toEqual(baseline.superempleado);

    await actAsServiceRole(db);
    expect(await runFixedQueries(db)).toEqual(baseline.serviceRole);

    expect(await snapshotProductos(db)).toBe(baseline.productosJson);
  });

  it('denies EXECUTE with 42501 to anon and PUBLIC while keeping authenticated and service_role executable', async () => {
    await actAsAnon(db);
    await expect(callBuscarProductos(db, 'martillo', 5)).rejects.toMatchObject({ code: '42501' });

    await actAsPublicOnly(db);
    await expect(callBuscarProductos(db, 'martillo', 5)).rejects.toMatchObject({ code: '42501' });

    await actAsOwner(db);
    expect(await hasExecutePrivilege(db, 'anon')).toBe(false);
    expect(await hasExecutePrivilege(db, 'public_only_caller')).toBe(false);
    expect(await hasExecutePrivilege(db, 'authenticated')).toBe(true);
    expect(await hasExecutePrivilege(db, 'service_role')).toBe(true);
  });

  it('sets SECURITY INVOKER, STABLE, fixed empty search_path and revokes PUBLIC execute in pg_proc', async () => {
    await actAsOwner(db);
    const meta = await db.query<{
      prosecdef: boolean;
      provolatile: string;
      proconfig: string[] | null;
      proacl: string | null;
    }>(
      'select prosecdef, provolatile, proconfig, proacl::text from pg_proc where oid = $1::regprocedure',
      [TARGET_SIG]
    );
    expect(meta.rows).toHaveLength(1);
    expect(meta.rows[0].prosecdef).toBe(false);
    expect(meta.rows[0].provolatile).toBe('s');
    expect(meta.rows[0].proconfig).toContain('search_path=""');
    expect(meta.rows[0].proacl ?? '').not.toMatch(/(^\{|,)=X/);
    expect(meta.rows[0].proacl ?? '').not.toMatch(/(^\{|,)anon=X/);
  });

  it('prevents caller-writable schema shadows from redirecting tables, functions or operators', async () => {
    await actAsOwner(db);
    await db.exec(`
      create schema attacker_schema;
      grant usage, create on schema attacker_schema to authenticated;
    `);

    await actAs(db, EMPLEADO);
    await db.exec(`
      create table attacker_schema.productos (
        codigo_interno text primary key,
        descripcion    text not null,
        precio_venta   numeric not null,
        existencia     numeric not null,
        total_vendido  numeric not null default 0
      );
      insert into attacker_schema.productos values
        ('POISON-SKU', 'MARTILLO ENVENENADO', 0.01, 999, 999);

      create function attacker_schema.similarity(text, text)
      returns real language sql immutable as $$ select 99.0::real $$;

      create function attacker_schema.shadow_trgm_match(text, text)
      returns boolean language sql immutable as $$ select true $$;

      create operator attacker_schema.% (
        leftarg = text,
        rightarg = text,
        function = attacker_schema.shadow_trgm_match
      );
    `);

    const expectedMartillo = await callBuscarProductos(db, 'martillo', 8);

    try {
      await db.exec('set search_path to attacker_schema, public');
      expect(await callBuscarProductos(db, 'martillo', 8)).toEqual(expectedMartillo);
      expect(await callBuscarProductos(db, 'zzzz_producto_inexistente_999', 8)).toEqual([]);
      expect(await callBuscarProductos(db, 'destornilador plano', 8)).toEqual(baseline.empleado.trigram_only);
    } finally {
      await db.exec('reset search_path');
    }
  });

  it('upholds RLS on public.productos as SECURITY INVOKER while service_role bypasses RLS', async () => {
    await actAsOwner(db);
    await db.exec('begin');
    try {
      await db.exec('drop policy "auth_read" on public.productos');
      await db.exec(`
        create policy "auth_read_restricted" on public.productos
          for select to authenticated
          using (codigo_interno <> 'SKU-RLS-ONLY');
      `);

      await actAs(db, EMPLEADO);
      const employeeRows = await callBuscarProductos(db, 'CONTROL RLS', 5);
      expect(employeeRows).toEqual([]);

      await actAsServiceRole(db);
      const serviceRows = await callBuscarProductos(db, 'CONTROL RLS', 5);
      expect(serviceRows.map(r => r.codigo_interno)).toEqual(['SKU-RLS-ONLY']);
    } finally {
      await actAsOwner(db);
      await db.exec('rollback');
    }
  });

  it('leaves unrelated RPC definitions and grants untouched', async () => {
    const siblingAfter = await readSiblingMetadata(db);
    expect(siblingAfter.def).toBe(baseline.siblingDef);
    expect(siblingAfter.acl).toBe(baseline.siblingAcl);
  });

  it('preserves default createMigratedDb() behavior when called without extensions', async () => {
    const defaultDb = await createMigratedDb();
    try {
      const res = await defaultDb.query<{ exists: boolean }>(
        "select exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'facturas_proveedores') as exists"
      );
      expect(res.rows[0].exists).toBe(true);
    } finally {
      await defaultDb.close();
    }
  });
});
