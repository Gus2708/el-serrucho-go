import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { withSupabaseRetry } from '../lib/retry';
import { isDemoActive } from '../demo/useDemoStore';

// Ítem de pedido. `precio_base_usd` es el precio maestro del producto en Hybrid
// (referencia, USD con IVA) y `precio_unitario` es lo que se va a cobrar: cuando
// difieren, el vendedor fijó un precio a mano y el backend lo teclea en la
// columna Precio de la grilla de Pedidos (migración 040). Si son iguales no se
// manda nada y Hybrid aplica el maestro, que era el comportamiento histórico.
// `costo_usd` es solo para avisar si el precio queda bajo el costo (ex-IVA).
export interface PedidoDraftItem {
  codigo_producto:  string;
  descripcion:      string;
  cantidad:         number;
  precio_unitario?: number;
  precio_base_usd?: number;
  costo_usd?:       number;
}

/**
 * Precio manual del ítem en USD con IVA, o null si quedó con el precio maestro.
 * null es lo que hace que el backend NO toque la columna Precio de la grilla.
 */
export function precioManual(item: PedidoDraftItem): number | null {
  const { precio_unitario: precio, precio_base_usd: base } = item;

  if (precio === undefined || !(precio > 0)) return null;
  // Medio centavo de tolerancia: el input es texto y "12.50" vs 12.5 no es un cambio.
  if (base !== undefined && Math.abs(precio - base) < 0.005) return null;

  return parseFloat(precio.toFixed(2));
}

export interface PedidoEditDraft {
  pedidoId:      number;
  clienteCodigo: string;
  clienteNombre: string | null;
  nota:          string;
  items:         PedidoDraftItem[];
}

// Draft para retomar un BORRADOR guardado ("lista sin terminar"): la fila ya
// existe en pedidos_app con status='borrador' — el backend la ignora porque sus
// listeners filtran status=eq.emitido. Al emitir se actualiza esa misma fila a
// 'emitido' en vez de crear una nueva. El cliente puede venir null: se puede
// guardar la lista antes de saber a quién va.
export interface PedidoBorradorDraft {
  borradorId:    number;
  titulo:        string;
  clienteCodigo: string | null;
  clienteNombre: string | null;
  nota:          string;
  items:         PedidoDraftItem[];
}

// Draft para "convertir un presupuesto en pedido": trae cliente + ítems del
// presupuesto pero crea un pedido NUEVO (editingPedidoId = null). El cliente
// puede venir null (presupuesto sin cliente): el usuario lo elige antes de
// emitir. Los ítems no llevan precio — el pedido usa el precio maestro de Hybrid.
export interface PedidoFromPresupuestoDraft {
  presupuestoId: number;   // origen — se marca como convertido al emitir el pedido
  clienteCodigo: string | null;
  clienteNombre: string | null;
  nota:          string;
  items:         PedidoDraftItem[];
}

interface PedidoStore {
  clienteCodigo:      string | null;
  clienteNombre:      string | null;
  items:              PedidoDraftItem[];
  nota:               string;
  titulo:             string;          // nombre del borrador ("Pedido ferretería Tovar")
  enBs:               boolean;
  modalOpen:          boolean;
  skipModalAnimation: boolean;
  isLoading:          boolean;
  editingPedidoId:    number | null;   // != null => reintentar un pedido existente (update, no insert)
  borradorId:         number | null;   // != null => se está armando sobre un borrador guardado
  presupuestoOrigenId: number | null;  // != null => al emitir, marcar ese presupuesto como convertido
  setCliente:         (codigo: string, nombre: string) => void;
  setEnBs:            (enBs: boolean) => void;
  setModalOpen:       (open: boolean, skipAnimation?: boolean) => void;
  addItem:            (item: PedidoDraftItem) => void;
  removeItem:         (codigo: string) => void;
  updateItem:         (codigo: string, updates: Partial<PedidoDraftItem>) => void;
  setNota:            (nota: string) => void;
  setTitulo:          (titulo: string) => void;
  clear:              () => void;
  loadForEdit:         (draft: PedidoEditDraft) => void;
  loadFromPresupuesto: (draft: PedidoFromPresupuestoDraft) => void;
  loadBorrador:        (draft: PedidoBorradorDraft) => void;
  saveDraft:           (userId: string, titulo: string) => Promise<{ pedidoId: number }>;
  submit:              (userId: string) => Promise<{ pedidoId: number }>;
}

export const usePedido = create<PedidoStore>()((set, get) => ({
  clienteCodigo:      null,
  clienteNombre:      null,
  items:              [],
  nota:               '',
  titulo:             '',
  enBs:               false,
  modalOpen:          false,
  skipModalAnimation: false,
  isLoading:          false,
  editingPedidoId:    null,
  borradorId:         null,
  presupuestoOrigenId: null,

  setCliente:   (codigo, nombre) => set({ clienteCodigo: codigo, clienteNombre: nombre }),
  setEnBs:      (enBs) => set({ enBs }),
  setModalOpen: (modalOpen, skipAnimation = false) => set({ modalOpen, skipModalAnimation: skipAnimation }),

  // Consolida por código: Hybrid permite líneas repetidas, pero el orquestador
  // (registrar_pedido) rechaza códigos duplicados, así que sumamos cantidades.
  addItem: (item) => {
    const { items } = get();
    const existing = items.find(i => i.codigo_producto === item.codigo_producto);
    if (existing) {
      // Va al final de la lista: la vista muestra los ítems del más reciente al
      // más antiguo, así que lo último que se tocó queda arriba y a la vista.
      set({ items: [
        ...items.filter(i => i.codigo_producto !== item.codigo_producto),
        { ...existing, cantidad: existing.cantidad + item.cantidad },
      ] });
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

  setTitulo: (titulo) => set({ titulo }),

  clear: () => set({
    clienteCodigo: null, clienteNombre: null, items: [], nota: '', titulo: '', editingPedidoId: null, borradorId: null, presupuestoOrigenId: null, enBs: false, skipModalAnimation: false,
  }),

  loadForEdit: (draft) => set({
    editingPedidoId: draft.pedidoId,
    borradorId:      null,
    presupuestoOrigenId: null,   // reintentar un pedido no es una conversión
    clienteCodigo:   draft.clienteCodigo,
    clienteNombre:   draft.clienteNombre,
    nota:            draft.nota,
    titulo:          '',
    items:           draft.items,
    modalOpen:       true,
  }),

  // Retomar un borrador guardado: la fila ya existe, así que submit() la
  // actualizará a status='emitido' en vez de crear un pedido nuevo.
  loadBorrador: (draft) => set({
    editingPedidoId:     null,
    borradorId:          draft.borradorId,
    presupuestoOrigenId: null,
    clienteCodigo:       draft.clienteCodigo,
    clienteNombre:       draft.clienteNombre,
    nota:                draft.nota,
    titulo:              draft.titulo,
    items:               draft.items,
    enBs:                false,
    modalOpen:           true,
    skipModalAnimation:  false,
  }),

  // Convertir presupuesto → pedido NUEVO: editingPedidoId queda en null para que
  // submit() haga INSERT (no update). Abre el modal del PedidoFab para que el
  // usuario revise (cliente, precio maestro actual) y emita a caja.
  loadFromPresupuesto: (draft) => set({
    editingPedidoId:     null,
    borradorId:          null,
    titulo:              '',
    presupuestoOrigenId: draft.presupuestoId,
    clienteCodigo:       draft.clienteCodigo,
    clienteNombre:       draft.clienteNombre,
    nota:                draft.nota,
    items:               draft.items,
    enBs:                false,
    modalOpen:           true,
    skipModalAnimation:  false,
  }),

  // Guarda la lista a medio armar como fila status='borrador'. El backend la
  // ignora (sus listeners filtran status=eq.emitido), así que no llega a caja
  // hasta que el usuario la retome y la emita. Solo exige ítems: el cliente es
  // opcional a propósito, se puede armar la lista antes de saber a quién va.
  saveDraft: async (userId: string, titulo: string) => {
    if (isDemoActive()) {
      get().clear();
      return { pedidoId: 999 };
    }
    const { clienteCodigo, clienteNombre, items, nota, borradorId } = get();

    if (items.length === 0) throw new Error('Agrega al menos un producto antes de guardar el borrador.');

    const nombre = titulo.trim();
    if (!nombre) throw new Error('Ponle un nombre al borrador para reconocerlo después.');

    const cabecera = {
      cliente_codigo: clienteCodigo,
      cliente_nombre: clienteNombre,
      nota:           nota || null,
      titulo:         nombre,
      status:         'borrador',
      actualizado_en: new Date().toISOString(),
    };

    set({ isLoading: true });

    try {
      let pedidoId: number;

      if (borradorId === null) {
        const { data, error } = await withSupabaseRetry(
          () =>
            supabase
              .from('pedidos_app')
              .insert({ ...cabecera, creado_por: userId })
              .select('id')
              .single(),
          { retries: 1 },
        );
        if (error || !data) throw error ?? new Error('No pedido id');
        pedidoId = data.id;
      } else {
        pedidoId = borradorId;

        const { error: updateError } = await withSupabaseRetry(
          () => supabase.from('pedidos_app').update(cabecera).eq('id', borradorId),
          { retries: 1 },
        );
        if (updateError) throw updateError;

        const { error: deleteItemsError } = await withSupabaseRetry(
          () => supabase.from('pedidos_app_items').delete().eq('pedido_id', borradorId),
          { retries: 1 },
        );
        if (deleteItemsError) throw deleteItemsError;
      }

      const { error: itemsError } = await withSupabaseRetry(
        () => supabase.from('pedidos_app_items').insert(buildItemRows(pedidoId, items)),
        { retries: 1 },
      );
      if (itemsError) throw itemsError;

      set({ isLoading: false, borradorId: pedidoId, titulo: nombre });
      return { pedidoId };
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  submit: async (userId: string) => {
    if (isDemoActive()) {
      get().clear();
      return { pedidoId: 999 };
    }
    const { clienteCodigo, clienteNombre, items, nota, editingPedidoId, borradorId, presupuestoOrigenId } = get();

    if (!clienteCodigo) throw new Error('Selecciona un cliente antes de emitir el pedido.');
    if (items.length === 0) throw new Error('Agrega al menos un producto antes de emitir el pedido.');

    set({ isLoading: true });

    // Dos casos usan la MISMA fila en vez de insertar una nueva: reintentar un
    // pedido que falló (editingPedidoId) y emitir un borrador guardado
    // (borradorId). En ambos se reemplazan los items y se reencola con
    // backend_intentos en 0 (fresh retry); status='emitido' es lo que hace que
    // el listener por fin lo vea.
    const existingId = editingPedidoId ?? borradorId;

    if (existingId !== null) {
      try {
        const { error: updateError } = await withSupabaseRetry(
          () =>
            supabase
              .from('pedidos_app')
              .update({
                cliente_codigo:      clienteCodigo,
                cliente_nombre:      clienteNombre,
                nota:                nota || null,
                status:              'emitido',
                backend_status:      'pendiente',
                backend_resultado:   null,
                backend_intentos:    0,
                backend_aplicado_en: null,
                documento_hybrid:    null,
              })
              .eq('id', existingId),
          { retries: 1 },
        );
        if (updateError) throw updateError;

        const { error: deleteItemsError } = await withSupabaseRetry(
          () =>
            supabase
              .from('pedidos_app_items')
              .delete()
              .eq('pedido_id', existingId),
          { retries: 1 },
        );
        if (deleteItemsError) throw deleteItemsError;

        const { error: itemsError } = await withSupabaseRetry(
          () => supabase.from('pedidos_app_items').insert(buildItemRows(existingId, items)),
          { retries: 1 },
        );
        if (itemsError) throw itemsError;

        await marcarPresupuestoConvertido(presupuestoOrigenId, existingId);

        set({ isLoading: false });
        return { pedidoId: existingId };
      } catch (err) {
        set({ isLoading: false });
        throw err;
      }
    }

    let createdPedidoId: number | null = null;

    try {
      const { data: pedido, error: pedidoError } = await withSupabaseRetry(
        () =>
          supabase
            .from('pedidos_app')
            .insert({
              creado_por:     userId,
              cliente_codigo: clienteCodigo,
              cliente_nombre: clienteNombre,
              nota:            nota || null,
              status:          'emitido',
            })
            .select('id')
            .single(),
        { retries: 1 },
      );

      if (pedidoError || !pedido) throw pedidoError ?? new Error('No pedido id');
      createdPedidoId = pedido.id;

      const { error: itemsError } = await withSupabaseRetry(
        () => supabase.from('pedidos_app_items').insert(buildItemRows(pedido.id, items)),
        { retries: 1 },
      );

      if (itemsError) throw itemsError;

      await marcarPresupuestoConvertido(presupuestoOrigenId, pedido.id);

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

function buildItemRows(pedidoId: number, items: PedidoDraftItem[]): Record<string, unknown>[] {
  return items.map(item => ({
    pedido_id:       pedidoId,
    codigo_producto: item.codigo_producto,
    descripcion:     item.descripcion,
    cantidad:        item.cantidad,
    precio:          precioManual(item),
  }));
}

/**
 * Si el pedido nació de un presupuesto, márcalo como convertido. Es best-effort:
 * el pedido ya está creado (fuente de verdad para caja), así que un fallo aquí
 * solo omite la etiqueta "Convertido", no rompe la emisión.
 */
async function marcarPresupuestoConvertido(presupuestoId: number | null, pedidoId: number): Promise<void> {
  if (presupuestoId === null) return;

  const { error } = await supabase.rpc('marcar_presupuesto_convertido', {
    p_presupuesto_id: presupuestoId,
    p_pedido_id:      pedidoId,
  });

  if (error) {
    console.warn('[usePedido] no se pudo marcar el presupuesto como convertido:', error.message);
  }
}
