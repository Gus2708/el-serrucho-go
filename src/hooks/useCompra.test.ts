(global as any).__DEV__ = true;

const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockSelect = jest.fn();
const mockSingle = jest.fn();
const mockEq = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => ({
      insert: mockInsert.mockImplementation(() => ({
        select: mockSelect.mockImplementation(() => ({
          single: mockSingle,
        })),
        error: null,
      })),
      update: mockUpdate.mockImplementation(() => ({
        eq: mockEq.mockReturnThis(),
        error: null,
      })),
      delete: mockDelete.mockImplementation(() => ({
        eq: mockEq.mockReturnThis(),
        error: null,
      })),
    })),
  },
}));

jest.mock('./useExistencias', () => ({
  fetchExistencias: jest.fn().mockResolvedValue({}),
  faltantePorNegativo: jest.fn().mockReturnValue(0),
}));

jest.mock('./useColisionesCodigo', () => ({
  fetchColisionesCodigo: jest.fn().mockResolvedValue({}),
  describirColision: jest.fn().mockReturnValue(''),
}));

import { useCompra, CompraDraftItem } from './useCompra';
import { supabase } from '../lib/supabase';

describe('useCompra autosave draft', () => {
  const sampleItem: CompraDraftItem = {
    codigo_producto: 'P-001',
    descripcion: 'PINTURA CAUCHO',
    cantidad: 2,
    costo: 5.0,
    precio: 7.5,
    referencia: null,
    es_nuevo: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useCompra.getState().clear();
  });

  it('does not autosave if items list is empty', async () => {
    const id = await useCompra.getState().autoSaveDraft('user-123');
    expect(id).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('creates a new draft with auto-generated title when borradorId is null', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 55 }, error: null });

    useCompra.getState().setProveedor('PRV-01', 'FLORIPAINT');
    useCompra.getState().addItem(sampleItem);

    const id = await useCompra.getState().autoSaveDraft('user-123');

    expect(id).toBe(55);
    expect(useCompra.getState().borradorId).toBe(55);
    expect(useCompra.getState().titulo).toContain('FLORIPAINT');
    expect(useCompra.getState().isAutoSaving).toBe(false);
    expect(useCompra.getState().lastSavedAt).not.toBeNull();
  });

  it('updates existing draft when borradorId is present', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 77 }, error: null });

    useCompra.getState().setProveedor('PRV-01', 'FLORIPAINT');
    useCompra.getState().addItem(sampleItem);

    await useCompra.getState().autoSaveDraft('user-123');
    expect(useCompra.getState().borradorId).toBe(77);

    // Update an item and autosave again
    useCompra.getState().updateItem('P-001', { cantidad: 5 });
    const updatedId = await useCompra.getState().autoSaveDraft('user-123');

    expect(updatedId).toBe(77);
    expect(supabase.from).toHaveBeenCalledWith('compras_app');
    expect(supabase.from).toHaveBeenCalledWith('compras_app_items');
  });

  it('deletes active draft from database and clears borradorId', async () => {
    useCompra.setState({ borradorId: 99, titulo: 'Borrador test' });

    await useCompra.getState().deleteActiveDraft();

    expect(supabase.from).toHaveBeenCalledWith('compras_app');
    expect(useCompra.getState().borradorId).toBeNull();
    expect(useCompra.getState().titulo).toBe('');
  });
});
