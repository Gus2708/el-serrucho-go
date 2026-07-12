import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface CompraDraftItem {
  codigo_producto: string;
  descripcion:     string;
  cantidad:        number;
  costo:           number;
  precio:          number;
}

interface CompraStore {
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  items:           CompraDraftItem[];
  nota:            string;
  isLoading:       boolean;
  setProveedor: (codigo: string, nombre: string) => void;
  addItem:      (item: CompraDraftItem) => void;
  removeItem:   (codigo: string) => void;
  updateItem:   (codigo: string, updates: Partial<CompraDraftItem>) => void;
  setNota:      (nota: string) => void;
  clear:        () => void;
  submit:       (userId: string) => Promise<{ compraId: number }>;
}

export const useCompra = create<CompraStore>()((set, get) => ({
  proveedorCodigo: null,
  proveedorNombre: null,
  items:           [],
  nota:            '',
  isLoading:       false,

  setProveedor: (codigo, nombre) => set({ proveedorCodigo: codigo, proveedorNombre: nombre }),

  addItem: (item) => {
    const { items } = get();
    const existing = items.find(i => i.codigo_producto === item.codigo_producto);
    if (existing) {
      set({ items: items.map(i => i.codigo_producto === item.codigo_producto ? { ...existing, ...item } : i) });
    } else {
      set({ items: [...items, item] });
    }
  },

  removeItem: (codigo) => {
    set({ items: get().items.filter(i => i.codigo_producto !== codigo) });
  },

  updateItem: (codigo, updates) => {
    set({ items: get().items.map(i => i.codigo_producto === codigo ? { ...i, ...updates } : i) });
  },

  setNota: (nota) => set({ nota }),

  clear: () => set({ proveedorCodigo: null, proveedorNombre: null, items: [], nota: '' }),

  submit: async (userId: string) => {
    const { proveedorCodigo, proveedorNombre, items, nota } = get();

    if (!proveedorCodigo) throw new Error('Selecciona un proveedor antes de emitir la compra.');
    if (items.length === 0) throw new Error('Agrega al menos un producto antes de emitir la compra.');

    set({ isLoading: true });

    let createdCompraId: number | null = null;

    try {
      // 1. Create the compra header
      const { data: compra, error: compraError } = await supabase
        .from('compras_app')
        .insert({
          creado_por:       userId,
          proveedor_codigo: proveedorCodigo,
          proveedor_nombre: proveedorNombre,
          nota:              nota || null,
          status:            'emitido',
        })
        .select('id')
        .single();

      if (compraError || !compra) throw compraError ?? new Error('No compra id');
      createdCompraId = compra.id;

      // 2. Insert all items
      const { error: itemsError } = await supabase
        .from('compras_app_items')
        .insert(
          items.map(item => ({
            compra_id:       compra.id,
            codigo_producto: item.codigo_producto,
            descripcion:     item.descripcion,
            cantidad:        item.cantidad,
            costo:           item.costo,
            precio:          item.precio,
          }))
        );

      if (itemsError) throw itemsError;

      set({ isLoading: false });
      return { compraId: compra.id };
    } catch (err) {
      if (createdCompraId !== null) {
        await supabase
          .from('compras_app')
          .delete()
          .eq('id', createdCompraId)
          .then(({ error }) => {
            if (error) console.warn('[useCompra] cleanup failed:', error.message);
          });
      }
      set({ isLoading: false });
      throw err;
    }
  },
}));
