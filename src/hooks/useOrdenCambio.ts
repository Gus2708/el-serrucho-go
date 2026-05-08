import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export interface DraftItem {
  codigo_producto:   string;
  descripcion:       string;
  existencia_actual: number;
  nueva_existencia:  number;
  nota:              string;
}

interface OrdenStore {
  items:     DraftItem[];
  nota:      string;
  isLoading: boolean;
  addItem:       (item: DraftItem) => void;
  removeItem:    (codigo: string) => void;
  updateItem:    (codigo: string, updates: Partial<DraftItem>) => void;
  setNota:       (nota: string) => void;
  clear:         () => void;
  submit:        (userId: string) => Promise<{ orderId: number }>;
}

export const useOrdenCambio = create<OrdenStore>((set, get) => ({
  items:     [],
  nota:      '',
  isLoading: false,

  addItem: (item) =>
    set(s => ({
      items: s.items.find(i => i.codigo_producto === item.codigo_producto)
        ? s.items.map(i => i.codigo_producto === item.codigo_producto ? item : i)
        : [...s.items, item],
    })),

  removeItem: (codigo) =>
    set(s => ({ items: s.items.filter(i => i.codigo_producto !== codigo) })),

  updateItem: (codigo, updates) =>
    set(s => ({
      items: s.items.map(i =>
        i.codigo_producto === codigo ? { ...i, ...updates } : i
      ),
    })),

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

      // 2. Insert all items (delta computed explicitly for DB compatibility)
      const { error: itemsError } = await supabase
        .from('ordenes_cambio_items')
        .insert(
          items.map(item => ({
            orden_id:           orden.id,
            codigo_producto:    item.codigo_producto,
            descripcion:        item.descripcion,
            existencia_actual:  item.existencia_actual,
            nueva_existencia:   item.nueva_existencia,
            delta:              item.nueva_existencia - item.existencia_actual,
            nota:               item.nota || null,
          }))
        );

      if (itemsError) throw itemsError;

      // 3. Generate and share PDF
      const html     = buildPdfHtml(items, nota, orden.id);
      const { uri }  = await Print.printToFileAsync({ html });

      // 4. Upload to Supabase Storage
      const fileName = `orden-${orden.id}-${Date.now()}.pdf`;
      const fileData = await fetch(uri).then(r => r.blob());
      const { error: uploadError } = await supabase.storage
        .from('change-orders')
        .upload(fileName, fileData, { contentType: 'application/pdf' });

      if (!uploadError) {
        // Private bucket → create a long-lived signed URL (1 year)
        const { data: signedData } = await supabase.storage
          .from('change-orders')
          .createSignedUrl(fileName, 60 * 60 * 24 * 365);

        await supabase
          .from('ordenes_cambio')
          .update({ status: 'emitido', pdf_url: signedData?.signedUrl ?? null })
          .eq('id', orden.id);
      }

      // 5. Share via system sheet
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });

      set({ isLoading: false });
      return { orderId: orden.id };
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },
}));

// ── PDF HTML Template ─────────────────────────────────────────────────────────
function buildPdfHtml(items: DraftItem[], nota: string, orderId: number): string {
  const now  = new Date().toLocaleString('es-VE');
  const rows = items.map(item => {
    const delta  = item.nueva_existencia - item.existencia_actual;
    const sign   = delta >= 0 ? '+' : '';
    const color  = delta >= 0 ? '#2D6A2D' : '#A32020';
    return `
      <tr>
        <td>${item.codigo_producto}</td>
        <td>${item.descripcion}</td>
        <td style="text-align:center;">${item.existencia_actual}</td>
        <td style="text-align:center;">${item.nueva_existencia}</td>
        <td style="text-align:center;color:${color};font-weight:bold;">${sign}${delta}</td>
        <td>${item.nota || ''}</td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 40px; }
  .header { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid #F5B200; padding-bottom: 16px; margin-bottom: 24px; }
  .logo-text { font-size: 28px; font-weight: 900; color: #F5B200; letter-spacing: -1px; }
  .logo-sub { font-size: 11px; color: #888; }
  .badge { background: #0C0C0C; color: #F5B200; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: bold; }
  .meta { margin-bottom: 20px; color: #444; }
  .nota-box { background: #f5f5f5; border-left: 4px solid #F5B200; padding: 10px 14px; margin-bottom: 20px; border-radius: 0 8px 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #0C0C0C; color: #F5B200; padding: 8px 10px; text-align: left; font-size: 11px; }
  td { padding: 7px 10px; border-bottom: 1px solid #e8e8e8; }
  tr:nth-child(even) { background: #fafafa; }
  .footer { margin-top: 40px; border-top: 1px solid #ddd; padding-top: 16px; display: flex; justify-content: space-between; color: #888; font-size: 10px; }
  .sign-line { margin-top: 40px; }
  .sign-line p { border-top: 1px solid #bbb; padding-top: 6px; font-size: 10px; color: #888; display: inline-block; min-width: 200px; margin-right: 40px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo-text">⚙ EL SERRUCHO</div>
      <div class="logo-sub">Ferretería · Orden de Cambio de Inventario</div>
    </div>
    <div style="margin-left:auto;">
      <div class="badge">OC-${String(orderId).padStart(4,'0')}</div>
    </div>
  </div>

  <div class="meta">
    <strong>Fecha:</strong> ${now} &nbsp;&nbsp;
    <strong>Total ítems:</strong> ${items.length}
  </div>

  ${nota ? `<div class="nota-box"><strong>Nota:</strong> ${nota}</div>` : ''}

  <table>
    <thead>
      <tr>
        <th>Código</th>
        <th>Descripción</th>
        <th>Existencia actual</th>
        <th>Nueva existencia</th>
        <th>Delta</th>
        <th>Nota</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="sign-line">
    <p>Recibido por: ___________________________</p>
    <p>Aplicado en Hybrid: ___________________________</p>
  </div>

  <div class="footer">
    <span>El Serrucho GO · Orden ${orderId} · ${now}</span>
    <span>Este documento no modifica el sistema — ingresar cambios en Hybrid POS</span>
  </div>
</body>
</html>`;
}
