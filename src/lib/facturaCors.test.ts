import { handleFacturaExtractionRequest } from '../../supabase/functions/procesar-factura-multimodal/handler';
import { handleFacturaRecalculationRequest } from '../../supabase/functions/recalcular-revision-factura/handler';
import { handleFacturaMaterializationRequest } from '../../supabase/functions/materializar-compra-factura/handler';

type Handler = (request: Request) => Promise<Response>;

const handlers: ReadonlyArray<readonly [string, Handler]> = [
  ['extraction', handleFacturaExtractionRequest],
  ['recalculation', handleFacturaRecalculationRequest],
  ['materialization', handleFacturaMaterializationRequest],
];

function expectSdkCors(response: Response): void {
  const headers = response.headers;
  const allowedHeaders = (headers.get('access-control-allow-headers') ?? '')
    .split(',')
    .map(header => header.trim().toLowerCase());

  expect(allowedHeaders).toEqual(expect.arrayContaining([
    'authorization', 'apikey', 'content-type', 'x-client-info',
  ]));
  expect(allowedHeaders).toHaveLength(4);
  expect(allowedHeaders).not.toContain('x-untrusted-header');
  expect(headers.get('access-control-allow-origin')).toBe('*');
  expect(headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
  expect(headers.get('access-control-allow-credentials')).toBeNull();
}

describe.each(handlers)('%s SDK CORS', (_name, handleRequest) => {
  it('permits the SDK preflight without reflecting arbitrary request headers', async () => {
    const response = await handleRequest(new Request('https://example.test/invoice', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.test',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info,x-untrusted-header',
      },
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expectSdkCors(response);
  });

  it('retains method rejection and exposes its error to the browser', async () => {
    const response = await handleRequest(new Request('https://example.test/invoice'));

    expect(response.status).toBe(405);
    expectSdkCors(response);
    expect(await response.json()).toHaveProperty('error');
  });

  it('retains malformed-request rejection and exposes JSON errors to the browser', async () => {
    const response = await handleRequest(new Request('https://example.test/invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Info': 'supabase-js-web/test' },
      body: '{',
    }));

    expect(response.status).toBe(400);
    expectSdkCors(response);
    expect(await response.json()).toHaveProperty('error');
  });
});
