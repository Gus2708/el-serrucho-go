import { create } from 'zustand';
import { supabase, Producto } from '../lib/supabase';
import { uploadPdfAndGetUrl } from '../lib/pdfStorage';
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { buildPresupuestoPdfHtml, getPresupuestoFilename } from '../utils/pdfGenerator';

export type Cliente = {
  codigo_cliente: string;
  nombre: string;
  rif: string;
  telefono: string | null;
  direccion: string | null;
};

export type PresupuestoItem = {
  producto: Producto;
  cantidad: number;
  precio_unitario: number; // frozen at time of addition/creation
};

type PresupuestoStore = {
  cliente: Cliente | null;
  items: PresupuestoItem[];
  nota: string;
  enBs: boolean;
  tasaCambio: number | null;
  porcentajeRecargo: number | null;
  
  setCliente: (cliente: Cliente | null) => void;
  setNota: (nota: string) => void;
  setEnBs: (enBs: boolean, tasaCambio?: number | null, porcentajeRecargo?: number | null) => void;
  addItem: (producto: Producto, cantidad: number) => void;
  updateItemQuantity: (codigo_producto: string, cantidad: number) => void;
  updateItemPrice: (codigo_producto: string, precio: number) => string | null;
  removeItem: (codigo_producto: string) => void;
  reset: () => void;
  submit: () => Promise<{ presupuestoId: number; html?: string } | null>; // Returns the generated presupuesto ID and HTML if web
};

export const usePresupuestoStore = create<PresupuestoStore>((set, get) => ({
  cliente: null,
  items: [],
  nota: '',
  enBs: false,
  tasaCambio: null,
  porcentajeRecargo: null,

  setCliente: (cliente) => set({ cliente }),
  setNota: (nota) => set({ nota }),
  setEnBs: (enBs, tasaCambio = null, porcentajeRecargo = null) => set({ enBs, tasaCambio, porcentajeRecargo }),

  addItem: (producto, cantidad) => {
    if (cantidad <= 0) return;
    
    set((state) => {
      const existingItemIndex = state.items.findIndex(i => i.producto.codigo_interno === producto.codigo_interno);
      
      if (existingItemIndex >= 0) {
        const newItems = [...state.items];
        newItems[existingItemIndex] = {
          ...newItems[existingItemIndex],
          cantidad: newItems[existingItemIndex].cantidad + cantidad
        };
        return { items: newItems };
      } else {
        return { 
          items: [...state.items, { 
            producto, 
            cantidad, 
            precio_unitario: producto.precio_venta 
          }] 
        };
      }
    });
  },

  updateItemQuantity: (codigo_producto, cantidad) => {
    set((state) => {
      if (cantidad <= 0) {
        return { items: state.items.filter(i => i.producto.codigo_interno !== codigo_producto) };
      }
      
      return {
        items: state.items.map(i => 
          i.producto.codigo_interno === codigo_producto 
            ? { ...i, cantidad } 
            : i
        )
      };
    });
  },

  updateItemPrice: (codigo_producto, precio) => {
    const item  = get().items.find(i => i.producto.codigo_interno === codigo_producto);
    const costo = item?.producto.costo ?? 0;

    set((state) => ({
      items: state.items.map(i =>
        i.producto.codigo_interno === codigo_producto
          ? { ...i, precio_unitario: precio }
          : i
      ),
    }));

    if (item && costo > 0 && precio < costo) {
      return `Precio por debajo del costo ($${costo.toFixed(2)})`;
    }
    return null;
  },

  removeItem: (codigo_producto) => {
    set((state) => ({
      items: state.items.filter(i => i.producto.codigo_interno !== codigo_producto)
    }));
  },

  reset: () => set({ cliente: null, items: [], nota: '', enBs: false, tasaCambio: null, porcentajeRecargo: null }),

  submit: async () => {
    const { cliente, items, nota, enBs, tasaCambio, porcentajeRecargo } = get();

    if (items.length === 0) {
      throw new Error('No hay productos en el presupuesto');
    }

    let createdPresupuestoId: number | null = null;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticado');

      // Get creator's display name
      const { data: profileData } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single();
      const creadoPor = profileData?.display_name || undefined;

      const getFinalPrice = (item: PresupuestoItem) => {
        if (!enBs) return item.precio_unitario;
        const isMarkupApplied = item.precio_unitario !== item.producto.precio_venta;
        if (isMarkupApplied) return item.precio_unitario;
        const surcharge = 1 + (porcentajeRecargo || 0) / 100;
        return Number((item.precio_unitario * surcharge).toFixed(2));
      };

      const total_usd = items.reduce((acc, item) => acc + (item.cantidad * getFinalPrice(item)), 0);

      // Insertar cabecera
      const { data: presupuesto, error: cabeceraError } = await supabase
        .from('presupuestos')
        .insert({
          creado_por: user.id,
          cliente_id: cliente ? cliente.codigo_cliente : null,
          total_usd,
          status: 'emitido',
          nota: nota || null,
          en_bs: enBs,
          tasa_cambio: tasaCambio,
          porcentaje_recargo: porcentajeRecargo
        })
        .select()
        .single();

      if (cabeceraError) throw cabeceraError;
      createdPresupuestoId = presupuesto.id;

      // Insertar detalle
      const detalles = items.map(item => ({
        presupuesto_id: presupuesto.id,
        codigo_producto: item.producto.codigo_interno,
        descripcion: item.producto.descripcion,
        cantidad: item.cantidad,
        precio_unitario: getFinalPrice(item)
      }));

      const { error: detalleError } = await supabase
        .from('presupuestos_detalle')
        .insert(detalles);

      if (detalleError) throw detalleError;

      // 3. Generate HTML
      const pdfItems = items.map(item => ({
        ...item,
        precio_unitario: getFinalPrice(item)
      }));
      const html = buildPresupuestoPdfHtml(
        cliente, 
        pdfItems, 
        nota || '', 
        presupuesto.id, 
        creadoPor,
        enBs,
        tasaCambio || undefined,
        porcentajeRecargo || undefined
      );

      if (Platform.OS === 'web') {
        // Web: return the html so the UI can decide how to handle the print/delivery
        return { presupuestoId: presupuesto.id, html };
      } else {
        // Native: generate a real PDF file and share it
        const { uri } = await Print.printToFileAsync({ html });

        // Generate friendly name
        const friendlyName = getPresupuestoFilename(cliente, presupuesto.id);
        const localDestUri = `${FileSystem.cacheDirectory}${friendlyName}`;

        // Copy the temporary PDF to the friendly name in the cache directory
        await FileSystem.copyAsync({
          from: uri,
          to: localDestUri,
        });

        // 4. Upload PDF to Storage
        const pdfUrl = await uploadPdfAndGetUrl(localDestUri, friendlyName);

        await supabase
          .from('presupuestos')
          .update({ pdf_url: pdfUrl })
          .eq('id', presupuesto.id);

        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(localDestUri, { mimeType: 'application/pdf' });
        }

        // Clean up the original temporary file
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch (cleanupError) {
          console.warn('[usePresupuestoStore] failed to clean up temp file:', cleanupError);
        }
      }

      return { presupuestoId: presupuesto.id, html };
    } catch (error: any) {
      if (createdPresupuestoId !== null) {
        await supabase
          .from('presupuestos')
          .delete()
          .eq('id', createdPresupuestoId)
          .then(({ error: delErr }) => {
            if (delErr) console.warn('[usePresupuestoStore] cleanup failed:', delErr.message);
          });
      }
      console.error('Error enviando presupuesto:', error);
      throw error;
    }
  }
}));
