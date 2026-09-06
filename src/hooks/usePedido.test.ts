(global as any).__DEV__ = true;
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
  withSupabaseRetry: jest.fn(),
}));

import { buildItemRows, precioManual, PedidoDraftItem } from './usePedido';

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
