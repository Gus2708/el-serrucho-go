(global as any).__DEV__ = true;

const mockUploadPdfAndGetUrl = jest.fn();
const mockHtmlToPdfBlob = jest.fn();
const mockPrintToFileAsync = jest.fn();
const mockShareAsync = jest.fn();

jest.mock('react-native', () => ({
  Platform: {
    OS: 'web',
  },
}));

jest.mock('../lib/pdfStorage', () => ({
  uploadPdfAndGetUrl: (...args: any[]) => mockUploadPdfAndGetUrl(...args),
}));

jest.mock('../utils/webPdf', () => ({
  htmlToPdfBlob: (...args: any[]) => mockHtmlToPdfBlob(...args),
}));

jest.mock('expo-print', () => ({
  printToFileAsync: (...args: any[]) => mockPrintToFileAsync(...args),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: (...args: any[]) => mockShareAsync(...args),
}));

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockPresupuestoId = 101;
const mockPresupuestoInsert = jest.fn();
const mockDetalleInsert = jest.fn();
const mockPresupuestoUpdate = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
        error: null,
      }),
    },
    from: jest.fn((tabla: string) => {
      if (tabla === 'presupuestos') {
        return {
          insert: (data: any) => {
            mockPresupuestoInsert(data);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: mockPresupuestoId, ...data }, error: null }),
              }),
            };
          },
          update: (data: any) => {
            mockPresupuestoUpdate(data);
            return {
              eq: () => Promise.resolve({ error: null }),
            };
          },
        };
      }
      if (tabla === 'presupuestos_detalle') {
        return {
          insert: (data: any) => {
            mockDetalleInsert(data);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (tabla === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { display_name: 'Test Agent' }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    }),
  },
}));

jest.mock('../lib/retry', () => ({
  withRetry: (fn: () => unknown) => fn(),
  withSupabaseRetry: (fn: () => unknown) => fn(),
}));

jest.mock('../demo/useDemoStore', () => ({
  isDemoActive: () => false,
}));

import { Platform } from 'react-native';
import { usePresupuestoStore } from './usePresupuestoStore';
import { Producto } from '../lib/supabase';

describe('usePresupuestoStore', () => {
  const sampleProduct: Producto = {
    codigo_interno: 'P-001',
    descripcion: 'Martillo de Acero',
    precio_venta: 15.0,
    costo: 10.0,
    existencia: 50,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    usePresupuestoStore.getState().reset();
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-blob-url');
    global.URL.revokeObjectURL = jest.fn();
    mockHtmlToPdfBlob.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
    mockUploadPdfAndGetUrl.mockResolvedValue('https://storage.supabase.co/bucket/presupuesto.pdf');
  });

  describe('Item management and Margin warnings', () => {
    it('adds item with frozen unit price', () => {
      usePresupuestoStore.getState().addItem(sampleProduct, 2);
      const state = usePresupuestoStore.getState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].cantidad).toBe(2);
      expect(state.items[0].precio_unitario).toBe(15.0);
    });

    it('returns warning when price is updated below cost', () => {
      usePresupuestoStore.getState().addItem(sampleProduct, 1);
      const warning = usePresupuestoStore.getState().updateItemPrice('P-001', 8.0);
      expect(warning).toContain('por debajo del costo');
      expect(usePresupuestoStore.getState().items[0].precio_unitario).toBe(8.0);
    });

    it('returns null warning when price is updated above or equal to cost', () => {
      usePresupuestoStore.getState().addItem(sampleProduct, 1);
      const warning = usePresupuestoStore.getState().updateItemPrice('P-001', 12.0);
      expect(warning).toBeNull();
      expect(usePresupuestoStore.getState().items[0].precio_unitario).toBe(12.0);
    });
  });

  describe('submit on Web platform', () => {
    it('generates HTML, creates PDF blob, uploads to storage, and updates pdf_url', async () => {
      usePresupuestoStore.getState().setCliente({
        codigo_cliente: 'CLI-01',
        nombre: 'Ferretería Central',
        rif: 'J-12345678-9',
        telefono: '04141234567',
        direccion: 'Calle Principal',
      });
      usePresupuestoStore.getState().addItem(sampleProduct, 3);

      const result = await usePresupuestoStore.getState().submit();

      expect(result).toBeDefined();
      expect(result?.presupuestoId).toBe(mockPresupuestoId);
      expect(result?.html).toContain('Ferretería Central');

      // Verified PDF blob creation on web
      expect(mockHtmlToPdfBlob).toHaveBeenCalled();
      // Verified upload to storage
      expect(mockUploadPdfAndGetUrl).toHaveBeenCalledWith(
        'blob:mock-blob-url',
        expect.stringContaining('Ferretería_Central')
      );
      // Verified Supabase update with pdf_url
      expect(mockPresupuestoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          pdf_url: 'https://storage.supabase.co/bucket/presupuesto.pdf',
        })
      );
      // Verified object URL cleanup
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-blob-url');
    });

    it('does not throw or abort submit when PDF upload fails on web', async () => {
      usePresupuestoStore.getState().addItem(sampleProduct, 1);
      mockUploadPdfAndGetUrl.mockRejectedValueOnce(new Error('Storage quota exceeded'));

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await usePresupuestoStore.getState().submit();

      expect(result).toBeDefined();
      expect(result?.presupuestoId).toBe(mockPresupuestoId);
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-blob-url');
    });
  });

  describe('submit on Native platform', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      mockPrintToFileAsync.mockResolvedValue({ uri: 'file:///temp/print.pdf' });
    });

    it('uses Print.printToFileAsync and shares PDF on native', async () => {
      usePresupuestoStore.getState().addItem(sampleProduct, 2);

      const result = await usePresupuestoStore.getState().submit();

      expect(result).toBeDefined();
      expect(result?.presupuestoId).toBe(mockPresupuestoId);
      expect(mockPrintToFileAsync).toHaveBeenCalled();
      expect(mockShareAsync).toHaveBeenCalledWith(
        expect.stringContaining('file:///cache/'),
        expect.objectContaining({ mimeType: 'application/pdf' })
      );
    });
  });
});
