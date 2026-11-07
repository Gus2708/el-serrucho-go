import * as React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BarcodeScannerModal, BARCODE_1D_TYPES } from './BarcodeScannerModal';
import { WebBarcodeScanner, resetWebScannerStreamForTests } from './WebBarcodeScanner';
import { ThemeProvider } from '../theme/ThemeContext';

let mockPermission: { granted: boolean } | null = { granted: true };
const mockRequestPermission = jest.fn();
let lastCameraProps: any = null;

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: (props: any) => {
      lastCameraProps = props;
      return <View testID="mock-camera-view" {...props} />;
    },
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  };
});

function renderScanner(props: { visible?: boolean; onClose?: () => void; onScan?: (data: string) => void } = {}) {
  const onClose = props.onClose ?? jest.fn();
  const onScan = props.onScan ?? jest.fn();
  const visible = props.visible ?? true;

  const result = render(
    <ThemeProvider>
      <BarcodeScannerModal visible={visible} onClose={onClose} onScan={onScan} />
    </ThemeProvider>
  );

  return { ...result, onClose, onScan };
}

beforeEach(() => {
  mockPermission = { granted: true };
  mockRequestPermission.mockReset();
  lastCameraProps = null;
});

describe('BarcodeScannerModal - Suite TDD de Escáner 1D', () => {
  describe('Configuración de formatos (1D exclusivo, sin QR ni 2D)', () => {
    it('declara únicamente formatos lineales 1D y excluye QR y matrices 2D', () => {
      expect(BARCODE_1D_TYPES).toContain('code128');
      expect(BARCODE_1D_TYPES).toContain('ean13');
      expect(BARCODE_1D_TYPES).toContain('ean8');
      expect(BARCODE_1D_TYPES).toContain('code39');
      expect(BARCODE_1D_TYPES).toContain('code93');
      expect(BARCODE_1D_TYPES).toContain('upc_a');
      expect(BARCODE_1D_TYPES).toContain('upc_e');
      expect(BARCODE_1D_TYPES).toContain('codabar');
      expect(BARCODE_1D_TYPES).toContain('itf14');

      expect(BARCODE_1D_TYPES).not.toContain('qr');
      expect(BARCODE_1D_TYPES).not.toContain('aztec');
      expect(BARCODE_1D_TYPES).not.toContain('datamatrix');
      expect(BARCODE_1D_TYPES).not.toContain('pdf417');
    });

    it('pasa la lista de formatos 1D y enfoque continuo (autofocus="off") a CameraView en Android e iOS', () => {
      const originalOS = Platform.OS;
      Platform.OS = 'android';
      try {
        renderScanner();
        expect(lastCameraProps).not.toBeNull();
        expect(lastCameraProps.barcodeScannerSettings.barcodeTypes).toEqual(BARCODE_1D_TYPES);
        expect(lastCameraProps.barcodeScannerSettings.barcodeTypes).not.toContain('qr');
        expect(lastCameraProps.autofocus).toBe('off');
      } finally {
        Platform.OS = originalOS;
      }
    });
  });

  describe('Filtrado estricto de eventos de escaneo', () => {
    it('escanea con éxito un código 1D Code 128 (ej. 205000010307)', () => {
      const { onScan } = renderScanner();

      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'code128', data: '205000010307' });
      });

      expect(onScan).toHaveBeenCalledTimes(1);
      expect(onScan).toHaveBeenCalledWith('205000010307');
    });

    it('escanea con éxito un código 1D EAN/UPC (ej. 801320012310) con trim de espacios', () => {
      const { onScan } = renderScanner();

      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'ean13', data: '  801320012310  ' });
      });

      expect(onScan).toHaveBeenCalledTimes(1);
      expect(onScan).toHaveBeenCalledWith('801320012310');
    });

    it('limpia asteriscos de guarda en códigos Code 39 (*CODIGO*) y prefijo GS1 ]C1', () => {
      const { onScan } = renderScanner();

      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'code39', data: '*FER-990*' });
      });

      expect(onScan).toHaveBeenCalledWith('FER-990');

      // Segundo render para probar prefijo GS1-128
      const second = renderScanner();
      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'code128', data: ']C10107591234000018' });
      });
      expect(second.onScan).toHaveBeenCalledWith('07591234000018');
    });

    it('escanea con éxito todos los formatos 1D: UPC-E, ITF-14, Code 93 y Codabar', () => {
      const scannerUpcE = renderScanner();
      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'upc_e', data: '04252614' });
      });
      expect(scannerUpcE.onScan).toHaveBeenCalledWith('04252614');

      const scannerItf = renderScanner();
      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'itf14', data: '17591234000015' });
      });
      expect(scannerItf.onScan).toHaveBeenCalledWith('17591234000015');

      const scannerCode93 = renderScanner();
      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'code93', data: 'TEST-93' });
      });
      expect(scannerCode93.onScan).toHaveBeenCalledWith('TEST-93');

      const scannerCodabar = renderScanner();
      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'codabar', data: 'A40156B' });
      });
      expect(scannerCodabar.onScan).toHaveBeenCalledWith('A40156B');
    });

    it('ignora estrictamente cualquier código QR detectado', () => {
      const { onScan } = renderScanner();

      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'qr', data: 'https://serrucho.com/promo' });
      });
      expect(onScan).not.toHaveBeenCalled();

      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'org.iso.QRCode', data: '123456789' });
      });
      expect(onScan).not.toHaveBeenCalled();

      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'QR_CODE', data: 'some-qr' });
      });
      expect(onScan).not.toHaveBeenCalled();
    });

    it('ignora códigos 2D de tipo Aztec o DataMatrix', () => {
      const { onScan } = renderScanner();

      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'aztec', data: 'aztec-data' });
      });
      expect(onScan).not.toHaveBeenCalled();

      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'datamatrix', data: 'matrix-data' });
      });
      expect(onScan).not.toHaveBeenCalled();
    });

    it('evita dobles lecturas consecutivas (scannedRef)', () => {
      const { onScan } = renderScanner();

      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'code128', data: '205000010307' });
        lastCameraProps.onBarcodeScanned({ type: 'code128', data: '205000010307' });
      });

      expect(onScan).toHaveBeenCalledTimes(1);
    });
  });

  describe('Controles de Cámara y UI', () => {
    it('muestra el texto de instrucción exclusivo para código de barras (sin mención a QR)', () => {
      renderScanner();
      expect(screen.getByText('Apunta la cámara al código de barras')).toBeTruthy();
      expect(screen.queryByText(/QR/i)).toBeNull();
    });

    it('el botón de linterna conmuta enableTorch en la cámara', () => {
      renderScanner();
      expect(lastCameraProps.enableTorch).toBe(false);

      const torchBtn = screen.getByLabelText('Encender linterna');
      fireEvent.press(torchBtn);
      expect(lastCameraProps.enableTorch).toBe(true);

      const torchOffBtn = screen.getByLabelText('Apagar linterna');
      fireEvent.press(torchOffBtn);
      expect(lastCameraProps.enableTorch).toBe(false);
    });

    it('el botón de zoom conmuta entre 1x (0) y 2x (0.15) para facilitar enfoque', () => {
      renderScanner();
      expect(lastCameraProps.zoom).toBe(0);
      expect(screen.getByText('1x')).toBeTruthy();

      const zoomBtn = screen.getByLabelText('Zoom 2x');
      fireEvent.press(zoomBtn);
      expect(lastCameraProps.zoom).toBe(0.15);
      expect(screen.getByText('2x')).toBeTruthy();

      const zoom1xBtn = screen.getByLabelText('Zoom 1x');
      fireEvent.press(zoom1xBtn);
      expect(lastCameraProps.zoom).toBe(0);
      expect(screen.getByText('1x')).toBeTruthy();
    });

    it('el botón Cerrar dispara la función onClose', () => {
      const { onClose } = renderScanner();
      const closeBtn = screen.getByRole('button', { name: 'Cerrar Escáner' });
      fireEvent.press(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Manejo de permisos', () => {
    it('muestra la pantalla de solicitud cuando el permiso no ha sido otorgado', () => {
      mockPermission = { granted: false };
      renderScanner();

      expect(screen.getByText('Permiso de Cámara Requerido')).toBeTruthy();
      const grantBtn = screen.getByText('Otorgar Permiso');
      fireEvent.press(grantBtn);
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });
  });

  describe('WebBarcodeScanner (PWA) - Permiso único, Linterna y Zoom', () => {
    let mockApplyConstraints: jest.Mock;
    let mockStopTrack: jest.Mock;
    let mockGetUserMedia: jest.Mock;
    let mockTrack: any;
    let storageMap: Record<string, string>;

    beforeEach(() => {
      if (typeof resetWebScannerStreamForTests === 'function') {
        resetWebScannerStreamForTests();
      }
      storageMap = {};
      (globalThis as any).localStorage = {
        getItem: jest.fn((k: string) => storageMap[k] ?? null),
        setItem: jest.fn((k: string, v: string) => { storageMap[k] = v; }),
        removeItem: jest.fn((k: string) => { delete storageMap[k]; }),
      };
      (globalThis as any).sessionStorage = {
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      };

      mockApplyConstraints = jest.fn().mockResolvedValue(undefined);
      mockStopTrack = jest.fn();
      mockTrack = {
        readyState: 'live',
        enabled: true,
        stop: mockStopTrack,
        applyConstraints: mockApplyConstraints,
        getCapabilities: () => ({
          torch: true,
          focusMode: ['continuous'],
          zoom: { min: 1, max: 4, step: 0.1 },
        }),
        getSettings: () => ({
          deviceId: 'rear-camera-1',
        }),
      };

      mockGetUserMedia = jest.fn().mockResolvedValue({
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
      });

      (globalThis as any).window = globalThis;
      (globalThis as any).navigator = {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
        },
      };
      (globalThis as any).BarcodeDetector = class {
        static getSupportedFormats() {
          return Promise.resolve(['ean_13', 'code_128']);
        }
        detect() {
          return Promise.resolve([]);
        }
      };
    });

    it('solicita getUserMedia una sola vez y reutiliza el stream en aperturas sucesivas sin volver a pedir permiso', async () => {
      const onClose = jest.fn();
      const onScan = jest.fn();

      const { rerender } = render(
        <ThemeProvider>
          <WebBarcodeScanner visible={true} onClose={onClose} onScan={onScan} />
        </ThemeProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Apunta la cámara al código de barras')).toBeTruthy();
      });

      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
      expect(storageMap['serrucho_camera_device_id']).toBe('rear-camera-1');
      expect(mockStopTrack).not.toHaveBeenCalled();

      // Cerrar modal -> pausa el track pero NO lo destruye (no revoca permiso de sesión en PWA)
      rerender(
        <ThemeProvider>
          <WebBarcodeScanner visible={false} onClose={onClose} onScan={onScan} />
        </ThemeProvider>
      );
      expect(mockStopTrack).not.toHaveBeenCalled();
      expect(mockTrack.enabled).toBe(false);

      // Reabrir modal -> reutiliza el stream activo sin llamar getUserMedia otra vez
      rerender(
        <ThemeProvider>
          <WebBarcodeScanner visible={true} onClose={onClose} onScan={onScan} />
        </ThemeProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Apunta la cámara al código de barras')).toBeTruthy();
      });
      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
      expect(mockTrack.enabled).toBe(true);
    });

    it('integra control de linterna (flash) y zoom en el escáner PWA', async () => {
      render(
        <ThemeProvider>
          <WebBarcodeScanner visible={true} onClose={jest.fn()} onScan={jest.fn()} />
        </ThemeProvider>
      );

      await waitFor(() => {
        expect(screen.getByLabelText('Encender linterna')).toBeTruthy();
      });

      const torchBtn = screen.getByLabelText('Encender linterna');
      await act(async () => {
        fireEvent.press(torchBtn);
      });

      expect(mockApplyConstraints).toHaveBeenCalledWith({
        advanced: [{ torch: true }],
      });
      expect(screen.getByLabelText('Apagar linterna')).toBeTruthy();

      const zoomBtn = screen.getByLabelText('Zoom 2x');
      await act(async () => {
        fireEvent.press(zoomBtn);
      });

      expect(mockApplyConstraints).toHaveBeenCalledWith({
        advanced: [{ zoom: 2 }],
      });
      expect(screen.getByLabelText('Zoom 1x')).toBeTruthy();
    });
  });
});
