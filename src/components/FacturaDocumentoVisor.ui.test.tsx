import * as React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import FacturaDocumentoVisor, { type DocumentoVisor } from './FacturaDocumentoVisor';
import { ThemeProvider } from '../theme/ThemeContext';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const IMAGEN_A: DocumentoVisor = { path: 'owner/f1/a.jpg', mime: 'image/jpeg', sha256: SHA_A, nombre: 'factura-a.jpg' };
const IMAGEN_B: DocumentoVisor = { path: 'owner/f1/b.jpg', mime: 'image/jpeg', sha256: SHA_B, nombre: 'factura-b.jpg' };
const PDF: DocumentoVisor = { path: 'owner/f1/a.pdf', mime: 'application/pdf', sha256: SHA_A, nombre: 'factura.pdf' };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface Options {
  visible?: boolean;
  documento?: DocumentoVisor | null;
  obtenerUrl?: (path: string) => Promise<string>;
  estaVigente?: () => boolean;
  onClose?: () => void;
}

function ui(options: Options = {}): React.ReactElement {
  return (
    <ThemeProvider>
      <FacturaDocumentoVisor
        visible={options.visible ?? true}
        documento={options.documento === undefined ? IMAGEN_A : options.documento}
        obtenerUrl={options.obtenerUrl ?? (async path => `https://private.test/${path}`)}
        estaVigente={options.estaVigente ?? (() => true)}
        onClose={options.onClose ?? (() => undefined)}
      />
    </ThemeProvider>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
}

async function press(label: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(label));
  });
}

function imagen(): ReturnType<typeof screen.getByTestId> {
  return screen.getByTestId('factura-visor-imagen');
}

function anchoImagen(): number {
  return StyleSheet.flatten(imagen().props.style).width as number;
}

function cargarImagen(width = 1000, height = 2000): void {
  fireEvent(imagen(), 'load', { source: { url: 'x', width, height, mediaType: 'image/jpeg' } });
}

let openURL: jest.SpyInstance;

beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  openURL.mockRestore();
});

describe('FacturaDocumentoVisor: imagen', () => {
  it('opens full screen, signs a URL for the document and shows its name with an accessible close', async () => {
    const obtenerUrl = jest.fn(async (path: string) => `https://private.test/${path}`);
    const onClose = jest.fn();
    render(ui({ obtenerUrl, onClose }));
    await flush();

    expect(obtenerUrl).toHaveBeenCalledTimes(1);
    expect(obtenerUrl).toHaveBeenCalledWith(IMAGEN_A.path);
    expect(screen.getByText('factura-a.jpg')).toBeTruthy();
    expect(imagen().props.source).toMatchObject({ uri: `https://private.test/${IMAGEN_A.path}` });

    await press('Cerrar visor');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a larger image when the zoom grows and fits again on demand', async () => {
    render(ui());
    await flush();
    cargarImagen();
    const ajustado = anchoImagen();

    await press('Acercar');
    const acercado = anchoImagen();
    expect(acercado).toBeGreaterThan(ajustado);
    expect(acercado / ajustado).toBeCloseTo(1.5, 5);

    await press('Alejar');
    expect(anchoImagen()).toBeCloseTo(ajustado, 5);

    await press('Acercar');
    await press('Ajustar a la pantalla');
    expect(anchoImagen()).toBeCloseTo(ajustado, 5);
  });

  it('keeps the zoom between 1x and 4x and disables the control at each limit', async () => {
    render(ui());
    await flush();
    cargarImagen();
    expect(screen.getByLabelText('Alejar').props.accessibilityState).toMatchObject({ disabled: true });

    for (let i = 0; i < 10; i += 1) await press('Acercar');
    expect(screen.getByLabelText('Acercar').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('400 %')).toBeTruthy();
    expect(screen.getByLabelText('Alejar').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('scrolls both ways so a zoomed image can be panned', async () => {
    render(ui());
    await flush();
    cargarImagen();
    expect(screen.UNSAFE_queryAllByProps({ testID: 'factura-visor-pan-vertical' }).length).toBeGreaterThan(0);
    expect(screen.UNSAFE_queryAllByProps({ testID: 'factura-visor-pan-horizontal' }).length).toBeGreaterThan(0);
  });

  it('shows a retry when the image fails to load and signs a new URL on retry', async () => {
    const obtenerUrl = jest.fn(async (path: string) => `https://private.test/${path}`);
    render(ui({ obtenerUrl }));
    await flush();
    await act(async () => {
      fireEvent(imagen(), 'error', { error: 'boom' });
    });

    expect(screen.getByText('No se pudo abrir la factura.')).toBeTruthy();
    expect(screen.queryByTestId('factura-visor-imagen')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText('Reintentar'));
    });
    await flush();

    expect(obtenerUrl).toHaveBeenCalledTimes(2);
    expect(imagen()).toBeTruthy();
  });

  it('shows the same error and retry when signing fails', async () => {
    const obtenerUrl = jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('https://private.test/ok');
    render(ui({ obtenerUrl }));
    await flush();
    expect(screen.getByText('No se pudo abrir la factura.')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('Reintentar'));
    });
    await flush();
    expect(obtenerUrl).toHaveBeenCalledTimes(2);
    expect(imagen().props.source).toMatchObject({ uri: 'https://private.test/ok' });
  });

  it('signs a fresh URL every time it is opened and never reuses the previous one', async () => {
    let n = 0;
    const obtenerUrl = jest.fn(async () => `https://private.test/firma-${(n += 1)}`);
    const view = render(ui({ obtenerUrl }));
    await flush();
    expect(imagen().props.source).toMatchObject({ uri: 'https://private.test/firma-1' });

    view.rerender(ui({ obtenerUrl, visible: false }));
    expect(screen.queryByTestId('factura-visor-imagen')).toBeNull();
    view.rerender(ui({ obtenerUrl, visible: true }));
    await flush();

    expect(obtenerUrl).toHaveBeenCalledTimes(2);
    expect(imagen().props.source).toMatchObject({ uri: 'https://private.test/firma-2' });
  });

  it('resets the zoom when it is opened again', async () => {
    const view = render(ui());
    await flush();
    cargarImagen();
    await press('Acercar');
    expect(screen.getByText('150 %')).toBeTruthy();

    view.rerender(ui({ visible: false }));
    view.rerender(ui({ visible: true }));
    await flush();
    expect(screen.getByText('100 %')).toBeTruthy();
  });
});

describe('FacturaDocumentoVisor: URL fences', () => {
  it('discards a URL signed for a document that was replaced while signing', async () => {
    const first = deferred<string>();
    const obtenerUrl = jest.fn((path: string) => (path === IMAGEN_A.path ? first.promise : Promise.resolve('https://private.test/segundo')));
    const view = render(ui({ obtenerUrl, documento: IMAGEN_A }));
    view.rerender(ui({ obtenerUrl, documento: IMAGEN_B }));
    await flush();
    await act(async () => {
      first.resolve('https://private.test/viejo');
    });
    await flush();

    expect(imagen().props.source).toMatchObject({ uri: 'https://private.test/segundo' });
    expect(screen.getByText('factura-b.jpg')).toBeTruthy();
  });

  it('discards the URL when the same path now has different content', async () => {
    const first = deferred<string>();
    let llamadas = 0;
    const obtenerUrl = jest.fn((_path: string): Promise<string> => {
      llamadas += 1;
      return llamadas === 1 ? first.promise : Promise.resolve('https://private.test/nuevo');
    });
    const view = render(ui({ obtenerUrl, documento: IMAGEN_A }));
    view.rerender(ui({ obtenerUrl, documento: { ...IMAGEN_A, sha256: SHA_B } }));
    await flush();
    await act(async () => {
      first.resolve('https://private.test/viejo');
    });
    await flush();

    expect(imagen().props.source).toMatchObject({ uri: 'https://private.test/nuevo' });
  });

  it('discards the URL when the owner session stops being current', async () => {
    const reply = deferred<string>();
    let vigente = true;
    render(ui({ obtenerUrl: () => reply.promise, estaVigente: () => vigente }));
    vigente = false;
    await act(async () => {
      reply.resolve('https://private.test/doc');
    });
    await flush();

    expect(screen.queryByTestId('factura-visor-imagen')).toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('discards the URL when the viewer was closed before it arrived', async () => {
    const reply = deferred<string>();
    const view = render(ui({ obtenerUrl: () => reply.promise }));
    view.rerender(ui({ obtenerUrl: () => reply.promise, visible: false }));
    await act(async () => {
      reply.resolve('https://private.test/doc');
    });
    await flush();
    expect(screen.queryByTestId('factura-visor-imagen')).toBeNull();

    // Reopening signs again instead of showing the discarded answer.
    const next = jest.fn(async () => 'https://private.test/otra');
    view.rerender(ui({ obtenerUrl: next, visible: true }));
    await flush();
    expect(next).toHaveBeenCalledTimes(1);
    expect(imagen().props.source).toMatchObject({ uri: 'https://private.test/otra' });
  });

  it('discards a PDF URL that arrives after the viewer unmounted', async () => {
    const reply = deferred<string>();
    const view = render(ui({ documento: PDF, obtenerUrl: () => reply.promise }));
    view.unmount();
    await act(async () => {
      reply.resolve('https://private.test/doc.pdf');
    });
    expect(openURL).not.toHaveBeenCalled();
  });

  it('does not sign anything while hidden or without a document', async () => {
    const obtenerUrl = jest.fn(async () => 'https://private.test/x');
    const view = render(ui({ obtenerUrl, visible: false }));
    view.rerender(ui({ obtenerUrl, documento: null }));
    await flush();
    expect(obtenerUrl).not.toHaveBeenCalled();
  });
});

describe('FacturaDocumentoVisor: PDF y URL no seguras', () => {
  it('opens a PDF through the system opener only for a safe HTTP(S) URL and says where it opens', async () => {
    render(ui({ documento: PDF, obtenerUrl: async () => 'https://private.test/doc.pdf' }));
    await flush();

    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('https://private.test/doc.pdf');
    expect(screen.getByText('El PDF se abre en otra pestaña o app.')).toBeTruthy();
    expect(screen.queryByTestId('factura-visor-imagen')).toBeNull();
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'not a url', ''])(
    'refuses the unsafe PDF URL %p',
    async unsafe => {
      render(ui({ documento: PDF, obtenerUrl: async () => unsafe }));
      await flush();

      expect(openURL).not.toHaveBeenCalled();
      expect(screen.getByText('No se pudo abrir la factura.')).toBeTruthy();
    },
  );

  it('refuses an unsafe image URL instead of rendering it', async () => {
    render(ui({ obtenerUrl: async () => 'javascript:alert(1)' }));
    await flush();

    expect(screen.queryByTestId('factura-visor-imagen')).toBeNull();
    expect(screen.getByText('No se pudo abrir la factura.')).toBeTruthy();
  });

  it('shows the error when the system refuses to open the PDF, and retry signs again', async () => {
    openURL.mockRejectedValueOnce(new Error('blocked'));
    const obtenerUrl = jest.fn(async () => 'https://private.test/doc.pdf');
    render(ui({ documento: PDF, obtenerUrl }));
    await flush();
    expect(screen.getByText('No se pudo abrir la factura.')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('Reintentar'));
    });
    await flush();
    expect(obtenerUrl).toHaveBeenCalledTimes(2);
    expect(openURL).toHaveBeenCalledTimes(2);
  });

  it('never prints the signed URL to the console', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(level => jest.spyOn(console, level).mockImplementation(() => undefined));
    render(ui({ documento: PDF, obtenerUrl: async () => 'https://private.test/doc.pdf?token=SECRET' }));
    await flush();
    const printed = spies.flatMap(spy => spy.mock.calls.flat()).join(' ');
    spies.forEach(spy => spy.mockRestore());
    expect(printed).not.toContain('SECRET');
  });
});
