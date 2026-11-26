import * as React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithProviders } from '../test-utils/facturaUiHarness';

let mockRole: string | undefined = 'admin';
let mockDemo = false;
let mockFacturaVinculada = false;
let mockItemsOverride: any[] | null = null;
let mockDescuentosGenerales: number[] = [];
const mockUpdateItem = jest.fn();
const mockSetDescuentosGenerales = jest.fn();

jest.mock('../hooks/useUserRole', () => ({
  useUserRole: () => ({ data: { role: mockRole, profile: { id: 'a0000000-0000-4000-8000-00000000000a' } } }),
  isPrivilegedRole: (r?: string | null) => r === 'admin' || r === 'superempleado',
}));
jest.mock('../demo/useDemoStore', () => ({ isDemoActive: () => mockDemo, useDemoStore: Object.assign(() => ({}), { getState: () => ({ isDemoMode: mockDemo }) }) }));
jest.mock('../hooks/useDeviceSize', () => ({ useDeviceSize: () => ({ isDesktop: false }) }));
jest.mock('../hooks/useProveedores', () => ({ useProveedores: () => ({ data: [], isLoading: false }) }));
jest.mock('../hooks/useCompra', () => ({
  useCompra: () => ({
    proveedorCodigo: 'P1',
    proveedorNombre: 'Prov Uno',
    items: mockItemsOverride ?? (mockFacturaVinculada ? [{ codigo_producto: 'SKU-1', descripcion: 'Artículo', cantidad: 2, costo: 1, precio: 1.3, referencia: null, es_nuevo: false }] : []),
    descuentosGenerales: mockDescuentosGenerales,
    nota: '',
    titulo: '',
    numeroDocumento: '',
    isLoading: false,
    isAutoSaving: false,
    lastSavedAt: null,
    editingCompraId: null,
    borradorId: mockFacturaVinculada ? 7 : null,
    facturaVinculada: mockFacturaVinculada,
    setProveedor: jest.fn(),
    setDescuentosGenerales: mockSetDescuentosGenerales,
    addItem: jest.fn(),
    removeItem: jest.fn(),
    updateItem: mockUpdateItem,
    setNota: jest.fn(),
    setNumeroDocumento: jest.fn(),
    clear: jest.fn(),
    saveDraft: jest.fn(),
    autoSaveDraft: jest.fn(),
    deleteActiveDraft: jest.fn(),
    submit: jest.fn(),
  }),
}));
jest.mock('../hooks/useBorradores', () => ({ borradoresQueryKey: ['b'] }));
jest.mock('../hooks/useProductos', () => ({ useProductos: () => ({ data: undefined, isLoading: false }), normalizeSearchTerm: (s: string) => s }));
jest.mock('../hooks/useExistencias', () => ({ useExistencias: () => ({ data: undefined }), faltantePorNegativo: () => 0 }));
jest.mock('../hooks/useColisionesCodigo', () => ({ useColisionesCodigo: () => ({ data: undefined }), describirColision: () => '' }));
jest.mock('../components/BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));
jest.mock('../components/RegistroProveedorModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/GuardarBorradorModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/FacturasProveedorModal', () => ({ __esModule: true, default: (p: { visible: boolean; proveedorCodigo?: string }) => require("react").createElement(require("react-native").Text, { testID: "mock-facturas-modal" }, `${p.visible}|${p.proveedorCodigo}`) }));
jest.mock('../components/FacturaBorradoresBadge', () => ({ __esModule: true, default: () => require("react").createElement(require("react-native").Text, { testID: "mock-badge" }, "b") }));
jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn(), storage: { from: jest.fn() } } }));

import ComprasView, { parseCantidadConAjuste } from '../components/ComprasView';

async function mount() {
  const r = renderWithProviders(<ComprasView router={{ push: jest.fn() }} />);
  await act(async () => { await Promise.resolve(); });
  return r;
}

describe('ComprasView invoice entry gate', () => {
  afterEach(() => {
    mockRole = 'admin';
    mockDemo = false;
    mockFacturaVinculada = false;
    mockItemsOverride = null;
    mockDescuentosGenerales = [];
    mockUpdateItem.mockClear();
    mockSetDescuentosGenerales.mockClear();
  });
  it('admin: entry present, modal closed, opens on press with supplier prefill', async () => {
    const r = await mount();
    expect(r.getByText('FACTURA DE PROVEEDOR')).toBeTruthy();
    expect(r.getByText('Cargar factura con foto')).toBeTruthy();
    expect(r.queryByText('Foto o carga manual')).toBeNull();
    expect(r.getByLabelText('Facturas de proveedor')).toBeTruthy();
    expect(r.getByTestId('mock-facturas-modal').props.children).toBe('false|P1');
    await act(async () => { fireEvent.press(r.getByLabelText('Facturas de proveedor')); });
    expect(r.getByTestId('mock-facturas-modal').props.children).toBe('true|P1');
  });
  it('superempleado: entry present', async () => {
    mockRole = 'superempleado';
    const r = await mount();
    expect(r.queryByLabelText('Facturas de proveedor')).toBeTruthy();
  });
  it('empleado: no entry', async () => {
    mockRole = 'empleado';
    const r = await mount();
    expect(r.queryByLabelText('Facturas de proveedor')).toBeNull();
    expect(r.queryByTestId('mock-badge')).toBeNull();
  });
  it('role not loaded: no entry', async () => {
    mockRole = undefined;
    const r = await mount();
    expect(r.queryByLabelText('Facturas de proveedor')).toBeNull();
  });
  it('keeps an invoice-linked draft editable but blocks the unsafe submit path', async () => {
    mockFacturaVinculada = true;
    const r = await mount();
    expect(r.getByTestId('factura-submit-block')).toBeTruthy();
    expect(r.getByTestId('compra-submit').props.accessibilityState.disabled).toBe(true);
    const nameScroll = r.getByTestId('compra-item-name-scroll');
    expect(nameScroll.props.horizontal).toBe(true);
    expect(nameScroll.props.showsHorizontalScrollIndicator).toBe(false);
    expect(r.getByText('Artículo')).toBeTruthy();
  });
  it('demo mode, even as admin: no entry', async () => {
    mockDemo = true;
    const r = await mount();
    expect(r.queryByLabelText('Facturas de proveedor')).toBeNull();
  });

  it('parses trailing ellipsis adjustment quantities', () => {
    expect(parseCantidadConAjuste('5')).toEqual({ display: '5', cantidad: 5, esAjuste: false });
    expect(parseCantidadConAjuste('5.')).toEqual({ display: '5.', cantidad: 5, esAjuste: false });
    expect(parseCantidadConAjuste('5..')).toEqual({ display: '5..', cantidad: 5, esAjuste: false });
    expect(parseCantidadConAjuste('5...')).toEqual({ display: '5...', cantidad: 5, esAjuste: true });
    expect(parseCantidadConAjuste('2,5...')).toEqual({ display: '2.5...', cantidad: 2.5, esAjuste: true });
    expect(parseCantidadConAjuste('5\u2026')).toEqual({ display: '5...', cantidad: 5, esAjuste: true });
  });

  it('updates item with es_ajuste=true when typing 5... in CompraItemCard and shows notice in ProductoNuevoModal', async () => {
    mockItemsOverride = [{
      codigo_producto: 'SKU-1',
      descripcion: 'Artículo',
      cantidad: 2,
      costo: 1,
      precio: 1.3,
      referencia: null,
      es_nuevo: false,
      es_ajuste: false,
    }];
    const r = await mount();
    const qtyInput = r.getByTestId('compra-item-cantidad-input');

    await act(async () => { fireEvent.changeText(qtyInput, '5.'); });
    expect(mockUpdateItem).toHaveBeenLastCalledWith('SKU-1', { cantidad: 5, es_ajuste: false });

    await act(async () => { fireEvent.changeText(qtyInput, '5..'); });
    expect(mockUpdateItem).toHaveBeenLastCalledWith('SKU-1', { cantidad: 5, es_ajuste: false });

    await act(async () => { fireEvent.changeText(qtyInput, '5...'); });
    expect(mockUpdateItem).toHaveBeenLastCalledWith('SKU-1', { cantidad: 5, es_ajuste: true });

    await act(async () => { fireEvent.press(r.getByText('Producto nuevo')); });
    const modalQtyInput = r.getByTestId('producto-nuevo-cantidad-input');
    await act(async () => { fireEvent.changeText(modalQtyInput, '5...'); });
    expect(r.getByTestId('producto-nuevo-ajuste-aviso')).toBeTruthy();
  });

  it('supports per-item and cascaded discounts, general toggle, net cost receipt, and ProductoNuevoModal preview', async () => {
    mockDescuentosGenerales = [5];
    mockItemsOverride = [{
      codigo_producto: 'SKU-1',
      descripcion: 'Artículo',
      cantidad: 2,
      costo: 7.37,
      costo_lista: 10,
      descuentos: [20, 3],
      excluir_descuento_general: false,
      precio: 15,
      referencia: null,
      es_nuevo: false,
      es_ajuste: false,
    }];

    const r = await mount();

    // General discount panel is open and shows combined 5%
    expect(r.getByTestId('compra-desc-general-panel')).toBeTruthy();
    expect(r.getByTestId('compra-desc-general-badge')).toBeTruthy();

    // Item card shows net cost receipt and rounding notice (10 * 0.80 * 0.97 * 0.95 = 7.372 -> 7.37)
    expect(r.getByTestId('compra-item-costo-neto-SKU-1')).toBeTruthy();
    expect(r.getByTestId('compra-item-redondeo-SKU-1')).toBeTruthy();

    // Typing a new discount step updates item discounts
    const itemDescInput = r.getByTestId('compra-item-desc-SKU-1-input');
    await act(async () => { fireEvent.changeText(itemDescInput, '2'); });
    expect(mockUpdateItem).toHaveBeenLastCalledWith('SKU-1', { descuentos: [20, 3, 2] });

    // Toggling general exclusion calls updateItem
    await act(async () => { fireEvent.press(r.getByTestId('compra-item-toggle-general-SKU-1')); });
    expect(mockUpdateItem).toHaveBeenLastCalledWith('SKU-1', { excluir_descuento_general: true });

    // ProductoNuevoModal live net cost preview with cascaded discount + general discount
    await act(async () => { fireEvent.press(r.getByText('Producto nuevo')); });
    await act(async () => { fireEvent.changeText(r.getByTestId('producto-nuevo-costo-input'), '10'); });
    await act(async () => { fireEvent.changeText(r.getByTestId('producto-nuevo-desc-input'), '20'); });
    expect(r.getByTestId('producto-nuevo-costo-neto')).toBeTruthy();
  });

  it('expands DescuentoGeneralCard on tap and calls setDescuentosGenerales when typing cascade', async () => {
    const r = await mount();
    await act(async () => { fireEvent.press(r.getByTestId('compra-desc-general-toggle')); });
    const genInput = r.getByTestId('compra-desc-general-input');
    await act(async () => { fireEvent.changeText(genInput, '20+5'); });
    expect(mockSetDescuentosGenerales).toHaveBeenLastCalledWith([20, 5]);
  });
});
