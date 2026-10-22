import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FacturaError,
  createFacturaRepository,
  mapFacturaError,
} from './facturaProveedorRepository';

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
