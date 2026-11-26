import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { withSupabaseRetry } from '../lib/retry';
import { calcularCantidadesCompra } from '../lib/compraCantidades';
import { fetchExistencias, faltantePorNegativo } from './useExistencias';
import { fetchColisionesCodigo, describirColision, ColisionesMap } from './useColisionesCodigo';
import { isDemoActive } from '../demo/useDemoStore';
import { trackAuditEvent } from '../lib/auditLog';
import {
  calcularCostoConDescuento,
  isMissingDiscountColumnError,
  normalizarDescuentos,
  resolverDescuentosEfectivos,
} from '../lib/compraDescuentos';

export interface CompraDraftItem {
  codigo_producto:            string;
  descripcion:                string;
  cantidad:                   number;
  costo:                      number;   // costo neto final (después de descuentos) que viaja al write-back
  costo_lista?:               number;   // costo de lista original antes de descuentos
  descuentos?:                number[]; // porcentajes en cascada propios del ítem (ej. [20, 5])
  excluir_descuento_general?: boolean;  // true = no hereda descuentosGenerales de la cabecera
  precio:                     number;
  referencia:                 string | null;   // opcional; null para productos existentes
  es_nuevo:                   boolean;         // true = producto a dar de alta en Hybrid
  es_ajuste?:                 boolean;         // true = cantidad con "..." (ajustar existencia a esta cifra en vez de sumar)
}

export interface CompraEditDraft {
  compraId:             number;
  proveedorCodigo:      string;
  proveedorNombre:      string | null;
  nota:                 string;
  numeroDocumento:      string;
  descuentosGenerales?: number[];
  items:                CompraDraftItem[];
}

// Draft para retomar un BORRADOR guardado ("lista sin terminar"): la fila ya
// existe en compras_app con status='borrador' — el backend la ignora porque su
// listener filtra status=eq.emitido. Al emitir se actualiza esa misma fila a
// 'emitido' en vez de crear una nueva. El proveedor puede venir null: se puede
// guardar la lista antes de decidir a quién se le compra.
export interface CompraBorradorDraft {
  borradorId:           number;
  titulo:               string;
  proveedorCodigo:      string | null;
  proveedorNombre:      string | null;
  nota:                 string;
  numeroDocumento:      string;
  descuentosGenerales?: number[];
  items:                CompraDraftItem[];
  facturaVinculada?:    boolean;
}

interface CompraStore {
  proveedorCodigo:      string | null;
  proveedorNombre:      string | null;
  items:                CompraDraftItem[];
  descuentosGenerales:  number[];
  nota:                 string;
  titulo:               string;   // nombre del borrador ("Reposición tornillería")
  numeroDocumento:      string;   // opcional; vacío = el backend usa el id de la compra
  isLoading:            boolean;
  isAutoSaving:         boolean;
  lastSavedAt:          Date | null;
  autoSaveError:        string | null;
  editingCompraId:      number | null;   // != null => reintentar una compra existente (update, no insert)
  borradorId:           number | null;   // != null => se está armando sobre un borrador guardado
  facturaVinculada:     boolean;
  setProveedor:           (codigo: string, nombre: string) => void;
  setDescuentosGenerales: (descuentos: number[]) => void;
  addItem:                (item: CompraDraftItem) => void;
  removeItem:             (codigo: string) => void;
  updateItem:             (codigo: string, updates: Partial<CompraDraftItem>) => void;
  setNota:                (nota: string) => void;
  setTitulo:              (titulo: string) => void;
  setNumeroDocumento:     (numero: string) => void;
  clear:                  () => void;
  loadForEdit:            (draft: CompraEditDraft) => void;
  loadBorrador:           (draft: CompraBorradorDraft) => void;
  saveDraft:              (userId: string, titulo: string) => Promise<{ compraId: number }>;
  autoSaveDraft:          (userId: string) => Promise<number | null>;
  deleteActiveDraft:      () => Promise<void>;
  submit:                 (userId: string) => Promise<{ compraId: number }>;
}

/**
 * Recalculates an item's net `costo` from its preserved `costo_lista` and effective
 * discounts (item + general unless excluded) without ever double-discounting.
 */
export function normalizarItemConDescuento(
  item: CompraDraftItem,
  descuentosGenerales: readonly number[],
): CompraDraftItem {
  const costoLista = item.costo_lista !== undefined ? item.costo_lista : item.costo;
  const descuentos = normalizarDescuentos(item.descuentos);
  const excluirGeneral = Boolean(item.excluir_descuento_general);
  const efectivos = resolverDescuentosEfectivos(descuentos, descuentosGenerales, excluirGeneral);
  const { costoNeto } = calcularCostoConDescuento(costoLista, efectivos);

  return {
    ...item,
    costo_lista: costoLista,
    costo: costoNeto,
    descuentos,
    excluir_descuento_general: excluirGeneral,
  };
}

async function withDiscountColumnFallback<R extends { error: unknown }>(
  primary: () => Promise<R>,
  fallback: () => Promise<R>,
): Promise<R> {
  const result = await primary();
  if (result.error && isMissingDiscountColumnError(result.error)) {
    return fallback();
  }
  return result;
}

export const useCompra = create<CompraStore>()((set, get) => ({
  proveedorCodigo:     null,
  proveedorNombre:     null,
  items:               [],
  descuentosGenerales: [],
  nota:                '',
  titulo:              '',
  numeroDocumento:     '',
  isLoading:           false,
  isAutoSaving:        false,
  lastSavedAt:         null,
  autoSaveError:       null,
  editingCompraId:     null,
  borradorId:          null,
  facturaVinculada:    false,

  setProveedor: (codigo, nombre) => set({ proveedorCodigo: codigo, proveedorNombre: nombre }),

  setDescuentosGenerales: (descuentos) => {
    const normalized = normalizarDescuentos(descuentos);
    set({
      descuentosGenerales: normalized,
      items: get().items.map(i => normalizarItemConDescuento(i, normalized)),
    });
  },

  addItem: (item) => {
    const { items, descuentosGenerales } = get();
    const existing = items.find(i => i.codigo_producto === item.codigo_producto);
    if (existing) {
      // Va al final de la lista: la vista muestra los ítems del más reciente al
      // más antiguo, así que lo último que se tocó queda arriba y a la vista.
      const costoLista = item.costo_lista !== undefined ? item.costo_lista : item.costo;
      const merged = normalizarItemConDescuento(
        { ...existing, ...item, costo_lista: costoLista },
        descuentosGenerales,
      );
      set({ items: [
        ...items.filter(i => i.codigo_producto !== item.codigo_producto),
        merged,
      ] });
    } else {
      set({ items: [...items, normalizarItemConDescuento(item, descuentosGenerales)] });
    }
  },

  removeItem: (codigo) => {
    set({ items: get().items.filter(i => i.codigo_producto !== codigo) });
  },

  updateItem: (codigo, updates) => {
    const { items, descuentosGenerales } = get();
    set({
      items: items.map(i => {
        if (i.codigo_producto !== codigo) return i;
        const costoLista =
          updates.costo_lista !== undefined
            ? updates.costo_lista
            : updates.costo !== undefined
              ? updates.costo
              : (i.costo_lista ?? i.costo);
        return normalizarItemConDescuento(
          { ...i, ...updates, costo_lista: costoLista },
          descuentosGenerales,
        );
      }),
    });
  },

  setNota: (nota) => set({ nota }),

  setTitulo: (titulo) => set({ titulo }),

  setNumeroDocumento: (numero) => set({ numeroDocumento: numero }),

  clear: () => set({
    proveedorCodigo: null, proveedorNombre: null, items: [], descuentosGenerales: [], nota: '', titulo: '', numeroDocumento: '', editingCompraId: null, borradorId: null, facturaVinculada: false, isAutoSaving: false, lastSavedAt: null, autoSaveError: null,
  }),

  loadForEdit: (draft) => {
    const descuentosGenerales = normalizarDescuentos(draft.descuentosGenerales);
    set({
      editingCompraId:     draft.compraId,
      borradorId:          null,
      facturaVinculada:    false,
      proveedorCodigo:     draft.proveedorCodigo,
      proveedorNombre:     draft.proveedorNombre,
      nota:                draft.nota,
      titulo:              '',
      numeroDocumento:     draft.numeroDocumento,
      descuentosGenerales,
      items:               draft.items.map(i => normalizarItemConDescuento(i, descuentosGenerales)),
    });
  },

  // Retomar un borrador guardado: la fila ya existe, así que submit() la
  // actualizará a status='emitido' en vez de crear una compra nueva.
  loadBorrador: (draft) => {
    const descuentosGenerales = normalizarDescuentos(draft.descuentosGenerales);
    set({
      editingCompraId:     null,
      borradorId:          draft.borradorId,
      facturaVinculada:    draft.facturaVinculada ?? false,
      proveedorCodigo:     draft.proveedorCodigo,
      proveedorNombre:     draft.proveedorNombre,
      nota:                draft.nota,
      titulo:              draft.titulo,
      numeroDocumento:     draft.numeroDocumento,
      descuentosGenerales,
      items:               draft.items.map(i => normalizarItemConDescuento(i, descuentosGenerales)),
    });
  },

  // Guarda la lista a medio armar como fila status='borrador'. El backend la
  // ignora (listener_compras filtra status=eq.emitido), así que no se registra
  // en Hybrid hasta que el usuario la retome y la emita. Solo exige ítems: el
  // proveedor es opcional a propósito, se puede cotizar antes de decidirlo.
  saveDraft: async (userId: string, titulo: string) => {
    if (isDemoActive()) {
      get().clear();
      return { compraId: 888 };
    }
    const { proveedorCodigo, proveedorNombre, items, descuentosGenerales, nota, numeroDocumento, borradorId } = get();

    if (items.length === 0) throw new Error('Agrega al menos un producto antes de guardar el borrador.');

    const nombre = titulo.trim();
    if (!nombre) throw new Error('Ponle un nombre al borrador para reconocerlo después.');

    const cabeceraBase = {
      proveedor_codigo: proveedorCodigo,
      proveedor_nombre: proveedorNombre,
      nota:             nota || null,
      numero_documento: numeroDocumento.trim() || null,
      titulo:           nombre,
      status:           'borrador',
      actualizado_en:   new Date().toISOString(),
    };
    const cabeceraConDesc = {
      ...cabeceraBase,
      descuentos_generales: descuentosGenerales,
    };

    set({ isLoading: true });

    try {
      let compraId: number;

      if (borradorId === null) {
        const { data, error } = await withDiscountColumnFallback(
          () =>
            withSupabaseRetry(
              () =>
                supabase
                  .from('compras_app')
                  .insert({ ...cabeceraConDesc, creado_por: userId })
                  .select('id')
                  .single(),
              { retries: 1 }
            ),
          () =>
            withSupabaseRetry(
              () =>
                supabase
                  .from('compras_app')
                  .insert({ ...cabeceraBase, creado_por: userId })
                  .select('id')
                  .single(),
              { retries: 1 }
            ),
        );
        if (error || !data) throw error ?? new Error('No compra id');
        compraId = data.id;
      } else {
        compraId = borradorId;

        const { error: updateError } = await withDiscountColumnFallback(
          () =>
            withSupabaseRetry(
              () => supabase.from('compras_app').update(cabeceraConDesc).eq('id', borradorId),
              { retries: 1 }
            ),
          () =>
            withSupabaseRetry(
              () => supabase.from('compras_app').update(cabeceraBase).eq('id', borradorId),
              { retries: 1 }
            ),
        );
        if (updateError) throw updateError;

        const { error: deleteItemsError } = await withSupabaseRetry(
          () => supabase.from('compras_app_items').delete().eq('compra_id', borradorId),
          { retries: 1 }
        );
        if (deleteItemsError) throw deleteItemsError;
      }

      const { error: itemsError } = await withDiscountColumnFallback(
        () =>
          withSupabaseRetry(
            () => supabase.from('compras_app_items').insert(buildItemRows(compraId, items, descuentosGenerales, true)),
            { retries: 1 }
          ),
        () =>
          withSupabaseRetry(
            () => supabase.from('compras_app_items').insert(buildItemRows(compraId, items, descuentosGenerales, false)),
            { retries: 1 }
          ),
      );
      if (itemsError) throw itemsError;

      set({ isLoading: false, borradorId: compraId, titulo: nombre, lastSavedAt: new Date() });
      return { compraId };
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  // Autoguardado continuo en segundo plano: no bloquea UI ni lanza excepciones al usuario.
  autoSaveDraft: async (userId: string) => {
    if (isDemoActive()) return 888;
    const { proveedorCodigo, proveedorNombre, items, descuentosGenerales, nota, numeroDocumento, borradorId, editingCompraId, titulo } = get();

    if (items.length === 0 || editingCompraId !== null) return null;

    const nombre = titulo.trim() || (proveedorNombre ? `Compra ${proveedorNombre}` : `Borrador ${new Date().toLocaleDateString('es-VE')}`);

    const cabeceraBase = {
      proveedor_codigo: proveedorCodigo,
      proveedor_nombre: proveedorNombre,
      nota:             nota || null,
      numero_documento: numeroDocumento.trim() || null,
      titulo:           nombre,
      status:           'borrador',
      actualizado_en:   new Date().toISOString(),
    };
    const cabeceraConDesc = {
      ...cabeceraBase,
      descuentos_generales: descuentosGenerales,
    };

    set({ isAutoSaving: true, autoSaveError: null });

    try {
      let compraId: number;

      if (borradorId === null) {
        const { data, error } = await withDiscountColumnFallback(
          async () =>
            supabase
              .from('compras_app')
              .insert({ ...cabeceraConDesc, creado_por: userId })
              .select('id')
              .single(),
          async () =>
            supabase
              .from('compras_app')
              .insert({ ...cabeceraBase, creado_por: userId })
              .select('id')
              .single(),
        );
        if (error || !data) throw error ?? new Error('No compra id');
        compraId = data.id;
      } else {
        compraId = borradorId;

        const { error: updateError } = await withDiscountColumnFallback(
          async () => supabase.from('compras_app').update(cabeceraConDesc).eq('id', borradorId),
          async () => supabase.from('compras_app').update(cabeceraBase).eq('id', borradorId),
        );
        if (updateError) throw updateError;

        const { error: deleteItemsError } = await supabase
          .from('compras_app_items')
          .delete()
          .eq('compra_id', borradorId);
        if (deleteItemsError) throw deleteItemsError;
      }

      const { error: itemsError } = await withDiscountColumnFallback(
        async () => supabase.from('compras_app_items').insert(buildItemRows(compraId, items, descuentosGenerales, true)),
        async () => supabase.from('compras_app_items').insert(buildItemRows(compraId, items, descuentosGenerales, false)),
      );
      if (itemsError) throw itemsError;

      set({
        isAutoSaving: false,
        borradorId: compraId,
        titulo: nombre,
        lastSavedAt: new Date(),
        autoSaveError: null,
      });
      return compraId;
    } catch (err: any) {
      set({ isAutoSaving: false, autoSaveError: err.message ?? 'Error en autoguardado' });
      console.warn('[useCompra] autoSaveDraft failed:', err);
      return null;
    }
  },

  // Elimina el borrador activo de Supabase cuando el usuario decide descartar/limpiar la lista
  deleteActiveDraft: async () => {
    const { borradorId } = get();
    if (borradorId === null) return;
    try {
      await supabase
        .from('compras_app')
        .delete()
        .eq('id', borradorId)
        .eq('status', 'borrador');
    } catch (err) {
      console.warn('[useCompra] deleteActiveDraft failed:', err);
    } finally {
      set({ borradorId: null, titulo: '' });
    }
  },

  submit: async (userId: string) => {
    if (get().facturaVinculada) {
      throw new Error('La emision de esta compra vinculada sigue bloqueada hasta resolver la regla de inventario de facturas.');
    }
    if (isDemoActive()) {
      get().clear();
      return { compraId: 888 };
    }
    const { proveedorCodigo, proveedorNombre, items, descuentosGenerales, nota, numeroDocumento, editingCompraId, borradorId } = get();

    if (!proveedorCodigo) throw new Error('Selecciona un proveedor antes de emitir la compra.');
    if (items.length === 0) throw new Error('Agrega al menos un producto antes de emitir la compra.');

    set({ isLoading: true });

    // Guarda dura contra el choque de códigos: emitir un ítem colisionado
    // registra un documento PERMANENTE en el kardex con el producto equivocado.
    // Va acá y no solo en la UI porque la vista puede emitir con el aviso aún
    // sin cargar. Si falla la lectura se aborta: no se emite a ciegas.
    let colisiones: ColisionesMap;
    try {
      colisiones = await fetchColisionesCodigo(items.map(item => item.codigo_producto));
    } catch {
      set({ isLoading: false });
      throw new Error('No se pudo verificar los códigos de los productos. Revisa la conexión e intenta de nuevo.');
    }

    const itemChocado = items.find(item => colisiones[item.codigo_producto]);
    if (itemChocado) {
      set({ isLoading: false });
      throw new Error(describirColision(
        itemChocado.codigo_producto,
        itemChocado.descripcion,
        colisiones[itemChocado.codigo_producto],
      ));
    }

    // Se compensa acá y no al agregar el ítem: la existencia pudo cambiar
    // mientras se armaba la lista, así que lo que vale es el saldo de este
    // instante. Si falla la lectura se aborta — cargar de menos dejaría el
    // stock mal sin que nadie se entere.
    let itemsAEnviar: CompraDraftItem[];
    try {
      itemsAEnviar = await compensarExistenciasNegativas(items);
    } catch {
      set({ isLoading: false });
      throw new Error('No se pudo leer la existencia actual de los productos. Revisa la conexión e intenta de nuevo.');
    }

    const itemsConDescuento = items.filter(it =>
      resolverDescuentosEfectivos(it.descuentos, descuentosGenerales, it.excluir_descuento_general).length > 0,
    ).length;

    // Dos casos usan la MISMA fila en vez de insertar una nueva: reintentar una
    // compra que falló (editingCompraId) y emitir un borrador guardado
    // (borradorId). En ambos se reemplazan los items y se reencola con
    // backend_intentos en 0 (fresh retry, ver listener_compras.MAX_INTENTOS);
    // status='emitido' es lo que hace que el listener por fin la vea.
    const existingId = editingCompraId ?? borradorId;

    if (existingId !== null) {
      try {
        // 1. Reemplazar los items primero, antes de marcar como emitido,
        // para que el listener jamás vea una compra con 0 items.
        const { error: deleteItemsError } = await withSupabaseRetry(
          () =>
            supabase
              .from('compras_app_items')
              .delete()
              .eq('compra_id', existingId),
          { retries: 1 }
        );
        if (deleteItemsError) throw deleteItemsError;

        const { error: itemsError } = await withDiscountColumnFallback(
          () =>
            withSupabaseRetry(
              () => supabase.from('compras_app_items').insert(buildItemRows(existingId, itemsAEnviar, descuentosGenerales, true)),
              { retries: 1 }
            ),
          () =>
            withSupabaseRetry(
              () => supabase.from('compras_app_items').insert(buildItemRows(existingId, itemsAEnviar, descuentosGenerales, false)),
              { retries: 1 }
            ),
        );
        if (itemsError) throw itemsError;

        // 2. Solo tras garantizar los items, activamos status='emitido'
        const updateBase = {
          proveedor_codigo:    proveedorCodigo,
          proveedor_nombre:    proveedorNombre,
          nota:                nota || null,
          numero_documento:    numeroDocumento.trim() || null,
          status:              'emitido',
          backend_status:      'pendiente',
          backend_resultado:   null,
          backend_intentos:    0,
          backend_aplicado_en: null,
        };
        const { error: updateError } = await withDiscountColumnFallback(
          () =>
            withSupabaseRetry(
              () =>
                supabase
                  .from('compras_app')
                  .update({ ...updateBase, descuentos_generales: descuentosGenerales })
                  .eq('id', existingId),
              { retries: 1 }
            ),
          () =>
            withSupabaseRetry(
              () => supabase.from('compras_app').update(updateBase).eq('id', existingId),
              { retries: 1 }
            ),
        );
        if (updateError) throw updateError;

        trackAuditEvent({
          evento: 'compra_emitida',
          entidad: 'compras_app',
          entidadId: existingId,
          empleadoId: userId,
          detalle: {
            items_count: items.length,
            proveedor_codigo: proveedorCodigo,
            proveedor_nombre: proveedorNombre ?? null,
            numero_documento: numeroDocumento.trim() || null,
            desde_borrador: true,
            ...(descuentosGenerales.length > 0 ? { descuentos_generales: descuentosGenerales } : {}),
            ...(itemsConDescuento > 0 ? { items_con_descuento: itemsConDescuento } : {}),
          },
        });

        set({ isLoading: false });
        return { compraId: existingId };
      } catch (err) {
        set({ isLoading: false });
        throw err;
      }
    }

    let createdCompraId: number | null = null;

    try {
      // 1. Crear cabecera en status='borrador' para que el listener NO la procese
      // hasta que todos los items hayan sido confirmados en Supabase.
      const insertBase = {
        creado_por:       userId,
        proveedor_codigo: proveedorCodigo,
        proveedor_nombre: proveedorNombre,
        nota:              nota || null,
        numero_documento:  numeroDocumento.trim() || null,   // vacío -> el backend usa el id de la compra
        status:            'borrador',
      };
      const { data: compra, error: compraError } = await withDiscountColumnFallback(
        () =>
          withSupabaseRetry(
            () =>
              supabase
                .from('compras_app')
                .insert({ ...insertBase, descuentos_generales: descuentosGenerales })
                .select('id')
                .single(),
            { retries: 1 }
          ),
        () =>
          withSupabaseRetry(
            () => supabase.from('compras_app').insert(insertBase).select('id').single(),
            { retries: 1 }
          ),
      );

      if (compraError || !compra) throw compraError ?? new Error('No compra id');
      createdCompraId = compra.id;

      // 2. Insertar todos los items
      const { error: itemsError } = await withDiscountColumnFallback(
        () =>
          withSupabaseRetry(
            () => supabase.from('compras_app_items').insert(buildItemRows(compra.id, itemsAEnviar, descuentosGenerales, true)),
            { retries: 1 }
          ),
        () =>
          withSupabaseRetry(
            () => supabase.from('compras_app_items').insert(buildItemRows(compra.id, itemsAEnviar, descuentosGenerales, false)),
            { retries: 1 }
          ),
      );

      if (itemsError) throw itemsError;

      // 3. Activar status='emitido' ahora que los items están garantizados
      const { error: emitError } = await withSupabaseRetry(
        () =>
          supabase
            .from('compras_app')
            .update({
              status:         'emitido',
              backend_status: 'pendiente',
            })
            .eq('id', compra.id),
        { retries: 1 }
      );

      if (emitError) throw emitError;

      trackAuditEvent({
        evento: 'compra_emitida',
        entidad: 'compras_app',
        entidadId: compra.id,
        empleadoId: userId,
        detalle: {
          items_count: items.length,
          proveedor_codigo: proveedorCodigo,
          proveedor_nombre: proveedorNombre ?? null,
          numero_documento: numeroDocumento || null,
          ...(descuentosGenerales.length > 0 ? { descuentos_generales: descuentosGenerales } : {}),
          ...(itemsConDescuento > 0 ? { items_con_descuento: itemsConDescuento } : {}),
        },
      });

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

/**
 * Suma a cada ítem las unidades que le faltan para salir del negativo.
 *
 * Hybrid suma lo comprado al saldo existente, así que un producto en -3 al que
 * se le compran 10 quedaría en 7. Enviando 13 el saldo final es 10: exactamente
 * la cantidad que el usuario escribió. Los productos nuevos no se tocan (aún no
 * existen en Hybrid, arrancan en cero).
 */
async function compensarExistenciasNegativas(items: CompraDraftItem[]): Promise<CompraDraftItem[]> {
  const codigos = items.filter(item => !item.es_nuevo && !item.es_ajuste).map(item => item.codigo_producto);
  if (codigos.length === 0) return items;

  const existencias = await fetchExistencias(codigos);

  return items.map(item => {
    if (item.es_nuevo || item.es_ajuste) return item;
    const faltante = faltantePorNegativo(existencias[item.codigo_producto]);
    if (faltante === 0) return item;
    const cantidades = calcularCantidadesCompra(item.cantidad, existencias[item.codigo_producto]);
    return { ...item, cantidad: cantidades.cantidadPos };
  });
}

function buildItemRows(
  compraId: number,
  items: CompraDraftItem[],
  descuentosGenerales: readonly number[],
  includeDiscountMetadata: boolean,
): Record<string, unknown>[] {
  return items.map(raw => {
    const item = normalizarItemConDescuento(raw, descuentosGenerales);
    const base: Record<string, unknown> = {
      compra_id:       compraId,
      codigo_producto: item.codigo_producto,
      descripcion:     item.es_nuevo ? item.descripcion.toUpperCase() : item.descripcion,
      cantidad:        item.cantidad,
      costo:           item.costo,
      precio:          item.precio,
      referencia:      item.referencia,
      es_nuevo:        item.es_nuevo,
      es_ajuste:       Boolean(item.es_ajuste),
    };
    if (includeDiscountMetadata) {
      base.costo_lista = item.costo_lista ?? item.costo;
      base.descuentos = item.descuentos ?? [];
      base.excluir_descuento_general = Boolean(item.excluir_descuento_general);
    }
    return base;
  });
}
