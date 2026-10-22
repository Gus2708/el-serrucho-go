import {
  BaseClient,
  getCurrentScope,
  getGlobalScope,
  getIsolationScope,
  withScope,
  captureEvent,
  addBreadcrumb,
  type ClientOptions,
  type Envelope,
} from '@sentry/core';
import { FacturaError } from './facturaProveedorRepository';
import { createFacturaReporter, createSentrySink, type FacturaFailure } from './facturaTelemetry';

const SECRET = 'SECRET-supplier-Proveedor-S.A.-1234.56-/storage/own/doc.pdf?token=abc';

function reporter(now = () => 0) {
  const sent: FacturaFailure[] = [];
  const { reportFacturaFailure, reportFacturaThrown } = createFacturaReporter({ capture: failure => sent.push(failure), now });
  return { sent, reportFacturaFailure, reportFacturaThrown };
}

describe('reportFacturaThrown: what counts as unexpected', () => {
  it.each(['no_autorizado', 'version_obsoleta', 'clave_reutilizada', 'datos_invalidos', 'no_encontrada', 'red'] as const)(
    'ignores the expected outcome %s',
    code => {
      const { sent, reportFacturaThrown } = reporter();
      reportFacturaThrown('save', new FacturaError(code));
      expect(sent).toEqual([]);
    },
  );

  it('reports an unmapped server answer with its SQLSTATE and HTTP status only', () => {
    const { sent, reportFacturaThrown } = reporter();
    reportFacturaThrown('save', new FacturaError('desconocido', { sqlState: 'XX000', httpStatus: 500 }));
    expect(sent).toEqual([{ operation: 'save', code: 'desconocido', sqlState: 'XX000', httpStatus: 500 }]);
  });

  it('reports any other thrown value as unexpected without keeping its message or fields', () => {
    const { sent, reportFacturaThrown } = reporter();
    reportFacturaThrown('hash_document', Object.assign(new Error(SECRET), { code: SECRET, status: SECRET }));
    reportFacturaThrown('pick_document', SECRET);
    reportFacturaThrown('open', undefined);
    expect(sent.map(failure => failure.code)).toEqual(['unexpected', 'unexpected', 'unexpected']);
    expect(JSON.stringify(sent)).not.toContain('SECRET');
  });

  it('drops SQLSTATE and status values that do not have the expected shape', () => {
    const { sent, reportFacturaThrown } = reporter();
    reportFacturaThrown('save', new FacturaError('desconocido', { sqlState: SECRET, httpStatus: 99999 }));
    expect(sent).toEqual([{ operation: 'save', code: 'desconocido' }]);
  });
});

describe('reportFacturaFailure', () => {
  it('reports a classified local failure', () => {
    const { sent, reportFacturaFailure } = reporter();
    reportFacturaFailure({ operation: 'local_write', code: 'quota' });
    expect(sent).toEqual([{ operation: 'local_write', code: 'quota' }]);
  });

  it('reports the same error object once, however many boundaries it crosses', () => {
    const { sent, reportFacturaThrown } = reporter();
    const error = new FacturaError('desconocido', { httpStatus: 503 });
    reportFacturaThrown('upload', error);
    reportFacturaThrown('upload', error);
    reportFacturaThrown('save', error);
    expect(sent).toHaveLength(1);
  });

  it('reports a repeating failure once per minute', () => {
    let clock = 0;
    const { sent, reportFacturaFailure } = reporter(() => clock);
    const failure: FacturaFailure = { operation: 'local_write', code: 'unavailable' };
    reportFacturaFailure(failure);
    clock = 59_999;
    reportFacturaFailure(failure);
    reportFacturaFailure({ operation: 'local_read', code: 'unavailable' });
    clock = 60_000;
    reportFacturaFailure(failure);
    expect(sent.map(item => item.operation)).toEqual(['local_write', 'local_read', 'local_write']);
  });

  it('never lets a failing sink change the caller', () => {
    const { reportFacturaFailure, reportFacturaThrown } = createFacturaReporter({
      capture: () => {
        throw new Error('sink down');
      },
    });
    expect(() => reportFacturaFailure({ operation: 'open', code: 'desconocido' })).not.toThrow();
    expect(() => reportFacturaThrown('open', new Error('x'))).not.toThrow();
  });
});

describe('Sentry sink: the final event', () => {
  class TestClient extends BaseClient<ClientOptions> {
    constructor(options: ClientOptions) {
      super(options);
    }
    eventFromException(): PromiseLike<never> {
      return Promise.reject(new Error('unused'));
    }
    eventFromMessage(): PromiseLike<never> {
      return Promise.reject(new Error('unused'));
    }
  }

  const envelopes: Envelope[] = [];
  let client: TestClient;

  beforeEach(() => {
    envelopes.length = 0;
    client = new TestClient({
      dsn: 'https://public@example.invalid/1',
      release: 'rel@1',
      environment: 'test',
      sendDefaultPii: true,
      integrations: [],
      stackParser: () => [],
      transport: () => ({
        send: async (envelope: Envelope) => {
          envelopes.push(envelope);
          return {};
        },
        flush: async () => true,
      }),
    });
    getCurrentScope().setClient(client);
    client.init();
  });

  afterEach(() => {
    getGlobalScope().clear();
    getIsolationScope().clear();
    getCurrentScope().clear();
    getCurrentScope().setClient(undefined);
  });

  function polluteEverything(): void {
    getGlobalScope().setTag('global', SECRET);
    getGlobalScope().addAttachment({ filename: 'secret.txt', data: SECRET });
    getIsolationScope().setUser({ id: SECRET, email: `${SECRET}@example.com`, ip_address: '203.0.113.9' });
    getIsolationScope().setContext('device', { name: SECRET });
    getIsolationScope().setExtra('invoice', SECRET);
    getCurrentScope().setTag('screen', SECRET);
    addBreadcrumb({ category: 'fetch', message: SECRET, data: { url: `https://x.supabase.co/rest/v1/${SECRET}` } });
    client.addEventProcessor(event => ({
      ...event,
      user: { id: SECRET },
      request: { url: `https://signed.example/${SECRET}` },
      contexts: { device: { name: SECRET }, replay: { replay_id: SECRET } },
      extra: { total: SECRET },
      modules: { [SECRET]: '1' },
      breadcrumbs: [{ message: SECRET }],
      exception: { values: [{ type: 'Error', value: SECRET }] },
      transaction: SECRET,
    }));
    client.on('createDsc', dsc => {
      dsc.replay_id = SECRET;
      dsc.transaction = SECRET;
    });
  }

  async function send(failure: FacturaFailure): Promise<Envelope> {
    const sink = createSentrySink(() => ({ withScope, captureEvent }));
    sink(failure);
    await client.flush(1000);
    expect(envelopes).toHaveLength(1);
    return envelopes[0];
  }

  it('contains only the static allowlisted metadata, whatever the scopes and integrations add', async () => {
    polluteEverything();

    const [header, items] = await send({ operation: 'save', code: 'desconocido', sqlState: 'XX000', httpStatus: 500 });

    expect(items).toHaveLength(1);
    const event = items[0][1] as Record<string, unknown>;
    expect(event).toEqual({
      event_id: expect.any(String),
      timestamp: expect.any(Number),
      release: 'rel@1',
      environment: 'test',
      level: 'error',
      message: 'factura.save.desconocido',
      tags: { feature: 'factura_proveedor', operation: 'save', code: 'desconocido', sql_state: 'XX000', http_status: '500' },
      fingerprint: ['factura_proveedor', 'save', 'desconocido', 'XX000', '500'],
      contexts: {},
    });
    expect(header).not.toHaveProperty('trace');
    expect(JSON.stringify([header, items])).not.toMatch(/SECRET|203\.0\.113\.9|supabase|signed\.example/);
  });

  it('marks a failed orphan cleanup as a warning', async () => {
    const [, items] = await send({ operation: 'cleanup', code: 'desconocido' });
    const event = items[0][1] as { level: string; fingerprint: string[] };
    expect(event.level).toBe('warning');
    expect(event.fingerprint).toEqual(['factura_proveedor', 'cleanup', 'desconocido']);
  });

  it('leaves the ambient scope untouched', async () => {
    getIsolationScope().setTag('keep', 'me');
    await send({ operation: 'list', code: 'desconocido' });
    expect(getIsolationScope().getScopeData().tags).toEqual({ keep: 'me' });
  });

  it('never lets a missing SDK reach the caller', () => {
    const { reportFacturaFailure } = createFacturaReporter({
      capture: createSentrySink(() => {
        throw new SyntaxError('SDK unavailable');
      }),
    });
    expect(() => reportFacturaFailure({ operation: 'list', code: 'desconocido' })).not.toThrow();
  });
});
