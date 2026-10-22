import type { SupabaseClient } from '@supabase/supabase-js';
import type { Event } from '@sentry/react-native';
import {
  FacturaError,
  createFacturaRepository,
  mapFacturaError,
} from './facturaProveedorRepository';

const mockCaptureEvent = jest.fn();
jest.mock('@sentry/react-native', () => ({
  withScope: (callback: (scope: unknown) => void) => callback({ addEventProcessor: jest.fn() }),
  captureEvent: (event: unknown) => mockCaptureEvent(event),
}));

const OWNER = '11111111-1111-4111-8111-111111111111';
const FACTURA = 'f0000000-0000-4000-8000-000000000001';
const DOC = 'd0000000-0000-4000-8000-000000000001';
const KEY = 'c0000000-0000-4000-8000-000000000001';
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

type Result = { data: unknown; error: { code?: string; message: string } | null };

function queryChain(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'limit', 'eq']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(async () => result);
  chain.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function fakeClient(options: {
  rpc?: Result;
  query?: Result;
  upload?: { data: unknown; error: { message: string; statusCode?: string } | null };
  signed?: { data: { signedUrl: string } | null; error: { message: string } | null };
  remove?: { data: unknown; error: { message: string } | null };
} = {}) {
  const chain = queryChain(options.query ?? { data: [], error: null });
  const bucket = {
    upload: jest.fn(async () => options.upload ?? { data: { path: 'x' }, error: null }),
    createSignedUrl: jest.fn(async () => options.signed ?? { data: { signedUrl: 'https://signed.example/doc' }, error: null }),
    remove: jest.fn(async () => options.remove ?? { data: [], error: null }),
  };
  const client = {
    rpc: jest.fn(async () => options.rpc ?? { data: { factura_id: FACTURA, version: 1, replay: false }, error: null }),
    from: jest.fn(() => chain),
    storage: { from: jest.fn(() => bucket) },
  };
  return { client: client as unknown as Pick<SupabaseClient, 'rpc' | 'from' | 'storage'>, raw: client, chain, bucket };
}

const payload = { cabecera: { numero_documento: 'A-1', documento: null }, lineas: [{ linea_id: 'l1' }] };

describe('mapFacturaError', () => {
  it.each([
    ['42501', 'no_autorizado'],
    ['PV409', 'version_obsoleta'],
    ['PI409', 'clave_reutilizada'],
    ['22023', 'datos_invalidos'],
    ['23514', 'datos_invalidos'],
    ['22P02', 'datos_invalidos'],
    ['P0002', 'no_encontrada'],
  ])('mapea SQLSTATE %s a %s', (code, expected) => {
    expect(mapFacturaError({ code, message: 'boom' }).code).toBe(expected);
  });

  it('distingue fallos de red de errores desconocidos', () => {
    expect(mapFacturaError({ message: 'TypeError: Network request failed' }).code).toBe('red');
    expect(mapFacturaError({ code: 'XX000', message: 'internal' }).code).toBe('desconocido');
  });

  it('usa mensajes en espanol sin filtrar detalles internos', () => {
    const error = mapFacturaError({ code: '42501', message: 'permission denied for table facturas_proveedores' });

    expect(error).toBeInstanceOf(FacturaError);
    expect(error.message).not.toMatch(/permission denied|facturas_proveedores/);
  });
});

describe('guardar', () => {
  it('llama la RPC atomica con version esperada, clave y contenido', async () => {
    const { client, raw } = fakeClient();
    const repo = createFacturaRepository(client);

    const result = await repo.guardar({ facturaId: FACTURA, version: 0, key: KEY, payload });

    expect(raw.rpc).toHaveBeenCalledWith('guardar_factura_proveedor', {
      p_factura_id: FACTURA,
      p_version_esperada: 0,
      p_clave: KEY,
      p_cabecera: payload.cabecera,
      p_lineas: payload.lineas,
    });
    expect(result).toEqual({ facturaId: FACTURA, version: 1, replay: false });
  });

  it('propaga conflicto de version como FacturaError tipado', async () => {
    const { client } = fakeClient({ rpc: { data: null, error: { code: 'PV409', message: 'version_obsoleta' } } });

    await expect(createFacturaRepository(client).guardar({ facturaId: FACTURA, version: 1, key: KEY, payload }))
      .rejects.toMatchObject({ name: 'FacturaError', code: 'version_obsoleta' });
  });

  it('rechaza una respuesta del servidor con forma inesperada', async () => {
    const { client } = fakeClient({ rpc: { data: { version: 'x' }, error: null } });

    await expect(createFacturaRepository(client).guardar({ facturaId: FACTURA, version: 0, key: KEY, payload }))
      .rejects.toMatchObject({ code: 'desconocido' });
  });

  it('convierte una excepcion de transporte en error de red reintentable', async () => {
    const { client, raw } = fakeClient();
    raw.rpc.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(createFacturaRepository(client).guardar({ facturaId: FACTURA, version: 0, key: KEY, payload }))
      .rejects.toMatchObject({ code: 'red' });
  });
});

describe('guardar conserva la respuesta cruda del servidor (U3)', () => {
  const save = { facturaId: FACTURA, version: 1, key: KEY, payload };
  const failing = (rpc: { data: unknown; error: { code?: string; message: string } | null; status?: number }) => {
    const fake = fakeClient();
    fake.raw.rpc.mockResolvedValueOnce(rpc as never);
    return createFacturaRepository(fake.client);
  };

  it.each([
    ['PV409', 400],
    ['PV409', 409],
    ['PI409', 400],
    ['22023', 400],
    ['42501', 403],
  ])('conserva SQLSTATE %s y estado HTTP %s', async (code, status) => {
    const repo = failing({ data: null, error: { code, message: 'x' }, status });

    await expect(repo.guardar(save)).rejects.toMatchObject({ name: 'FacturaError', sqlState: code, httpStatus: status });
  });

  it('conserva un SQLSTATE sin mapa junto con su estado 500, sin filtrar el mensaje', async () => {
    const repo = failing({ data: null, error: { code: 'XX000', message: 'relation facturas_proveedores broke' }, status: 500 });

    const error = await repo.guardar(save).catch(caught => caught);

    expect(error).toMatchObject({ code: 'desconocido', sqlState: 'XX000', httpStatus: 500 });
    expect(error.message).not.toMatch(/relation|facturas_proveedores/);
  });

  it('conserva el estado de un fallo sin SQLSTATE (pasarela o red)', async () => {
    const repo = failing({ data: null, error: { code: '', message: 'Bad Gateway' }, status: 502 });

    await expect(repo.guardar(save)).rejects.toMatchObject({ httpStatus: 502, sqlState: undefined });
  });

  it('un fallo de fetch devuelto con estado 0 es de red y conserva el estado', async () => {
    const repo = failing({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

    await expect(repo.guardar(save)).rejects.toMatchObject({ code: 'red', httpStatus: 0, sqlState: undefined });
  });

  it('una excepcion de transporte no inventa SQLSTATE ni estado', async () => {
    const fake = fakeClient();
    fake.raw.rpc.mockRejectedValueOnce(new TypeError('Network request failed'));

    const error = await createFacturaRepository(fake.client).guardar(save).catch(caught => caught);

    expect(error).toMatchObject({ code: 'red' });
    expect(error.sqlState).toBeUndefined();
    expect(error.httpStatus).toBeUndefined();
  });

  it('un 200 con cuerpo malformado no declara estado de rechazo', async () => {
    const repo = failing({ data: { version: 'x' }, error: null, status: 200 });

    const error = await repo.guardar(save).catch(caught => caught);

    expect(error).toMatchObject({ code: 'desconocido' });
    expect(error.sqlState).toBeUndefined();
  });

  it('los FacturaError creados sin detalle siguen siendo validos', () => {
    const error = new FacturaError('red');

    expect(error.sqlState).toBeUndefined();
    expect(error.httpStatus).toBeUndefined();
    expect(mapFacturaError({ code: 'PV409', message: 'x' }, 409)).toMatchObject({ sqlState: 'PV409', httpStatus: 409 });
  });
});

describe('listar y abrir', () => {
  it('lista las facturas propias mas recientes primero', async () => {
    const rows = [{ id: FACTURA, version: 2, proveedor_nombre: 'Norte', numero_documento: 'A-1', fecha_documento: null, actualizado_en: '2026-10-19T00:00:00Z', documento_mime: null }];
    const { client, raw, chain } = fakeClient({ query: { data: rows, error: null } });

    const result = await createFacturaRepository(client).listar();

    expect(raw.from).toHaveBeenCalledWith('facturas_proveedores');
    expect(chain.order).toHaveBeenCalledWith('actualizado_en', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(result).toEqual(rows);
  });

  it('abre una factura con sus renglones embebidos', async () => {
    const record = { id: FACTURA, version: 3, lineas: [] };
    const { client, chain } = fakeClient({ query: { data: record, error: null } });

    const result = await createFacturaRepository(client).abrir(FACTURA);

    expect(chain.select).toHaveBeenCalledWith('*, lineas:facturas_proveedores_lineas(*)');
    expect(chain.eq).toHaveBeenCalledWith('id', FACTURA);
    expect(result).toBe(record);
  });

  it('devuelve null si la factura no existe o no es visible', async () => {
    const { client } = fakeClient({ query: { data: null, error: null } });

    await expect(createFacturaRepository(client).abrir(FACTURA)).resolves.toBeNull();
  });

  it('mapea errores de lectura', async () => {
    const { client } = fakeClient({ query: { data: null, error: { code: '42501', message: 'denied' } } });

    await expect(createFacturaRepository(client).listar()).rejects.toMatchObject({ code: 'no_autorizado' });
  });
});

describe('subirDocumento', () => {
  const input = { ownerId: OWNER, facturaId: FACTURA, documentId: DOC, bytes: PDF, nombre: 'C:\\x\\factura.pdf', sha256: 'a'.repeat(64) };

  it('sube sin sobrescribir, con el MIME detectado y devuelve los metadatos', async () => {
    const { client, raw, bucket } = fakeClient();

    const documento = await createFacturaRepository(client).subirDocumento(input);

    expect(raw.storage.from).toHaveBeenCalledWith('facturas_proveedores');
    expect(bucket.upload).toHaveBeenCalledWith(
      `${OWNER}/${FACTURA}/${DOC}.pdf`,
      expect.any(ArrayBuffer),
      { contentType: 'application/pdf', upsert: false },
    );
    expect(documento).toEqual({
      path: `${OWNER}/${FACTURA}/${DOC}.pdf`,
      nombre: 'factura.pdf',
      mime: 'application/pdf',
      bytes: PDF.length,
      sha256: 'a'.repeat(64),
    });
  });

  it('no sube contenido que no es PDF ni imagen', async () => {
    const { client, bucket } = fakeClient();

    await expect(
      createFacturaRepository(client).subirDocumento({ ...input, bytes: new TextEncoder().encode('<html>') }),
    ).rejects.toMatchObject({ code: 'datos_invalidos' });
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it.each([
    ['403', 'no_autorizado'],
    ['413', 'datos_invalidos'],
    ['409', 'datos_invalidos'],
  ])('mapea el estado de Storage %s a %s', async (statusCode, expected) => {
    const { client } = fakeClient({ upload: { data: null, error: { message: 'x', statusCode } } });

    await expect(createFacturaRepository(client).subirDocumento(input)).rejects.toMatchObject({ code: expected });
  });
});

describe('urlDocumento y limpieza', () => {
  it('pide una URL firmada de vida corta', async () => {
    const { client, bucket } = fakeClient();

    const url = await createFacturaRepository(client).urlDocumento(`${OWNER}/${FACTURA}/${DOC}.pdf`);

    expect(url).toBe('https://signed.example/doc');
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(`${OWNER}/${FACTURA}/${DOC}.pdf`, 300);
  });

  it('falla si Storage no devuelve URL', async () => {
    const { client } = fakeClient({ signed: { data: null, error: { message: 'Object not found' } } });

    await expect(createFacturaRepository(client).urlDocumento('x')).rejects.toBeInstanceOf(FacturaError);
  });

  it('limpiar huerfano es de mejor esfuerzo: nunca lanza', async () => {
    const failing = fakeClient({ remove: { data: null, error: { message: 'denied' } } });
    const ok = fakeClient();

    await expect(createFacturaRepository(failing.client).limpiarHuerfano('p')).resolves.toBe(false);
    await expect(createFacturaRepository(ok.client).limpiarHuerfano('p')).resolves.toBe(true);
    expect(ok.bucket.remove).toHaveBeenCalledWith(['p']);
  });
});

describe('reporte de fallos inesperados', () => {
  const save = { facturaId: FACTURA, version: 1, key: KEY, payload };
  const SECRET = 'SECRET proveedor Ferreteria Norte 1234.56 https://x.supabase.co/storage/v1/sign/doc.pdf?token=abc';
  // Every clock read lands a minute after the last, so the reporter's per-failure throttle never hides a report.
  let clock = Date.now() + 86_400_000;

  beforeEach(() => {
    mockCaptureEvent.mockReset();
    jest.spyOn(Date, 'now').mockImplementation(() => (clock += 61_000));
  });
  afterEach(() => jest.restoreAllMocks());

  const reported = (): Event[] => mockCaptureEvent.mock.calls.map(([event]) => event as Event);
  const failingRpc = (rpc: unknown) => {
    const fake = fakeClient();
    fake.raw.rpc.mockResolvedValueOnce(rpc as never);
    return createFacturaRepository(fake.client);
  };

  it('guardar: un 500 sin mapa se reporta una vez con SQLSTATE y estado, sin el mensaje', async () => {
    const repo = failingRpc({ data: null, error: { code: 'XX000', message: SECRET }, status: 500 });

    await expect(repo.guardar(save)).rejects.toMatchObject({ code: 'desconocido', sqlState: 'XX000', httpStatus: 500 });

    expect(reported()).toHaveLength(1);
    expect(reported()[0]).toMatchObject({
      message: 'factura.save.desconocido',
      tags: { operation: 'save', code: 'desconocido', sql_state: 'XX000', http_status: '500' },
    });
    expect(JSON.stringify(reported())).not.toContain('SECRET');
  });

  it('guardar: un 200 con cuerpo malformado se reporta', async () => {
    const repo = failingRpc({ data: { version: SECRET }, error: null, status: 200 });

    await expect(repo.guardar(save)).rejects.toMatchObject({ code: 'desconocido' });

    expect(reported().map(event => event.message)).toEqual(['factura.save.desconocido']);
    expect(JSON.stringify(reported())).not.toContain('SECRET');
  });

  it('guardar: una excepcion no tipada del cliente se reporta sin su mensaje', async () => {
    const fake = fakeClient();
    fake.raw.rpc.mockRejectedValueOnce(new TypeError(SECRET));

    await expect(createFacturaRepository(fake.client).guardar(save)).rejects.toMatchObject({ code: 'desconocido' });

    expect(reported().map(event => event.message)).toEqual(['factura.save.desconocido']);
    expect(JSON.stringify(reported())).not.toContain('SECRET');
  });

  it.each([
    ['42501', 403],
    ['PV409', 400],
    ['PI409', 400],
    ['22023', 400],
    ['23505', 409],
    ['P0002', 404],
  ])('guardar: el rechazo esperado %s no se reporta', async (code, status) => {
    const repo = failingRpc({ data: null, error: { code, message: SECRET }, status });

    await expect(repo.guardar(save)).rejects.toBeInstanceOf(FacturaError);

    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('guardar: estar sin conexion no se reporta', async () => {
    const fake = fakeClient();
    fake.raw.rpc.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(createFacturaRepository(fake.client).guardar(save)).rejects.toMatchObject({ code: 'red' });

    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('listar y abrir: un error de lectura sin mapa se reporta con su operacion', async () => {
    const list = fakeClient({ query: { data: null, error: { code: 'XX000', message: SECRET } } });
    const open = fakeClient({ query: { data: null, error: { message: SECRET } } });

    await expect(createFacturaRepository(list.client).listar()).rejects.toMatchObject({ code: 'desconocido' });
    await expect(createFacturaRepository(open.client).abrir(FACTURA)).rejects.toMatchObject({ code: 'desconocido' });

    expect(reported().map(event => event.message)).toEqual(['factura.list.desconocido', 'factura.open.desconocido']);
    expect(JSON.stringify(reported())).not.toContain('SECRET');
  });

  it('listar y abrir: un error de lectura de autorizacion o de red no se reporta', async () => {
    const denied = fakeClient({ query: { data: null, error: { code: '42501', message: SECRET } } });
    const offline = fakeClient();
    offline.chain.maybeSingle = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });

    await expect(createFacturaRepository(denied.client).listar()).rejects.toMatchObject({ code: 'no_autorizado' });
    await expect(createFacturaRepository(offline.client).abrir(FACTURA)).rejects.toMatchObject({ code: 'red' });

    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('subirDocumento: un fallo 5xx de Storage se reporta; los rechazos esperados y el archivo invalido no', async () => {
    const down = fakeClient({ upload: { data: null, error: { message: SECRET, statusCode: '500' } } });
    const tooBig = fakeClient({ upload: { data: null, error: { message: SECRET, statusCode: '413' } } });
    const denied = fakeClient({ upload: { data: null, error: { message: SECRET, statusCode: '403' } } });
    const input = { ownerId: OWNER, facturaId: FACTURA, documentId: DOC, bytes: PDF, nombre: 'a.pdf', sha256: 'h' };

    await expect(createFacturaRepository(down.client).subirDocumento(input)).rejects.toMatchObject({ code: 'desconocido' });
    await expect(createFacturaRepository(tooBig.client).subirDocumento(input)).rejects.toMatchObject({ code: 'datos_invalidos' });
    await expect(createFacturaRepository(denied.client).subirDocumento(input)).rejects.toMatchObject({ code: 'no_autorizado' });
    await expect(
      createFacturaRepository(down.client).subirDocumento({ ...input, bytes: Uint8Array.from([1, 2, 3]) }),
    ).rejects.toMatchObject({ code: 'datos_invalidos' });

    expect(reported().map(event => event.message)).toEqual(['factura.upload.desconocido']);
    expect(JSON.stringify(reported())).not.toContain('SECRET');
  });

  it('urlDocumento: un fallo sin mapa se reporta como descarga; un documento ausente no', async () => {
    const broken = fakeClient({ signed: { data: null, error: { message: SECRET } } });
    const missing = fakeClient({ signed: { data: null, error: { message: SECRET, statusCode: '404' } as never } });

    await expect(createFacturaRepository(broken.client).urlDocumento(SECRET)).rejects.toMatchObject({ code: 'desconocido' });
    await expect(createFacturaRepository(missing.client).urlDocumento(SECRET)).rejects.toMatchObject({ code: 'no_encontrada' });

    expect(reported().map(event => event.message)).toEqual(['factura.download.desconocido']);
    expect(JSON.stringify(reported())).not.toContain('SECRET');
  });

  it('limpiarHuerfano: un fallo inesperado se reporta como aviso y sigue devolviendo false', async () => {
    const broken = fakeClient({ remove: { data: null, error: { message: SECRET } } });
    const thrown = fakeClient();
    thrown.bucket.remove.mockRejectedValueOnce(new Error(SECRET));
    const offline = fakeClient();
    offline.bucket.remove.mockRejectedValueOnce(new TypeError('Network request failed'));
    const missing = fakeClient({ remove: { data: null, error: { message: SECRET, statusCode: '404' } as never } });

    await expect(createFacturaRepository(broken.client).limpiarHuerfano(SECRET)).resolves.toBe(false);
    await expect(createFacturaRepository(thrown.client).limpiarHuerfano(SECRET)).resolves.toBe(false);
    await expect(createFacturaRepository(offline.client).limpiarHuerfano(SECRET)).resolves.toBe(false);
    await expect(createFacturaRepository(missing.client).limpiarHuerfano(SECRET)).resolves.toBe(false);

    expect(reported().map(event => [event.message, event.level])).toEqual([
      ['factura.cleanup.desconocido', 'warning'],
      ['factura.cleanup.desconocido', 'warning'],
    ]);
    expect(JSON.stringify(reported())).not.toContain('SECRET');
  });

  it('un Sentry que falla no cambia el resultado ni el error de guardar', async () => {
    mockCaptureEvent.mockImplementation(() => {
      throw new Error('sentry down');
    });
    const repo = failingRpc({ data: null, error: { code: 'XX000', message: SECRET }, status: 500 });

    await expect(repo.guardar(save)).rejects.toMatchObject({
      name: 'FacturaError',
      code: 'desconocido',
      sqlState: 'XX000',
      httpStatus: 500,
    });
  });
});
