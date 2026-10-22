import { handleFacturaExtractionRequest } from '../../supabase/functions/procesar-factura-multimodal/handler';

describe('Factura Extraction HTTP Handler Integration', () => {
  const FAKE_CONFIG = {
    supabaseUrl: 'https://test-project.supabase.co',
    supabaseAnonKey: 'anon-test-key-12345',
    supabaseServiceRoleKey: 'service-role-test-secret-99999',
    openRouterApiKey: 'sk-or-test-openrouter-secret-77777',
  };

  const VALID_USER_ID = '11111111-1111-4111-8111-111111111111';
  const VALID_FACTURA_ID = '22222222-2222-4222-8222-222222222222';
  const VALID_SOLICITUD_ID = '33333333-3333-4333-8333-333333333333';
  const VALID_DOC_ID = '44444444-4444-4444-8444-444444444444';
  const VALID_JWT = 'valid-user-jwt-token-abc';
  const VALID_STORAGE_PATH = `${VALID_USER_ID}/${VALID_FACTURA_ID}/${VALID_DOC_ID}.pdf`;

  // Minimal valid PDF: %PDF-1.4 with dummy body
  const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xd0, 0xd4, 0xc5, 0xd8]);
  const PDF_SHA256 = '8b3d68371ef3b64bc9e96e730a911e0e843f4c6e9381711204cfbf67e914041b'; // We will calculate dynamically or match exactly in test

  const MINIMAL_CONTRACT_RESULT = {
    version: 1,
    cabecera: {
      proveedorNombre: 'FERRETERIA TEST C.A.',
      proveedorRif: 'J-12345678-0',
      numeroDocumento: 'FAC-001',
      numeroControl: '00-01',
      fechaEmision: '2026-10-22',
      moneda: 'USD',
      tasaCambio: '1.000000',
      subtotal: '100.0000',
      descuentos: [],
      impuestos: [],
      total: '100.0000',
    },
    lineas: [
      {
        numeroLinea: 1,
        pagina: 1,
        codigoProveedor: 'P-001',
        descripcion: 'PRODUCTO TEST',
        cantidad: '2.0000',
        unidad: 'UND',
        precioUnitario: '50.000000',
        descuentos: [],
        tasaIva: null,
        total: '100.0000',
        incertidumbre: null,
      },
    ],
    metadatos: {
      totalPaginas: 1,
      paginasProcesadas: [1],
      documentoCompleto: true,
      advertencias: [],
      confianzaGlobal: 0.98,
    },
  };

  async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  interface RequestRecord {
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyText?: string;
  }

  function createNetworkMock(options: {
    authUserResponse?: { status: number; body?: any };
    reservationResponse?: { status: number; body?: any };
    storageResponse?: { status: number; bytes?: Uint8Array; headers?: Record<string, string> };
    openRouterResponse?: { status: number; body?: any };
    completionResponse?: { status: number; body?: any };
  }) {
    const recordedCalls: RequestRecord[] = [];

    const mockFetch: typeof fetch = jest.fn().mockImplementation(async (urlInput: any, init?: RequestInit) => {
      const url = typeof urlInput === 'string' ? urlInput : urlInput.url;
      const method = init?.method || 'GET';
      const headers: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => {
            headers[k.toLowerCase()] = v;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([k, v]) => {
            headers[k.toLowerCase()] = v;
          });
        } else {
          Object.entries(init.headers).forEach(([k, v]) => {
            headers[k.toLowerCase()] = String(v);
          });
        }
      }

      let bodyText: string | undefined;
      if (init?.body) {
        if (typeof init.body === 'string') {
          bodyText = init.body;
        } else if (init.body instanceof Uint8Array) {
          bodyText = `<bytes: ${init.body.length}>`;
        }
      }

      recordedCalls.push({ url, method, headers, bodyText });

      // 1. Supabase Auth user check
      if (url === `${FAKE_CONFIG.supabaseUrl}/auth/v1/user`) {
        const conf = options.authUserResponse ?? {
          status: 200,
          body: { id: VALID_USER_ID, role: 'authenticated', email: 'employee@example.com' },
        };
        return new Response(JSON.stringify(conf.body ?? {}), {
          status: conf.status,
          headers: { 'content-type': 'application/json' },
        });
      }

      // 2. Reservation RPC
      if (url === `${FAKE_CONFIG.supabaseUrl}/rest/v1/rpc/reservar_extraccion_factura`) {
        const conf = options.reservationResponse ?? {
          status: 200,
          body: {
            extraccion_id: '55555555-5555-4555-8555-555555555555',
            factura_id: VALID_FACTURA_ID,
            solicitud_id: VALID_SOLICITUD_ID,
            estado: 'procesando',
            factura_version: 1,
            ejecutar: true,
            replay: false,
            documento: {
              path: VALID_STORAGE_PATH,
              sha256: await sha256Hex(PDF_MAGIC),
              mime: 'application/pdf',
              bytes: PDF_MAGIC.length,
            },
          },
        };
        return new Response(JSON.stringify(conf.body ?? {}), {
          status: conf.status,
          headers: { 'content-type': 'application/json' },
        });
      }

      // 3. Storage download
      if (url.includes('/storage/v1/object/')) {
        const conf = options.storageResponse ?? {
          status: 200,
          bytes: PDF_MAGIC,
          headers: { 'content-type': 'application/pdf' },
        };
        return new Response(conf.bytes ?? PDF_MAGIC, {
          status: conf.status,
          headers: conf.headers ?? { 'content-type': 'application/pdf' },
        });
      }

      // 4. OpenRouter API
      if (url === 'https://openrouter.ai/api/v1/chat/completions') {
        const conf = options.openRouterResponse ?? {
          status: 200,
          body: {
            id: 'gen-test-123',
            model: 'google/gemini-3.1-flash-lite',
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify(MINIMAL_CONTRACT_RESULT) },
              },
            ],
            usage: {
              prompt_tokens: 1200,
              completion_tokens: 350,
              total_tokens: 1550,
              cost: 0.00085,
            },
          },
        };
        return new Response(JSON.stringify(conf.body ?? {}), {
          status: conf.status,
          headers: { 'content-type': 'application/json' },
        });
      }

      // 5. Completion RPC
      if (url === `${FAKE_CONFIG.supabaseUrl}/rest/v1/rpc/completar_extraccion_factura`) {
        const conf = options.completionResponse ?? {
          status: 200,
          body: {
            extraccion_id: '55555555-5555-4555-8555-555555555555',
            factura_id: VALID_FACTURA_ID,
            solicitud_id: VALID_SOLICITUD_ID,
            estado: 'completado',
            replay: false,
          },
        };
        return new Response(JSON.stringify(conf.body ?? {}), {
          status: conf.status,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    });

    return { mockFetch, recordedCalls };
  }

  function createValidRequest(bodyOverrides: Record<string, any> = {}, headerOverrides: Record<string, string> = {}) {
    const body = {
      facturaId: VALID_FACTURA_ID,
      solicitudId: VALID_SOLICITUD_ID,
      versionEsperada: 1,
      ...bodyOverrides,
    };
    return new Request('https://edge.supabase.co/functions/v1/procesar-factura-multimodal', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${VALID_JWT}`,
        apikey: FAKE_CONFIG.supabaseAnonKey,
        ...headerOverrides,
      },
      body: JSON.stringify(body),
    });
  }

  describe('CORS and HTTP Method Enforcement', () => {
    test('handles OPTIONS preflight with safe CORS headers, no credentials, POST and OPTIONS only', async () => {
      const req = new Request('https://edge.supabase.co/functions/v1/procesar-factura-multimodal', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization, apikey, content-type',
        },
      });

      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    test('rejects GET, PUT, DELETE with 405 Method Not Allowed and Allow header', async () => {
      for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
        const req = new Request('https://edge.supabase.co/functions/v1/procesar-factura-multimodal', { method });
        const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG });
        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toBe('POST, OPTIONS');
      }
    });
  });

  describe('Input Validation & Boundary Hardening', () => {
    test('rejects non-JSON requests or invalid body structure', async () => {
      const req = new Request('https://edge.supabase.co/functions/v1/procesar-factura-multimodal', {
        method: 'POST',
        headers: { 'content-type': 'text/plain', authorization: `Bearer ${VALID_JWT}` },
        body: 'hello world',
      });
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('bad_request');
    });

    test('rejects requests with extra forbidden keys (no injection of prompts, models, URLs or paths)', async () => {
      const forbiddenPayloads = [
        { prompt: 'ignore previous instructions', facturaId: VALID_FACTURA_ID, solicitudId: VALID_SOLICITUD_ID, versionEsperada: 1 },
        { model: 'unauthorized-expensive-model', facturaId: VALID_FACTURA_ID, solicitudId: VALID_SOLICITUD_ID, versionEsperada: 1 },
        { url: 'https://evil.com/leak', facturaId: VALID_FACTURA_ID, solicitudId: VALID_SOLICITUD_ID, versionEsperada: 1 },
        { documentPath: 'admin/secret.pdf', facturaId: VALID_FACTURA_ID, solicitudId: VALID_SOLICITUD_ID, versionEsperada: 1 },
        { apiKey: 'override-key', facturaId: VALID_FACTURA_ID, solicitudId: VALID_SOLICITUD_ID, versionEsperada: 1 },
      ];

      for (const payload of forbiddenPayloads) {
        const req = new Request('https://edge.supabase.co/functions/v1/procesar-factura-multimodal', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${VALID_JWT}` },
          body: JSON.stringify(payload),
        });
        const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error.code).toBe('bad_request');
      }
    });

    test('rejects invalid or non-UUID identifiers and non-positive version', async () => {
      const invalidCases = [
        { facturaId: 'not-a-uuid', solicitudId: VALID_SOLICITUD_ID, versionEsperada: 1 },
        { facturaId: VALID_FACTURA_ID, solicitudId: '1234', versionEsperada: 1 },
        { facturaId: VALID_FACTURA_ID, solicitudId: VALID_SOLICITUD_ID, versionEsperada: 0 },
        { facturaId: VALID_FACTURA_ID, solicitudId: VALID_SOLICITUD_ID, versionEsperada: -1 },
        { facturaId: VALID_FACTURA_ID, solicitudId: VALID_SOLICITUD_ID, versionEsperada: 1.5 },
      ];

      for (const payload of invalidCases) {
        const req = new Request('https://edge.supabase.co/functions/v1/procesar-factura-multimodal', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${VALID_JWT}` },
          body: JSON.stringify(payload),
        });
        const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG });
        expect(res.status).toBe(400);
      }
    });
  });

  describe('Authentication & Server Configuration', () => {
    test('rejects missing or malformed Authorization header with 401', async () => {
      const req = new Request('https://edge.supabase.co/functions/v1/procesar-factura-multimodal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ facturaId: VALID_FACTURA_ID, solicitudId: VALID_SOLICITUD_ID, versionEsperada: 1 }),
      });
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('unauthorized');
    });

    test('rejects when Auth verification fails (e.g. invalid/expired JWT)', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({
        authUserResponse: { status: 401, body: { message: 'Invalid JWT' } },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(401);

      // Verify Auth was checked and OpenRouter was NEVER called
      expect(recordedCalls.some((c) => c.url.includes('/auth/v1/user'))).toBe(true);
      expect(recordedCalls.some((c) => c.url.includes('openrouter.ai'))).toBe(false);
    });

    test('rejects when server configuration is incomplete before reservation', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({});
      const incompleteConfigs = [
        { ...FAKE_CONFIG, openRouterApiKey: '' },
        { ...FAKE_CONFIG, supabaseServiceRoleKey: '' },
        { ...FAKE_CONFIG, supabaseUrl: '' },
      ];

      for (const cfg of incompleteConfigs) {
        const req = createValidRequest();
        const res = await handleFacturaExtractionRequest(req, { config: cfg, fetchFn: mockFetch });
        expect(res.status).toBe(500);
        const json = await res.json();
        expect(json.error.code).toBe('server_configuration_error');
      }

      // No reservation or provider call made
      expect(recordedCalls.some((c) => c.url.includes('/rpc/reservar_extraccion_factura'))).toBe(false);
      expect(recordedCalls.some((c) => c.url.includes('openrouter.ai'))).toBe(false);
    });
  });

  describe('Reservation Scenarios (No Provider Calls on Replay, Busy, Stale, Unattached)', () => {
    test('returns existing staged result on replay without calling OpenRouter or fetching storage', async () => {
      const existingExtraction = {
        extraccion_id: '55555555-5555-4555-8555-555555555555',
        factura_id: VALID_FACTURA_ID,
        solicitud_id: VALID_SOLICITUD_ID,
        estado: 'completado',
        factura_version: 1,
        ejecutar: false,
        replay: true,
        resultado: MINIMAL_CONTRACT_RESULT,
        error_codigo: null,
        modelo: 'google/gemini-3.1-flash-lite',
        proveedor: null,
        tokens_prompt: 100,
        tokens_completion: 50,
        tokens_total: 150,
        costo_usd: '0.001000',
        metadatos: {
          model: 'google/gemini-3.1-flash-lite',
          provider: null,
          tokens_prompt: 100,
          tokens_completion: 50,
          tokens_total: 150,
          cost_usd: '0.001000',
        },
      };

      const { mockFetch, recordedCalls } = createNetworkMock({
        reservationResponse: { status: 200, body: existingExtraction },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.replay).toBe(true);
      expect(json.estado).toBe('completado');
      expect(json.resultado.cabecera.proveedorNombre).toBe('FERRETERIA TEST C.A.');

      // Zero storage calls, zero OpenRouter calls, zero completion calls
      expect(recordedCalls.some((c) => c.url.includes('/storage/v1/object/'))).toBe(false);
      expect(recordedCalls.some((c) => c.url.includes('openrouter.ai'))).toBe(false);
      expect(recordedCalls.some((c) => c.url.includes('/rpc/completar_extraccion_factura'))).toBe(false);
    });

    test('handles busy state (extraccion_en_curso PX409) with 409 and never calls provider', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({
        reservationResponse: {
          status: 409,
          body: { code: 'PX409', message: 'extraccion_en_curso' },
        },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('extraccion_en_curso');
      expect(recordedCalls.some((c) => c.url.includes('openrouter.ai'))).toBe(false);
    });

    test('handles stale version (version_obsoleta PV409) with 409 and never calls provider', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({
        reservationResponse: {
          status: 409,
          body: { code: 'PV409', message: 'version_obsoleta' },
        },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('version_obsoleta');
      expect(recordedCalls.some((c) => c.url.includes('openrouter.ai'))).toBe(false);
    });

    test('handles manual invoice without attachment (sin_documento_fuente 22023) without side effects', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({
        reservationResponse: {
          status: 400,
          body: { code: '22023', message: 'sin_documento_fuente' },
        },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('sin_documento_fuente');
      expect(recordedCalls.some((c) => c.url.includes('openrouter.ai'))).toBe(false);
    });
  });

  describe('Storage Download & Source Integrity Checks', () => {
    test('fails and marks attempt as fallido (invalid_document) if storage path violates strict owner/invoice path', async () => {
      const evilPath = '99999999-9999-9999-9999-999999999999/other-factura/doc.pdf';
      const { mockFetch, recordedCalls } = createNetworkMock({
        reservationResponse: {
          status: 200,
          body: {
            extraccion_id: '55555555-5555-4555-8555-555555555555',
            factura_id: VALID_FACTURA_ID,
            solicitud_id: VALID_SOLICITUD_ID,
            estado: 'procesando',
            factura_version: 1,
            ejecutar: true,
            replay: false,
            documento: {
              path: evilPath,
              sha256: await sha256Hex(PDF_MAGIC),
              mime: 'application/pdf',
              bytes: PDF_MAGIC.length,
            },
          },
        },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe('invalid_document');

      // Check completion RPC was called with status fallido
      const completionCall = recordedCalls.find((c) => c.url.includes('/rpc/completar_extraccion_factura'));
      expect(completionCall).toBeDefined();
      const completionBody = JSON.parse(completionCall!.bodyText!);
      expect(completionBody.p_estado).toBe('fallido');
      expect(completionBody.p_error_codigo).toBe('invalid_document');

      // Provider was NEVER called
      expect(recordedCalls.some((c) => c.url.includes('openrouter.ai'))).toBe(false);
    });

    test('fails and marks attempt as fallido if SHA256 or byte length does not match snapshot metadata', async () => {
      const corruptBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x39, 0x39]); // Different hash
      const { mockFetch, recordedCalls } = createNetworkMock({
        storageResponse: {
          status: 200,
          bytes: corruptBytes,
          headers: { 'content-type': 'application/pdf' },
        },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(422);

      const completionCall = recordedCalls.find((c) => c.url.includes('/rpc/completar_extraccion_factura'));
      expect(completionCall).toBeDefined();
      const completionBody = JSON.parse(completionCall!.bodyText!);
      expect(completionBody.p_estado).toBe('fallido');
      expect(completionBody.p_error_codigo).toBe('invalid_document');

      expect(recordedCalls.some((c) => c.url.includes('openrouter.ai'))).toBe(false);
    });
  });

  describe('Full Successful Extraction & Provider Lifecycle', () => {
    test('preserves provider costs below one micro-dollar without rounding them to zero', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({
        openRouterResponse: {
          status: 200,
          body: {
            id: 'gen-test-micro-cost',
            model: 'google/gemini-3.1-flash-lite',
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify(MINIMAL_CONTRACT_RESULT) },
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
              cost: 0.000000123,
            },
          },
        },
      });

      const res = await handleFacturaExtractionRequest(createValidRequest(), {
        config: FAKE_CONFIG,
        fetchFn: mockFetch,
      });
      const completionCall = recordedCalls.find((call) => call.url.includes('/rpc/completar_extraccion_factura'));

      expect(res.status).toBe(200);
      expect(JSON.parse(completionCall!.bodyText!).p_metadatos.cost_usd).toBe('0.000000123');
    });

    test('downloads verified source, calls OpenRouter, and marks attempt completado with strict metadata mapping', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({});

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.estado).toBe('completado');
      expect(json.resultado.cabecera.proveedorNombre).toBe('FERRETERIA TEST C.A.');

      // Assert OpenRouter call headers and body
      const openRouterCall = recordedCalls.find((c) => c.url.includes('openrouter.ai'));
      expect(openRouterCall).toBeDefined();
      expect(openRouterCall!.headers.authorization).toBe(`Bearer ${FAKE_CONFIG.openRouterApiKey}`);
      // Zero Supabase keys leaked to OpenRouter
      expect(openRouterCall!.headers.authorization).not.toContain(FAKE_CONFIG.supabaseServiceRoleKey);
      expect(openRouterCall!.headers.authorization).not.toContain(FAKE_CONFIG.supabaseAnonKey);

      // Assert Completion RPC called with service role
      const completionCall = recordedCalls.find((c) => c.url.includes('/rpc/completar_extraccion_factura'));
      expect(completionCall).toBeDefined();
      expect(completionCall!.headers.authorization).toBe(`Bearer ${FAKE_CONFIG.supabaseServiceRoleKey}`);
      expect(completionCall!.headers.apikey).toBe(FAKE_CONFIG.supabaseServiceRoleKey);
      const completionBody = JSON.parse(completionCall!.bodyText!);
      expect(completionBody.p_estado).toBe('completado');
      expect(completionBody.p_resultado).toEqual(MINIMAL_CONTRACT_RESULT);
      expect(completionBody.p_error_codigo).toBeNull();
      expect(completionBody.p_metadatos).toEqual({
        model: 'google/gemini-3.1-flash-lite',
        provider: null,
        tokens_prompt: 1200,
        tokens_completion: 350,
        tokens_total: 1550,
        cost_usd: '0.000850',
      });
    });

    test('correctly maps null usage counts when provider omits tokens or provides invalid counts', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({
        openRouterResponse: {
          status: 200,
          body: {
            id: 'gen-test-no-tokens',
            model: 'google/gemini-3.1-flash-lite',
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify(MINIMAL_CONTRACT_RESULT) },
              },
            ],
            // usage omitted
          },
        },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(200);

      const completionCall = recordedCalls.find((c) => c.url.includes('/rpc/completar_extraccion_factura'));
      expect(completionCall).toBeDefined();
      const completionBody = JSON.parse(completionCall!.bodyText!);
      expect(completionBody.p_metadatos.tokens_prompt).toBeNull();
      expect(completionBody.p_metadatos.tokens_completion).toBeNull();
      expect(completionBody.p_metadatos.tokens_total).toBeNull();
      expect(completionBody.p_metadatos.cost_usd).toBeNull();
    });

    test('handles quarantine state when completion reports cuarentena (concurrent draft modification)', async () => {
      const { mockFetch } = createNetworkMock({
        completionResponse: {
          status: 200,
          body: {
            extraccion_id: '55555555-5555-4555-8555-555555555555',
            factura_id: VALID_FACTURA_ID,
            solicitud_id: VALID_SOLICITUD_ID,
            estado: 'cuarentena',
            replay: false,
          },
        },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.estado).toBe('cuarentena');
    });
  });

  describe('Provider Failures and Safe Error Handling', () => {
    test('handles provider refusal / content filter safely and records fallido (refusal)', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({
        openRouterResponse: {
          status: 200,
          body: {
            model: 'google/gemini-3.1-flash-lite',
            choices: [
              {
                finish_reason: 'content_filter',
                message: { refusal: 'Safety policy violation' },
              },
            ],
          },
        },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(422);

      const completionCall = recordedCalls.find((c) => c.url.includes('/rpc/completar_extraccion_factura'));
      expect(completionCall).toBeDefined();
      const completionBody = JSON.parse(completionCall!.bodyText!);
      expect(completionBody.p_estado).toBe('fallido');
      expect(completionBody.p_error_codigo).toBe('refusal');
    });

    test('handles caller abort without auto-retrying and marks attempt fallido (aborted)', async () => {
      const controller = new AbortController();
      controller.abort();

      const { mockFetch, recordedCalls } = createNetworkMock({});
      const req = createValidRequest();

      const res = await handleFacturaExtractionRequest(req, {
        config: FAKE_CONFIG,
        fetchFn: mockFetch,
        signal: controller.signal,
      });

      expect(res.status).toBe(499); // Client closed request
      const json = await res.json();
      expect(json.error.code).toBe('aborted');

      const completionCall = recordedCalls.find((c) => c.url.includes('/rpc/completar_extraccion_factura'));
      expect(completionCall).toBeDefined();
      const completionBody = JSON.parse(completionCall!.bodyText!);
      expect(completionBody.p_estado).toBe('fallido');
      expect(completionBody.p_error_codigo).toBe('aborted');
    });

    test('persistence failure returns recoverable request identity without secrets or raw data, never staged success', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({
        completionResponse: {
          status: 500,
          body: { message: 'Database transaction failed' },
        },
      });

      const req = createValidRequest();
      const res = await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });
      expect(res.status).toBe(500);
      const json = await res.json();

      expect(json.error.code).toBe('persistence_error');
      expect(json.recuperable).toBe(true);
      expect(json.facturaId).toBe(VALID_FACTURA_ID);
      expect(json.solicitudId).toBe(VALID_SOLICITUD_ID);

      // Must NEVER contain raw contract results or secrets!
      const jsonStr = JSON.stringify(json);
      expect(jsonStr).not.toContain('FERRETERIA TEST C.A.');
      expect(jsonStr).not.toContain(FAKE_CONFIG.supabaseServiceRoleKey);
      expect(jsonStr).not.toContain(FAKE_CONFIG.openRouterApiKey);
    });
  });

  describe('Zero Forbidden Writes & Strict Isolation', () => {
    test('never attempts writes to invoice draft, purchases, inventory, or unapproved tables', async () => {
      const { mockFetch, recordedCalls } = createNetworkMock({});

      const req = createValidRequest();
      await handleFacturaExtractionRequest(req, { config: FAKE_CONFIG, fetchFn: mockFetch });

      for (const call of recordedCalls) {
        // Only allowed routes:
        // 1. /auth/v1/user
        // 2. /rest/v1/rpc/reservar_extraccion_factura
        // 3. /storage/v1/object/authenticated/facturas_proveedores/...
        // 4. openrouter.ai/api/v1/chat/completions
        // 5. /rest/v1/rpc/completar_extraccion_factura
        const isAllowed =
          call.url.endsWith('/auth/v1/user') ||
          call.url.endsWith('/rpc/reservar_extraccion_factura') ||
          call.url.includes('/storage/v1/object/') ||
          call.url.includes('openrouter.ai/api/v1/chat/completions') ||
          call.url.endsWith('/rpc/completar_extraccion_factura');

        expect(isAllowed).toBe(true);

        // Explicit forbidden checks
        expect(call.url).not.toContain('facturas_proveedores_lineas');
        expect(call.url).not.toContain('compras');
        expect(call.url).not.toContain('productos');
        expect(call.url).not.toContain('inventario');
        expect(call.url).not.toContain('comandos_remotos');
      }
    });
  });
});
