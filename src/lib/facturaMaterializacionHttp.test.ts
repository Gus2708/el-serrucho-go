import { handleFacturaMaterializationRequest } from '../../supabase/functions/materializar-compra-factura/handler';
import { crearRevisionDesdeExtraccion, type RevisionContenido } from './facturaRevision';
import type { FacturaExtraccionPayload } from './facturaExtractionContract';

const invoiceId = '22222222-2222-4222-8222-222222222222';
const userId = '11111111-1111-4111-8111-111111111111';
const extractionId = '33333333-3333-4333-8333-333333333333';
const token = '44444444-4444-4444-8444-444444444444';
const fingerprint = 'a'.repeat(64);
const sha = 'b'.repeat(64);
const config = { supabaseUrl: 'https://project.test', supabaseAnonKey: 'anon', supabaseServiceRoleKey: 'server-secret' };

function fixture(): { extraction: FacturaExtraccionPayload; content: RevisionContenido } {
  const extraction: FacturaExtraccionPayload = {
    version: 1,
    cabecera: { proveedorNombre: 'Supplier', proveedorRif: null, numeroDocumento: '001', numeroControl: null,
      fechaEmision: '2026-11-20', moneda: 'USD', tasaCambio: null, subtotal: null, descuentos: [], impuestos: [], total: null },
    lineas: [{ numeroLinea: 1, pagina: 1, codigoProveedor: '00-INV-A', descripcion: 'New pliers', cantidad: '2',
      unidad: 'UND', precioUnitario: '6.06', descuentos: [], tasaIva: '0', total: null, incertidumbre: null }],
    metadatos: { totalPaginas: 1, paginasProcesadas: [1], documentoCompleto: true, advertencias: [], confianzaGlobal: null },
  };
  const created = crearRevisionDesdeExtraccion(extraction, extractionId, () => token);
  if (!created.ok) throw new Error('Invalid fixture');
  const content: RevisionContenido = {
    ...created.contenido,
    cabecera: { ...created.contenido.cabecera, precioIncluyeIva: false, recepcionCompleta: true,
      documentoCompletoConfirmado: true, tipoDocumento: 'nota_entrega' },
    lineas: created.contenido.lineas.map(line => ({ ...line, factorConversion: '1',
      correcciones: { tasaIva: { valor: '0', motivo: 'Manual tax choice' } },
      asociacion: { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'Reviewed new product' },
      codigoBarras: { usarCodigoFactura: false, codigoEscaneado: '0001234567890' }, precioVenta: '12' })),
  };
  return { extraction, content };
}

async function run(options: {
  mutate?: (data: ReturnType<typeof fixture>) => void;
  catalog?: unknown;
  catalogStatus?: number;
  range?: string;
  throwCatalog?: boolean;
} = {}) {
  const data = fixture();
  options.mutate?.(data);
  const before = JSON.stringify(data);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn: typeof fetch = jest.fn(async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    let body: unknown;
    let status = 200;
    let headers: Record<string, string> = {};
    if (url.endsWith('/auth/v1/user')) body = { id: userId, role: 'authenticated' };
    else if (url.includes('/facturas_proveedores?')) body = [{ id: invoiceId, version: 1, documento_sha256: sha,
      proveedor_codigo: 'SUPPLIER', facturas_proveedores_revisiones: [{ revision: 1, factura_version: 1,
        extraccion_id: extractionId, documento_sha256: sha, contenido: data.content, fingerprint,
        aprobado_por: userId, aprobado_en: '2026-11-20T12:00:00Z', facturas_proveedores_extracciones: {
          id: extractionId, factura_id: invoiceId, estado: 'completado', factura_version: 1,
          documento_sha256: sha, resultado: data.extraction } }] }];
    else if (url.includes('/productos_view?')) {
      if (options.throwCatalog) throw new Error('Private transport detail');
      body = options.catalog ?? []; status = options.catalogStatus ?? 200;
      headers = { 'Content-Range': options.range ?? '*/0' };
    } else if (url.endsWith('/registrar_stage_compra_factura')) body = token;
    else if (url.endsWith('/materializar_compra_factura')) body = { factura_id: invoiceId, compra_id: 7, replay: false };
    else throw new Error(`Unexpected call ${url}`);
    return new Response(JSON.stringify(body), { status, headers });
  });
  const response = await handleFacturaMaterializationRequest(new Request('https://edge.test/materializar', {
    method: 'POST', headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ facturaId: invoiceId, revision: 1, fingerprint, versionEsperada: 1 }),
  }), { config, fetchFn });
  expect(JSON.stringify(data)).toBe(before);
  const stage = calls.find(call => call.url.endsWith('/registrar_stage_compra_factura'));
  return { response, calls, payload: stage ? JSON.parse(String(stage.init.body)).p_payload : null };
}

it('uses the captured barcode as code and the invoice code as reference, without changing quantity or cost', async () => {
  const result = await run();
  expect(result.response.status).toBe(200);
  expect(result.payload.items).toEqual([{ codigo_producto: '0001234567890', descripcion: 'New pliers',
    cantidad: '2', costo: '6.06', precio: '12', referencia: '00-INV-A', es_nuevo: true }]);
  const reads = result.calls.filter(call => call.url.includes('/productos_view?'));
  expect(reads).toHaveLength(3);
  for (const read of reads) {
    expect(new Headers(read.init.headers).get('authorization')).toBe('Bearer user-jwt');
    expect(new Headers(read.init.headers).get('apikey')).toBe('anon');
  }
});

it('preserves the existing approved-product payload and network path', async () => {
  const result = await run({ mutate: data => {
    data.content = { ...data.content, lineas: data.content.lineas.map(line => ({ ...line,
      asociacion: { tipo: 'confirmado', codigoInterno: 'SKU-1', evidencia: 'manual', motivo: 'Catalog selection' } })) };
  } });
  expect(result.response.status).toBe(200);
  expect(result.payload.items[0]).toEqual({ codigo_producto: 'SKU-1', descripcion: 'New pliers', cantidad: '2',
    costo: '6.06', precio: '12', referencia: null, es_nuevo: false });
  expect(result.calls).toHaveLength(4);
});

it.each([undefined, 'x'.repeat(101), ' A', 'A ', 'A,or.BAD'])('rejects missing or unsupported new codes without staging: %s', async code => {
  const result = await run({ mutate: data => {
    data.content = { ...data.content, lineas: data.content.lineas.map(line => ({ ...line,
      codigoBarras: code === undefined ? { usarCodigoFactura: false } : { usarCodigoFactura: false, codigoEscaneado: code } })) };
  } });
  expect(result.response.status).toBeGreaterThanOrEqual(400);
  expect(result.payload).toBeNull();
});

it('preserves alphanumeric captured codes and corrected invoice references', async () => {
  const result = await run({ mutate: data => {
    data.content = { ...data.content, lineas: data.content.lineas.map(line => ({ ...line,
      codigoBarras: { usarCodigoFactura: false, codigoEscaneado: '00-ABC/12' },
      correcciones: { ...line.correcciones, codigoProveedor: { valor: '000-REF', motivo: 'Printed correction' } } })) };
  } });
  expect(result.response.status).toBe(200);
  expect(result.payload.items[0]).toMatchObject({ codigo_producto: '00-ABC/12', referencia: '000-REF' });
});

it.each([
  { catalog: [{ codigo_interno: 'EXISTING' }] },
  { catalogStatus: 403 }, { catalogStatus: 206 }, { catalog: {} },
  { range: '*/1' }, { range: '' }, { throwCatalog: true },
])('fails closed on catalog collision or incomplete/unavailable reads: %j', async options => {
  const result = await run(options);
  expect(result.calls.some(call => call.url.includes('/productos_view?'))).toBe(true);
  expect(result.response.status).toBeGreaterThanOrEqual(400);
  expect(result.payload).toBeNull();
  expect(await result.response.text()).not.toContain('Private transport detail');
});

it('does not merge new codes with different invoice references', async () => {
  const result = await run({ mutate: data => {
    data.extraction = { ...data.extraction, lineas: [...data.extraction.lineas, { ...data.extraction.lineas[0], numeroLinea: 2, codigoProveedor: 'OTHER' }] };
    data.content = { ...data.content, lineas: [...data.content.lineas,
      { ...data.content.lineas[0], lineaId: '55555555-5555-4555-8555-555555555555', origen: { numeroLinea: 2 } }] };
  } });
  expect(result.response.status).toBe(409);
  expect(result.payload).toBeNull();
});
