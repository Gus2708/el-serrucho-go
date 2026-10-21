(global as any).__DEV__ = true;

const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockSelect = jest.fn();
const mockSingle = jest.fn();
const mockEq = jest.fn();
const mockIn = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => ({
      select: jest.fn(() => ({ in: mockIn })),
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

describe('useCompra submit: negative-stock compensation at the emission boundary', () => {
  // Only Supabase is faked. fetchExistencias, faltantePorNegativo, the compensation
  // helper and buildItemRows run for real. Assertions cover the rows sent to the
  // purchase queue; they do not prove the final Hybrid inventory, which stays
  // pending real-environment proof (task 4.4).
  const item = (overrides: Partial<CompraDraftItem> = {}): CompraDraftItem => ({
    codigo_producto: 'P-001',
    descripcion: 'PINTURA CAUCHO',
    cantidad: 10,
    costo: 5.0,
    precio: 7.5,
    referencia: null,
    es_nuevo: false,
    ...overrides,
  });

  function stockOf(rows: Record<string, number>): void {
    mockIn.mockResolvedValue({
      data: Object.entries(rows).map(([codigo_interno, existencia]) => ({ codigo_interno, existencia })),
      error: null,
    });
  }

  function sentItemRows(): Record<string, unknown>[] {
    const call = mockInsert.mock.calls.find(([arg]) => Array.isArray(arg));
    return call ? (call[0] as Record<string, unknown>[]) : [];
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockSingle.mockResolvedValue({ data: { id: 321 }, error: null });
    useCompra.getState().clear();
    useCompra.getState().setProveedor('PRV-01', 'FLORIPAINT');
  });

  it('sends 13 for stock -3 and invoice 10, keeping the documentary 10 untouched (expected arithmetic final 10)', async () => {
    stockOf({ 'P-001': -3 });
    useCompra.getState().addItem(item());

    const result = await useCompra.getState().submit('user-123');

    expect(result).toEqual({ compraId: 321 });
    expect(sentItemRows()).toEqual([expect.objectContaining({ compra_id: 321, codigo_producto: 'P-001', cantidad: 13 })]);
    expect(useCompra.getState().items[0].cantidad).toBe(10);
    expect(-3 + 13).toBe(10);
  });

  it('sends 10 for stock +5 and invoice 10 (expected arithmetic final 15, not 5 or 20)', async () => {
    stockOf({ 'P-001': 5 });
    useCompra.getState().addItem(item());

    await useCompra.getState().submit('user-123');

    expect(sentItemRows()).toEqual([expect.objectContaining({ cantidad: 10 })]);
    expect(5 + 10).toBe(15);
  });

  it('sends 10 for stock exactly 0 and compensates only the item in negative stock', async () => {
    stockOf({ 'P-001': 0, 'P-002': -4 });
    useCompra.getState().addItem(item());
    useCompra.getState().addItem(item({ codigo_producto: 'P-002', cantidad: 6 }));

    await useCompra.getState().submit('user-123');

    expect(sentItemRows().map(row => [row.codigo_producto, row.cantidad])).toEqual([['P-001', 10], ['P-002', 10]]);
  });

  it('leaves new products unchanged and skips the stock read when every item is new', async () => {
    useCompra.getState().addItem(item({ codigo_producto: 'N-001', es_nuevo: true }));

    await useCompra.getState().submit('user-123');

    expect(mockIn).not.toHaveBeenCalled();
    expect(sentItemRows()).toEqual([expect.objectContaining({ codigo_producto: 'N-001', cantidad: 10 })]);
  });

  it('compensates when an existing draft is emitted, not only a new purchase', async () => {
    stockOf({ 'P-001': -3 });
    useCompra.setState({ borradorId: 77 });
    useCompra.getState().addItem(item());

    const result = await useCompra.getState().submit('user-123');

    expect(result).toEqual({ compraId: 77 });
    expect(sentItemRows()).toEqual([expect.objectContaining({ compra_id: 77, cantidad: 13 })]);
  });

  it('aborts without writing anything when the stock read fails', async () => {
    mockIn.mockResolvedValue({ data: null, error: new Error('boom') });
    useCompra.getState().addItem(item());

    await expect(useCompra.getState().submit('user-123')).rejects.toThrow('No se pudo leer la existencia actual');

    expect(mockInsert).not.toHaveBeenCalled();
    expect(useCompra.getState().isLoading).toBe(false);
  });
});
