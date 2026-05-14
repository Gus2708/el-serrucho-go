import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { buildPdfHtml, DraftItem } from '../utils/pdfGenerator';

interface OrdenStore {
  items:     DraftItem[];
  nota:      string;
  isLoading: boolean;
  addItem:       (item: DraftItem) => void;
  removeItem:    (codigo: string) => void;
  updateItem:    (codigo: string, updates: Partial<DraftItem>) => void;
  setNota:       (nota: string) => void;
  clear:         () => void;
  submit:        (userId: string) => Promise<{ orderId: number; html?: string }>;
}

export const useOrdenCambio = create<OrdenStore>((set, get) => ({
  items:     [],
  nota:      '',
  isLoading: false,

  addItem: (item) => {
    const { items } = get();
    const existing = items.find(i => i.codigo_producto === item.codigo_producto);
    if (existing) {
      set({ items: items.map(i => i.codigo_producto === item.codigo_producto ? item : i) });
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

  clear: () => set({ items: [], nota: '' }),
  submit: async (userId: string) => {
    const { items, nota } = get();
    set({ isLoading: true });

    try {
      // 1. Create the change order header
      const { data: orden, error: ordenError } = await supabase
        .from('ordenes_cambio')
        .insert({ creado_por: userId, nota: nota || null, status: 'borrador' })
        .select('id')
        .single();

      if (ordenError || !orden) throw ordenError ?? new Error('No orden id');

      // 2. Insert all items
      const { error: itemsError } = await supabase
        .from('ordenes_cambio_items')
        .insert(
          items.map(item => ({
            orden_id:           orden.id,
            codigo_producto:    item.codigo_producto,
            descripcion:        item.descripcion,
            existencia_actual:  item.existencia_actual,
            nueva_existencia:   item.nueva_existencia,
            nota:               item.nota || null,
          }))
        );

      if (itemsError) throw itemsError;

      // 3. Get the creator's display name
      const { data: profileData } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .single();
      const creadoPor = profileData?.display_name || undefined;

      // 4. Generate HTML
      const html = buildPdfHtml(items, nota, orden.id, creadoPor);

      if (Platform.OS === 'web') {
        // Web: return the html so the UI can decide how to handle the print/delivery
        // Update status to emitted even on web
        
        // Update status to emitted even on web
        await supabase
          .from('ordenes_cambio')
          .update({ status: 'emitido' })
          .eq('id', orden.id);

        set({ isLoading: false });
        return { orderId: orden.id, html };
      } else {
        // Native: generate a real PDF file and share it
        const { uri } = await Print.printToFileAsync({ html });

        // 4. Upload to Supabase Storage
        const fileName = `orden-${orden.id}-${Date.now()}.pdf`;
        const fileData = await fetch(uri).then(r => r.blob());
        const { error: uploadError } = await supabase.storage
          .from('change-orders')
          .upload(fileName, fileData, { contentType: 'application/pdf' });

        if (!uploadError) {
          const { data: signedData } = await supabase.storage
            .from('change-orders')
            .createSignedUrl(fileName, 60 * 60 * 24 * 365);

          await supabase
            .from('ordenes_cambio')
            .update({ status: 'emitido', pdf_url: signedData?.signedUrl ?? null })
            .eq('id', orden.id);
        }

        const canShare = await Sharing.isAvailableAsync();
        if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
      }

      set({ isLoading: false });
      return { orderId: orden.id };
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },
}));
