import * as React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import FacturasProveedorModal from './FacturasProveedorModal';
import { facturaEditorService, publishFacturaSession } from '../hooks/useFacturasProveedor';
import {
  OWNER_A,
  OWNER_B,
  asyncStorage,
  backend,
  renderWithProviders,
  resetBackend,
  spyOnAlert,
} from '../test-utils/facturaUiHarness';

let mockOwner: string | null = OWNER_A;

jest.mock('../lib/supabase', () => ({ supabase: require('../test-utils/facturaUiHarness').backend.client }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('../test-utils/facturaUiHarness').asyncStorage,
}));
jest.mock('../hooks/useUserRole', () => ({
  useUserRole: () => ({ data: mockOwner === null ? undefined : { profile: { id: mockOwner } } }),
}));

const DRAFT_1 = 'f3000000-0000-4000-8000-000000000001';
const DRAFT_2 = 'f3000000-0000-4000-8000-000000000002';
const SERVER_1 = 'f3000000-0000-4000-8000-0000000000a1';
const LINE_A = 'a3000000-0000-4000-8000-000000000001';
const LINE_B = 'a3000000-0000-4000-8000-000000000002';

function emptyDraft(facturaId: string) {
  return { facturaId, version: 0, proveedorCodigo: '', proveedorNombre: '', numeroDocumento: '', numeroControl: '', fechaDocumento: '', moneda: 'USD', notas: '', documento: null, lineas: [] };
}

async function leaveDraft(uid: string, facturaId: string, numero: string, withLines = false): Promise<void> {
  publishFacturaSession({ user: { id: uid } });
  const controller = await facturaEditorService.acquire({ uid, facturaId, draft: emptyDraft(facturaId), savedDocumentPath: null });
  controller.edit(draft => {
    const next = { ...draft, numeroDocumento: numero };
    if (!withLines) return next;
    const linea = { codigoProveedor: '', descripcion: '', unidad: '', costoUnitario: '', total: '', nota: '' };
    return {
      ...next,
      lineas: [
        { lineaId: LINE_A, codigoProducto: 'SKU-1', cantidad: '2', ...linea },
        { lineaId: LINE_B, codigoProducto: 'SKU-1', cantidad: '7', ...linea },
      ],
    };
  });
  await controller.close();
}

function serverInvoice(id: string, numero: string) {
  return { id, version: 3, proveedor_nombre: 'Proveedor Sur', numero_documento: numero, fecha_documento: '2026-10-01', actualizado_en: '2026-10-01T10:00:00Z', documento_mime: null };
}

function renderModal() {
  return renderWithProviders(<FacturasProveedorModal visible onClose={jest.fn()} />);
}

let alert: jest.SpyInstance;

beforeEach(() => {
  resetBackend();
  alert = spyOnAlert();
  mockOwner = OWNER_A;
  publishFacturaSession({ user: { id: OWNER_A } });
});

afterEach(() => {
  alert.mockRestore();
});

describe('lista de facturas: borradores locales primero', () => {
  it('muestra los borradores de este dispositivo antes que las facturas del servidor y no abre ninguno solo', async () => {
    await leaveDraft(OWNER_A, DRAFT_1, 'A-1');
    backend.tables.list = [serverInvoice(SERVER_1, 'S-9')];

    renderModal();

    expect(await screen.findByText('BORRADORES EN ESTE DISPOSITIVO')).toBeTruthy();
    expect(screen.getByText('Factura A-1')).toBeTruthy();
    expect(screen.getByText('Factura S-9')).toBeTruthy();
    expect(screen.getAllByTestId(/^factura-(borrador|servidor)-/).map(node => node.props.testID)).toEqual([
      `factura-borrador-${DRAFT_1}`,
      `factura-servidor-${SERVER_1}`,
    ]);
    expect(screen.queryByTestId('factura-editor')).toBeNull();
  });

  it('con el servidor sin conexión sigue mostrando los borradores y ofrece reintentar la lista', async () => {
    await leaveDraft(OWNER_A, DRAFT_1, 'A-2');
    backend.client.from.mockImplementationOnce(() => {
      throw new Error('Network request failed');
    });

    renderModal();

    expect(await screen.findByText('Factura A-2')).toBeTruthy();
    expect(screen.getByText('No se pudo cargar. Reintentar')).toBeTruthy();
  });

  it('no dice que no hay facturas cuando hay borradores, y lo dice cuando no hay nada', async () => {
    renderModal();
    expect(await screen.findByText('Aún no hay facturas guardadas')).toBeTruthy();
    expect(screen.queryByText('BORRADORES EN ESTE DISPOSITIVO')).toBeNull();
  });

  it('abrir un borrador restaura sus campos, renglones repetidos y orden exactos', async () => {
    await leaveDraft(OWNER_A, DRAFT_1, 'A-3', true);

    renderModal();
    const row = await screen.findByTestId(`factura-borrador-${DRAFT_1}`);
    await act(async () => {
      fireEvent.press(row);
    });
    await screen.findByLabelText('Número de factura');

    expect(screen.getByLabelText('Número de factura').props.value).toBe('A-3');
    expect(screen.getByText('RENGLONES (2)')).toBeTruthy();
    expect(screen.getAllByLabelText('Código interno (SKU)').map(node => node.props.value)).toEqual(['SKU-1', 'SKU-1']);
    expect(screen.getAllByLabelText('Cantidad').map(node => node.props.value)).toEqual(['2', '7']);
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('cada cuenta ve solo sus borradores y al volver la primera recupera los suyos', async () => {
    await leaveDraft(OWNER_A, DRAFT_1, 'A-4');
    await leaveDraft(OWNER_B, DRAFT_2, 'B-4');
    publishFacturaSession({ user: { id: OWNER_A } });

    const view = renderModal();
    expect(await screen.findByText('Factura A-4')).toBeTruthy();
    expect(screen.queryByText('Factura B-4')).toBeNull();

    mockOwner = OWNER_B;
    publishFacturaSession({ user: { id: OWNER_B } });
    view.rerenderUi(<FacturasProveedorModal visible onClose={jest.fn()} />);
    expect(await screen.findByText('Factura B-4')).toBeTruthy();
    expect(screen.queryByText('Factura A-4')).toBeNull();

    mockOwner = OWNER_A;
    publishFacturaSession({ user: { id: OWNER_A } });
    view.rerenderUi(<FacturasProveedorModal visible onClose={jest.fn()} />);
    expect(await screen.findByText('Factura A-4')).toBeTruthy();
  });

  it('avisa de los borradores que no se pudieron leer sin mostrarlos como válidos', async () => {
    await leaveDraft(OWNER_A, DRAFT_1, 'A-5');
    await asyncStorage.setItem(`serrucho-factura-v1:${OWNER_A}:${DRAFT_2}`, '{no es json');

    renderModal();

    expect(await screen.findByText('Factura A-5')).toBeTruthy();
    expect(screen.getByText('Hay borradores en este dispositivo que no se pudieron leer.')).toBeTruthy();
    expect(screen.queryByTestId(`factura-borrador-${DRAFT_2}`)).toBeNull();
  });

  it('lo ya confirmado por el servidor deja de aparecer como borrador', async () => {
    publishFacturaSession({ user: { id: OWNER_A } });
    backend.script.push({ data: { factura_id: DRAFT_1, version: 1, replay: false }, error: null, status: 200 });
    const controller = await facturaEditorService.acquire({ uid: OWNER_A, facturaId: DRAFT_1, draft: emptyDraft(DRAFT_1), savedDocumentPath: null });
    controller.edit(draft => ({ ...draft, numeroDocumento: 'A-6' }));
    await controller.save();
    await controller.close();
    await leaveDraft(OWNER_A, DRAFT_2, 'A-7');

    renderModal();

    // Waiting for the pending draft proves the list loaded; the acknowledged one must be absent from it.
    expect(await screen.findByTestId(`factura-borrador-${DRAFT_2}`)).toBeTruthy();
    expect(screen.queryByTestId(`factura-borrador-${DRAFT_1}`)).toBeNull();
  });
});
