import { handleFacturaRecalculationRequest } from '../../supabase/functions/recalcular-revision-factura/handler';
import {
  aplicarEdicion,
  calcularRevision,
  crearRevisionDesdeExtraccion,
  crearRevisionManual,
  validarContenidoRevision,
  type Edicion,
  type RevisionContenido,
} from './facturaRevision';
import { parseFacturaExtraction, type FacturaExtraccionPayload } from './facturaExtractionContract';

describe('supplier invoice recalculation endpoint', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const facturaId = '22222222-2222-4222-8222-222222222222';
  const extractionId = '33333333-3333-4333-8333-333333333333';
  const fingerprint = 'a'.repeat(64);
  const sha256 = 'b'.repeat(64);
  const config = { supabaseUrl: 'https://project.test', supabaseAnonKey: 'anon-key' };
  const requestBody = { facturaId, revision: 1, fingerprint, versionEsperada: 1 };
  const manualContent = {
    review_schema: 1,
    calculo_version: 'calc-v1',
    matching_version: 'matching-v1',
    extraccion_id: null,
    cabecera: {
      correcciones: {},
      tasaConfirmada: null,
      precioIncluyeIva: null,
      recepcionCompleta: null,
      documentoCompletoConfirmado: null,
    },
    lineas: [],
  };
  const baseSource = {
    id: facturaId,
    version: 1,
    documento_sha256: sha256,
    facturas_proveedores_revisiones: [{
      revision: 1,
      factura_version: 1,
      extraccion_id: null,
      documento_sha256: sha256,
      contenido: manualContent,
      fingerprint,
      aprobado_por: userId,
      aprobado_en: '2026-10-25T12:00:00Z',
      facturas_proveedores_extracciones: null,
    }],
  };

  function request(body: unknown = requestBody, authorization = 'Bearer user-jwt'): Request {
    return new Request('https://edge.test/recalcular', {
      method: 'POST',
      headers: { ...(authorization ? { Authorization: authorization } : {}), 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  function createApprovedManualContent(): RevisionContenido {
    const lineId = '44444444-4444-4444-8444-444444444444';
    let content = crearRevisionManual();
    const corrections = {
      descripcion: { valor: 'Manual item', motivo: 'Manual invoice entry' },
      cantidad: { valor: '1', motivo: 'Manual invoice entry' },
      precioUnitario: { valor: '10', motivo: 'Manual invoice entry' },
      unidad: { valor: 'UND', motivo: 'Manual invoice entry' },
      tasaIva: { valor: '0', motivo: 'Manual invoice entry' },
    };
    const edits: Edicion[] = [
      { tipo: 'agregar_linea_manual', correcciones: corrections },
      { tipo: 'decision_cabecera', campo: 'documentoCompletoConfirmado', valor: true },
      { tipo: 'decision_cabecera', campo: 'recepcionCompleta', valor: true },
      { tipo: 'decision_cabecera', campo: 'precioIncluyeIva', valor: false },
      { tipo: 'cabecera_escalar', campo: 'moneda', valor: 'USD', motivo: 'Printed currency' },
      { tipo: 'factor_conversion', lineaId: lineId, valor: '1' },
      {
        tipo: 'asociacion',
        lineaId: lineId,
        asociacion: { tipo: 'confirmado', codigoInterno: 'SKU-1', evidencia: 'manual', motivo: 'Confirmed catalog identity' },
      },
    ];

    for (const edit of edits) {
      const result = aplicarEdicion(content, null, edit, () => lineId);
      if (!result.ok) throw new Error(result.error.mensaje);
      content = result.contenido;
    }

    return content;
  }

  function fetchFor(source: unknown = [baseSource], authBody: unknown = { id: userId }) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn: typeof fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, init });
      return new Response(JSON.stringify(calls.length === 1 ? authBody : source), { status: 200 });
    });
    return { calls, fetchFn };
  }

  async function call(req = request(), source: unknown = [baseSource]) {
    const mock = fetchFor(source);
    const response = await handleFacturaRecalculationRequest(req, { config, fetchFn: mock.fetchFn });
    return { response, calls: mock.calls };
  }

  it('returns the shared calculator result without exposing document lines', async () => {
    const { response, calls } = await call();
    const body = await response.json();
    const valid = validarContenidoRevision(manualContent, null);
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const expected = calcularRevision({ extraccion: null, contenido: valid.contenido });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      origen: {
        facturaId, revision: 1, fingerprint, facturaVersion: 1, documentoSha256: sha256,
        extraccionId: null, aprobadoEn: '2026-10-25T12:00:00Z', calculoVersion: 'calc-v1',
      },
      calculo: {
        calculo_version: expected.calculo_version,
        moneda: expected.moneda,
        totales: expected.totales,
        pos: expected.pos,
        bloqueos: expected.bloqueos.map(({ codigo, ambito, lineaId }) => ({ codigo, ambito, lineaId })),
        sinBloqueos: expected.sinBloqueos,
      },
      permisoImportacion: false,
      instantaneaDe: 'instantanea_una_lectura_postgrest_sin_garantia_entre_peticiones',
    });
    expect(body.calculo).not.toHaveProperty('lineas');
    expect(calls).toHaveLength(2);
    expect(calls[1].init.method).toBe('GET');
    expect(new Headers(calls[1].init.headers).get('authorization')).toBe('Bearer user-jwt');
    expect(new Headers(calls[1].init.headers).get('apikey')).toBe('anon-key');
    expect(calls[1].url).toContain('facturas_proveedores_revisiones.limit=1');
    expect(calls[1].url).toContain('facturas_proveedores_revisiones.order=revision.desc');
    expect(calls[1].url).toContain('facturas_proveedores_extracciones');
  });

  it('recalculates an approved manual revision without an attached document', async () => {
    const content = createApprovedManualContent();
    const source = [{
      ...baseSource,
      documento_sha256: null,
      facturas_proveedores_revisiones: [{
        ...baseSource.facturas_proveedores_revisiones[0],
        documento_sha256: null,
        contenido: content,
      }],
    }];
    const { response } = await call(request(), source);
    const body = await response.json();
    const expected = calcularRevision({ extraccion: null, contenido: content });

    expect(validarContenidoRevision(content, null).ok).toBe(true);
    expect(expected.sinBloqueos).toBe(true);
    expect(response.status).toBe(200);
    expect(body.origen.documentoSha256).toBeNull();
    expect(body.calculo.totales).toEqual(expected.totales);
    expect(body.permisoImportacion).toBe(false);
  });

  it.each([
    ['unknown amount field', { ...requestBody, amount: 1 }],
    ['client policy field', { ...requestBody, politicas: { tolerancia: '99' } }],
    ['unknown blockers field', { ...requestBody, bloqueos: [] }],
    ['missing fingerprint', { facturaId, revision: 1, versionEsperada: 1 }],
    ['unsafe version', { ...requestBody, versionEsperada: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid fingerprint case', { ...requestBody, fingerprint: 'A'.repeat(64) }],
  ])('rejects %s before network access', async (_name, body) => {
    const mock = fetchFor();
    const response = await handleFacturaRecalculationRequest(request(body), { config, fetchFn: mock.fetchFn });
    expect(response.status).toBe(400);
    expect(mock.calls).toHaveLength(0);
  });

  it('rejects an oversized request before network access', async () => {
    const mock = fetchFor();
    const response = await handleFacturaRecalculationRequest(request(' '.repeat(4097)), { config, fetchFn: mock.fetchFn });
    expect(response.status).toBe(400);
    expect(mock.calls).toHaveLength(0);
  });

  it('cancels a streamed oversized request without buffering the whole body', async () => {
    const mock = fetchFor();
    const streamState = { bytesPulled: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        streamState.bytesPulled += 1024;
        controller.enqueue(new Uint8Array(1024));
        if (streamState.bytesPulled >= 1024 * 1024) controller.close();
      },
      cancel() {
        streamState.cancelled = true;
      },
    });
    const streamedRequest = new Request('https://edge.test/recalcular', {
      method: 'POST',
      headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const response = await handleFacturaRecalculationRequest(streamedRequest, { config, fetchFn: mock.fetchFn });

    expect(response.status).toBe(400);
    expect(streamState.cancelled).toBe(true);
    expect(streamState.bytesPulled).toBeLessThan(1024 * 1024);
    expect(mock.calls).toHaveLength(0);
  });

  it('requires a bearer token before network access', async () => {
    const mock = fetchFor();
    const response = await handleFacturaRecalculationRequest(request(requestBody, ''), { config, fetchFn: mock.fetchFn });
    expect(response.status).toBe(401);
    expect(mock.calls).toHaveLength(0);
  });

  it('uses the same fixed 404 body for hidden and absent sources', async () => {
    const absent = await call(request(), []);
    const noRevision = await call(request(), [{ ...baseSource, facturas_proveedores_revisiones: [] }]);
    expect(absent.response.status).toBe(404);
    expect(noRevision.response.status).toBe(404);
    expect(await absent.response.text()).toBe(await noRevision.response.text());
  });

  it.each([
    ['stale revision', { facturas_proveedores_revisiones: [{ ...baseSource.facturas_proveedores_revisiones[0], revision: 2 }] }, 409],
    ['unapproved latest revision', { facturas_proveedores_revisiones: [{ ...baseSource.facturas_proveedores_revisiones[0], aprobado_por: null, aprobado_en: null }] }, 409],
    ['fingerprint mismatch', { facturas_proveedores_revisiones: [{ ...baseSource.facturas_proveedores_revisiones[0], fingerprint: 'c'.repeat(64) }] }, 409],
    ['invoice version mismatch', { version: 2 }, 409],
    ['revision document hash mismatch', { facturas_proveedores_revisiones: [{ ...baseSource.facturas_proveedores_revisiones[0], documento_sha256: 'c'.repeat(64) }] }, 409],
    ['invalid stored content', { facturas_proveedores_revisiones: [{ ...baseSource.facturas_proveedores_revisiones[0], contenido: { ...manualContent, importe: '999' } }] }, 422],
    ['content extraction identity mismatch', { facturas_proveedores_revisiones: [{ ...baseSource.facturas_proveedores_revisiones[0], extraccion_id: extractionId }] }, 422],
    ['missing linked extraction', { facturas_proveedores_revisiones: [{ ...baseSource.facturas_proveedores_revisiones[0], extraccion_id: extractionId, contenido: { ...manualContent, extraccion_id: extractionId } }] }, 422],
  ])('returns a fixed %i response for %s', async (_name, changes, status) => {
    const { response } = await call(request(), [{ ...baseSource, ...changes }]);
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).not.toContain('999');
    expect(text).not.toContain('SQL');
  });

  it('parses and calculates a stored extraction using the public calculator', async () => {
    const extraction: FacturaExtraccionPayload = {
      version: 1,
      cabecera: {
        proveedorNombre: 'Proveedor sintético', proveedorRif: null, numeroDocumento: 'DOC-1', numeroControl: null,
        fechaEmision: '2026-10-25', moneda: 'USD', tasaCambio: null, subtotal: null, descuentos: [], impuestos: [], total: null,
      },
      lineas: [{
        numeroLinea: 1, pagina: 1, codigoProveedor: 'TEST-1', descripcion: 'Muestra', cantidad: '1', unidad: 'UND',
        precioUnitario: '1', descuentos: [], tasaIva: null, total: null, incertidumbre: null,
      }],
      metadatos: { totalPaginas: 1, paginasProcesadas: [1], documentoCompleto: true, advertencias: [], confianzaGlobal: null },
    };
    const parsed = parseFacturaExtraction(extraction);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const made = crearRevisionDesdeExtraccion(parsed.data, extractionId, () => '44444444-4444-4444-8444-444444444444');
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const source = [{
      ...baseSource,
      facturas_proveedores_revisiones: [{
        ...baseSource.facturas_proveedores_revisiones[0],
        extraccion_id: extractionId,
        contenido: made.contenido,
        facturas_proveedores_extracciones: {
          id: extractionId, factura_id: facturaId, estado: 'completado', factura_version: 1,
          documento_sha256: sha256, resultado: extraction,
        },
      }],
    }];
    const { response } = await call(request(), source);
    const body = await response.json();
    const expected = calcularRevision({ extraccion: parsed.data, contenido: made.contenido });
    expect(response.status).toBe(200);
    expect(body.calculo.bloqueos.map((b: { codigo: string }) => b.codigo)).toEqual(expected.bloqueos.map(b => b.codigo));
    expect(body.permisoImportacion).toBe(false);
    expect(body.calculo).not.toHaveProperty('lineas');
  });

  it('rejects an extraction whose invoice, state, or document hash disagrees', async () => {
    const source = [{
      ...baseSource,
      facturas_proveedores_revisiones: [{
        ...baseSource.facturas_proveedores_revisiones[0],
        extraccion_id: extractionId,
        contenido: { ...manualContent, extraccion_id: extractionId },
        facturas_proveedores_extracciones: {
          id: extractionId, factura_id: '55555555-5555-4555-8555-555555555555', estado: 'fallido', factura_version: 1,
          documento_sha256: 'c'.repeat(64), resultado: {},
        },
      }],
    }];
    const { response } = await call(request(), source);
    expect(response.status).toBe(422);
    expect(await response.text()).toBe(JSON.stringify({ error: { code: 'fuente_inconsistente', message: 'La extracción almacenada no coincide con la revisión' } }));
  });

  it('rejects a stored extraction result that fails its parser contract', async () => {
    const source = [{
      ...baseSource,
      facturas_proveedores_revisiones: [{
        ...baseSource.facturas_proveedores_revisiones[0],
        extraccion_id: extractionId,
        contenido: { ...manualContent, extraccion_id: extractionId },
        facturas_proveedores_extracciones: {
          id: extractionId, factura_id: facturaId, estado: 'completado', factura_version: 1,
          documento_sha256: sha256, resultado: { version: 'invalid' },
        },
      }],
    }];
    const { response } = await call(request(), source);
    expect(response.status).toBe(422);
    expect(await response.text()).toBe(JSON.stringify({ error: { code: 'fuente_inconsistente', message: 'La extracción almacenada no es válida' } }));
  });
});
