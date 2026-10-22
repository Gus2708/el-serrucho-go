import type { SupabaseClient } from '@supabase/supabase-js';
import { createFacturaLocalStore, type StorageLike } from './facturaLocalStore';
import { FacturaError, createFacturaRepository } from './facturaProveedorRepository';
import {
  attachDocument,
  classifySubmitFailure,
  createDocumentGateway,
  createEditorService,
  createSubmitAdapter,
  releaseUnsavedDocument,
  saveDraft,
  type FlowRepository,
} from './facturaProveedorFlujo';
import { addLinea, createDraft, type FacturaDocumento } from './facturaProveedor';

const FACTURA = 'f0000000-0000-4000-8000-000000000001';
const OWNER = '11111111-1111-4111-8111-111111111111';
const L1 = 'a0000000-0000-4000-8000-000000000001';

function doc(name: string): FacturaDocumento {
  return { path: `${OWNER}/${FACTURA}/${name}.pdf`, nombre: `${name}.pdf`, mime: 'application/pdf', bytes: 10, sha256: 'a'.repeat(64) };
}

function fakeRepo(overrides: Partial<FlowRepository> = {}): { repo: FlowRepository } & { [K in keyof FlowRepository]: jest.Mock } {
  const mocks = {
    guardar: jest.fn(async () => ({ facturaId: FACTURA, version: 1, replay: false })),
    subirDocumento: jest.fn(async () => doc('nuevo')),
    limpiarHuerfano: jest.fn(async () => true),
    ...overrides,
  } as { [K in keyof FlowRepository]: jest.Mock };
  return { repo: mocks as unknown as FlowRepository, ...mocks };
}

function validDraft() {
  return addLinea(createDraft({ facturaId: FACTURA }), L1, { codigoProducto: 'SKU-1', cantidad: '2' });
}

describe('saveDraft', () => {
  it('no llama al servidor si el borrador es invalido', async () => {
    const { repo, guardar } = fakeRepo();

    const outcome = await saveDraft(
      { repo, newKey: () => 'k1' },
      { draft: { ...validDraft(), fechaDocumento: '31/12/2026' }, savedDocumentPath: null, pending: null },
    );

    expect(outcome.status).toBe('invalid');
    expect(guardar).not.toHaveBeenCalled();
  });

  it('guarda con la version del borrador y devuelve la nueva version', async () => {
    const { repo, guardar } = fakeRepo({ guardar: jest.fn(async () => ({ facturaId: FACTURA, version: 4, replay: false })) });

    const outcome = await saveDraft(
      { repo, newKey: () => 'k1' },
      { draft: { ...validDraft(), version: 3 }, savedDocumentPath: null, pending: null },
    );

    expect(guardar).toHaveBeenCalledWith(expect.objectContaining({ facturaId: FACTURA, version: 3, key: 'k1' }));
    if (outcome.status !== 'saved') throw new Error('expected saved');
    expect(outcome.draft.version).toBe(4);
    expect(outcome.pending).toBeNull();
    expect(outcome.documentPath).toBeNull();
  });

  it('tras un fallo de red el reintento reutiliza la misma clave de idempotencia', async () => {
    const guardar = jest.fn()
      .mockRejectedValueOnce(new FacturaError('red'))
      .mockResolvedValueOnce({ facturaId: FACTURA, version: 1, replay: true });
    const { repo } = fakeRepo({ guardar });
    const keys = ['k1', 'k2'];
    const ctx = { repo, newKey: () => keys.shift() as string };
    const draft = validDraft();

    const first = await saveDraft(ctx, { draft, savedDocumentPath: null, pending: null });
    if (first.status !== 'failed') throw new Error('expected failed');
    expect(first.error.code).toBe('red');

    const retry = await saveDraft(ctx, { draft, savedDocumentPath: null, pending: first.pending });

    expect(guardar.mock.calls.map(call => call[0].key)).toEqual(['k1', 'k1']);
    expect(retry.status).toBe('saved');
  });

  it('si el contenido cambia entre intentos usa una clave nueva', async () => {
    const guardar = jest.fn().mockRejectedValueOnce(new FacturaError('red')).mockResolvedValueOnce({ facturaId: FACTURA, version: 1, replay: false });
    const { repo } = fakeRepo({ guardar });
    const keys = ['k1', 'k2'];
    const ctx = { repo, newKey: () => keys.shift() as string };

    const first = await saveDraft(ctx, { draft: validDraft(), savedDocumentPath: null, pending: null });
    if (first.status !== 'failed') throw new Error('expected failed');
    await saveDraft(ctx, { draft: { ...validDraft(), numeroDocumento: 'A-2' }, savedDocumentPath: null, pending: first.pending });

    expect(guardar.mock.calls.map(call => call[0].key)).toEqual(['k1', 'k2']);
  });

  it('expone el conflicto de version sin perder el borrador local', async () => {
    const { repo } = fakeRepo({ guardar: jest.fn().mockRejectedValue(new FacturaError('version_obsoleta')) });

    const outcome = await saveDraft({ repo, newKey: () => 'k1' }, { draft: validDraft(), savedDocumentPath: null, pending: null });

    if (outcome.status !== 'failed') throw new Error('expected failed');
    expect(outcome.error.code).toBe('version_obsoleta');
  });

  it('al reemplazar el documento guardado, limpia el anterior solo despues de confirmar el guardado', async () => {
    const calls: string[] = [];
    const { repo, limpiarHuerfano } = fakeRepo({
      guardar: jest.fn(async () => { calls.push('guardar'); return { facturaId: FACTURA, version: 2, replay: false }; }),
      limpiarHuerfano: jest.fn(async () => { calls.push('limpiar'); return true; }),
    });
    const draft = { ...validDraft(), version: 1, documento: doc('nuevo') };

    const outcome = await saveDraft({ repo, newKey: () => 'k1' }, { draft, savedDocumentPath: doc('viejo').path, pending: null });

    expect(calls).toEqual(['guardar', 'limpiar']);
    expect(limpiarHuerfano).toHaveBeenCalledWith(doc('viejo').path);
    if (outcome.status !== 'saved') throw new Error('expected saved');
    expect(outcome.documentPath).toBe(doc('nuevo').path);
  });

  it('no limpia nada si el guardado falla', async () => {
    const { repo, limpiarHuerfano } = fakeRepo({ guardar: jest.fn().mockRejectedValue(new FacturaError('red')) });

    await saveDraft({ repo, newKey: () => 'k1' }, { draft: { ...validDraft(), documento: doc('nuevo') }, savedDocumentPath: doc('viejo').path, pending: null });

    expect(limpiarHuerfano).not.toHaveBeenCalled();
  });

  it('una excepcion inesperada se vuelve error desconocido, no un crash', async () => {
    const { repo } = fakeRepo({ guardar: jest.fn().mockRejectedValue(new Error('boom')) });

    const outcome = await saveDraft({ repo, newKey: () => 'k1' }, { draft: validDraft(), savedDocumentPath: null, pending: null });

    if (outcome.status !== 'failed') throw new Error('expected failed');
    expect(outcome.error.code).toBe('desconocido');
  });
});

describe('attachDocument', () => {
  const input = { ownerId: OWNER, bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), nombre: 'f.pdf' };
  const deps = (repo: FlowRepository) => ({ repo, newId: () => 'd0000000-0000-4000-8000-000000000001', sha256: async () => 'b'.repeat(64) });

  it('sube con hash y deja el documento en el borrador sin guardarlo todavia', async () => {
    const { repo, subirDocumento, guardar } = fakeRepo();

    const draft = await attachDocument(deps(repo), { ...input, draft: validDraft(), savedDocumentPath: null });

    expect(subirDocumento).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: OWNER, facturaId: FACTURA, documentId: 'd0000000-0000-4000-8000-000000000001', sha256: 'b'.repeat(64),
    }));
    expect(draft.documento).toEqual(doc('nuevo'));
    expect(guardar).not.toHaveBeenCalled();
  });

  it('descarta el archivo subido y aun no guardado que se reemplaza, pero nunca el guardado', async () => {
    const { repo, limpiarHuerfano } = fakeRepo();

    await attachDocument(deps(repo), { ...input, draft: { ...validDraft(), documento: doc('sin-guardar') }, savedDocumentPath: doc('guardado').path });
    await attachDocument(deps(repo), { ...input, draft: { ...validDraft(), documento: doc('guardado') }, savedDocumentPath: doc('guardado').path });

    expect(limpiarHuerfano).toHaveBeenCalledTimes(1);
    expect(limpiarHuerfano).toHaveBeenCalledWith(doc('sin-guardar').path);
  });

  it('si la subida falla no toca el borrador ni limpia nada', async () => {
    const { repo, limpiarHuerfano } = fakeRepo({ subirDocumento: jest.fn().mockRejectedValue(new FacturaError('red')) });

    await expect(attachDocument(deps(repo), { ...input, draft: { ...validDraft(), documento: doc('sin-guardar') }, savedDocumentPath: null }))
      .rejects.toMatchObject({ code: 'red' });
    expect(limpiarHuerfano).not.toHaveBeenCalled();
  });
});

describe('releaseUnsavedDocument', () => {
  it('borra el archivo subido que nunca se guardo al cerrar el editor', async () => {
    const { repo, limpiarHuerfano } = fakeRepo();

    await releaseUnsavedDocument(repo, { ...validDraft(), documento: doc('sin-guardar') }, null);

    expect(limpiarHuerfano).toHaveBeenCalledWith(doc('sin-guardar').path);
  });

  it('conserva el documento ya guardado', async () => {
    const { repo, limpiarHuerfano } = fakeRepo();

    await releaseUnsavedDocument(repo, { ...validDraft(), documento: doc('guardado') }, doc('guardado').path);
    await releaseUnsavedDocument(repo, validDraft(), null);

    expect(limpiarHuerfano).not.toHaveBeenCalled();
  });
});

describe('classifySubmitFailure', () => {
  const failure = (code: ConstructorParameters<typeof FacturaError>[0], sqlState?: string, httpStatus?: number) =>
    new FacturaError(code, { sqlState, httpStatus });

  it.each([
    ['PV409 en 400', failure('version_obsoleta', 'PV409', 400), { kind: 'rejected', reason: 'conflict' }],
    ['PV409 en 409', failure('version_obsoleta', 'PV409', 409), { kind: 'rejected', reason: 'conflict' }],
    ['PI409', failure('clave_reutilizada', 'PI409', 400), { kind: 'rejected', reason: 'key_reused' }],
    ['22023', failure('datos_invalidos', '22023', 400), { kind: 'rejected', reason: 'invalid' }],
    ['42501', failure('no_autorizado', '42501', 403), { kind: 'rejected', reason: 'unauthorized' }],
    ['P0002', failure('no_encontrada', 'P0002', 404), { kind: 'rejected', reason: 'unknown' }],
    ['SQLSTATE sin mapa con 500', failure('desconocido', 'XX000', 500), { kind: 'rejected', reason: 'unknown' }],
    ['serializacion 40001', failure('desconocido', '40001', 409), { kind: 'rejected', reason: 'unknown' }],
    ['JWT vencido PGRST301', failure('desconocido', 'PGRST301', 401), { kind: 'rejected', reason: 'unauthorized' }],
    ['403 sin SQLSTATE', failure('desconocido', undefined, 403), { kind: 'rejected', reason: 'unauthorized' }],
    ['funcion ausente PGRST202', failure('desconocido', 'PGRST202', 404), { kind: 'rejected', reason: 'unknown' }],
    ['cuerpo invalido 400', failure('desconocido', undefined, 400), { kind: 'rejected', reason: 'unknown' }],
  ])('%s es un rechazo definitivo', (_label, error, expected) => {
    expect(classifySubmitFailure(error)).toEqual(expected);
  });

  it.each([
    ['sin red', failure('red')],
    ['502 de pasarela', failure('desconocido', undefined, 502)],
    ['504 de pasarela', failure('desconocido', undefined, 504)],
    ['503 PGRST000 sin base de datos', failure('desconocido', 'PGRST000', 503)],
    ['fallo de transporte con estado 0', failure('desconocido', undefined, 0)],
    ['408 tiempo agotado', failure('desconocido', undefined, 408)],
    ['200 con cuerpo malformado', failure('desconocido', undefined, 200)],
    ['error ajeno', new Error('boom')],
    ['valor no Error', 'timeout'],
  ])('%s es ambiguo: la peticion pudo aplicarse', (_label, error) => {
    expect(classifySubmitFailure(error)).toEqual({ kind: 'ambiguous' });
  });
});

describe('createSubmitAdapter', () => {
  const input = { facturaId: FACTURA, version: 3, key: 'k-congelada', payload: { cabecera: { numero_documento: 'A-1', documento: null }, lineas: [{ linea_id: L1 }] } };

  it('entrega la entrada congelada al repositorio sin cambios y reporta lo confirmado', async () => {
    const { repo, guardar } = fakeRepo({ guardar: jest.fn(async () => ({ facturaId: FACTURA, version: 4, replay: true })) });

    const result = await createSubmitAdapter(repo)(input);

    expect(result).toEqual({ kind: 'committed', version: 4, replay: true });
    expect(guardar).toHaveBeenCalledWith(input);
  });

  it('traduce un rechazo del servidor y una respuesta perdida', async () => {
    const rejected = fakeRepo({ guardar: jest.fn().mockRejectedValue(new FacturaError('version_obsoleta', { sqlState: 'PV409', httpStatus: 400 })) });
    const lost = fakeRepo({ guardar: jest.fn().mockRejectedValue(new FacturaError('red')) });

    await expect(createSubmitAdapter(rejected.repo)(input)).resolves.toEqual({ kind: 'rejected', reason: 'conflict' });
    await expect(createSubmitAdapter(lost.repo)(input)).resolves.toEqual({ kind: 'ambiguous' });
  });
});

describe('createDocumentGateway', () => {
  const NEW_ID = 'd0000000-0000-4000-8000-0000000000aa';
  const DOC_ID = 'd0000000-0000-4000-8000-000000000001';
  const OTHER = '22222222-2222-4222-8222-222222222222';
  const mine = () => `${OWNER}/${FACTURA}/${DOC_ID}.pdf`;
  const setup = (overrides: Partial<FlowRepository> = {}) => {
    const { repo, subirDocumento, limpiarHuerfano } = fakeRepo(overrides);
    const gateway = createDocumentGateway(repo, { ownerId: OWNER, newId: () => NEW_ID, sha256: async () => 'c'.repeat(64) });
    return { gateway, subirDocumento, limpiarHuerfano };
  };

  it('entrega id, hash y subida al repositorio real', async () => {
    const { gateway, subirDocumento } = setup();
    const input = { ownerId: OWNER, facturaId: FACTURA, documentId: NEW_ID, bytes: Uint8Array.from([1]), nombre: 'f.pdf', sha256: 'c'.repeat(64) };

    expect(gateway.newDocumentId()).toBe(NEW_ID);
    await expect(gateway.sha256(Uint8Array.from([1]))).resolves.toBe('c'.repeat(64));
    await expect(gateway.upload(input)).resolves.toEqual(doc('nuevo'));
    expect(subirDocumento).toHaveBeenCalledWith(input);
  });

  it('no sube a nombre de otra cuenta', async () => {
    const { gateway, subirDocumento } = setup();

    await expect(
      gateway.upload({ ownerId: OTHER, facturaId: FACTURA, documentId: NEW_ID, bytes: Uint8Array.from([1]), nombre: 'f.pdf', sha256: 'c'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'no_autorizado' });
    expect(subirDocumento).not.toHaveBeenCalled();
  });

  it('borra solo rutas privadas propias y devuelve el resultado del repositorio', async () => {
    const gone = setup();
    const kept = setup({ limpiarHuerfano: jest.fn(async () => false) });

    await expect(gone.gateway.remove(mine())).resolves.toBe(true);
    await expect(kept.gateway.remove(mine())).resolves.toBe(false);
    expect(gone.limpiarHuerfano).toHaveBeenCalledWith(mine());
  });

  it.each([
    ['de otra cuenta', `${OTHER}/${FACTURA}/${DOC_ID}.pdf`],
    ['con salto de directorio', `${OWNER}/../${OTHER}/${FACTURA}/${DOC_ID}.pdf`],
    ['sin identificador de documento', `${OWNER}/${FACTURA}/factura.pdf`],
    ['con extension no admitida', `${OWNER}/${FACTURA}/${DOC_ID}.exe`],
    ['la carpeta de la cuenta', `${OWNER}/`],
    ['vacia', ''],
  ])('se niega a borrar una ruta %s sin tocar Storage', async (_label, path) => {
    const { gateway, limpiarHuerfano } = setup();

    await expect(gateway.remove(path)).resolves.toBe(false);
    expect(limpiarHuerfano).not.toHaveBeenCalled();
  });
});

describe('controlador conectado al repositorio real (fakes de Supabase y almacenamiento)', () => {
  const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const IDS = ['d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a3'];

  type MemoryStorage = StorageLike & { data: Map<string, string> };

  function memoryStorage(seed: Map<string, string> = new Map()): MemoryStorage {
    return {
      data: seed,
      getItem: async key => seed.get(key) ?? null,
      setItem: async (key, value) => {
        seed.set(key, value);
      },
      removeItem: async key => {
        seed.delete(key);
      },
      getAllKeys: async () => [...seed.keys()],
    };
  }

  type RpcAnswer = { data: unknown; error: { code?: string; message: string } | null; status: number };

  function fakeSupabase(answers: Array<RpcAnswer | Error>) {
    const bucket = {
      upload: jest.fn(async (..._args: unknown[]) => ({ data: { path: 'x' }, error: null as { message: string } | null })),
      remove: jest.fn(async (..._args: unknown[]) => ({ data: [], error: null as { message: string } | null })),
      list: jest.fn(async () => ({ data: [], error: null })),
    };
    const rpc = jest.fn(async (..._args: unknown[]): Promise<RpcAnswer> => {
      const next = answers.shift();
      if (next === undefined) throw new Error('unscripted rpc');
      if (next instanceof Error) throw next;
      return next;
    });
    const client = { rpc, from: jest.fn(), storage: { from: jest.fn(() => bucket) } };
    return { client: client as unknown as Pick<SupabaseClient, 'rpc' | 'from' | 'storage'>, rpc, bucket };
  }

  const committed = (version: number, replay = false): RpcAnswer => ({ data: { factura_id: FACTURA, version, replay }, error: null, status: 200 });
  const refused = (code: string, status: number): RpcAnswer => ({ data: null, error: { code, message: 'x' }, status });

  function open(options: { answers: Array<RpcAnswer | Error>; storage?: MemoryStorage; uid?: () => string | null; keys?: string[] }) {
    const storage = options.storage ?? memoryStorage();
    const supabase = fakeSupabase(options.answers);
    const keys = options.keys ?? ['k1', 'k2', 'k3'];
    const ids = [...IDS];
    const service = createEditorService({
      repo: createFacturaRepository(supabase.client),
      store: createFacturaLocalStore(storage),
      getUid: options.uid ?? (() => OWNER),
      newKey: () => keys.shift() as string,
      newDocumentId: () => ids.shift() as string,
      sha256: async () => 'e'.repeat(64),
    });
    return { service, storage, ...supabase };
  }

  type Opened = ReturnType<typeof open>;
  const draftWithLine = (version = 0) => ({ ...validDraft(), version });
  const acquire = (service: Opened['service'], draft = draftWithLine()) =>
    service.acquire({ uid: OWNER, facturaId: FACTURA, draft, savedDocumentPath: null });
  const sentToRpc = (rpc: Opened['rpc'], call = 0) => rpc.mock.calls[call] as unknown as [string, Record<string, unknown>];

  it('envia al RPC real la clave, version base y contenido congelados', async () => {
    const { service, rpc } = open({ answers: [committed(1)] });
    const controller = await acquire(service);
    controller.edit(draft => ({ ...draft, numeroDocumento: 'A-1' }));

    const outcome = await controller.save();

    expect(outcome).toMatchObject({ status: 'saved', version: 1, replay: false });
    const [name, args] = sentToRpc(rpc);
    expect(name).toBe('guardar_factura_proveedor');
    expect(args).toMatchObject({ p_factura_id: FACTURA, p_version_esperada: 0, p_clave: 'k1' });
    expect((args.p_cabecera as { numero_documento: string }).numero_documento).toBe('A-1');
    expect(args.p_lineas).toHaveLength(1);
    expect(controller.getState()).toMatchObject({ dirty: false, retryPending: false });
  });

  it('un 502 deja la intencion; tras reiniciar el reintento reenvia exactamente lo mismo', async () => {
    const first = open({ answers: [refused('', 502)] });
    const controller = await acquire(first.service);
    controller.edit(draft => ({ ...draft, numeroDocumento: 'A-1' }));

    await expect(controller.save()).resolves.toMatchObject({ status: 'pending' });
    await controller.persisted();
    const sent = sentToRpc(first.rpc);

    const second = open({ answers: [committed(1, true)], storage: memoryStorage(new Map(first.storage.data)), keys: ['otra-clave'] });
    const restored = await acquire(second.service);
    expect(restored.getState()).toMatchObject({ retryPending: true });
    await expect(restored.save()).resolves.toMatchObject({ status: 'saved', version: 1, replay: true });

    expect(sentToRpc(second.rpc)).toEqual(sent);
    expect(sentToRpc(second.rpc)[1].p_clave).toBe('k1');
  });

  it('una excepcion de transporte tambien es ambigua y conserva la intencion', async () => {
    const { service } = open({ answers: [new TypeError('Network request failed')] });
    const controller = await acquire(service);

    await expect(controller.save()).resolves.toMatchObject({ status: 'pending' });
    expect(controller.getState().retryPending).toBe(true);
  });

  it.each([
    ['PV409', 400, 'conflict'],
    ['PI409', 400, 'key_reused'],
    ['22023', 400, 'invalid'],
    ['42501', 403, 'unauthorized'],
    ['XX000', 500, 'unknown'],
  ])('SQLSTATE %s (HTTP %s) llega al controlador como rechazo %s y libera la intencion', async (code, status, reason) => {
    const { service } = open({ answers: [refused(code, status)] });
    const controller = await acquire(service, draftWithLine(2));

    await expect(controller.save()).resolves.toMatchObject({ status: 'rejected', reason });
    expect(controller.getState()).toMatchObject({ retryPending: false, dirty: true });
  });

  it('no repite un envio en vuelo ni abre dos controladores para la misma cuenta y factura', async () => {
    let release: (value: RpcAnswer) => void = () => undefined;
    const { service, rpc } = open({ answers: [] });
    rpc.mockImplementationOnce(() => new Promise<RpcAnswer>(resolve => { release = resolve; }));

    const [a, b] = await Promise.all([acquire(service), acquire(service)]);
    const saving = a.save();
    const again = await acquire(service);
    const duplicate = again.save();
    await new Promise(resolve => setTimeout(resolve, 0));
    release(committed(1));

    expect(a).toBe(b);
    expect(again).toBe(a);
    await expect(saving).resolves.toMatchObject({ status: 'saved' });
    await expect(duplicate).resolves.toMatchObject({ status: 'saved' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('separa controladores por cuenta y por factura, y crea uno nuevo despues de cerrar', async () => {
    const OTHER_FACTURA = 'f0000000-0000-4000-8000-000000000002';
    const OTHER_UID = '22222222-2222-4222-8222-222222222222';
    const { service } = open({ answers: [] });

    const base = await acquire(service);
    const otherInvoice = await service.acquire({ uid: OWNER, facturaId: OTHER_FACTURA, draft: createDraft({ facturaId: OTHER_FACTURA }), savedDocumentPath: null });
    const otherAccount = await service.acquire({ uid: OTHER_UID, facturaId: FACTURA, draft: draftWithLine(), savedDocumentPath: null });
    await base.close();
    const reopened = await acquire(service);

    expect(new Set([base, otherInvoice, otherAccount]).size).toBe(3);
    expect(base.getState().closed).toBe(true);
    expect(reopened).not.toBe(base);
    expect(reopened.getState().closed).toBe(false);
  });

  it('un fallo de hidratacion no deja el registro envenenado', async () => {
    const { service } = open({ answers: [] });

    await expect(service.acquire({ uid: 'no es valido/../', facturaId: FACTURA, draft: draftWithLine(), savedDocumentPath: null })).rejects.toBeInstanceOf(RangeError);
    await expect(acquire(service)).resolves.toBeDefined();
  });

  it('sin cuenta activa abre sin escribir ni enviar nada', async () => {
    const { service, rpc, storage } = open({ answers: [], uid: () => null });
    const controller = await acquire(service);
    controller.edit(draft => ({ ...draft, numeroDocumento: 'A-1' }));

    await expect(controller.save()).resolves.toMatchObject({ status: 'cuenta_cambiada' });
    await controller.persisted();
    expect(rpc).not.toHaveBeenCalled();
    expect(storage.data.size).toBe(0);
  });

  it('adjunta con ruta privada propia, guarda y barre solo el reemplazado sin listar el bucket', async () => {
    const { service, bucket, rpc } = open({ answers: [committed(1), committed(2)] });
    const controller = await acquire(service);

    const first = await controller.attach(PDF, 'a.pdf');
    await controller.save();
    const second = await controller.attach(PDF, 'b.pdf');
    await controller.save();
    const swept = await controller.sweep();

    const firstPath = `${OWNER}/${FACTURA}/${IDS[0]}.pdf`;
    const secondPath = `${OWNER}/${FACTURA}/${IDS[1]}.pdf`;
    expect(first).toMatchObject({ status: 'attached', path: firstPath });
    expect(second).toMatchObject({ status: 'attached', path: secondPath });
    expect(bucket.upload.mock.calls.map(call => call[0])).toEqual([firstPath, secondPath]);
    expect(swept).toEqual({ status: 'swept', removed: [firstPath], kept: [] });
    expect(bucket.remove).toHaveBeenCalledTimes(1);
    expect(bucket.remove).toHaveBeenCalledWith([firstPath]);
    expect(bucket.list).not.toHaveBeenCalled();
    expect((sentToRpc(rpc, 1)[1].p_cabecera as { documento: { path: string } }).documento.path).toBe(secondPath);
  });

  it('nunca borra el archivo que el servidor o una intencion pendiente referencian', async () => {
    const { service, bucket } = open({ answers: [refused('', 502)] });
    const controller = await acquire(service);
    await controller.attach(PDF, 'a.pdf');
    await controller.save();
    await controller.attach(PDF, 'b.pdf');

    const swept = await controller.sweep();

    expect(swept).toMatchObject({ status: 'swept', removed: [], kept: [`${OWNER}/${FACTURA}/${IDS[0]}.pdf`] });
    expect(controller.getState().retryPending).toBe(true);
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it('un fallo de subida real se barre despues y no toca otras rutas', async () => {
    const { service, bucket } = open({ answers: [] });
    bucket.upload.mockRejectedValueOnce(new TypeError('Network request failed'));
    const controller = await acquire(service);

    const failed = await controller.attach(PDF, 'a.pdf');
    const swept = await controller.sweep();

    const lostPath = `${OWNER}/${FACTURA}/${IDS[0]}.pdf`;
    expect(failed).toMatchObject({ status: 'upload_failed' });
    expect(controller.getState().draft.documento).toBeNull();
    expect(swept).toEqual({ status: 'swept', removed: [lostPath], kept: [] });
    expect(bucket.remove).toHaveBeenCalledWith([lostPath]);
  });

  it('el descarte conserva la intencion y los archivos: ni se reenvia ni se borra', async () => {
    const first = open({ answers: [refused('', 502)] });
    const controller = await acquire(first.service);
    await controller.attach(PDF, 'a.pdf');
    await controller.save();
    await controller.persisted();

    await expect(controller.discard(true)).resolves.toEqual({ status: 'discarded' });

    const second = open({ answers: [committed(1)], storage: memoryStorage(new Map(first.storage.data)), keys: ['nueva'] });
    const fresh = await acquire(second.service);
    await fresh.save();
    expect(sentToRpc(second.rpc)[1].p_clave).toBe('nueva');
    await expect(fresh.sweep()).resolves.toMatchObject({ removed: [] });
    expect(first.bucket.remove).not.toHaveBeenCalled();
    expect(second.bucket.remove).not.toHaveBeenCalled();
  });
});
