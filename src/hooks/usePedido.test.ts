(global as any).__DEV__ = true;
// Captura las filas que submit() manda a pedidos_app_items. El prefijo `mock`
// es lo unico que jest deja referenciar dentro de una factory de jest.mock.
const mockItemInserts: unknown[][] = [];

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn((tabla: string) => ({
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: (filas: unknown[]) => {
        if (tabla === 'pedidos_app_items') mockItemInserts.push(filas);
        // Insertar la cabecera encadena .select('id').single(); insertar items
        // se espera con await. Este objeto sirve para los dos.
        return {
          select: () => ({ single: () => Promise.resolve({ data: { id: 123 }, error: null }) }),
          then: (resolve: (r: { error: null }) => void) => resolve({ error: null }),
        };
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    })),
    rpc: jest.fn(() => Promise.resolve({ error: null })),
  },
}));

// El de verdad reintenta con espera; aca ejecuta la llamada y ya.
jest.mock('../lib/retry', () => ({
  withSupabaseRetry: (fn: () => unknown) => fn(),
}));

jest.mock('../demo/useDemoStore', () => ({
  isDemoActive: () => false,
}));

import { buildItemRows, precioManual, PedidoDraftItem, usePedido } from './usePedido';

describe('usePedido price resolution for writeback', () => {
  const sampleItems: PedidoDraftItem[] = [
    {
      codigo_producto: '01404',
      descripcion: 'Item 1',
      cantidad: 1,
      precio_base_usd: 19.99,
      precio_unitario: 19.99,
    },
    {
      codigo_producto: '03618',
      descripcion: 'Item 2',
      cantidad: 3,
      precio_base_usd: 7.50,
      precio_unitario: 7.50,
    },
    {
      codigo_producto: '00001',
      descripcion: 'Item 3',
      cantidad: 1,
      precio_base_usd: 1.00,
      precio_unitario: 1.00,
    },
  ];

  describe('precioManual', () => {
    it('returns null when price equals base price (tolerance 0.005)', () => {
      expect(precioManual(sampleItems[0])).toBeNull();
    });

    it('returns formatted number when price was changed manually', () => {
      const itemWithManualPrice: PedidoDraftItem = {
        ...sampleItems[0],
        precio_unitario: 22.50,
      };
      expect(precioManual(itemWithManualPrice)).toBe(22.50);
    });
  });

  describe('buildItemRows for Hybrid POS', () => {
    it('when enBs is false, preserves null for default master prices', () => {
      const rows = buildItemRows(100, sampleItems, false, 30);
      expect(rows).toEqual([
        {
          pedido_id: 100,
          codigo_producto: '01404',
          descripcion: 'Item 1',
          cantidad: 1,
          precio: null,
        },
        {
          pedido_id: 100,
          codigo_producto: '03618',
          descripcion: 'Item 2',
          cantidad: 3,
          precio: null,
        },
        {
          pedido_id: 100,
          codigo_producto: '00001',
          descripcion: 'Item 3',
          cantidad: 1,
          precio: null,
        },
      ]);
    });

    it('when enBs is true, applies markupPct (e.g. +30%) to prices so writeback types it into POS', () => {
      const rows = buildItemRows(100, sampleItems, true, 30);
      expect(rows).toEqual([
        {
          pedido_id: 100,
          codigo_producto: '01404',
          descripcion: 'Item 1',
          cantidad: 1,
          precio: 25.99, // 19.99 * 1.30 = 25.987 -> 25.99
        },
        {
          pedido_id: 100,
          codigo_producto: '03618',
          descripcion: 'Item 2',
          cantidad: 3,
          precio: 9.75, // 7.50 * 1.30 = 9.75
        },
        {
          pedido_id: 100,
          codigo_producto: '00001',
          descripcion: 'Item 3',
          cantidad: 1,
          precio: 1.30, // 1.00 * 1.30 = 1.30
        },
      ]);
    });

    it('when enBs is true and an item has manual price override, calculates markup from that manual price', () => {
      const customItems: PedidoDraftItem[] = [
        {
          codigo_producto: '01404',
          descripcion: 'Item 1',
          cantidad: 1,
          precio_base_usd: 10.00,
          precio_unitario: 12.00,
        },
      ];
      const rows = buildItemRows(100, customItems, true, 30);
      expect(rows[0].precio).toBe(15.60); // 12.00 * 1.30 = 15.60
    });
  });
});

// El bug que motiva estos tests: buildItemRows tiene enBs y markupPct con valor
// por defecto, asi que un punto de llamada al que se le olvide pasarlos compila
// limpio, pasa el typecheck y guarda precios en dolares sin recargo. Los tests
// de arriba prueban buildItemRows sola y no ven nada. Estos ejercitan submit(),
// que es donde estaba el olvido.
describe('usePedido submit sends Bs prices down every path', () => {
  const items: PedidoDraftItem[] = [
    {
      codigo_producto: '01404',
      descripcion: 'Item 1',
      cantidad: 1,
      precio_base_usd: 19.99,
      precio_unitario: 19.99,
    },
  ];

  beforeEach(() => {
    mockItemInserts.length = 0;
    usePedido.setState({
      clienteCodigo:       'C-1',
      clienteNombre:       'Cliente 1',
      items,
      nota:                '',
      enBs:                true,
      markupPct:           30,
      editingPedidoId:     null,
      borradorId:          null,
      presupuestoOrigenId: null,
      isLoading:           false,
    });
  });

  it('applies the markup when creating a new pedido', async () => {
    await usePedido.getState().submit('user-1');

    expect(mockItemInserts).toHaveLength(1);
    expect((mockItemInserts[0] as Array<{ precio: number | null }>)[0].precio).toBe(25.99);
  });

  it('applies the markup when re-emitting a pedido that already exists', async () => {
    // editingPedidoId es el reintento de un pedido que fallo; borradorId es
    // emitir un borrador guardado. Los dos caen en la misma rama de submit().
    usePedido.setState({ editingPedidoId: 77 });

    await usePedido.getState().submit('user-1');

    expect(mockItemInserts).toHaveLength(1);
    expect((mockItemInserts[0] as Array<{ precio: number | null }>)[0].precio).toBe(25.99);
  });

  it('applies the markup when emitting a saved draft', async () => {
    usePedido.setState({ borradorId: 88 });

    await usePedido.getState().submit('user-1');

    expect(mockItemInserts).toHaveLength(1);
    expect((mockItemInserts[0] as Array<{ precio: number | null }>)[0].precio).toBe(25.99);
  });
});
