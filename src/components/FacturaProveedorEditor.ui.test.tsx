import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import FacturaProveedorEditor from './FacturaProveedorEditor';
import { facturaEditorService, listFacturaBorradores, publishFacturaSession } from '../hooks/useFacturasProveedor';
import { createDraft } from '../lib/facturaProveedor';
import { buildDocumentPath } from '../lib/facturaDocumento';
import {
  FACTURA_1,
  OWNER_A,
  OWNER_B,
  backend,
  committed,
  deferred,
  pressAlertButton,
  renderWithProviders,
  resetBackend,
  scriptRpc,
  settle,
  spyOnAlert,
  storageFaults,
  storedRecords,
  asyncStorage,
  type RpcAnswer,
} from '../test-utils/facturaUiHarness';

jest.mock('../lib/supabase', () => ({ supabase: require('../test-utils/facturaUiHarness').backend.client }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('../test-utils/facturaUiHarness').asyncStorage,
}));

const SAVED_ON_SERVER = 'Guardada en el servidor.';
const SAVED_ON_DEVICE = 'Guardado en este dispositivo';
const NOT_SENT = 'No se pudo guardar en este dispositivo; no se envió.';
const NO_RESPONSE =
  'No se recibió respuesta del servidor. La factura sigue en este dispositivo; vuelve a guardar para confirmar.';
const SESSION_CHANGED = 'La sesión cambió; no se envió nada. Inicia sesión con la cuenta de esta factura.';
const IN_PROGRESS = 'Hay una operación en curso; espera a que termine antes de cerrar o descartar.';
const UPLOAD_INTERRUPTED = 'Carga interrumpida: el archivo no se adjuntó. Vuelve a adjuntarlo.';

let facturaCounter = 0;
function nextFactura(): string {
  facturaCounter += 1;
  return `f1000000-0000-4000-8000-${String(facturaCounter).padStart(12, '0')}`;
}

let alert: jest.SpyInstance;

beforeEach(() => {
  resetBackend();
  alert = spyOnAlert();
  publishFacturaSession({ user: { id: OWNER_A } });
});

afterEach(() => {
  alert.mockRestore();
});

interface Opened {
  facturaId: string;
  onClose: jest.Mock;
  onReload: jest.Mock;
}

async function openEditor(facturaId = nextFactura(), ownerId = OWNER_A): Promise<Opened & ReturnType<typeof renderWithProviders>> {
  const onClose = jest.fn();
  const onReload = jest.fn();
  const view = renderWithProviders(
    <FacturaProveedorEditor facturaId={facturaId} record={null} ownerId={ownerId} onClose={onClose} onReload={onReload} />,
  );
  await screen.findByLabelText('Número de factura');
  return { ...view, facturaId, onClose, onReload };
}

function type(label: string, text: string, index = 0): void {
  fireEvent.changeText(screen.getAllByLabelText(label)[index], text);
}

function value(label: string, index = 0): string {
  return screen.getAllByLabelText(label)[index].props.value as string;
}

async function press(target: ReturnType<typeof screen.getByText>): Promise<void> {
  await act(async () => {
    fireEvent.press(target);
  });
}

const pressText = async (text: string): Promise<void> => press(screen.getByText(text));

async function pressLabel(label: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(label));
  });
}

function rpcArgs(call = 0): { p_clave: string; p_version_esperada: number; p_cabecera: Record<string, unknown>; p_lineas: Array<Record<string, unknown>> } {
  return backend.rpc.mock.calls[call][1] as never;
}

describe('guardado con respuesta pendiente', () => {
  it('lo escrito mientras el servidor responde sobrevive a la confirmación y no viaja en ese envío', async () => {
    const reply = deferred<RpcAnswer>();
    const { facturaId } = await openEditor();
    scriptRpc(reply.promise);
    type('Número de factura', 'A-1');

    await pressText('Guardar factura');
    await waitFor(() => expect(backend.rpc).toHaveBeenCalledTimes(1));
    type('Notas', 'escrito durante el envío');
    await act(async () => {
      reply.resolve(committed(facturaId, 1));
    });
    await settle();

    expect(value('Notas')).toBe('escrito durante el envío');
    expect(value('Número de factura')).toBe('A-1');
    expect(rpcArgs().p_cabecera).toMatchObject({ numero_documento: 'A-1', notas: null });
    expect(screen.getByText('Guardar factura')).toBeTruthy();
    expect(screen.queryByText('Sin cambios')).toBeNull();
  });

  it('una segunda pulsación mientras se guarda no envía otra vez', async () => {
    const reply = deferred<RpcAnswer>();
    const { facturaId } = await openEditor();
    scriptRpc(reply.promise);
    type('Número de factura', 'A-2');

    await pressText('Guardar factura');
    expect(screen.getByTestId('factura-save').props.accessibilityState).toMatchObject({ disabled: true });
    await pressText('Guardar factura');
    await settle();
    await act(async () => {
      reply.resolve(committed(facturaId, 1));
    });
    await settle();

    expect(backend.rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByText(SAVED_ON_SERVER)).toBeTruthy();
  });

  it('no deja cerrar mientras el envío está en curso y deja cerrar al terminar', async () => {
    const reply = deferred<RpcAnswer>();
    const { facturaId, onClose } = await openEditor();
    scriptRpc(reply.promise);
    type('Número de factura', 'A-3');
    await pressText('Guardar factura');
    await waitFor(() => expect(backend.rpc).toHaveBeenCalledTimes(1));

    await pressLabel('Cerrar factura');

    expect(onClose).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(screen.getByText(IN_PROGRESS)).toBeTruthy();

    await act(async () => {
      reply.resolve(committed(facturaId, 1));
    });
    await settle();
    await pressLabel('Cerrar factura');
    await settle();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('estado local frente al servidor', () => {
  it('distingue lo guardado en el dispositivo de lo confirmado por el servidor', async () => {
    const { facturaId } = await openEditor();
    scriptRpc(committed(facturaId, 1));

    type('Número de factura', 'A-4');
    await settle();
    expect(screen.getByText(SAVED_ON_DEVICE)).toBeTruthy();
    expect(screen.queryByText(SAVED_ON_SERVER)).toBeNull();

    await pressText('Guardar factura');
    await settle();

    expect(screen.getByText(SAVED_ON_SERVER)).toBeTruthy();
    expect(screen.getByText('Sin cambios')).toBeTruthy();
  });

  it('guarda sin adjunto y envía el documento como ausente', async () => {
    const { facturaId, invalidate } = await openEditor();
    scriptRpc(committed(facturaId, 1));
    type('Proveedor', 'Ferretería Norte');

    await pressText('Guardar factura');
    await settle();

    expect(backend.rpc).toHaveBeenCalledTimes(1);
    expect(rpcArgs()).toMatchObject({ p_version_esperada: 0 });
    expect(rpcArgs().p_cabecera).toMatchObject({ proveedor_nombre: 'Ferretería Norte', documento: null });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['facturas-proveedor', 'lista'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['facturas-proveedor', 'borradores', OWNER_A] });
  });

  it('con datos inválidos marca los campos y no envía nada', async () => {
    await openEditor();
    type('Fecha', '31/12/2026');

    await pressText('Guardar factura');
    await settle();

    expect(backend.rpc).not.toHaveBeenCalled();
    expect(screen.getByText('Revisa los campos marcados en rojo.')).toBeTruthy();
    expect(screen.getByText('Usa el formato AAAA-MM-DD')).toBeTruthy();
  });
});

describe('almacenamiento y respuestas perdidas', () => {
  it('si el dispositivo no puede guardar, no envía y deja reintentar sin perder lo escrito', async () => {
    const { facturaId } = await openEditor();
    scriptRpc(committed(facturaId, 1));
    storageFaults.failWrites = true;
    type('Número de factura', 'A-5');

    await pressText('Guardar factura');
    await settle();

    expect(backend.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(NOT_SENT)).toBeTruthy();
    expect(screen.queryByText(SAVED_ON_SERVER)).toBeNull();
    expect(value('Número de factura')).toBe('A-5');

    storageFaults.failWrites = false;
    await pressText('Reintentar');
    await settle();

    expect(backend.rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByText(SAVED_ON_SERVER)).toBeTruthy();
  });

  it('si la respuesta se pierde, Reintentar reenvía exactamente la misma intención', async () => {
    const { facturaId } = await openEditor();
    scriptRpc(new Error('Network request failed'), committed(facturaId, 1, true));
    type('Número de factura', 'A-6');

    await pressText('Guardar factura');
    await settle();
    expect(screen.getByText(NO_RESPONSE)).toBeTruthy();

    await pressText('Reintentar');
    await settle();

    expect(backend.rpc).toHaveBeenCalledTimes(2);
    expect(backend.rpc.mock.calls[1]).toEqual(backend.rpc.mock.calls[0]);
    expect(screen.getByText('Ya estaba guardada en el servidor.')).toBeTruthy();
  });

  it('una carga que la sesión anterior dejó a medias se avisa y no se adjunta', async () => {
    const facturaId = nextFactura();
    const path = buildDocumentPath(OWNER_A, facturaId, 'd0000000-0000-4000-8000-0000000000a1', 'application/pdf');
    await asyncStorage.setItem(
      `serrucho-factura-v1:${OWNER_A}:${facturaId}`,
      JSON.stringify({
        schema: 1,
        uid: OWNER_A,
        facturaId,
        seq: 1,
        draft: { facturaId, version: 0, proveedorCodigo: '', proveedorNombre: '', numeroDocumento: 'A-7', numeroControl: '', fechaDocumento: '', moneda: 'USD', notas: '', documento: null, lineas: [] },
        savedDocumentPath: null,
        intent: null,
        uploads: [{ path, status: 'pending' }],
        protectedPaths: [path],
        dirty: true,
      }),
    );

    await openEditor(facturaId);

    expect(screen.getByText(UPLOAD_INTERRUPTED)).toBeTruthy();
    expect(value('Número de factura')).toBe('A-7');
    expect(screen.queryByText('Reemplazar')).toBeNull();
    expect(screen.getByText('Adjuntar PDF o imagen')).toBeTruthy();
  });
});

describe('cerrar y descartar', () => {
  it('cerrar con cambios pide confirmar, conserva el borrador local y no envía nada', async () => {
    const { facturaId, onClose } = await openEditor();
    type('Número de factura', 'A-8');
    await settle();

    await pressLabel('Cerrar factura');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Cerrar con cambios sin guardar');
    expect(onClose).not.toHaveBeenCalled();

    await pressAlertButton(alert, 'Cerrar');
    await settle();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(backend.rpc).not.toHaveBeenCalled();
    const drafts = await listFacturaBorradores(OWNER_A);
    expect(drafts.drafts.map(record => record.facturaId)).toEqual([facturaId]);
    expect(drafts.drafts[0].draft.numeroDocumento).toBe('A-8');
  });

  it('Seguir editando mantiene el editor abierto', async () => {
    const { onClose } = await openEditor();
    type('Número de factura', 'A-9');

    await pressLabel('Cerrar factura');
    await pressAlertButton(alert, 'Seguir editando');

    expect(onClose).not.toHaveBeenCalled();
    expect(value('Número de factura')).toBe('A-9');
  });

  it('descartar exige confirmación explícita y deja de mostrar el borrador', async () => {
    const { onClose } = await openEditor();
    type('Número de factura', 'A-10');
    await settle();

    await pressLabel('Descartar borrador');
    expect(alert.mock.calls[0][0]).toBe('Descartar borrador');
    await pressAlertButton(alert, 'Seguir editando');
    expect(onClose).not.toHaveBeenCalled();
    expect((await listFacturaBorradores(OWNER_A)).drafts).toHaveLength(1);

    await pressLabel('Descartar borrador');
    await pressAlertButton(alert, 'Descartar');
    await settle();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect((await listFacturaBorradores(OWNER_A)).drafts).toEqual([]);
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('salir sin pulsar Cerrar (atrás del sistema) conserva el borrador', async () => {
    const facturaId = nextFactura();
    const first = await openEditor(facturaId);
    type('Número de factura', 'A-11');
    await settle();

    const controller = await facturaEditorService.acquire({ uid: OWNER_A, facturaId, draft: createDraft({ facturaId }), savedDocumentPath: null });
    first.unmount();
    await settle();

    // The editor released its controller: a stale handle can no longer change the draft.
    expect(() => controller.edit(draft => draft)).toThrow(RangeError);
    const drafts = await listFacturaBorradores(OWNER_A);
    expect(drafts.drafts.map(record => record.facturaId)).toEqual([facturaId]);
    await openEditor(facturaId);
    expect(value('Número de factura')).toBe('A-11');
  });
});

describe('reconstrucción completa desde el dispositivo', () => {
  it('restaura campos, renglones repetidos con sus ids y el orden exacto', async () => {
    const facturaId = nextFactura();
    const first = await openEditor(facturaId);
    type('Proveedor', 'Ferretería Norte');
    type('Número de factura', 'A-12');
    await pressText('Agregar renglón');
    await pressText('Agregar renglón');
    type('Código interno (SKU)', 'SKU-1', 0);
    type('Cantidad', '2', 0);
    type('Código interno (SKU)', 'SKU-1', 1);
    type('Cantidad', '5', 1);
    type('Costo unitario (USD)', '12,50', 1);
    await settle();
    const idsBefore = (storedRecords()[0] as { draft: { lineas: Array<{ lineaId: string }> } }).draft.lineas.map(linea => linea.lineaId);
    expect(new Set(idsBefore).size).toBe(2);

    await pressLabel('Cerrar factura');
    await pressAlertButton(alert, 'Cerrar');
    await settle();
    first.unmount();
    await openEditor(facturaId);

    expect(value('Proveedor')).toBe('Ferretería Norte');
    expect(value('Número de factura')).toBe('A-12');
    expect(screen.getByText('RENGLONES (2)')).toBeTruthy();
    expect([value('Código interno (SKU)', 0), value('Código interno (SKU)', 1)]).toEqual(['SKU-1', 'SKU-1']);
    expect([value('Cantidad', 0), value('Cantidad', 1)]).toEqual(['2', '5']);
    expect(value('Costo unitario (USD)', 1)).toBe('12,50');
    const idsAfter = (storedRecords()[0] as { draft: { lineas: Array<{ lineaId: string }> } }).draft.lineas.map(linea => linea.lineaId);
    expect(idsAfter).toEqual(idsBefore);
  });
});

describe('cuenta de la sesión', () => {
  it('si la cuenta cambia con el editor abierto no envía nada a nombre de otra', async () => {
    await openEditor();
    type('Número de factura', 'A-13');

    publishFacturaSession({ user: { id: OWNER_B } });
    await pressText('Guardar factura');
    await settle();

    expect(backend.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(SESSION_CHANGED)).toBeTruthy();
    expect(storedRecords().every(record => (record as { uid: string }).uid === OWNER_A)).toBe(true);
  });

  it('sin sesión publicada el editor falla cerrado', async () => {
    publishFacturaSession(null);
    await openEditor();
    type('Número de factura', 'A-14');

    await pressText('Guardar factura');
    await settle();

    expect(backend.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(SESSION_CHANGED)).toBeTruthy();
    expect(storedRecords()).toEqual([]);
  });
});

describe('adjunto opcional y entrada manual', () => {
  it('sube el archivo al almacenamiento privado, lo muestra y lo envía al guardar', async () => {
    const { facturaId } = await openEditor();
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ name: 'factura-norte.pdf', size: 6, uri: 'file:///cache/factura-norte.pdf' }],
    });
    scriptRpc(committed(facturaId, 1));

    await pressText('Adjuntar PDF o imagen');
    await settle();

    expect(backend.bucket.upload).toHaveBeenCalledTimes(1);
    const uploadedPath = backend.bucket.upload.mock.calls[0][0] as string;
    expect(uploadedPath.startsWith(`${OWNER_A}/${facturaId}/`)).toBe(true);
    expect(uploadedPath.endsWith('.pdf')).toBe(true);
    expect(screen.getByText('factura-norte.pdf')).toBeTruthy();

    await pressText('Guardar factura');
    await settle();

    expect((rpcArgs().p_cabecera.documento as { path: string; mime: string }).path).toBe(uploadedPath);
    expect((rpcArgs().p_cabecera.documento as { mime: string }).mime).toBe('application/pdf');
  });

  it('un archivo que no se puede subir se avisa y la factura se sigue pudiendo guardar sin él', async () => {
    const { facturaId } = await openEditor();
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ name: 'factura-norte.pdf', size: 6, uri: 'file:///cache/factura-norte.pdf' }],
    });
    backend.bucket.upload.mockResolvedValueOnce({ data: null as never, error: { message: 'offline' } });
    scriptRpc(committed(facturaId, 1));

    await pressText('Adjuntar PDF o imagen');
    await settle();

    expect(screen.getByText('No se pudo subir el archivo. Inténtalo otra vez.')).toBeTruthy();
    expect(screen.getByText('Adjuntar PDF o imagen')).toBeTruthy();

    type('Número de factura', 'A-15');
    await pressText('Guardar factura');
    await settle();

    expect(rpcArgs().p_cabecera).toMatchObject({ numero_documento: 'A-15', documento: null });
  });

  it('la entrada manual con importes en USD viaja normalizada y con etiquetas explícitas', async () => {
    const { facturaId } = await openEditor();
    scriptRpc(committed(facturaId, 1));
    await pressText('Agregar renglón');
    type('Descripción', 'Tornillo 1/4');
    type('Cantidad', '3');
    type('Costo unitario (USD)', '12,50');
    type('Total del renglón (USD)', '37,5');

    expect(screen.getByText(/Importes en USD\./)).toBeTruthy();

    await pressText('Guardar factura');
    await settle();

    expect(rpcArgs().p_lineas).toHaveLength(1);
    expect(rpcArgs().p_lineas[0]).toMatchObject({
      descripcion: 'Tornillo 1/4',
      cantidad_documento: '3',
      costo_unitario_documento: '12.5',
      total_documento: '37.5',
    });
    expect(rpcArgs().p_cabecera.moneda).toBe('USD');
  });
});

describe('identificadores para pruebas de extremo a extremo', () => {
  it('expone ids estables en las acciones y en los campos', async () => {
    await openEditor(FACTURA_1);
    await pressText('Agregar renglón');

    expect(screen.getByTestId('factura-editor')).toBeTruthy();
    expect(screen.getByTestId('factura-save')).toBeTruthy();
    expect(screen.getByTestId('factura-close')).toBeTruthy();
    expect(screen.getByTestId('factura-discard')).toBeTruthy();
    expect(screen.getByTestId('factura-attach')).toBeTruthy();
    expect(screen.getByTestId('factura-field-numeroDocumento')).toBeTruthy();
    expect(screen.getByTestId('factura-linea-0-cantidad')).toBeTruthy();
  });
});
