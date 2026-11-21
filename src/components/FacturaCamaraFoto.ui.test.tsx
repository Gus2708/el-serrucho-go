import * as React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import FacturaCamaraFoto from './FacturaCamaraFoto';
import { ThemeProvider } from '../theme/ThemeContext';
import { MAX_DOCUMENT_BYTES } from '../lib/facturaDocumento';

let mockPermission: { granted: boolean; status?: string; canAskAgain?: boolean } | null;
const mockRequestPermission = jest.fn();
const mockTakePicture = jest.fn();
let cameraMounts = 0;

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: React.forwardRef((props: object, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePicture }));
      React.useEffect(() => {
        cameraMounts += 1;
        return () => { cameraMounts -= 1; };
      }, []);
      return <View testID="mock-camera-view" {...props} />;
    }),
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  };
});

const readAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;
const JPEG_BASE64 = '/9j/4AAQ'; // bytes ff d8 ff e0 00 10

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface Handlers {
  onClose: jest.Mock;
  onCapturada: jest.Mock;
  onNoDisponible: jest.Mock;
  estaVigente: jest.Mock;
}

function tree(visible: boolean, handlers: Handlers, withFallback = true): React.JSX.Element {
  return (
    <ThemeProvider>
      <FacturaCamaraFoto
        visible={visible}
        estaVigente={handlers.estaVigente}
        onClose={handlers.onClose}
        onCapturada={handlers.onCapturada}
        onNoDisponible={withFallback ? handlers.onNoDisponible : undefined}
      />
    </ThemeProvider>
  );
}

function setup(visible = true, withFallback = true) {
  const handlers: Handlers = {
    onClose: jest.fn(),
    onCapturada: jest.fn(),
    onNoDisponible: jest.fn(),
    estaVigente: jest.fn(() => true),
  };
  const view = render(tree(visible, handlers, withFallback));
  return { ...view, handlers, rerenderWith: (next: boolean) => view.rerender(tree(next, handlers, withFallback)) };
}

async function pressCapture(): Promise<void> {
  await act(async () => { fireEvent.press(screen.getByLabelText('Tomar foto')); });
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  mockPermission = { granted: true, status: 'granted', canAskAgain: true };
  mockRequestPermission.mockReset();
  mockTakePicture.mockReset();
  mockTakePicture.mockResolvedValue({ uri: 'file:///cache/photo.jpg', width: 10, height: 10, format: 'jpg' });
  readAsStringAsync.mockClear();
  readAsStringAsync.mockResolvedValue(JPEG_BASE64);
  (DocumentPicker.getDocumentAsync as jest.Mock).mockClear();
  cameraMounts = 0;
});

describe('FacturaCamaraFoto - captura nativa', () => {
  it('no activa la cámara ni captura nada mientras está oculta', () => {
    setup(false);

    expect(screen.queryByTestId('mock-camera-view')).toBeNull();
    expect(mockTakePicture).not.toHaveBeenCalled();
  });

  it('abre la cámara sin capturar automáticamente', () => {
    setup();

    expect(screen.getByTestId('mock-camera-view')).toBeTruthy();
    expect(mockTakePicture).not.toHaveBeenCalled();
  });

  it('captura solo al pulsar y entrega los bytes de la foto con nombre jpg', async () => {
    const { handlers } = setup();

    await pressCapture();

    expect(mockTakePicture).toHaveBeenCalledTimes(1);
    expect(readAsStringAsync).toHaveBeenCalledWith('file:///cache/photo.jpg', { encoding: 'base64' });
    expect(handlers.onCapturada).toHaveBeenCalledTimes(1);
    expect(handlers.onCapturada).toHaveBeenCalledWith({
      ok: true,
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      nombre: 'foto-factura.jpg',
    });
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('cancelar cierra sin entregar ninguna foto', () => {
    const { handlers } = setup();

    fireEvent.press(screen.getByLabelText('Cerrar cámara'));

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onCapturada).not.toHaveBeenCalled();
    expect(mockTakePicture).not.toHaveBeenCalled();
  });

  it('ignora una segunda pulsación mientras la primera captura sigue en curso', async () => {
    const pending = deferred<{ uri: string }>();
    mockTakePicture.mockReturnValueOnce(pending.promise);
    const { handlers } = setup();

    await pressCapture();
    await pressCapture();
    await act(async () => { pending.resolve({ uri: 'file:///cache/photo.jpg' }); });

    expect(mockTakePicture).toHaveBeenCalledTimes(1);
    expect(handlers.onCapturada).toHaveBeenCalledTimes(1);
  });
});

describe('FacturaCamaraFoto - permiso de cámara', () => {
  it('muestra el permiso denegado como recuperable, sin cámara ni captura', () => {
    mockPermission = { granted: false, status: 'denied', canAskAgain: true };
    const { handlers } = setup();

    expect(screen.getByText('Permiso de cámara requerido')).toBeTruthy();
    expect(screen.queryByTestId('mock-camera-view')).toBeNull();

    fireEvent.press(screen.getByText('Permitir cámara'));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('Cancelar'));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onCapturada).not.toHaveBeenCalled();
  });

  it('muestra la cámara cuando el permiso se concede después', () => {
    mockPermission = { granted: false, status: 'denied', canAskAgain: true };
    const { rerenderWith } = setup();
    expect(screen.queryByTestId('mock-camera-view')).toBeNull();

    mockPermission = { granted: true, status: 'granted', canAskAgain: true };
    rerenderWith(true);

    expect(screen.getByTestId('mock-camera-view')).toBeTruthy();
  });

  it('ofrece subir un archivo cuando el permiso fue denegado de forma definitiva', () => {
    mockPermission = { granted: false, status: 'denied', canAskAgain: false };
    const { handlers } = setup();

    fireEvent.press(screen.getByText('Subir foto o PDF'));

    expect(handlers.onNoDisponible).toHaveBeenCalledTimes(1);
    expect(handlers.onCapturada).not.toHaveBeenCalled();
  });
});

describe('FacturaCamaraFoto - resultados obsoletos', () => {
  it('ignora una foto que termina después de cerrar y reabrir la cámara', async () => {
    const pending = deferred<{ uri: string }>();
    mockTakePicture.mockReturnValueOnce(pending.promise);
    const { handlers, rerenderWith } = setup();

    await pressCapture();
    rerenderWith(false);
    rerenderWith(true);
    await act(async () => { pending.resolve({ uri: 'file:///cache/old.jpg' }); });

    expect(handlers.onCapturada).not.toHaveBeenCalled();
    expect(readAsStringAsync).not.toHaveBeenCalled();
  });

  it('ignora una foto que termina después de cerrar la cámara', async () => {
    const pending = deferred<{ uri: string }>();
    mockTakePicture.mockReturnValueOnce(pending.promise);
    const { handlers, rerenderWith } = setup();

    await pressCapture();
    rerenderWith(false);
    await act(async () => { pending.resolve({ uri: 'file:///cache/old.jpg' }); });

    expect(handlers.onCapturada).not.toHaveBeenCalled();
    expect(cameraMounts).toBe(0);
  });

  it('ignora una foto que termina después de desmontar el componente', async () => {
    const pending = deferred<{ uri: string }>();
    mockTakePicture.mockReturnValueOnce(pending.promise);
    const { handlers, unmount } = setup();

    await pressCapture();
    unmount();
    await act(async () => { pending.resolve({ uri: 'file:///cache/old.jpg' }); });

    expect(handlers.onCapturada).not.toHaveBeenCalled();
    expect(readAsStringAsync).not.toHaveBeenCalled();
  });

  it('ignora una lectura de archivo que termina después de cerrar la cámara', async () => {
    const pendingRead = deferred<string>();
    readAsStringAsync.mockReturnValueOnce(pendingRead.promise);
    const { handlers, rerenderWith } = setup();

    await pressCapture();
    await flush();
    expect(readAsStringAsync).toHaveBeenCalledTimes(1);
    rerenderWith(false);
    await act(async () => { pendingRead.resolve(JPEG_BASE64); });

    expect(handlers.onCapturada).not.toHaveBeenCalled();
  });

  it('ignora la foto cuando la factura dueña ya no está vigente antes de leerla', async () => {
    const pending = deferred<{ uri: string }>();
    mockTakePicture.mockReturnValueOnce(pending.promise);
    const { handlers } = setup();

    await pressCapture();
    handlers.estaVigente.mockReturnValue(false);
    await act(async () => { pending.resolve({ uri: 'file:///cache/old.jpg' }); });

    expect(handlers.onCapturada).not.toHaveBeenCalled();
    expect(readAsStringAsync).not.toHaveBeenCalled();
  });

  it('ignora los bytes cuando la factura dueña deja de estar vigente durante la lectura', async () => {
    const pendingRead = deferred<string>();
    readAsStringAsync.mockReturnValueOnce(pendingRead.promise);
    const { handlers } = setup();

    await pressCapture();
    await flush();
    handlers.estaVigente.mockReturnValue(false);
    await act(async () => { pendingRead.resolve(JPEG_BASE64); });

    expect(handlers.onCapturada).not.toHaveBeenCalled();
  });

  it('no captura si el contexto dueño ya no está vigente al pulsar', async () => {
    const { handlers } = setup();
    handlers.estaVigente.mockReturnValue(false);

    await pressCapture();

    expect(mockTakePicture).not.toHaveBeenCalled();
    expect(handlers.onCapturada).not.toHaveBeenCalled();
  });
});

describe('FacturaCamaraFoto - límite de tamaño y fallos', () => {
  it('rechaza una foto que supera 10 MB sin entregar los bytes', async () => {
    const oversized = 'A'.repeat(4 * Math.ceil((MAX_DOCUMENT_BYTES + 1) / 3));
    readAsStringAsync.mockResolvedValueOnce(oversized);
    const { handlers } = setup();

    await pressCapture();

    expect(handlers.onCapturada).toHaveBeenCalledTimes(1);
    expect(handlers.onCapturada).toHaveBeenCalledWith({
      ok: false,
      error: 'El archivo supera el límite de 10 MB',
    });
  });

  it('muestra un error recuperable si la cámara falla y permite reintentar', async () => {
    mockTakePicture.mockRejectedValueOnce(new Error('camera busy'));
    const { handlers } = setup();

    await pressCapture();

    expect(screen.getByText('No se pudo tomar la foto. Inténtalo de nuevo.')).toBeTruthy();
    expect(handlers.onCapturada).not.toHaveBeenCalled();

    await pressCapture();

    expect(handlers.onCapturada).toHaveBeenCalledTimes(1);
    expect(handlers.onCapturada.mock.calls[0][0]).toMatchObject({ ok: true });
    expect(screen.queryByText('No se pudo tomar la foto. Inténtalo de nuevo.')).toBeNull();
  });

  it('muestra un error recuperable si la lectura del archivo falla', async () => {
    readAsStringAsync.mockRejectedValueOnce(new Error('read failed'));
    const { handlers } = setup();

    await pressCapture();

    expect(screen.getByText('No se pudo tomar la foto. Inténtalo de nuevo.')).toBeTruthy();
    expect(handlers.onCapturada).not.toHaveBeenCalled();
  });
});

describe('FacturaCamaraFoto - web', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  it('avisa que la cámara no está disponible una sola vez, sin cámara ni subida', () => {
    Platform.OS = 'web';
    const { handlers, rerenderWith } = setup();

    expect(handlers.onNoDisponible).toHaveBeenCalledTimes(1);
    rerenderWith(true);
    expect(handlers.onNoDisponible).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mock-camera-view')).toBeNull();
    expect(mockTakePicture).not.toHaveBeenCalled();
    expect(handlers.onCapturada).not.toHaveBeenCalled();
    expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
  });

  it('cierra cuando no hay manejador de respaldo', () => {
    Platform.OS = 'web';
    const { handlers } = setup(true, false);

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onNoDisponible).not.toHaveBeenCalled();
  });

  it('no avisa mientras está oculta ni si el contexto dueño ya no está vigente', () => {
    Platform.OS = 'web';
    const hidden = setup(false);
    expect(hidden.handlers.onNoDisponible).not.toHaveBeenCalled();
    hidden.unmount();

    const stale: Handlers = {
      onClose: jest.fn(),
      onCapturada: jest.fn(),
      onNoDisponible: jest.fn(),
      estaVigente: jest.fn(() => false),
    };
    render(tree(true, stale));
    expect(stale.onNoDisponible).not.toHaveBeenCalled();
  });
});
