import * as React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithProviders } from '../test-utils/facturaUiHarness';

let mockRole: string | undefined = 'admin';
let mockDemo = false;

jest.mock('../hooks/useUserRole', () => ({
  useUserRole: () => ({ data: { role: mockRole, profile: { id: 'a0000000-0000-4000-8000-00000000000a' } } }),
  isPrivilegedRole: (r?: string | null) => r === 'admin' || r === 'superempleado',
}));
jest.mock('../demo/useDemoStore', () => ({ isDemoActive: () => mockDemo, useDemoStore: Object.assign(() => ({}), { getState: () => ({ isDemoMode: mockDemo }) }) }));
jest.mock('../hooks/useDeviceSize', () => ({ useDeviceSize: () => ({ isDesktop: false }) }));
jest.mock('../hooks/useProveedores', () => ({ useProveedores: () => ({ data: [], isLoading: false }) }));
jest.mock('../hooks/useCompra', () => ({
  useCompra: () => ({ proveedorCodigo: 'P1', proveedorNombre: 'Prov Uno', items: [], nota: '', titulo: '', numeroDocumento: '', isLoading: false, isAutoSaving: false, lastSavedAt: null, editingCompraId: null, borradorId: null,
    setProveedor: jest.fn(), addItem: jest.fn(), removeItem: jest.fn(), updateItem: jest.fn(), setNota: jest.fn(), setNumeroDocumento: jest.fn(), clear: jest.fn(), saveDraft: jest.fn(), autoSaveDraft: jest.fn(), deleteActiveDraft: jest.fn(), submit: jest.fn() }),
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

import ComprasView from '../components/ComprasView';

async function mount() {
  const r = renderWithProviders(<ComprasView router={{ push: jest.fn() }} />);
  await act(async () => { await Promise.resolve(); });
  return r;
}

describe('ComprasView invoice entry gate', () => {
  afterEach(() => { mockRole = 'admin'; mockDemo = false; });
  it('admin: entry present, modal closed, opens on press with supplier prefill', async () => {
    const r = await mount();
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
  it('demo mode, even as admin: no entry', async () => {
    mockDemo = true;
    const r = await mount();
    expect(r.queryByLabelText('Facturas de proveedor')).toBeNull();
  });
});
