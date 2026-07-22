import { create } from 'zustand';
import { supabase } from '../lib/supabase';

// Un ítem de pedido es simple: código + descripción + cantidad. NO lleva
// costo ni precio — el pedido usa el PRECIO MAESTRO del producto en Hybrid
// (a diferencia de la compra, ver useCompra). El backend (flujo_pedido_real)
// solo teclea código y cantidad en la pantalla de Pedidos.
export interface PedidoDraftItem {
  codigo_producto:  string;
  descripcion:      string;
  cantidad:         number;
  precio_unitario?: number;
  precio_base_usd?: number;
}

export interface PedidoEditDraft {
  pedidoId:      number;
  clienteCodigo: string;
  clienteNombre: string | null;
  nota:          string;
  items:         PedidoDraftItem[];
}

interface PedidoStore {
  clienteCodigo:   string | null;
  clienteNombre:   string | null;
  items:           PedidoDraftItem[];
  nota:            string;
  enBs:            boolean;
  modalOpen:       boolean;
  isLoading:       boolean;
  editingPedidoId: number | null;   // != null => reintentar un pedido existente (update, no insert)
  setCliente:      (codigo: string, nombre: string) => void;
  setEnBs:         (enBs: boolean) => void;
  setModalOpen:    (open: boolean) => void;
  addItem:         (item: PedidoDraftItem) => void;
  removeItem:      (codigo: string) => void;
  updateItem:      (codigo: string, updates: Partial<PedidoDraftItem>) => void;
  setNota:         (nota: string) => void;
  clear:           () => void;
  loadForEdit:     (draft: PedidoEditDraft) => void;
  submit:          (userId: string) => Promise<{ pedidoId: number }>;
}

export const usePedido = create<PedidoStore>()((set, get) => ({
  clienteCodigo:   null,
  clienteNombre:   null,
  items:           [],
  nota:            '',
  enBs:            false,
  modalOpen:       false,
  isLoading:       false,
  editingPedidoId: null,

  setCliente:   (codigo, nombre) => set({ clienteCodigo: codigo, clienteNombre: nombre }),
  setEnBs:      (enBs) => set({ enBs }),
  setModalOpen: (modalOpen) => set({ modalOpen }),

  // Consolida por código: Hybrid permite líneas repetidas, pero el orquestador
  // (registrar_pedido) rechaza códigos duplicados, así que sumamos cantidades.
  addItem: (item) => {
    const { items } = get();
    const existing = items.find(i => i.codigo_producto === item.codigo_producto);
    if (existing) {
      set({ items: items.map(i => i.codigo_producto === item.codigo_producto
        ? { ...existing, cantidad: existing.cantidad + item.cantidad } : i) });
    } else {
      set({ items: [...items, item] });
    }
  },

  removeItem: (codigo) => {
    set({ items: get().items.filter(i => i.codigo_producto !== codigo) });
  },

  updateItem: (codigo, updates) => {
    set({
      items: get().items
        .map(i => i.codigo_producto === codigo ? { ...i, ...updates } : i)
        .filter(i => i.cantidad > 0),
    });
  },

  setNota: (nota) => set({ nota }),

  clear: () => set({
    clienteCodigo: null, clienteNombre: null, items: [], nota: '', editingPedidoId: null, enBs: false,
  }),

  loadForEdit: (draft) => set({
    editingPedidoId: draft.pedidoId,
    clienteCodigo:   draft.clienteCodigo,
    clienteNombre:   draft.clienteNombre,
    nota:            draft.nota,
    items:           draft.items,
    modalOpen:       true,
  }),

  submit: async (userId: string) => {
    const { clienteCodigo, clienteNombre, items, nota, editingPedidoId } = get();

    if (!clienteCodigo) throw new Error('Selecciona un cliente antes de emitir el pedido.');
    if (items.length === 0) throw new Error('Agrega al menos un producto antes de emitir el pedido.');

    const itemRows = (pedidoId: number) => items.map(item => ({
      pedido_id:       pedidoId,
      codigo_producto: item.codigo_producto,
      descripcion:     item.descripcion,
      cantidad:        item.cantidad,
    }));

    set({ isLoading: true });

    // Reintento de un pedido que falló: actualiza la MISMA cabecera y reemplaza
    // sus items, en vez de crear uno nuevo — evita duplicar el historial y
    // reencola con backend_intentos en 0 (fresh retry).
    if (editingPedidoId !== null) {
      try {
        const { error: updateError } = await supabase
          .from('pedidos_app')
          .update({
            cliente_codigo:      clienteCodigo,
            cliente_nombre:      clienteNombre,
            nota:                nota || null,
            backend_status:      'pendiente',
            backend_resultado:   null,
            backend_intentos:    0,
            backend_aplicado_en: null,
            documento_hybrid:    null,
          })
          .eq('id', editingPedidoId);
        if (updateError) throw updateError;

        const { error: deleteItemsError } = await supabase
          .from('pedidos_app_items')
          .delete()
          .eq('pedido_id', editingPedidoId);
        if (deleteItemsError) throw deleteItemsError;

        const { error: itemsError } = await supabase
          .from('pedidos_app_items')
          .insert(itemRows(editingPedidoId));
        if (itemsError) throw itemsError;

        set({ isLoading: false });
        return { pedidoId: editingPedidoId };
      } catch (err) {
        set({ isLoading: false });
        throw err;
      }
    }

    let createdPedidoId: number | null = null;

    try {
      const { data: pedido, error: pedidoError } = await supabase
        .from('pedidos_app')
        .insert({
          creado_por:     userId,
          cliente_codigo: clienteCodigo,
          cliente_nombre: clienteNombre,
          nota:            nota || null,
          status:          'emitido',
        })
        .select('id')
        .single();

      if (pedidoError || !pedido) throw pedidoError ?? new Error('No pedido id');
      createdPedidoId = pedido.id;

      const { error: itemsError } = await supabase
        .from('pedidos_app_items')
        .insert(itemRows(pedido.id));

      if (itemsError) throw itemsError;

      set({ isLoading: false });
      return { pedidoId: pedido.id };
    } catch (err) {
      if (createdPedidoId !== null) {
        await supabase
          .from('pedidos_app')
          .delete()
          .eq('id', createdPedidoId)
          .then(({ error }) => {
            if (error) console.warn('[usePedido] cleanup failed:', error.message);
          });
      }
      set({ isLoading: false });
      throw err;
    }
  },
}));
