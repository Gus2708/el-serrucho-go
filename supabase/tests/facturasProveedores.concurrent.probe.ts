// Two-connection race probe for the source document (not part of `npm run test:sql`:
// the file name does not match *.test.ts, and PGlite has a single connection).
//
// Target: a disposable Supabase Postgres container that already has the fixture
// (support/documentRaceFixture.sql) and the invoice migrations applied. It uses
// `docker exec psql`, so it needs no extra dependency and never touches a real project.
//
//   PROBE_CONTAINER=<name> node --experimental-vm-modules node_modules/jest/bin/jest.js \
//     --testMatch '**/*.concurrent.probe.ts' --testPathIgnorePatterns=/node_modules/ --runInBand
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process';

jest.setTimeout(60_000);

const CONTAINER = process.env.PROBE_CONTAINER;
const ADMIN = '11111111-1111-4111-8111-111111111111';
const PSQL = ['psql', '-U', 'supabase_admin', '-d', 'postgres', '-qAt'];

let counter = 0;
const uuid = (): string => `00000000-0000-4000-8000-${String(++counter + Date.now() % 1_000_000).padStart(12, '0')}`;

function admin(sql: string): string {
  if (!CONTAINER) throw new Error('PROBE_CONTAINER is required');
  return execFileSync('docker', ['exec', CONTAINER, ...PSQL, '-c', sql], { encoding: 'utf8' }).trim();
}

class Session {
  private readonly proc: ChildProcessWithoutNullStreams;
  private output = '';
  private marks = 0;

  constructor(readonly name: string) {
    this.proc = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${name}`, CONTAINER!, 'sh', '-c', `exec ${PSQL.join(' ')} 2>&1`]);
    this.proc.stdout.on('data', chunk => (this.output += chunk));
  }

  /** Sends statements and resolves with everything psql printed before the end marker. */
  run(sql: string): Promise<string> {
    const mark = `__END_${this.name}_${++this.marks}__`;
    this.proc.stdin.write(`${sql}\n\\echo ${mark}\n`);
    return new Promise(resolve => {
      const timer = setInterval(() => {
        const at = this.output.indexOf(mark);
        if (at < 0) return;
        clearInterval(timer);
        const text = this.output.slice(0, at);
        this.output = this.output.slice(at + mark.length);
        resolve(text.trim());
      }, 20);
    });
  }

  asAuthenticated(): Promise<string> {
    return this.run(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${ADMIN}', true);`);
  }

  close(): void {
    this.proc.stdin.end();
  }
}

function isWaitingOnLock(name: string): boolean {
  return admin(`select count(*) from pg_stat_activity where application_name = '${name}' and wait_event_type = 'Lock'`) === '1';
}

async function waitUntil(condition: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

function newDocument(): { facturaId: string; path: string; save: string } {
  const facturaId = uuid();
  const path = `${ADMIN}/${facturaId}/${uuid()}.pdf`;
  admin(
    `insert into storage.objects (bucket_id, name, metadata) values ('facturas_proveedores', '${path}', '{"size":2048,"mimetype":"application/pdf"}')`,
  );
  const cabecera = JSON.stringify({
    proveedor_codigo: 'PROV-1',
    proveedor_nombre: 'Distribuidora Norte',
    numero_documento: 'A-001',
    numero_control: '00-123',
    fecha_documento: '2026-10-01',
    moneda: 'USD',
    notas: null,
    documento: { path, nombre: 'factura.pdf', mime: 'application/pdf', bytes: 2048, sha256: 'a'.repeat(64) },
  });
  const save = `select public.guardar_factura_proveedor('${facturaId}', 0, '${uuid()}', '${cabecera}'::jsonb, '[]'::jsonb);`;
  return { facturaId, path, save };
}

function state(facturaId: string, path: string): { invoiceHasDocument: boolean; objectExists: boolean } {
  return {
    invoiceHasDocument: admin(`select count(*) from public.facturas_proveedores where id = '${facturaId}' and documento_path = '${path}'`) === '1',
    objectExists: admin(`select count(*) from storage.objects where bucket_id = 'facturas_proveedores' and name = '${path}'`) === '1',
  };
}

const describeProbe = CONTAINER ? describe : describe.skip;

describeProbe('documento fuente: guardado vs borrado de huerfanos (dos conexiones)', () => {
  it('bind-first: el guardado abre su transaccion, el borrado concurrente no puede dejar la factura huerfana', async () => {
    const { facturaId, path, save } = newDocument();
    const saver = new Session('probe_save');
    const cleaner = new Session('probe_clean');
    try {
      await saver.asAuthenticated();
      expect(await saver.run(save)).toContain('"replay": false');

      await cleaner.asAuthenticated();
      const deleting = cleaner.run(`delete from storage.objects where bucket_id = 'facturas_proveedores' and name = '${path}';`);
      // With the protocol the delete waits for the uncommitted save; without it, it returns at once.
      await waitUntil(() => isWaitingOnLock('probe_clean'), 3000);

      await saver.run('commit;');
      await deleting;
      await cleaner.run('commit;');

      expect(state(facturaId, path)).toEqual({ invoiceHasDocument: true, objectExists: true });
    } finally {
      saver.close();
      cleaner.close();
    }
  });

  it('delete-first: un borrado en curso no puede coexistir con un guardado exitoso del mismo documento', async () => {
    const { facturaId, path, save } = newDocument();
    const saver = new Session('probe_save');
    const cleaner = new Session('probe_clean');
    try {
      await cleaner.asAuthenticated();
      await cleaner.run(`delete from storage.objects where bucket_id = 'facturas_proveedores' and name = '${path}';`);

      await saver.asAuthenticated();
      const saving = saver.run(save);
      // With the protocol the save waits for the uncommitted delete; without it, it returns at once.
      await waitUntil(() => isWaitingOnLock('probe_save'), 3000);

      await cleaner.run('commit;');
      const saveOutput = await saving;
      await saver.run('commit;');

      const after = state(facturaId, path);
      // A saved invoice must keep its document; if the delete won, the save must have failed.
      if (after.invoiceHasDocument) expect(after.objectExists).toBe(true);
      expect(saveOutput).toContain(after.invoiceHasDocument ? '"replay": false' : 'payload_invalido: documento');
    } finally {
      saver.close();
      cleaner.close();
    }
  });

  it('sin contienda: borrar un huerfano y guardar con un documento existente siguen funcionando', async () => {
    const orphan = newDocument();
    const live = newDocument();
    const session = new Session('probe_solo');
    try {
      await session.asAuthenticated();
      await session.run(`delete from storage.objects where bucket_id = 'facturas_proveedores' and name = '${orphan.path}';`);
      expect(await session.run(live.save)).toContain('"replay": false');
      await session.run('commit;');

      expect(state(orphan.facturaId, orphan.path).objectExists).toBe(false);
      expect(state(live.facturaId, live.path)).toEqual({ invoiceHasDocument: true, objectExists: true });
    } finally {
      session.close();
    }
  });
});
