import { parseFacturaExtraction } from './facturaExtractionContract';
import { validateDocumentBytes } from './facturaDocumento';
import {
  buildOpenRouterExtractionRequest,
  executeOpenRouterExtraction,
  OPENROUTER_CHAT_URL,
  PROVISIONAL_EXTRACTION_MODEL,
  type OpenRouterProtocolError,
} from '../../supabase/functions/procesar-factura-multimodal/openrouter';
import { EXTRACTION_JSON_SCHEMA } from '../../supabase/functions/procesar-factura-multimodal/schema';

describe('OpenRouter Protocol & Schema Slice', () => {
  const dummyApiKey = 'test-fake-key-12345';
  const validPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4

  const minimalValidPayload = {
    version: 1,
    cabecera: {
      proveedorNombre: 'FERRETERIA PROVEEDOR C.A.',
      proveedorRif: 'J-12345678-9',
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
        codigoProveedor: '00142-A',
        descripcion: 'MARTILLO 16OZ',
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
      confianzaGlobal: 0.95,
    },
  };

  describe('Schema invariants', () => {
    test('schema matches contract version 1 with strict mode properties', () => {
      expect(EXTRACTION_JSON_SCHEMA.type).toBe('object');
      expect(EXTRACTION_JSON_SCHEMA.additionalProperties).toBe(false);
      expect(EXTRACTION_JSON_SCHEMA.required).toEqual(
        expect.arrayContaining(['version', 'cabecera', 'lineas', 'metadatos'])
      );
      // Version must be constrained to 1
      expect(EXTRACTION_JSON_SCHEMA.properties.version).toBeDefined();
    });

    test('schema disallows forbidden authority keys in its properties', () => {
      const schemaStr = JSON.stringify(EXTRACTION_JSON_SCHEMA);
      expect(schemaStr).not.toContain('"compraId"');
      expect(schemaStr).not.toContain('"aprobado"');
      expect(schemaStr).not.toContain('"skuMatch"');
      expect(schemaStr).not.toContain('"inventario"');
      expect(schemaStr).not.toContain('"stockAjuste"');
    });

    test('schema parity: existing contract parser accepts a strictly schema-conforming fixture', () => {
      const fixture = {
        version: 1,
        cabecera: {
          proveedorNombre: 'DISTRIBUIDORA FERRETERA C.A.',
          proveedorRif: 'J-12345678-0',
          numeroDocumento: '0001234',
          numeroControl: '00-001234',
          fechaEmision: '2026-10-22',
          moneda: 'USD',
          tasaCambio: '1.000000',
          subtotal: '250.0000',
          descuentos: [
            {
              orden: 1,
              porcentaje: '5.0000',
              monto: '12.5000',
              alcance: 'global',
              incluidoEnPrecio: false,
            },
          ],
          impuestos: [
            {
              tasa: '16.0000',
              base: '237.5000',
              monto: '38.0000',
              exento: false,
            },
          ],
          total: '275.5000',
        },
        lineas: [
          {
            numeroLinea: 1,
            pagina: 1,
            codigoProveedor: 'SKU-0987',
            descripcion: 'DISCO DE CORTE 4-1/2',
            cantidad: '10.0000',
            unidad: 'UND',
            precioUnitario: '25.000000',
            descuentos: [],
            tasaIva: '16.0000',
            total: '250.0000',
            incertidumbre: {
              confianzaLectura: 0.99,
              advertencias: [],
              campoDudoso: [],
            },
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

      const parsed = parseFacturaExtraction(fixture);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.data.version).toBe(1);
        expect(parsed.data.cabecera.proveedorNombre).toBe('DISTRIBUIDORA FERRETERA C.A.');
        expect(parsed.data.lineas).toHaveLength(1);
        expect(parsed.data.metadatos.documentoCompleto).toBe(true);
      }
    });

    test('schema parity: enforces additionalProperties false and required nullables across all objects', () => {
      expect(EXTRACTION_JSON_SCHEMA.additionalProperties).toBe(false);
      expect((EXTRACTION_JSON_SCHEMA.properties.cabecera as any).additionalProperties).toBe(false);
      expect((EXTRACTION_JSON_SCHEMA.properties.lineas as any).items.additionalProperties).toBe(false);
      expect((EXTRACTION_JSON_SCHEMA.properties.metadatos as any).additionalProperties).toBe(false);

      const cabeceraProps = (EXTRACTION_JSON_SCHEMA.properties.cabecera as any).properties;
      expect(cabeceraProps.proveedorNombre.type).toEqual(['string', 'null']);
      expect(cabeceraProps.proveedorRif.type).toEqual(['string', 'null']);
      expect(cabeceraProps.tasaCambio.type).toEqual(['string', 'null']);

      const lineaProps = (EXTRACTION_JSON_SCHEMA.properties.lineas as any).items.properties;
      expect(lineaProps.codigoProveedor.type).toEqual(['string', 'null']);
      expect(lineaProps.cantidad.type).toEqual(['string', 'null']);
      expect(lineaProps.precioUnitario.type).toEqual(['string', 'null']);
    });
  });

  describe('buildOpenRouterExtractionRequest', () => {
    test('builds compliant request with exact model, headers, and privacy flags', () => {
      const built = buildOpenRouterExtractionRequest({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
      });

      expect(built.ok).toBe(true);
      if (!built.ok) return;

      expect(built.url).toBe(OPENROUTER_CHAT_URL);
      expect(built.headers['Authorization']).toBe(`Bearer ${dummyApiKey}`);
      expect(built.headers['Content-Type']).toBe('application/json');

      const body = built.body;
      expect(body.model).toBe(PROVISIONAL_EXTRACTION_MODEL);
      expect(body.model).toBe('google/gemini-3.1-flash-lite');
      expect(body.max_tokens).toBe(4096);
      expect(body.temperature).toBe(0.0);

      expect(body.provider).toEqual({
        require_parameters: true,
        data_collection: 'deny',
        allow_fallbacks: false,
      });

      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.strict).toBe(true);
      expect(body.response_format.json_schema.schema).toBe(EXTRACTION_JSON_SCHEMA);

      expect(body.messages).toHaveLength(1);
      const parts = body.messages[0].content;
      expect(parts[0].type).toBe('text');
      expect(parts[1].type).toBe('file');
      if (parts[1].type === 'file') {
        expect(parts[1].file.file_data).toMatch(/^data:application\/pdf;base64,/);
      }
    });

    test('builds image_url content part for PNG, JPEG, and WebP images', () => {
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);
      const built = buildOpenRouterExtractionRequest({
        apiKey: dummyApiKey,
        documentBytes: pngBytes,
        validateDocument: validateDocumentBytes,
      });

      expect(built.ok).toBe(true);
      if (!built.ok) return;

      const parts = built.body.messages[0].content as any;
      expect(parts[1].type).toBe('image_url');
      expect(parts[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    });

    test('rejects document bytes exceeding 10MB or invalid magic bytes', () => {
      const invalidBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const res = buildOpenRouterExtractionRequest({
        apiKey: dummyApiKey,
        documentBytes: invalidBytes,
        validateDocument: validateDocumentBytes,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('invalid_document');
      }
    });

    test('rejects empty API key', () => {
      const res = buildOpenRouterExtractionRequest({
        apiKey: '   ',
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('invalid_api_key');
      }
    });
  });

  describe('executeOpenRouterExtraction transport', () => {
    test('fails closed before fetch when parseContract dependency is missing or not a function', async () => {
      const fakeFetch: typeof fetch = jest.fn();

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: undefined as any,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('dependency_error');
        expect(outcome.error.message).toBe('Required validator or parser dependency is missing');
      }
      expect(fakeFetch).not.toHaveBeenCalled();
    });

    test('fails closed before fetch when validateDocument dependency is missing or not a function', async () => {
      const fakeFetch: typeof fetch = jest.fn();

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: undefined as any,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('dependency_error');
        expect(outcome.error.message).toBe('Required validator or parser dependency is missing');
      }
      expect(fakeFetch).not.toHaveBeenCalled();
    });

    test('never reflects sensitive thrown error message or secret sentinel', async () => {
      const secretSentinel = 'FAKE_SECRET_SENTINEL_TOKEN_KEY_98765';
      const fakeFetch: typeof fetch = jest.fn().mockImplementation(() => {
        throw new Error(secretSentinel);
      });

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('upstream_error');
        expect(outcome.error.message).not.toContain(secretSentinel);
        expect(outcome.error.message).toBe('Transport or connection error');
      }
    });

    test('rejects model mismatch from upstream response', async () => {
      const fakeFetch: typeof fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  model: 'unauthorized/arbitrary-model',
                  choices: [
                    {
                      finish_reason: 'stop',
                      message: { content: JSON.stringify(minimalValidPayload) },
                    },
                  ],
                })
              )
            );
            controller.close();
          },
        }),
      } as unknown as Response);

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('upstream_error');
      }
    });

    test('bounds response size using streaming reader and cancels stream when limit is exceeded', async () => {
      let cancelled = false;
      const oversizedChunk = new Uint8Array(512 * 1024); // 512KB
      const fakeStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(oversizedChunk);
        },
        cancel() {
          cancelled = true;
        },
      });

      const fakeFetch: typeof fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: fakeStream,
      } as unknown as Response);

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('malformed_response');
      }
      expect(cancelled).toBe(true);
    });

    test('fails immediately when content-length preflight exceeds size limit', async () => {
      const fakeFetch: typeof fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'content-length': '2097152', // 2MB > 1MB
        }),
        body: new ReadableStream(),
      } as unknown as Response);

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('malformed_response');
        expect(outcome.error.message).toBe('Response exceeded maximum size limit');
      }
    });

    test('succeeds on 200 with finish_reason stop and valid contract payload', async () => {
      const responsePayload = {
        id: 'gen-123',
        model: PROVISIONAL_EXTRACTION_MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify(minimalValidPayload),
            },
          },
        ],
        usage: {
          prompt_tokens: 1500,
          completion_tokens: 450,
          total_tokens: 1950,
          cost: 0.0012,
        },
      };

      const fakeFetch: typeof fetch = jest.fn().mockResolvedValue(
        new Response(new TextEncoder().encode(JSON.stringify(responsePayload)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.data.version).toBe(1);
      expect(outcome.data.cabecera.proveedorNombre).toBe('FERRETERIA PROVEEDOR C.A.');
      expect(outcome.data.lineas[0].codigoProveedor).toBe('00142-A');
      expect(outcome.metadata.costUsd).toBe(0.0012);
      expect(outcome.metadata.tokens.total).toBe(1950);
      expect(outcome.metadata.finishReason).toBe('stop');
      expect(outcome.metadata.provider).toBeNull();
    });

    test('records cost as null when upstream does not provide cost or provides negative/non-finite cost', async () => {
      const responsePayload = {
        model: PROVISIONAL_EXTRACTION_MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(minimalValidPayload) },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: -0.5 },
      };

      const fakeFetch: typeof fetch = jest.fn().mockResolvedValue(
        new Response(new TextEncoder().encode(JSON.stringify(responsePayload)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.metadata.costUsd).toBeNull();
    });

    test('records tokens as null for missing, non-numeric, fractional, negative, or unsafe counts, but preserves actual 0', async () => {
      // 1. Missing usage object -> all null
      const noUsagePayload = {
        model: PROVISIONAL_EXTRACTION_MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(minimalValidPayload) },
          },
        ],
      };

      const fakeFetchNoUsage: typeof fetch = jest.fn().mockResolvedValue(
        new Response(new TextEncoder().encode(JSON.stringify(noUsagePayload)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const resNoUsage = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetchNoUsage,
      });

      expect(resNoUsage.ok).toBe(true);
      if (resNoUsage.ok) {
        expect(resNoUsage.metadata.tokens.prompt).toBeNull();
        expect(resNoUsage.metadata.tokens.completion).toBeNull();
        expect(resNoUsage.metadata.tokens.total).toBeNull();
      }

      // 2. Fractional, negative, non-number, unsafe counts -> null
      const invalidUsagePayload = {
        model: PROVISIONAL_EXTRACTION_MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(minimalValidPayload) },
          },
        ],
        usage: {
          prompt_tokens: 12.5,
          completion_tokens: -10,
          total_tokens: 'unsafe-string',
        },
      };

      const fakeFetchInvalid: typeof fetch = jest.fn().mockResolvedValue(
        new Response(new TextEncoder().encode(JSON.stringify(invalidUsagePayload)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const resInvalid = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetchInvalid,
      });

      expect(resInvalid.ok).toBe(true);
      if (resInvalid.ok) {
        expect(resInvalid.metadata.tokens.prompt).toBeNull();
        expect(resInvalid.metadata.tokens.completion).toBeNull();
        expect(resInvalid.metadata.tokens.total).toBeNull();
      }

      // 3. Actual 0 tokens -> stays 0
      const zeroUsagePayload = {
        model: PROVISIONAL_EXTRACTION_MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(minimalValidPayload) },
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };

      const fakeFetchZero: typeof fetch = jest.fn().mockResolvedValue(
        new Response(new TextEncoder().encode(JSON.stringify(zeroUsagePayload)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const resZero = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetchZero,
      });

      expect(resZero.ok).toBe(true);
      if (resZero.ok) {
        expect(resZero.metadata.tokens.prompt).toBe(0);
        expect(resZero.metadata.tokens.completion).toBe(0);
        expect(resZero.metadata.tokens.total).toBe(0);
      }
    });

    test('fails safely when finish_reason is length (token truncation)', async () => {
      const responsePayload = {
        model: PROVISIONAL_EXTRACTION_MODEL,
        choices: [
          {
            finish_reason: 'length',
            message: { content: '{"version": 1, "cabecera": {' },
          },
        ],
      };

      const fakeFetch: typeof fetch = jest.fn().mockResolvedValue(
        new Response(new TextEncoder().encode(JSON.stringify(responsePayload)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('output_truncated');
      }
    });

    test('fails safely when model content violates contract schema (forbidden authority)', async () => {
      const forbiddenPayload = {
        ...minimalValidPayload,
        cabecera: {
          ...minimalValidPayload.cabecera,
          compraId: '12345',
        },
      };

      const responsePayload = {
        model: PROVISIONAL_EXTRACTION_MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(forbiddenPayload) },
          },
        ],
      };

      const fakeFetch: typeof fetch = jest.fn().mockResolvedValue(
        new Response(new TextEncoder().encode(JSON.stringify(responsePayload)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('contract_violation');
        expect(outcome.error.message).toBe('Contract schema violation');
      }
    });

    test('fails safely on malformed JSON content without silent markdown repair', async () => {
      const responsePayload = {
        model: PROVISIONAL_EXTRACTION_MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: { content: 'This is not json at all' },
          },
        ],
      };

      const fakeFetch: typeof fetch = jest.fn().mockResolvedValue(
        new Response(new TextEncoder().encode(JSON.stringify(responsePayload)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('malformed_response');
      }
    });

    test('maps HTTP 401, 402, 429 without leaking sensitive strings', async () => {
      const statuses: Array<[number, OpenRouterProtocolError['code']]> = [
        [401, 'unauthorized'],
        [402, 'insufficient_credits'],
        [429, 'rate_limited'],
        [500, 'upstream_error'],
      ];

      for (const [status, expectedCode] of statuses) {
        const fakeFetch: typeof fetch = jest.fn().mockResolvedValue({
          ok: false,
          status,
          statusText: 'Error',
          text: async () => `Sensitive raw upstream dump with key ${dummyApiKey}`,
        } as unknown as Response);

        const outcome = await executeOpenRouterExtraction({
          apiKey: dummyApiKey,
          documentBytes: validPdfBytes,
          validateDocument: validateDocumentBytes,
          parseContract: parseFacturaExtraction,
          fetchFn: fakeFetch,
        });

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.error.code).toBe(expectedCode);
          expect(outcome.error.message).not.toContain(dummyApiKey);
        }
      }
    });

    test('supports AbortSignal and propagates abort to fetch', async () => {
      const controller = new AbortController();
      controller.abort();

      const fakeFetch: typeof fetch = jest.fn().mockImplementation((_url, init) => {
        if (init?.signal?.aborted) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          return Promise.reject(err);
        }
        return Promise.resolve({ ok: true } as Response);
      });

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
        signal: controller.signal,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('aborted');
      }
    });

    test('handles event-triggered AbortSignal during streaming body read with zero secret leaks and exactly one fetch', async () => {
      const controller = new AbortController();
      let streamCancelled = false;

      const slowStream = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode('{"model":"google/gemini-3.1-flash-lite",'));
        },
        pull(streamController) {
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              try {
                streamController.enqueue(new TextEncoder().encode('"choices":[]'));
              } catch {
                // stream cancelled
              }
              resolve();
            }, 100);
          });
        },
        cancel() {
          streamCancelled = true;
        },
      });

      const fakeFetch: typeof fetch = jest.fn().mockResolvedValue(
        new Response(slowStream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      setTimeout(() => controller.abort(), 10);

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
        signal: controller.signal,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('aborted');
        expect(outcome.error.message).toBe('Request was aborted');
        expect(outcome.error.message).not.toContain(dummyApiKey);
      }
      expect(fakeFetch).toHaveBeenCalledTimes(1);
      expect(streamCancelled).toBe(true);
    });

    test('times out with static error when upstream connection hangs', async () => {
      const fakeFetch: typeof fetch = jest.fn().mockImplementation((_url, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const outcome = await executeOpenRouterExtraction({
        apiKey: dummyApiKey,
        documentBytes: validPdfBytes,
        validateDocument: validateDocumentBytes,
        parseContract: parseFacturaExtraction,
        fetchFn: fakeFetch,
        timeoutMs: 25,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe('timeout');
        expect(outcome.error.message).toBe('Request timed out');
      }
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    });
  });
});
