jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
  },
}));

jest.mock('expo-print', () => ({
  printAsync: jest.fn(),
}));

const mockPrintWebPdf = jest.fn();
jest.mock('./webPdf', () => ({
  printWebPdf: (...args: any[]) => mockPrintWebPdf(...args),
}));

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import { printHtml } from './pdfGenerator';

describe('pdfGenerator printHtml platform routing', () => {
  const originalPlatform = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatform, configurable: true });
    jest.clearAllMocks();
  });

  describe('on Web platform', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    });

    it('delegates to printWebPdf with given filename', async () => {
      await printHtml('<h1>Test HTML</h1>', 'Presupuesto_101.pdf');
      expect(mockPrintWebPdf).toHaveBeenCalledWith('<h1>Test HTML</h1>', 'Presupuesto_101.pdf');
      expect(Print.printAsync).not.toHaveBeenCalled();
    });

    it('uses default filename documento.pdf when omitted', async () => {
      await printHtml('<h1>Default Test</h1>');
      expect(mockPrintWebPdf).toHaveBeenCalledWith('<h1>Default Test</h1>', 'documento.pdf');
      expect(Print.printAsync).not.toHaveBeenCalled();
    });
  });

  describe('on Native platform', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    });

    it('delegates to Print.printAsync on android', async () => {
      await printHtml('<h1>Native HTML</h1>');
      expect(Print.printAsync).toHaveBeenCalledWith({ html: '<h1>Native HTML</h1>' });
      expect(mockPrintWebPdf).not.toHaveBeenCalled();
    });

    it('catches and logs errors without throwing unhandled rejection', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (Print.printAsync as jest.Mock).mockRejectedValueOnce(new Error('Print spooler failure'));

      await expect(printHtml('<h1>Native Error</h1>')).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
