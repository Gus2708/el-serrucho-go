import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BarcodeScannerModal, BARCODE_1D_TYPES } from './BarcodeScannerModal';
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
      // Debe incluir todos los 1D estándar
      expect(BARCODE_1D_TYPES).toContain('code128');
      expect(BARCODE_1D_TYPES).toContain('ean13');
      expect(BARCODE_1D_TYPES).toContain('ean8');
      expect(BARCODE_1D_TYPES).toContain('code39');
      expect(BARCODE_1D_TYPES).toContain('code93');
      expect(BARCODE_1D_TYPES).toContain('upc_a');
      expect(BARCODE_1D_TYPES).toContain('upc_e');
      expect(BARCODE_1D_TYPES).toContain('codabar');
      expect(BARCODE_1D_TYPES).toContain('itf14');

      // Prohibido QR y 2D
      expect(BARCODE_1D_TYPES).not.toContain('qr');
      expect(BARCODE_1D_TYPES).not.toContain('aztec');
      expect(BARCODE_1D_TYPES).not.toContain('datamatrix');
      expect(BARCODE_1D_TYPES).not.toContain('pdf417');
    });

    it('pasa la lista de formatos 1D a CameraView', () => {
      renderScanner();
      expect(lastCameraProps).not.toBeNull();
      expect(lastCameraProps.barcodeScannerSettings.barcodeTypes).toEqual(BARCODE_1D_TYPES);
      expect(lastCameraProps.barcodeScannerSettings.barcodeTypes).not.toContain('qr');
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

    it('ignora estrictamente cualquier código QR detectado', () => {
      const { onScan } = renderScanner();

      // Caso tipo 'qr'
      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'qr', data: 'https://serrucho.com/promo' });
      });
      expect(onScan).not.toHaveBeenCalled();

      // Caso tipo 'org.iso.QRCode' o variantes
      act(() => {
        lastCameraProps.onBarcodeScanned({ type: 'org.iso.QRCode', data: '123456789' });
      });
      expect(onScan).not.toHaveBeenCalled();

      // Caso tipo con sufijo 'QR'
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
});
