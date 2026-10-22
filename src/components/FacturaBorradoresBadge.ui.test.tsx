import * as React from 'react';
import { screen } from '@testing-library/react-native';
import FacturaBorradoresBadge from './FacturaBorradoresBadge';
import { facturaEditorService, publishFacturaSession } from '../hooks/useFacturasProveedor';
import { FACTURA_1, FACTURA_2, OWNER_A, OWNER_B, renderWithProviders, resetBackend, settle } from '../test-utils/facturaUiHarness';

let mockOwner: string | null = OWNER_A;

jest.mock('../lib/supabase', () => ({ supabase: require('../test-utils/facturaUiHarness').backend.client }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('../test-utils/facturaUiHarness').asyncStorage,
}));
jest.mock('../hooks/useUserRole', () => ({
  useUserRole: () => ({ data: mockOwner === null ? undefined : { profile: { id: mockOwner } } }),
}));

async function leaveDraft(uid: string, facturaId: string, numero: string): Promise<void> {
  publishFacturaSession({ user: { id: uid } });
  const controller = await facturaEditorService.acquire({
    uid,
    facturaId,
    draft: { facturaId, version: 0, proveedorCodigo: '', proveedorNombre: '', numeroDocumento: '', numeroControl: '', fechaDocumento: '', moneda: 'USD', notas: '', documento: null, lineas: [] },
    savedDocumentPath: null,
  });
  controller.edit(draft => ({ ...draft, numeroDocumento: numero }));
  await controller.close();
}

beforeEach(() => {
  resetBackend();
  mockOwner = OWNER_A;
});

describe('insignia de borradores locales', () => {
  it('cuenta los borradores de esta cuenta con una etiqueta accesible', async () => {
    await leaveDraft(OWNER_A, 'f2000000-0000-4000-8000-000000000001', 'A-1');
    await leaveDraft(OWNER_A, 'f2000000-0000-4000-8000-000000000002', 'A-2');

    renderWithProviders(<FacturaBorradoresBadge />);

    expect(await screen.findByTestId('factura-borradores-badge')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByLabelText('2 borradores sin guardar')).toBeTruthy();
  });

  it('con un solo borrador usa el singular y no cuenta los de otra cuenta', async () => {
    await leaveDraft(OWNER_A, FACTURA_1, 'A-3');
    await leaveDraft(OWNER_B, FACTURA_2, 'B-3');

    renderWithProviders(<FacturaBorradoresBadge />);

    expect(await screen.findByLabelText('1 borrador sin guardar')).toBeTruthy();
  });

  it('sin borradores o sin cuenta no muestra nada', async () => {
    renderWithProviders(<FacturaBorradoresBadge />);
    await settle();
    expect(screen.queryByTestId('factura-borradores-badge')).toBeNull();

    mockOwner = null;
    screen.unmount();
    renderWithProviders(<FacturaBorradoresBadge />);
    await settle();
    expect(screen.queryByTestId('factura-borradores-badge')).toBeNull();
  });
});
