import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface CompraDraftItem {
  codigo_producto: string;
  descripcion:     string;
  cantidad:        number;
  costo:           number;
  precio:          number;
  referencia:      string | null;   // opcional; null para productos existentes
  es_nuevo:        boolean;         // true = producto a dar de alta en Hybrid
}

export interface CompraEditDraft {
  compraId:        number;
  proveedorCodigo: string;
  proveedorNombre: string | null;
  nota:            string;
  numeroDocumento: string;
  items:           CompraDraftItem[];
}

interface CompraStore {
  proveedorCodigo:  string | null;
  proveedorNombre:  string | null;
  items:            CompraDraftItem[];
  nota:             string;
  numeroDocumento:  string;   // opcional; vacío = el backend usa el id de la compra
  isLoading:        boolean;
  editingCompraId:  number | null;   // != null => reintentar una compra existente (update, no insert)
  setProveedor:      (codigo: string, nombre: string) => void;
  addItem:           (item: CompraDraftItem) => void;
  removeItem:        (codigo: string) => void;
  updateItem:        (codigo: string, updates: Partial<CompraDraftItem>) => void;
  setNota:           (nota: string) => void;
  setNumeroDocumento: (numero: string) => void;
  clear:             () => void;
  loadForEdit:       (draft: CompraEditDraft) => void;
  submit:            (userId: string) => Promise<{ compraId: number }>;
}

export const useCompra = create<CompraStore>()((set, get) => ({
  proveedorCodigo: null,
  proveedorNombre: null,
  items:           [],
  nota:            '',
  numeroDocumento: '',
  isLoading:       false,
  editingCompraId: null,

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

  setNumeroDocumento: (numero) => set({ numeroDocumento: numero }),

  clear: () => set({
    proveedorCodigo: null, proveedorNombre: null, items: [], nota: '', numeroDocumento: '', editingCompraId: null,
  }),

  loadForEdit: (draft) => set({
    editingCompraId: draft.compraId,
    proveedorCodigo: draft.proveedorCodigo,
    proveedorNombre: draft.proveedorNombre,
    nota:            draft.nota,
    numeroDocumento: draft.numeroDocumento,
    items:           draft.items,
  }),

  submit: async (userId: string) => {
    const { proveedorCodigo, proveedorNombre, items, nota, numeroDocumento, editingCompraId } = get();

    if (!proveedorCodigo) throw new Error('Selecciona un proveedor antes de emitir la compra.');
    if (items.length === 0) throw new Error('Agrega al menos un producto antes de emitir la compra.');

    const itemRows = (compraId: number) => items.map(item => ({
      compra_id:       compraId,
      codigo_producto: item.codigo_producto,
      descripcion:     item.es_nuevo ? item.descripcion.toUpperCase() : item.descripcion,
      cantidad:        item.cantidad,
      costo:           item.costo,
      precio:          item.precio,
      referencia:      item.referencia,
      es_nuevo:        item.es_nuevo,
    }));

    set({ isLoading: true });

    // Reintento de una compra que falló: actualiza la MISMA cabecera y
    // reemplaza sus items, en vez de crear una compra nueva -- evita
    // duplicar el registro en el historial y reencola la existente con
    // backend_intentos en 0 (fresh retry, ver listener_compras.MAX_INTENTOS).
    if (editingCompraId !== null) {
      try {
        const { error: updateError } = await supabase
          .from('compras_app')
          .update({
            proveedor_codigo:    proveedorCodigo,
            proveedor_nombre:    proveedorNombre,
            nota:                nota || null,
            numero_documento:    numeroDocumento.trim() || null,
            backend_status:      'pendiente',
            backend_resultado:   null,
            backend_intentos:    0,
            backend_aplicado_en: null,
          })
          .eq('id', editingCompraId);
        if (updateError) throw updateError;

        const { error: deleteItemsError } = await supabase
          .from('compras_app_items')
          .delete()
          .eq('compra_id', editingCompraId);
        if (deleteItemsError) throw deleteItemsError;

        const { error: itemsError } = await supabase
          .from('compras_app_items')
          .insert(itemRows(editingCompraId));
        if (itemsError) throw itemsError;

        set({ isLoading: false });
        return { compraId: editingCompraId };
      } catch (err) {
        set({ isLoading: false });
        throw err;
      }
    }

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
          numero_documento:  numeroDocumento.trim() || null,   // vacío -> el backend usa el id de la compra
          status:            'emitido',
        })
        .select('id')
        .single();

      if (compraError || !compra) throw compraError ?? new Error('No compra id');
      createdCompraId = compra.id;

      // 2. Insert all items
      const { error: itemsError } = await supabase
        .from('compras_app_items')
        .insert(itemRows(compra.id));

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
