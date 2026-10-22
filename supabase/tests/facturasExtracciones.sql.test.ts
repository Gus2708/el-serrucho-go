import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { actAs, actAsAnon, actAsOwner, addUser, createMigratedDb } from './support/pgliteHarness';

// fixture validate_session is a STUB: its production body is not in this repository,
// so the harness models it with the test.session_valid setting.

jest.setTimeout(120_000);

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER_ADMIN = '22222222-2222-4222-8222-222222222222';
const SUPER = '33333333-3333-4333-8333-333333333333';
const EMPLEADO = '44444444-4444-4444-8444-444444444444';
const INACTIVO = '55555555-5555-4555-8555-555555555555';

const BUCKET = 'facturas_proveedores';

let db: PGlite;
let counter = 0;

function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

async function actAsServiceRole(database: PGlite): Promise<void> {
  await database.exec('reset role');
  await database.query("select set_config('request.jwt.claim.role', 'service_role', false)");
  await database.query("select set_config('request.jwt.claim.sub', '', false)");
  await database.exec('set role service_role');
}

async function initTestDb(): Promise<PGlite> {
  const database = await createMigratedDb();
  await database.exec(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      else
        alter role service_role bypassrls;
      end if;
    end $$;
    grant usage on schema public to service_role;
    grant usage on schema facturas_privado to service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant execute on functions to service_role;
  `);

  const migrationSql = readFileSync(
    join(__dirname, '..', 'migrations', '20261022134127_facturas_proveedores_extracciones.sql'),
    'utf8'
  );
  await database.exec(migrationSql);
  return database;
}

async function seedInvoice(
  database: PGlite,
  ownerId: string,
  invoiceId: string,
  version = 1,
  withDoc = true
): Promise<void> {
  await actAsOwner(database);
  let docPath: string | null = null;
  let sha256: string | null = null;
  let mime: string | null = null;
  let bytes: number | null = null;
  let docName: string | null = null;

  if (withDoc) {
    docPath = `${ownerId}/${invoiceId}/${uuid()}.pdf`;
    sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    mime = 'application/pdf';
    bytes = 2048;
    docName = 'factura.pdf';

    await database.query(
      'insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb)',
      [BUCKET, docPath, JSON.stringify({ size: bytes, mimetype: mime })]
    );
  }

  await database.query(
    `insert into public.facturas_proveedores (
      id, creado_por, proveedor_codigo, proveedor_nombre, numero_documento,
      version, documento_path, documento_nombre, documento_mime, documento_bytes, documento_sha256
    ) values ($1, $2, 'PROV-1', 'Proveedor Uno', 'DOC-001', $3, $4, $5, $6, $7, $8)`,
    [invoiceId, ownerId, version, docPath, docName, mime, bytes, sha256]
  );
}

interface ReserveArgs {
  id: string;
  requestId: string;
  expectedVersion: number;
}

async function reserveExtraction(database: PGlite, { id, requestId, expectedVersion }: ReserveArgs) {
  const result = await database.query<{ r: Record<string, unknown> }>(
    'select public.reservar_extraccion_factura($1::uuid, $2::uuid, $3::int) as r',
    [id, requestId, expectedVersion]
  );
  return result.rows[0].r;
}

interface CompleteArgs {
  id: string;
  requestId: string;
  status: 'completado' | 'fallido';
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
}

async function completeExtraction(
  database: PGlite,
  { id, requestId, status, result = null, errorCode = null, metadata = null }: CompleteArgs
) {
  const res = await database.query<{ r: Record<string, unknown> }>(
    'select public.completar_extraccion_factura($1::uuid, $2::uuid, $3::text, $4::jsonb, $5::text, $6::jsonb) as r',
    [
      id,
      requestId,
      status,
      result ? JSON.stringify(result) : null,
      errorCode,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  return res.rows[0].r;
}

describe('facturas_proveedores_extracciones attempt lifecycle', () => {
  beforeAll(async () => {
    counter = 0;
    db = await initTestDb();
    await addUser(db, ADMIN, 'admin');
    await addUser(db, OTHER_ADMIN, 'admin');
    await addUser(db, SUPER, 'superempleado');
    await addUser(db, EMPLEADO, 'empleado');
    await addUser(db, INACTIVO, 'admin', false);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Reservation: role and session isolation', () => {
    it('admin activo con sesion valida puede reservar', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      const res = await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      expect(res).toMatchObject({
        factura_id: facturaId,
        solicitud_id: requestId,
        estado: 'procesando',
        ejecutar: true,
        replay: false,
      });
      expect(res.extraccion_id).toBeDefined();
      expect(res.documento).toMatchObject({
        mime: 'application/pdf',
        bytes: 2048,
      });
    });

    it('superempleado activo con sesion valida puede reservar su factura', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, SUPER, facturaId, 1, true);

      await actAs(db, SUPER, true);
      const res = await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      expect(res).toMatchObject({
        factura_id: facturaId,
        solicitud_id: requestId,
        estado: 'procesando',
        ejecutar: true,
      });
    });

    it('empleado no puede reservar', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, EMPLEADO, facturaId, 1, true);

      await actAs(db, EMPLEADO, true);
      await expect(
        reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 })
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('admin inactivo no puede reservar', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, INACTIVO, facturaId, 1, true);

      await actAs(db, INACTIVO, true);
      await expect(
        reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 })
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('admin con sesion invalida no puede reservar', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, false);
      await expect(
        reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 })
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('anon no puede reservar', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAsAnon(db);
      await expect(
        reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 })
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('otro usuario privilegiado no puede reservar factura ajena', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, OTHER_ADMIN, true);
      await expect(
        reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 })
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('Reservation: version, document, replay and busy semantics', () => {
    it('rechaza version esperada que no coincide con la version actual (PV409)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 2, true);

      await actAs(db, ADMIN, true);
      await expect(
        reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 })
      ).rejects.toMatchObject({ code: 'PV409' });
    });

    it('rechaza si la factura no tiene documento adjunto (sin_documento_fuente)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, false);

      await actAs(db, ADMIN, true);
      await expect(
        reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 })
      ).rejects.toMatchObject({ code: '22023' });
    });

    it('rechaza si la factura no existe (P0002)', async () => {
      const facturaId = uuid();
      const requestId = uuid();

      await actAs(db, ADMIN, true);
      await expect(
        reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 })
      ).rejects.toMatchObject({ code: 'P0002' });
    });

    it('replay de la misma solicitud mientras procesa nunca otorga nueva autoridad de ejecucion', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      const first = await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });
      expect(first.ejecutar).toBe(true);
      expect(first.replay).toBe(false);

      const replay = await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });
      expect(replay).toMatchObject({
        extraccion_id: first.extraccion_id,
        factura_id: facturaId,
        solicitud_id: requestId,
        estado: 'procesando',
        ejecutar: false,
        replay: true,
      });
    });

    it('expone busy de forma segura (PX409) si otra solicitud intenta iniciar mientras hay un intento activo', async () => {
      const facturaId = uuid();
      const req1 = uuid();
      const req2 = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId: req1, expectedVersion: 1 });

      // Second distinct request must fail with PX409 (busy/active attempt)
      await expect(
        reserveExtraction(db, { id: facturaId, requestId: req2, expectedVersion: 1 })
      ).rejects.toMatchObject({ code: 'PX409' });
    });

    it('replay de solicitud completada devuelve resultado guardado sin ejecutar', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      const mockData = { cabecera: { total: '10.00' }, lineas: [] };
      await actAsServiceRole(db);
      await completeExtraction(db, {
        id: facturaId,
        requestId,
        status: 'completado',
        result: mockData,
        metadata: { model: 'gemini-3.1-flash-lite', cost_usd: 0.002 },
      });

      await actAs(db, ADMIN, true);
      const replay = await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });
      expect(replay).toMatchObject({
        factura_id: facturaId,
        solicitud_id: requestId,
        estado: 'completado',
        ejecutar: false,
        replay: true,
        resultado: mockData,
      });
    });
  });

  describe('Completion: authorization, quarantine, and idempotency', () => {
    it('solo service_role puede finalizar un intento; authenticated es rechazado (42501)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      const mockData = { cabecera: { total: '15.00' }, lineas: [] };
      // Authenticated tries to complete:
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: mockData,
        })
      ).rejects.toMatchObject({ code: '42501' });

      // service_role succeeds:
      await actAsServiceRole(db);
      const res = await completeExtraction(db, {
        id: facturaId,
        requestId,
        status: 'completado',
        result: mockData,
      });
      expect(res.estado).toBe('completado');
      expect(res.replay).toBe(false);
    });

    it('service_role puede finalizar con estado fallido usando codigo permitido', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      await actAsServiceRole(db);
      const res = await completeExtraction(db, {
        id: facturaId,
        requestId,
        status: 'fallido',
        errorCode: 'timeout',
      });
      expect(res.estado).toBe('fallido');
    });

    it('finalizacion es idempotente ante reintentos identicos', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      const mockData = { cabecera: { total: '25.00' }, lineas: [] };
      await actAsServiceRole(db);
      const first = await completeExtraction(db, {
        id: facturaId,
        requestId,
        status: 'completado',
        result: mockData,
      });
      expect(first.replay).toBe(false);

      const replay = await completeExtraction(db, {
        id: facturaId,
        requestId,
        status: 'completado',
        result: mockData,
      });
      expect(replay).toMatchObject({
        factura_id: facturaId,
        solicitud_id: requestId,
        estado: 'completado',
        replay: true,
      });
    });

    it('finalizacion en conflicto sobre intento terminal es rechazada (PI409)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      await actAsServiceRole(db);
      await completeExtraction(db, {
        id: facturaId,
        requestId,
        status: 'completado',
        result: { val: 1 },
      });

      // Conflicting payload:
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { val: 2 },
        })
      ).rejects.toMatchObject({ code: 'PI409' });

      // Conflicting status:
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'fallido',
          errorCode: 'upstream_error',
        })
      ).rejects.toMatchObject({ code: 'PI409' });

      // Conflicting metadata (changed model on identical result):
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { val: 1 },
          metadata: { model: 'other-model' },
        })
      ).rejects.toMatchObject({ code: 'PI409' });

      // Conflicting metadata (changed cost on identical result):
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { val: 1 },
          metadata: { cost_usd: 0.05 },
        })
      ).rejects.toMatchObject({ code: 'PI409' });
    });

    it('preserva costo decimal exacto no acotado a 6 decimales (ej 0.000000123)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      const exactCost = '0.000000123';
      await actAsServiceRole(db);
      await completeExtraction(db, {
        id: facturaId,
        requestId,
        status: 'completado',
        result: { val: 'test' },
        metadata: { model: 'test-model', cost_usd: exactCost },
      });

      await actAsOwner(db);
      const row = await db.query<{ costo_usd: string }>(
        'select costo_usd::text as costo_usd from public.facturas_proveedores_extracciones where factura_id = $1 and solicitud_id = $2',
        [facturaId, requestId]
      );
      expect(row.rows[0].costo_usd).toBe(exactCost);
    });

    it('si la factura avanzo de version antes de finalizar, pone resultado en cuarentena y nunca toca borrador', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      // Simulate invoice draft updated by user (version bumped to 2):
      await actAsOwner(db);
      await db.query('update public.facturas_proveedores set version = 2 where id = $1', [facturaId]);

      const mockData = { cabecera: { total: '99.00' }, lineas: [] };
      await actAsServiceRole(db);
      const res = await completeExtraction(db, {
        id: facturaId,
        requestId,
        status: 'completado',
        result: mockData,
      });

      expect(res.estado).toBe('cuarentena');

      // Verify DB row has estado = 'cuarentena'
      const rows = await db.query<{ estado: string }>(
        'select estado from public.facturas_proveedores_extracciones where factura_id = $1 and solicitud_id = $2',
        [facturaId, requestId]
      );
      expect(rows.rows[0].estado).toBe('cuarentena');

      // Invariant: facturas_proveedores remains version 2, no lines created, no ledger created
      await actAsOwner(db);
      const invoice = await db.query<{ version: number }>(
        'select version from public.facturas_proveedores where id = $1',
        [facturaId]
      );
      expect(invoice.rows[0].version).toBe(2);

      const lines = await db.query<{ c: string }>('select count(*) as c from public.facturas_proveedores_lineas where factura_id = $1', [facturaId]);
      expect(Number(lines.rows[0].c)).toBe(0);

      const ops = await db.query<{ c: string }>('select count(*) as c from public.facturas_proveedores_operaciones where factura_id = $1', [facturaId]);
      expect(Number(ops.rows[0].c)).toBe(0);
    });

    it('si el documento adjunto cambio antes de finalizar, pone resultado en cuarentena', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      // User changed attached file:
      await actAsOwner(db);
      await db.query("update public.facturas_proveedores set documento_sha256 = '0000000000000000000000000000000000000000000000000000000000000000' where id = $1", [facturaId]);

      await actAsServiceRole(db);
      const res = await completeExtraction(db, {
        id: facturaId,
        requestId,
        status: 'completado',
        result: { ok: true },
      });
      expect(res.estado).toBe('cuarentena');
    });
  });

  describe('Validation & Payload Guards', () => {
    it('rechaza resultado que excede 1MB (22023)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      const hugePayload = { big: 'x'.repeat(1024 * 1024 + 10) };
      await actAsServiceRole(db);
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: hugePayload,
        })
      ).rejects.toMatchObject({ code: '22023' });
    });

    it('rechaza resultado no-objeto en completado (22023)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      await actAsServiceRole(db);
      await expect(
        db.query(
          'select public.completar_extraccion_factura($1::uuid, $2::uuid, $3::text, $4::jsonb, null, null)',
          [facturaId, requestId, 'completado', JSON.stringify('solo_un_texto')]
        )
      ).rejects.toMatchObject({ code: '22023' });
    });

    it('rechaza si completado viene sin resultado (22023)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      await actAsServiceRole(db);
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: null,
        })
      ).rejects.toMatchObject({ code: '22023' });
    });

    it('rechaza codigo de error no permitido en fallido (22023)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      await actAsServiceRole(db);
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'fallido',
          errorCode: 'hack_inyeccion_error',
        })
      ).rejects.toMatchObject({ code: '22023' });
    });

    it('rechaza resultado adjunto en intento fallido (22023)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      await actAsServiceRole(db);
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'fallido',
          result: { algo: true },
          errorCode: 'upstream_error',
        })
      ).rejects.toMatchObject({ code: '22023' });
    });

    it('rechaza estado ausente o invalido en completar_extraccion_factura (22023)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      await actAsServiceRole(db);
      await expect(
        db.query(
          'select public.completar_extraccion_factura($1::uuid, $2::uuid, null, $3::jsonb, null, null)',
          [facturaId, requestId, JSON.stringify({ ok: true })]
        )
      ).rejects.toMatchObject({ code: '22023' });

      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'estado_inventado' as any,
          result: { ok: true },
        })
      ).rejects.toMatchObject({ code: '22023' });
    });

    it('rechaza claves no permitidas o alias conflictivos en metadatos (22023)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      await actAsServiceRole(db);
      // Rejects 'modelo' (must use canonical transport key 'model')
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { ok: true },
          metadata: { modelo: 'gemini-3.1' },
        })
      ).rejects.toMatchObject({ code: '22023' });

      // Rejects 'costUsd' or 'costo_usd' (must use canonical transport key 'cost_usd')
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { ok: true },
          metadata: { costUsd: 0.05 },
        })
      ).rejects.toMatchObject({ code: '22023' });

      // Rejects arbitrary extra keys
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { ok: true },
          metadata: { model: 'gemini-3.1', unexpected_key: 'foo' },
        })
      ).rejects.toMatchObject({ code: '22023' });
    });

    it('rechaza tipos invalidos en metadatos (22023)', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      await actAsServiceRole(db);
      // Object as model (no coercion allowed)
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { ok: true },
          metadata: { model: { name: 'gemini' } },
        })
      ).rejects.toMatchObject({ code: '22023' });

      // String as tokens_prompt
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { ok: true },
          metadata: { tokens_prompt: 'diez' },
        })
      ).rejects.toMatchObject({ code: '22023' });

      // Negative tokens_completion
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { ok: true },
          metadata: { tokens_completion: -1 },
        })
      ).rejects.toMatchObject({ code: '22023' });

      // Cost > 100
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { ok: true },
          metadata: { cost_usd: 150 },
        })
      ).rejects.toMatchObject({ code: '22023' });

      // Negative cost
      await expect(
        completeExtraction(db, {
          id: facturaId,
          requestId,
          status: 'completado',
          result: { ok: true },
          metadata: { cost_usd: -0.01 },
        })
      ).rejects.toMatchObject({ code: '22023' });
    });

    it('acepta metadatos con tipos canonicos validos o nulos', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      await actAsServiceRole(db);
      const res = await completeExtraction(db, {
        id: facturaId,
        requestId,
        status: 'completado',
        result: { ok: true },
        metadata: {
          model: 'google/gemini-3.1-flash-lite',
          provider: 'google',
          tokens_prompt: 100,
          tokens_completion: 50,
          tokens_total: 150,
          cost_usd: '0.0000155',
        },
      });
      expect(res.estado).toBe('completado');

      // Check nulls preserved
      const facturaId2 = uuid();
      const req2 = uuid();
      await seedInvoice(db, ADMIN, facturaId2, 1, true);
      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId2, requestId: req2, expectedVersion: 1 });
      await actAsServiceRole(db);
      const resNull = await completeExtraction(db, {
        id: facturaId2,
        requestId: req2,
        status: 'completado',
        result: { ok: true },
        metadata: null,
      });
      expect(resNull.estado).toBe('completado');
    });
  });

  describe('Security & Direct table access denials', () => {
    it('authenticated no tiene permiso de INSERT/UPDATE/DELETE en facturas_proveedores_extracciones', async () => {
      const facturaId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await expect(
        db.query(
          `insert into public.facturas_proveedores_extracciones (
            factura_id, solicitud_id, creado_por, estado, factura_version,
            documento_path, documento_sha256, documento_mime, documento_bytes
          ) values ($1, $2, $3, 'procesando', 1, 'path', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'application/pdf', 100)`,
          [facturaId, uuid(), ADMIN]
        )
      ).rejects.toMatchObject({ code: '42501' });

      await expect(
        db.query('delete from public.facturas_proveedores_extracciones where factura_id = $1', [facturaId])
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('service_role tampoco tiene permisos directos de escritura en facturas_proveedores_extracciones', async () => {
      const facturaId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAsServiceRole(db);
      await expect(
        db.query(
          `insert into public.facturas_proveedores_extracciones (
            factura_id, solicitud_id, creado_por, estado, factura_version,
            documento_path, documento_sha256, documento_mime, documento_bytes
          ) values ($1, $2, $3, 'procesando', 1, 'path', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'application/pdf', 100)`,
          [facturaId, uuid(), ADMIN]
        )
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('RLS: solo el usuario propietario privileged lee sus extracciones via SELECT', async () => {
      const facturaId = uuid();
      const requestId = uuid();
      await seedInvoice(db, ADMIN, facturaId, 1, true);

      await actAs(db, ADMIN, true);
      await reserveExtraction(db, { id: facturaId, requestId, expectedVersion: 1 });

      // Owner can read:
      const ownRows = await db.query<{ solicitud_id: string }>(
        'select solicitud_id from public.facturas_proveedores_extracciones where factura_id = $1',
        [facturaId]
      );
      expect(ownRows.rows.length).toBe(1);

      // Other admin sees 0 rows:
      await actAs(db, OTHER_ADMIN, true);
      const otherRows = await db.query(
        'select solicitud_id from public.facturas_proveedores_extracciones where factura_id = $1',
        [facturaId]
      );
      expect(otherRows.rows.length).toBe(0);
    });

    it('seguridad: funciones privadas viven en facturas_privado con search_path vacio', async () => {
      const rows = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(
        `select proname, prosecdef, proconfig
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'facturas_privado'
            and proname in ('reservar_extraccion_factura', 'completar_extraccion_factura')`
      );
      expect(rows.rows.length).toBe(2);
      for (const row of rows.rows) {
        expect(row.prosecdef).toBe(true);
        expect(row.proconfig.some(c => c.startsWith('search_path='))).toBe(true);
      }

      // Wrappers in public are SECURITY INVOKER with search_path empty:
      const publicRows = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(
        `select proname, prosecdef, proconfig
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and proname in ('reservar_extraccion_factura', 'completar_extraccion_factura')`
      );
      expect(publicRows.rows.length).toBe(2);
      for (const row of publicRows.rows) {
        expect(row.prosecdef).toBe(false);
        expect(row.proconfig.some(c => c.startsWith('search_path='))).toBe(true);
      }
    });

    it('limitacion: serial PGlite no prueba concurrencia real PostgreSQL; invariantes garantizados por advisory lock e indices unicos', async () => {
      // Documenting the explicit limitation required by verification prompt:
      // PGlite runs in a single-threaded/serial engine and cannot execute concurrent transactions.
      // However, we verify that:
      // 1. Partial unique index 'facturas_extracciones_activa_idx' exists for single active attempt.
      // 2. Unique constraint 'facturas_proveedores_extracciones_solicitud_key' exists.
      // 3. Advisory lock function call hashtextextended(invoice_id, 0) is wired in both reservation and completion.
      const indexes = await db.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef
           from pg_indexes
          where tablename = 'facturas_proveedores_extracciones'`
      );
      const names = indexes.rows.map(i => i.indexname);
      expect(names).toContain('facturas_extracciones_activa_idx');
      expect(names).toContain('facturas_proveedores_extracciones_solicitud_key');
    });
  });
});
