const mockRpc = jest.fn();
const mockDeviceStorage = new Map<string, string>();
let mockUuidCounter = 0;

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDeviceStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockDeviceStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      mockDeviceStorage.delete(key);
    },
    getAllKeys: async () => [...mockDeviceStorage.keys()],
  },
}));

jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

jest.mock('../lib/facturaDocumentoPicker', () => ({
  newUuid: () => `d0000000-0000-4000-8000-${String((mockUuidCounter += 1)).padStart(12, '0')}`,
  sha256Hex: async () => 'f'.repeat(64),
}));

import { addLinea, createDraft } from '../lib/facturaProveedor';
import {
  facturaEditorService,
  facturaRepository,
  getFacturaSessionUid,
  isPendingDraft,
  listFacturaBorradores,
  publishFacturaSession,
  selectFacturaStorage,
  setFacturaSessionUid,
  useFacturaRecord,
  useFacturasList,
  useGuardarFactura,
} from './useFacturasProveedor';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const LINE = 'a0000000-0000-4000-8000-000000000001';

function invoiceId(n: number): string {
  return `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function open(n: number, uid = OWNER) {
  const facturaId = invoiceId(n);
  const draft = addLinea(createDraft({ facturaId }), LINE, { codigoProducto: 'SKU-1', cantidad: '2' });
  return facturaEditorService.acquire({ uid, facturaId, draft, savedDocumentPath: null });
}

beforeEach(() => {
  mockRpc.mockReset();
  mockDeviceStorage.clear();
  setFacturaSessionUid(null);
});

describe('facturaEditorService (cableado real: repositorio, almacen del dispositivo y sesion)', () => {
  it('entrega el mismo controlador por cuenta y factura y guarda por el RPC real', async () => {
    setFacturaSessionUid(OWNER);
    mockRpc.mockResolvedValueOnce({ data: { factura_id: invoiceId(1), version: 1, replay: false }, error: null, status: 200 });

    const [a, b] = await Promise.all([open(1), open(1)]);
    a.edit(draft => ({ ...draft, numeroDocumento: 'A-1' }));
    const outcome = await a.save();

    expect(b).toBe(a);
    expect(outcome).toMatchObject({ status: 'saved', version: 1 });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][0]).toBe('guardar_factura_proveedor');
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_factura_id: invoiceId(1), p_version_esperada: 0 });
    expect([...mockDeviceStorage.keys()]).toEqual([`serrucho-factura-v1:${OWNER}:${invoiceId(1)}`]);
  });

  it('sin sesion registrada falla cerrado: no escribe ni envia', async () => {
    const controller = await open(2);
    controller.edit(draft => ({ ...draft, numeroDocumento: 'A-2' }));

    await expect(controller.save()).resolves.toMatchObject({ status: 'cuenta_cambiada' });
    await controller.persisted();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockDeviceStorage.size).toBe(0);
  });

  it('si la sesion cambia despues de abrir, el controlador no envia a nombre de otra cuenta', async () => {
    setFacturaSessionUid(OWNER);
    const controller = await open(3);
    setFacturaSessionUid(OTHER);

    await expect(controller.save()).resolves.toMatchObject({ status: 'cuenta_cambiada' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('un 502 deja la intencion en el dispositivo y el reintento la reenvia igual', async () => {
    setFacturaSessionUid(OWNER);
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: '', message: 'Bad Gateway' }, status: 502 })
      .mockResolvedValueOnce({ data: { factura_id: invoiceId(4), version: 1, replay: true }, error: null, status: 200 });
    const controller = await open(4);

    await expect(controller.save()).resolves.toMatchObject({ status: 'pending' });
    await expect(controller.save()).resolves.toMatchObject({ status: 'saved', replay: true });

    expect(mockRpc.mock.calls[1]).toEqual(mockRpc.mock.calls[0]);
  });
});

describe('sesion publicada por la raiz de autenticacion', () => {
  it('publica el uid real de la sesion y lo limpia al cerrar sesion', () => {
    publishFacturaSession({ user: { id: OWNER } });
    expect(getFacturaSessionUid()).toBe(OWNER);

    publishFacturaSession(null);
    expect(getFacturaSessionUid()).toBeNull();
  });

  it('un cambio de cuenta reemplaza el uid y las operaciones del controlador anterior fallan cerrado', async () => {
    publishFacturaSession({ user: { id: OWNER } });
    const controller = await open(5);
    controller.edit(draft => ({ ...draft, numeroDocumento: 'A-5' }));

    publishFacturaSession({ user: { id: OTHER } });

    expect(getFacturaSessionUid()).toBe(OTHER);
    await expect(controller.save()).resolves.toMatchObject({ status: 'cuenta_cambiada' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([[undefined], [{}], [{ user: {} }], [{ user: { id: '' } }]])('una sesion sin uid utilizable (%j) deja la sesion en null', session => {
    publishFacturaSession({ user: { id: OWNER } });

    publishFacturaSession(session as never);

    expect(getFacturaSessionUid()).toBeNull();
  });
});

describe('borradores locales: solo los que aun no estan en el servidor', () => {
  async function leaveDraft(n: number, uid: string, numero: string) {
    publishFacturaSession({ user: { id: uid } });
    const controller = await open(n, uid);
    controller.edit(draft => ({ ...draft, numeroDocumento: numero }));
    await controller.close();
  }

  it('lista el borrador sucio de la cuenta con su contenido exacto y su orden de renglones', async () => {
    await leaveDraft(10, OWNER, 'A-10');

    const result = await listFacturaBorradores(OWNER);

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].facturaId).toBe(invoiceId(10));
    expect(result.drafts[0].draft.numeroDocumento).toBe('A-10');
    expect(result.drafts[0].draft.lineas.map(linea => linea.lineaId)).toEqual([LINE]);
    expect(result.problems).toEqual([]);
  });

  it('oculta lo ya reconocido por el servidor y lo descartado, y muestra lo que sigue pendiente', async () => {
    publishFacturaSession({ user: { id: OWNER } });
    mockRpc.mockResolvedValue({ data: { factura_id: invoiceId(11), version: 1, replay: false }, error: null, status: 200 });
    const acknowledged = await open(11);
    acknowledged.edit(draft => ({ ...draft, numeroDocumento: 'A-11' }));
    await acknowledged.save();
    await acknowledged.close();
    const discarded = await open(12);
    discarded.edit(draft => ({ ...draft, numeroDocumento: 'A-12' }));
    await discarded.discard(true);
    await leaveDraft(13, OWNER, 'A-13');

    const result = await listFacturaBorradores(OWNER);

    expect(result.drafts.map(record => record.facturaId)).toEqual([invoiceId(13)]);
  });

  it('cada cuenta ve solo sus borradores', async () => {
    await leaveDraft(14, OWNER, 'A-14');
    await leaveDraft(15, OTHER, 'B-15');

    const own = await listFacturaBorradores(OWNER);
    const other = await listFacturaBorradores(OTHER);

    expect(own.drafts.map(record => record.facturaId)).toEqual([invoiceId(14)]);
    expect(other.drafts.map(record => record.facturaId)).toEqual([invoiceId(15)]);
  });

  it('informa los borradores ilegibles sin mostrarlos como validos', async () => {
    await leaveDraft(16, OWNER, 'A-16');
    mockDeviceStorage.set(`serrucho-factura-v1:${OWNER}:${invoiceId(17)}`, '{not json');

    const result = await listFacturaBorradores(OWNER);

    expect(result.drafts.map(record => record.facturaId)).toEqual([invoiceId(16)]);
    expect(result.problems.map(problem => problem.facturaId)).toEqual([invoiceId(17)]);
  });

  it('isPendingDraft: sucio o con envio sin resolver cuenta; limpio y sin envio no', () => {
    const record = (patch: object) => ({ draft: {}, intent: null, ...patch }) as never;
    const intent = { key: 'k', baseVersion: 0, payload: {}, documentPath: null };

    expect(isPendingDraft(record({ dirty: true }))).toBe(true);
    expect(isPendingDraft(record({}))).toBe(true);
    expect(isPendingDraft(record({ dirty: false, intent }))).toBe(true);
    expect(isPendingDraft(record({ dirty: false }))).toBe(false);
  });
});

describe('selectFacturaStorage', () => {
  const device = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(), getAllKeys: jest.fn() };

  function fakeLocalStorage(seed: Record<string, string>) {
    const data = new Map(Object.entries(seed));
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      get length() {
        return data.size;
      },
      key: (index: number) => [...data.keys()][index] ?? null,
    } as unknown as Storage;
  }

  it('usa el almacen del dispositivo fuera de la web', () => {
    expect(selectFacturaStorage('ios', device, () => fakeLocalStorage({}))).toBe(device);
    expect(selectFacturaStorage('android', device, () => fakeLocalStorage({}))).toBe(device);
  });

  it('envuelve localStorage en la web con la misma interfaz asincrona', async () => {
    const local = fakeLocalStorage({ a: '1', b: '2' });
    const storage = selectFacturaStorage('web', device, () => local);

    await storage.setItem('c', '3');
    await expect(storage.getItem('c')).resolves.toBe('3');
    await expect(storage.getItem('missing')).resolves.toBeNull();
    await storage.removeItem('a');
    await expect(storage.getAllKeys()).resolves.toEqual(['b', 'c']);
  });

  it('un localStorage que lanza llega como rechazo para que el almacen lo clasifique', async () => {
    const storage = selectFacturaStorage('web', device, () => {
      throw new Error('SecurityError');
    });

    await expect(storage.getItem('x')).rejects.toThrow('SecurityError');
  });
});

describe('compatibilidad con los llamadores existentes', () => {
  it('conserva las exportaciones que usan el editor y el modal', () => {
    expect(typeof useGuardarFactura).toBe('function');
    expect(typeof useFacturaRecord).toBe('function');
    expect(typeof useFacturasList).toBe('function');
    expect(Object.keys(facturaRepository).sort()).toEqual(
      ['abrir', 'guardar', 'limpiarHuerfano', 'listar', 'subirDocumento', 'urlDocumento'],
    );
  });
});
