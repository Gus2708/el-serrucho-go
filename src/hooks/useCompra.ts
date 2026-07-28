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

// Draft para retomar un BORRADOR guardado ("lista sin terminar"): la fila ya
// existe en compras_app con status='borrador' — el backend la ignora porque su
// listener filtra status=eq.emitido. Al emitir se actualiza esa misma fila a
// 'emitido' en vez de crear una nueva. El proveedor puede venir null: se puede
// guardar la lista antes de decidir a quién se le compra.
export interface CompraBorradorDraft {
  borradorId:      number;
  titulo:          string;
  proveedorCodigo: string | null;
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
  titulo:           string;   // nombre del borrador ("Reposición tornillería")
  numeroDocumento:  string;   // opcional; vacío = el backend usa el id de la compra
  isLoading:        boolean;
  editingCompraId:  number | null;   // != null => reintentar una compra existente (update, no insert)
  borradorId:       number | null;   // != null => se está armando sobre un borrador guardado
  setProveedor:      (codigo: string, nombre: string) => void;
  addItem:           (item: CompraDraftItem) => void;
  removeItem:        (codigo: string) => void;
  updateItem:        (codigo: string, updates: Partial<CompraDraftItem>) => void;
  setNota:           (nota: string) => void;
  setTitulo:         (titulo: string) => void;
  setNumeroDocumento: (numero: string) => void;
  clear:             () => void;
  loadForEdit:       (draft: CompraEditDraft) => void;
  loadBorrador:      (draft: CompraBorradorDraft) => void;
  saveDraft:         (userId: string, titulo: string) => Promise<{ compraId: number }>;
  submit:            (userId: string) => Promise<{ compraId: number }>;
}

export const useCompra = create<CompraStore>()((set, get) => ({
  proveedorCodigo: null,
  proveedorNombre: null,
  items:           [],
  nota:            '',
  titulo:          '',
  numeroDocumento: '',
  isLoading:       false,
  editingCompraId: null,
  borradorId:      null,

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

  setTitulo: (titulo) => set({ titulo }),

  setNumeroDocumento: (numero) => set({ numeroDocumento: numero }),

  clear: () => set({
    proveedorCodigo: null, proveedorNombre: null, items: [], nota: '', titulo: '', numeroDocumento: '', editingCompraId: null, borradorId: null,
  }),

  loadForEdit: (draft) => set({
    editingCompraId: draft.compraId,
    borradorId:      null,
    proveedorCodigo: draft.proveedorCodigo,
    proveedorNombre: draft.proveedorNombre,
    nota:            draft.nota,
    titulo:          '',
    numeroDocumento: draft.numeroDocumento,
    items:           draft.items,
  }),

  // Retomar un borrador guardado: la fila ya existe, así que submit() la
  // actualizará a status='emitido' en vez de crear una compra nueva.
  loadBorrador: (draft) => set({
    editingCompraId: null,
    borradorId:      draft.borradorId,
    proveedorCodigo: draft.proveedorCodigo,
    proveedorNombre: draft.proveedorNombre,
    nota:            draft.nota,
    titulo:          draft.titulo,
    numeroDocumento: draft.numeroDocumento,
    items:           draft.items,
  }),

  // Guarda la lista a medio armar como fila status='borrador'. El backend la
  // ignora (listener_compras filtra status=eq.emitido), así que no se registra
  // en Hybrid hasta que el usuario la retome y la emita. Solo exige ítems: el
  // proveedor es opcional a propósito, se puede cotizar antes de decidirlo.
  saveDraft: async (userId: string, titulo: string) => {
    const { proveedorCodigo, proveedorNombre, items, nota, numeroDocumento, borradorId } = get();

    if (items.length === 0) throw new Error('Agrega al menos un producto antes de guardar el borrador.');

    const nombre = titulo.trim();
    if (!nombre) throw new Error('Ponle un nombre al borrador para reconocerlo después.');

    const cabecera = {
      proveedor_codigo: proveedorCodigo,
      proveedor_nombre: proveedorNombre,
      nota:             nota || null,
      numero_documento: numeroDocumento.trim() || null,
      titulo:           nombre,
      status:           'borrador',
      actualizado_en:   new Date().toISOString(),
    };

    set({ isLoading: true });

    try {
      let compraId: number;

      if (borradorId === null) {
        const { data, error } = await supabase
          .from('compras_app')
          .insert({ ...cabecera, creado_por: userId })
          .select('id')
          .single();
        if (error || !data) throw error ?? new Error('No compra id');
        compraId = data.id;
      } else {
        compraId = borradorId;

        const { error: updateError } = await supabase
          .from('compras_app')
          .update(cabecera)
          .eq('id', borradorId);
        if (updateError) throw updateError;

        const { error: deleteItemsError } = await supabase
          .from('compras_app_items')
          .delete()
          .eq('compra_id', borradorId);
        if (deleteItemsError) throw deleteItemsError;
      }

      const { error: itemsError } = await supabase
        .from('compras_app_items')
        .insert(buildItemRows(compraId, items));
      if (itemsError) throw itemsError;

      set({ isLoading: false, borradorId: compraId, titulo: nombre });
      return { compraId };
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  submit: async (userId: string) => {
    const { proveedorCodigo, proveedorNombre, items, nota, numeroDocumento, editingCompraId, borradorId } = get();

    if (!proveedorCodigo) throw new Error('Selecciona un proveedor antes de emitir la compra.');
    if (items.length === 0) throw new Error('Agrega al menos un producto antes de emitir la compra.');

    set({ isLoading: true });

    // Dos casos usan la MISMA fila en vez de insertar una nueva: reintentar una
    // compra que falló (editingCompraId) y emitir un borrador guardado
    // (borradorId). En ambos se reemplazan los items y se reencola con
    // backend_intentos en 0 (fresh retry, ver listener_compras.MAX_INTENTOS);
    // status='emitido' es lo que hace que el listener por fin la vea.
    const existingId = editingCompraId ?? borradorId;

    if (existingId !== null) {
      try {
        const { error: updateError } = await supabase
          .from('compras_app')
          .update({
            proveedor_codigo:    proveedorCodigo,
            proveedor_nombre:    proveedorNombre,
            nota:                nota || null,
            numero_documento:    numeroDocumento.trim() || null,
            status:              'emitido',
            backend_status:      'pendiente',
            backend_resultado:   null,
            backend_intentos:    0,
            backend_aplicado_en: null,
          })
          .eq('id', existingId);
        if (updateError) throw updateError;

        const { error: deleteItemsError } = await supabase
          .from('compras_app_items')
          .delete()
          .eq('compra_id', existingId);
        if (deleteItemsError) throw deleteItemsError;

        const { error: itemsError } = await supabase
          .from('compras_app_items')
          .insert(buildItemRows(existingId, items));
        if (itemsError) throw itemsError;

        set({ isLoading: false });
        return { compraId: existingId };
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
        .insert(buildItemRows(compra.id, items));

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

function buildItemRows(compraId: number, items: CompraDraftItem[]): Record<string, unknown>[] {
  return items.map(item => ({
    compra_id:       compraId,
    codigo_producto: item.codigo_producto,
    descripcion:     item.es_nuevo ? item.descripcion.toUpperCase() : item.descripcion,
    cantidad:        item.cantidad,
    costo:           item.costo,
    precio:          item.precio,
    referencia:      item.referencia,
    es_nuevo:        item.es_nuevo,
  }));
}
