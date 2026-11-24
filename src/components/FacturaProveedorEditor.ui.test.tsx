import * as React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import FacturaProveedorEditor from './FacturaProveedorEditor';
import type { FacturaCamaraFotoProps } from './FacturaCamaraFoto';

let mockPhone = false;
jest.mock('../hooks/useDeviceSize', () => ({
  useDeviceSize: () => ({ width: mockPhone ? 390 : 1280, height: 844, isDesktop: !mockPhone }),
}));
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
jest.mock('./FacturaCamaraFoto', () => ({
  __esModule: true,
  default: (props: FacturaCamaraFotoProps) => {
    (globalThis as unknown as { __fotoProps: FacturaCamaraFotoProps }).__fotoProps = props;
    return null;
  },
}));
// The review panel has its own suite; here only the editor's wiring around it is exercised.
jest.mock('./FacturaRevisionView', () => {
  const { useState } = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: (props: { onDirtyChange?: (dirty: boolean) => void }) => {
      const [marcada, setMarcada] = useState(false);
      (globalThis as unknown as { __revisionProps: unknown }).__revisionProps = props;
      return (
        <View>
          <Pressable testID="revision-stub" onPress={() => props.onDirtyChange?.(true)}>
            <Text>{marcada ? 'revision-marcada' : 'revision-stub'}</Text>
          </Pressable>
          <Pressable testID="revision-stub-marcar" onPress={() => setMarcada(true)}>
            <Text>marcar</Text>
          </Pressable>
        </View>
      );
    },
  };
});
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
  mockPhone = false;
  resetBackend();
  (DocumentPicker.getDocumentAsync as jest.Mock).mockReset();
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

function fotoProps(): FacturaCamaraFotoProps {
  return (globalThis as unknown as { __fotoProps: FacturaCamaraFotoProps }).__fotoProps;
}

const fotoResultado = { ok: true as const, bytes: new Uint8Array([37, 80, 68, 70, 45, 49]), nombre: 'captura.pdf' };

describe('photo camera entry integration', () => {
  it('opens explicitly and attaches captured bytes without reading or saving the invoice', async () => {
    await openEditor();
    expect(fotoProps()?.visible).not.toBe(true);
    await press(screen.getByTestId('factura-tomar-foto'));
    expect(fotoProps().visible).toBe(true);
    expect(backend.bucket.upload).not.toHaveBeenCalled();
    await act(async () => fotoProps().onCapturada(fotoResultado));
    await settle();
    expect(backend.bucket.upload).toHaveBeenCalledTimes(1);
    expect(screen.getByText('captura.pdf')).toBeTruthy();
    expect(fotoProps().visible).toBe(false);
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('ignores a captured callback after cancellation', async () => {
    await openEditor();
    await press(screen.getByTestId('factura-tomar-foto'));
    const previous = fotoProps();
    await act(async () => previous.onClose());
    await act(async () => previous.onCapturada(fotoResultado));
    expect(backend.bucket.upload).not.toHaveBeenCalled();
  });

  it('ignores a captured callback after the owner session changes', async () => {
    await openEditor();
    await press(screen.getByTestId('factura-tomar-foto'));
    const previous = fotoProps();
    await act(async () => publishFacturaSession({ user: { id: OWNER_B } }));
    expect(previous.estaVigente()).toBe(false);
    await act(async () => previous.onCapturada(fotoResultado));
    expect(backend.bucket.upload).not.toHaveBeenCalled();
  });

  it('uses the existing document picker when the camera is unavailable', async () => {
    await openEditor();
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({ canceled: true });
    await press(screen.getByTestId('factura-tomar-foto'));
    await act(async () => fotoProps().onNoDisponible?.());
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(1);
    expect(fotoProps().visible).toBe(false);
    expect(backend.bucket.upload).not.toHaveBeenCalled();
  });
});

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

/** "Más datos" holds the control number and notes; it is collapsed while both are empty. */
async function openMasDatos(): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId('factura-mas-datos'));
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
    await openMasDatos();
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
    expect(screen.getByText('Subir foto o PDF')).toBeTruthy();
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

    await pressText('Subir foto o PDF');
    await settle();

    expect(backend.bucket.upload).toHaveBeenCalledTimes(1);
    const uploadedPath = backend.bucket.upload.mock.calls[0][0] as string;
    expect(uploadedPath.startsWith(`${OWNER_A}/${facturaId}/`)).toBe(true);
    expect(uploadedPath.endsWith('.pdf')).toBe(true);
    expect(screen.getByText('factura-norte.pdf')).toBeTruthy();

    await pressText('Guardar y continuar');
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

    await pressText('Subir foto o PDF');
    await settle();

    expect(screen.getByText('No se pudo subir el archivo. Inténtalo otra vez.')).toBeTruthy();
    expect(screen.getByText('Subir foto o PDF')).toBeTruthy();

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

const SHA = 'c'.repeat(64);
const record = (facturaId: string, withDocument = true, overrides: Record<string, unknown> = {}) => ({
  id: facturaId,
  version: 2,
  proveedor_codigo: null,
  proveedor_nombre: 'Proveedor Uno',
  numero_documento: 'A-1',
  numero_control: null,
  fecha_documento: null,
  moneda: 'USD',
  notas: null,
  documento_path: withDocument ? `${OWNER_A}/${facturaId}/d.pdf` : null,
  documento_nombre: withDocument ? 'factura.pdf' : null,
  documento_mime: withDocument ? ('application/pdf' as const) : null,
  documento_bytes: withDocument ? 2048 : null,
  documento_sha256: withDocument ? SHA : null,
  lineas: [],
  ...overrides,
});
const revisionProps = (): Record<string, unknown> => (globalThis as unknown as { __revisionProps: Record<string, unknown> }).__revisionProps;

describe('compact invoice targets', () => {
  it('keeps the supplier on its own visible line on a phone without changing data', async () => {
    mockPhone = true;
    await openSaved();
    expect(screen.getByTestId('factura-title')).toHaveTextContent('Factura A-1');
    expect(screen.getByTestId('factura-supplier-title')).toHaveTextContent('Proveedor Uno');
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('gives every attachment action a minimum 44-point touch target', async () => {
    await openSaved();
    for (const id of ['factura-ver-documento', 'factura-replace', 'factura-quitar-documento']) {
      expect(screen.getByTestId(id)).toHaveStyle({ minHeight: 44 });
    }
  });

  it('preserves the full desktop invoice heading', async () => {
    await openSaved();
    expect(screen.getByText('Factura A-1 · Proveedor Uno')).toBeTruthy();
    expect(screen.queryByTestId('factura-supplier-title')).toBeNull();
  });
});

async function openSaved(withDocument = true, overrides: Record<string, unknown> = {}) {
  const facturaId = nextFactura();
  const onClose = jest.fn();
  const view = renderWithProviders(
    <FacturaProveedorEditor facturaId={facturaId} record={record(facturaId, withDocument, overrides)} ownerId={OWNER_A} onClose={onClose} onReload={jest.fn()} />,
  );
  await screen.findByLabelText('Número de factura');
  return { facturaId, onClose, ...view };
}

describe('revisión asistida (puente con el editor)', () => {
  it('does not offer the review for an unsaved invoice, and manual entry stays complete', async () => {
    await openEditor();
    expect(screen.queryByTestId('factura-abrir-revision')).toBeNull();
    expect(screen.getByText(/Guarda la factura para leerla y revisar sus productos/)).toBeTruthy();
    type('Número de factura', 'A-1');
    expect(value('Número de factura')).toBe('A-1');
    expect(screen.queryByTestId('revision-stub')).toBeNull();
  });

  it('opens the review only on request and hands it the saved version, document SHA and manual dirty state', async () => {
    const { facturaId } = await openSaved();
    expect(screen.queryByTestId('revision-stub')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-abrir-revision'));
    });
    expect(screen.getByTestId('revision-stub')).toBeTruthy();
    expect(revisionProps()).toMatchObject({ facturaId, ownerId: OWNER_A, facturaVersion: 2, editorDirty: false, documento: expect.objectContaining({ sha256: SHA }) });

    // The form is hidden while the review is the active step; editing it means going back to step 1.
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-paso-factura'));
    });
    await openMasDatos();
    type('Notas', 'cambio manual sin guardar');
    expect(revisionProps()).toMatchObject({ editorDirty: true });
  });

  it('hands the review no document when the saved invoice has none', async () => {
    await openSaved(false);
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-abrir-revision'));
    });
    expect(revisionProps()).toMatchObject({ documento: null, facturaVersion: 2 });
  });

  it('guards closing while the review has unsaved changes, without touching the manual draft flow', async () => {
    const { onClose } = await openSaved();
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-abrir-revision'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('revision-stub'));
    });
    await pressLabel('Cerrar factura');
    expect(onClose).not.toHaveBeenCalled();
    const [title, message] = alert.mock.calls[alert.mock.calls.length - 1] as [string, string];
    expect(title).toBe('Cerrar con cambios sin guardar');
    expect(message).toMatch(/revisión asistida/);
    await pressAlertButton(alert, 'Cerrar');
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes immediately when neither the manual form nor the review has unsaved changes', async () => {
    const { onClose } = await openSaved();
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-abrir-revision'));
    });
    await pressLabel('Cerrar factura');
    await settle();
    expect(alert).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function pasoState(paso: string): { selected?: boolean; disabled?: boolean } {
  return screen.getByTestId(`factura-paso-${paso}`).props.accessibilityState;
}

async function openReview(withDocument = true): ReturnType<typeof openSaved> {
  const opened = await openSaved(withDocument);
  await act(async () => {
    fireEvent.press(screen.getByTestId('factura-abrir-revision'));
  });
  return opened;
}

function pickNextDocument(): void {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
    canceled: false,
    assets: [{ name: 'factura-norte.pdf', size: 6, uri: 'file:///cache/factura-norte.pdf' }],
  });
}

describe('pasos guiados', () => {
  it('muestra el paso Factura seleccionado, bloquea los demás hasta guardar y no enseña versiones', async () => {
    await openEditor();

    expect(pasoState('factura')).toMatchObject({ selected: true });
    ['leer', 'productos', 'compra'].forEach(paso => expect(pasoState(paso)).toMatchObject({ disabled: true, selected: false }));
    expect(screen.queryByText('nueva')).toBeNull();
  });

  it('una factura guardada habilita los pasos, titula con número y proveedor y no enseña la versión', async () => {
    await openSaved();

    ['leer', 'productos', 'compra'].forEach(paso => expect(pasoState(paso)).toMatchObject({ disabled: false }));
    expect(screen.getByText('Factura A-1 · Proveedor Uno')).toBeTruthy();
    expect(screen.queryByText('v2')).toBeNull();
  });

  it('con documento, Guardar y continuar guarda y pasa a Leer con la revisión montada', async () => {
    const { facturaId } = await openEditor();
    pickNextDocument();
    scriptRpc(committed(facturaId, 1));
    await pressText('Subir foto o PDF');
    await settle();

    await pressText('Guardar y continuar');
    await settle();

    expect(backend.rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('revision-stub')).toBeTruthy();
    expect(revisionProps()).toMatchObject({ facturaVersion: 1, etapa: 'leer' });
    expect(pasoState('leer')).toMatchObject({ selected: true });
    expect(screen.queryByLabelText('Número de factura')).toBeNull();
  });

  it('si el guardado falla, Guardar y continuar se queda en el paso Factura sin montar la revisión', async () => {
    await openEditor();
    pickNextDocument();
    scriptRpc(new Error('Network request failed'));
    await pressText('Subir foto o PDF');
    await settle();

    await pressText('Guardar y continuar');
    await settle();

    expect(screen.queryByTestId('revision-stub', { includeHiddenElements: true })).toBeNull();
    expect(pasoState('factura')).toMatchObject({ selected: true });
  });

  it('abre la revisión desde un paso posterior con esa etapa elegida', async () => {
    await openSaved();

    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-paso-productos'));
    });

    expect(screen.getByTestId('revision-stub')).toBeTruthy();
    expect(revisionProps()).toMatchObject({ etapa: 'productos' });
    expect(pasoState('productos')).toMatchObject({ selected: true });
  });

  it('volver al paso Factura oculta la revisión sin desmontarla y conserva su estado', async () => {
    await openReview();
    await act(async () => {
      fireEvent.press(screen.getByTestId('revision-stub-marcar'));
    });
    expect(screen.getByText('revision-marcada')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-paso-factura'));
    });
    expect(screen.queryByTestId('revision-stub')).toBeNull();
    expect(screen.getByTestId('revision-stub', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText('Número de factura')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-paso-leer'));
    });
    expect(screen.getByText('revision-marcada')).toBeTruthy();
  });

  it('la revisión elige la etapa desde dentro y la etapa sobrevive a pasar por Factura', async () => {
    await openReview();

    await act(async () => {
      (revisionProps().onEtapaChange as (etapa: string) => void)('productos');
    });
    expect(pasoState('productos')).toMatchObject({ selected: true });
    expect(revisionProps()).toMatchObject({ etapa: 'productos' });

    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-paso-factura'));
    });
    expect(revisionProps()).toMatchObject({ etapa: 'productos' });
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-paso-compra'));
    });
    expect(revisionProps()).toMatchObject({ etapa: 'compra' });
    expect(pasoState('compra')).toMatchObject({ selected: true });
  });

  it('Seguir a mano vuelve al paso Factura con los renglones manuales abiertos', async () => {
    await openReview();
    expect(screen.queryByTestId('factura-add-linea')).toBeNull();

    await act(async () => {
      (revisionProps().onSeguirManual as () => void)();
    });

    expect(pasoState('factura')).toMatchObject({ selected: true });
    expect(screen.getByTestId('factura-add-linea')).toBeTruthy();
  });

  it('los cambios sin guardar de la revisión siguen protegiendo el cierre desde el paso Factura', async () => {
    const { onClose } = await openReview();
    await act(async () => {
      fireEvent.press(screen.getByTestId('revision-stub'));
    });
    expect(screen.getByTestId('factura-revision-pill')).toHaveTextContent('Revisión sin guardar');
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Guardada');

    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-paso-factura'));
    });
    await pressLabel('Cerrar factura');

    expect(onClose).not.toHaveBeenCalled();
    const [title, message] = alert.mock.calls[alert.mock.calls.length - 1] as [string, string];
    expect(title).toBe('Cerrar con cambios sin guardar');
    expect(message).toMatch(/revisión asistida/);
  });

  it('los cambios manuales marcan el estado y no se pierden al cambiar de paso', async () => {
    await openReview();
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-paso-factura'));
    });
    type('Número de factura', 'A-77');
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Factura sin guardar');

    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-paso-leer'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-paso-factura'));
    });

    expect(value('Número de factura')).toBe('A-77');
    expect(revisionProps()).toMatchObject({ editorDirty: true });
  });
});

describe('paso Factura: entrada guiada', () => {
  it('con documento ofrece Continuar y no promete que solo se guarda', async () => {
    await openSaved();

    expect(screen.getByTestId('factura-abrir-revision')).toBeTruthy();
    expect(screen.getByText('Continuar')).toBeTruthy();
    expect(screen.queryByText(/solo se guarda/)).toBeNull();
    expect(screen.queryByText(/No se lee ni se crea ninguna compra/)).toBeNull();
    expect(screen.getByText(/Se lee solo cuando tú lo pides/)).toBeTruthy();
  });

  it('la entrada manual guardada dice dónde registrar la compra y sigue pudiéndose abrir la revisión', async () => {
    const { facturaId } = await openEditor();
    scriptRpc(committed(facturaId, 1));
    type('Número de factura', 'A-20');
    await pressText('Guardar factura');
    await settle();

    expect(screen.getByText('Factura guardada. Registra la compra desde Compras como siempre.')).toBeTruthy();
    expect(screen.getByTestId('factura-abrir-revision')).toBeTruthy();
  });

  it('con documento y sin renglones, la carga manual está plegada hasta pedirla', async () => {
    await openSaved();
    expect(screen.queryByTestId('factura-add-linea')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-manual-toggle'));
    });

    expect(screen.getByTestId('factura-add-linea')).toBeTruthy();
    expect(screen.getByText('RENGLONES (0)')).toBeTruthy();
  });

  it('control y notas están plegados en Más datos salvo que ya tengan contenido', async () => {
    await openEditor();
    expect(screen.queryByLabelText('Notas')).toBeNull();
    expect(screen.queryByLabelText('Número de control')).toBeNull();

    await openMasDatos();

    expect(screen.getByLabelText('Notas')).toBeTruthy();
    expect(screen.getByLabelText('Número de control')).toBeTruthy();
  });

  it('un borrador con notas restaura Más datos abierto', async () => {
    const facturaId = nextFactura();
    const first = await openEditor(facturaId);
    await openMasDatos();
    type('Notas', 'nota guardada');
    await settle();
    await pressLabel('Cerrar factura');
    await pressAlertButton(alert, 'Cerrar');
    await settle();
    first.unmount();

    await openEditor(facturaId);

    expect(value('Notas')).toBe('nota guardada');
  });
});

const CABECERA = { proveedorNombre: 'PROVEEDOR UNO C.A', numeroDocumento: '48615', fechaEmision: '2026-11-20' };
type Cabecera = { proveedorNombre: string | null; numeroDocumento: string | null; fechaEmision: string | null };

async function openSavedImagen(overrides: Record<string, unknown> = {}) {
  const facturaId = nextFactura();
  const view = renderWithProviders(
    <FacturaProveedorEditor
      facturaId={facturaId}
      record={record(facturaId, true, {
        documento_path: `${OWNER_A}/${facturaId}/d.jpg`,
        documento_nombre: 'factura.jpg',
        documento_mime: 'image/jpeg',
        ...overrides,
      })}
      ownerId={OWNER_A}
      onClose={jest.fn()}
      onReload={jest.fn()}
    />,
  );
  await screen.findByLabelText('Número de factura');
  return { facturaId, ...view };
}

async function emitirCabecera(cabecera: Cabecera | null): Promise<void> {
  await act(async () => {
    (revisionProps().onCabeceraLeida as (value: Cabecera | null) => void)(cabecera);
  });
}

async function irAFactura(): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId('factura-paso-factura'));
  });
}

async function openCabecera(overrides: Record<string, unknown> = {}, cabecera: Cabecera | null = CABECERA): ReturnType<typeof openSaved> {
  const opened = await openSaved(true, overrides);
  await act(async () => {
    fireEvent.press(screen.getByTestId('factura-abrir-revision'));
  });
  await emitirCabecera(cabecera);
  await irAFactura();
  return opened;
}

describe('visor del documento (puente con el editor)', () => {
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });
  afterEach(() => {
    openURL.mockRestore();
  });

  it('Ver opens the full-screen viewer with a freshly signed image, not a fixed inline preview', async () => {
    const { facturaId } = await openSavedImagen();
    await press(screen.getByTestId('factura-ver-documento'));
    await settle();

    expect(backend.bucket.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(backend.bucket.createSignedUrl.mock.calls[0][0]).toBe(`${OWNER_A}/${facturaId}/d.jpg`);
    expect(screen.getByTestId('factura-visor')).toBeTruthy();
    expect(screen.getByTestId('factura-visor-imagen').props.source).toMatchObject({ uri: 'https://private.test/doc' });
  });

  it('keeps a tappable thumbnail with an enlargement hint that opens the viewer and signs again', async () => {
    await openSavedImagen();
    await press(screen.getByTestId('factura-ver-documento'));
    await settle();
    await press(screen.getByTestId('factura-visor-cerrar'));

    expect(screen.queryByTestId('factura-visor')).toBeNull();
    expect(screen.getByText('Toca para ampliar')).toBeTruthy();
    await press(screen.getByTestId('factura-documento-miniatura'));
    await settle();

    expect(screen.getByTestId('factura-visor')).toBeTruthy();
    expect(backend.bucket.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('opens the same viewer when the review asks for it, without extracting anything', async () => {
    await openSavedImagen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-abrir-revision'));
    });
    expect(screen.queryByTestId('factura-visor')).toBeNull();
    expect(backend.bucket.createSignedUrl).not.toHaveBeenCalled();

    await act(async () => {
      (revisionProps().onVerDocumento as () => void)();
    });
    await settle();

    expect(screen.getByTestId('factura-visor')).toBeTruthy();
    expect(backend.bucket.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('ignores a review request to view a document the invoice does not have', async () => {
    await openReview(false);
    await act(async () => {
      (revisionProps().onVerDocumento as () => void)();
    });
    await settle();
    expect(screen.queryByTestId('factura-visor')).toBeNull();
    expect(backend.bucket.createSignedUrl).not.toHaveBeenCalled();
  });

  it('never opens the viewer by itself when the review reports a read header', async () => {
    await openSavedImagen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-abrir-revision'));
    });
    await emitirCabecera(CABECERA);
    expect(screen.queryByTestId('factura-visor')).toBeNull();
    expect(backend.bucket.createSignedUrl).not.toHaveBeenCalled();
  });

  it('sends a PDF to the system opener through the safe URL check', async () => {
    await openSaved();
    await press(screen.getByTestId('factura-ver-documento'));
    await settle();

    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('https://private.test/doc');
    expect(screen.getByText('El PDF se abre en otra pestaña o app.')).toBeTruthy();
  });

  it('refuses an unsafe signed URL', async () => {
    backend.bucket.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'javascript:alert(1)' }, error: null });
    await openSaved();
    await press(screen.getByTestId('factura-ver-documento'));
    await settle();

    expect(openURL).not.toHaveBeenCalled();
    expect(screen.getByText('No se pudo abrir la factura.')).toBeTruthy();
  });

  it('discards a signed URL that arrives after the session changed', async () => {
    const reply = deferred<{ data: { signedUrl: string }; error: null }>();
    backend.bucket.createSignedUrl.mockReturnValueOnce(reply.promise);
    await openSavedImagen();
    await press(screen.getByTestId('factura-ver-documento'));
    await act(async () => publishFacturaSession({ user: { id: OWNER_B } }));
    await act(async () => {
      reply.resolve({ data: { signedUrl: 'https://private.test/otra-sesion' }, error: null });
    });
    await settle();

    expect(screen.queryByTestId('factura-visor-imagen')).toBeNull();
    expect(screen.queryByTestId('factura-documento-miniatura')).toBeNull();
  });

  it('discards a signed URL that arrives after the viewer was closed', async () => {
    const reply = deferred<{ data: { signedUrl: string }; error: null }>();
    backend.bucket.createSignedUrl.mockReturnValueOnce(reply.promise);
    await openSavedImagen();
    await press(screen.getByTestId('factura-ver-documento'));
    await press(screen.getByTestId('factura-visor-cerrar'));
    await act(async () => {
      reply.resolve({ data: { signedUrl: 'https://private.test/tarde' }, error: null });
    });
    await settle();

    expect(screen.queryByTestId('factura-visor')).toBeNull();
    expect(screen.queryByTestId('factura-documento-miniatura')).toBeNull();
  });

  it('does not sign or open anything when the owner session is no longer current', async () => {
    await openSavedImagen();
    await act(async () => publishFacturaSession({ user: { id: OWNER_B } }));
    await press(screen.getByTestId('factura-ver-documento'));
    await settle();

    expect(backend.bucket.createSignedUrl).not.toHaveBeenCalled();
    expect(screen.queryByTestId('factura-visor')).toBeNull();
  });

  it('closes the viewer and drops the thumbnail when the document is removed', async () => {
    await openSavedImagen();
    await press(screen.getByTestId('factura-ver-documento'));
    await settle();
    await press(screen.getByTestId('factura-quitar-documento'));
    await settle();

    expect(screen.queryByTestId('factura-visor')).toBeNull();
    expect(screen.queryByTestId('factura-documento-miniatura')).toBeNull();
  });

  it('discards the URL signed for a document that was replaced while signing', async () => {
    const reply = deferred<{ data: { signedUrl: string }; error: null }>();
    backend.bucket.createSignedUrl.mockReturnValueOnce(reply.promise);
    await openSavedImagen();
    await press(screen.getByTestId('factura-ver-documento'));
    pickNextDocument();
    await press(screen.getByTestId('factura-replace'));
    await settle();
    await act(async () => {
      reply.resolve({ data: { signedUrl: 'https://private.test/documento-viejo' }, error: null });
    });
    await settle();

    expect(screen.queryByTestId('factura-visor')).toBeNull();
    expect(screen.queryByTestId('factura-documento-miniatura')).toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  });
});

describe('cabecera leída (atribución y adopción explícita)', () => {
  it('receiving the read header never dirties the draft, saves, or prompts', async () => {
    await openSaved();
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-abrir-revision'));
    });
    await emitirCabecera(CABECERA);

    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Guardada');
    expect(screen.queryByTestId('factura-revision-pill')).toBeNull();
    expect(screen.queryByText(/sin guardar/)).toBeNull();
    expect(revisionProps()).toMatchObject({ editorDirty: false });
    expect(backend.rpc).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('labels each read value next to the typed one only when they differ', async () => {
    await openCabecera({ fecha_documento: null }, { ...CABECERA, proveedorNombre: 'Proveedor Uno' });

    expect(screen.queryByTestId('factura-leido-proveedorNombre')).toBeNull();
    expect(screen.getByTestId('factura-leido-numeroDocumento')).toHaveTextContent('Leído de la foto: 48615 · Escrito: A-1');
    expect(screen.getByTestId('factura-leido-fechaDocumento')).toHaveTextContent('Leído de la foto: 2026-11-20');
    expect(screen.getByTestId('factura-leido-fechaDocumento')).not.toHaveTextContent('Escrito');
  });

  it('labels a supplier name that differs from the typed one', async () => {
    await openCabecera();
    expect(screen.getByTestId('factura-leido-proveedorNombre')).toHaveTextContent('Leído de la foto: PROVEEDOR UNO C.A · Escrito: Proveedor Uno');
  });

  it('shows no read value and no adoption once the review reports null', async () => {
    await openCabecera({ fecha_documento: null });
    expect(screen.getByTestId('factura-completar-leido')).toBeTruthy();
    await emitirCabecera(null);

    expect(screen.queryByTestId('factura-leido-fechaDocumento')).toBeNull();
    expect(screen.queryByTestId('factura-completar-leido')).toBeNull();
  });

  it('adopts the read values only into empty fields, after an explicit confirmation that warns about the new version', async () => {
    await openCabecera({ fecha_documento: null });
    await press(screen.getByText('Completar campos vacíos con lo leído'));

    const [, message] = alert.mock.calls[alert.mock.calls.length - 1] as [string, string];
    expect(message).toMatch(/solo los campos vacíos/);
    expect(message).toMatch(/cambia de versión/);
    expect(message).toMatch(/volver a guardar y aprobar/);
    expect(value('Fecha')).toBe('');
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Guardada');

    await pressAlertButton(alert, 'Completar');

    expect(value('Fecha')).toBe('2026-11-20');
    expect(value('Número de factura')).toBe('A-1');
    expect(value('Proveedor')).toBe('Proveedor Uno');
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Factura sin guardar');
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('leaves the draft untouched when the confirmation is declined', async () => {
    await openCabecera({ fecha_documento: null });
    await press(screen.getByTestId('factura-completar-leido'));
    await pressAlertButton(alert, 'Ahora no');

    expect(value('Fecha')).toBe('');
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Guardada');
    expect(screen.queryByText(/sin guardar/)).toBeNull();
  });

  it('never overwrites what was typed while the confirmation was open', async () => {
    await openCabecera({ fecha_documento: null, numero_documento: null });
    await press(screen.getByTestId('factura-completar-leido'));
    type('Fecha', '2030-01-01');
    await pressAlertButton(alert, 'Completar');

    expect(value('Fecha')).toBe('2030-01-01');
    expect(value('Número de factura')).toBe('48615');
  });

  it('treats whitespace-only fields as empty and keeps typed supplier text', async () => {
    await openCabecera({ fecha_documento: null, numero_documento: '  ' });
    await press(screen.getByTestId('factura-completar-leido'));
    await pressAlertButton(alert, 'Completar');

    expect(value('Número de factura')).toBe('48615');
    expect(value('Proveedor')).toBe('Proveedor Uno');
  });

  it('does not offer adoption when no typed field is empty or nothing was read for it', async () => {
    await openCabecera({ fecha_documento: '2026-11-01' });
    expect(screen.queryByTestId('factura-completar-leido')).toBeNull();

    await emitirCabecera({ proveedorNombre: null, numeroDocumento: null, fechaEmision: null });
    expect(screen.queryByTestId('factura-completar-leido')).toBeNull();
  });

  it('does not offer adoption when the only empty field has no read value', async () => {
    await openCabecera({ fecha_documento: null }, { ...CABECERA, fechaEmision: null });
    expect(screen.queryByTestId('factura-completar-leido')).toBeNull();
  });

  it('hides the read header of a document that was replaced', async () => {
    await openCabecera({ fecha_documento: null });
    expect(screen.getByTestId('factura-leido-fechaDocumento')).toBeTruthy();

    pickNextDocument();
    await press(screen.getByTestId('factura-replace'));
    await settle();

    expect(screen.queryByTestId('factura-leido-fechaDocumento')).toBeNull();
    expect(screen.queryByTestId('factura-completar-leido')).toBeNull();
  });

  it('ignores a read header delivered after the owner session changed', async () => {
    await openSaved();
    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-abrir-revision'));
    });
    await act(async () => publishFacturaSession({ user: { id: OWNER_B } }));
    await emitirCabecera(CABECERA);
    await irAFactura();

    expect(screen.queryByTestId('factura-leido-numeroDocumento')).toBeNull();
  });
});

describe('título y estado por origen', () => {
  it('titles with the read number marked as read only while the typed number is empty', async () => {
    await openCabecera({ numero_documento: null });
    expect(screen.getByText('Factura 48615 (leída) · Proveedor Uno')).toBeTruthy();

    type('Número de factura', 'A-9');
    expect(screen.getByText('Factura A-9 · Proveedor Uno')).toBeTruthy();
  });

  it('keeps the plain title when nothing was read', async () => {
    await openSaved(true, { numero_documento: null });
    expect(screen.getByText('Factura de proveedor · Proveedor Uno')).toBeTruthy();
  });

  it('separates the invoice and review unsaved states and shows both when both apply', async () => {
    await openReview();
    await act(async () => {
      fireEvent.press(screen.getByTestId('revision-stub'));
    });
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Guardada');
    expect(screen.getByTestId('factura-revision-pill')).toHaveTextContent('Revisión sin guardar');

    await irAFactura();
    type('Número de factura', 'A-5');
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Factura sin guardar');
    expect(screen.getByTestId('factura-revision-pill')).toHaveTextContent('Revisión sin guardar');
  });

  it('shows only the invoice state when only the form changed', async () => {
    await openSaved();
    type('Número de factura', 'A-6');
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Factura sin guardar');
    expect(screen.queryByTestId('factura-revision-pill')).toBeNull();
  });

  it('reopening a saved invoice with no edits shows Guardada and no unsaved state, also after opening the review', async () => {
    await openSaved();
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Guardada');
    expect(screen.queryByText(/sin guardar/)).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('factura-abrir-revision'));
    });
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Guardada');
    expect(screen.queryByText(/sin guardar/)).toBeNull();
  });

  it('shows Borrador for an invoice that was never saved', async () => {
    await openEditor();
    expect(screen.getByTestId('factura-estado-pill')).toHaveTextContent('Borrador');
  });
});
