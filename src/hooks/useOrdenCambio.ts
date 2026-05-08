import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { SERRUCHO_LOGO } from '../constants/pdfAssets';

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
    const color  = delta >= 0 ? '#10b981' : '#ef4444'; // Tailwind colors for better look
    const bg     = delta >= 0 ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)';
    
    return `
      <tr>
        <td style="font-weight: 600; color: #666;">${item.codigo_producto}</td>
        <td style="font-weight: 500;">${item.descripcion}</td>
        <td style="text-align:center;">${item.existencia_actual}</td>
        <td style="text-align:center;">${item.nueva_existencia}</td>
        <td style="text-align:center; color:${color}; font-weight:700; background: ${bg};">${sign}${delta}</td>
        <td style="font-size: 10px; color: #888;">${item.nota || ''}</td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap');
  
  body { 
    font-family: 'JetBrains Mono', monospace; 
    font-size: 11px; 
    color: #1a1a1a; 
    margin: 40px; 
    line-height: 1.5;
  }
  
  .header { 
    display: flex; 
    align-items: center; 
    justify-content: space-between;
    border-bottom: 2px solid #010100; 
    padding-bottom: 20px; 
    margin-bottom: 30px; 
  }
  
  .logo-container {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .logo-img {
    width: 50px;
    height: 50px;
    object-fit: contain;
  }
  
  .logo-text-group {
    display: flex;
    flex-direction: column;
  }

  .logo-text { 
    font-size: 24px; 
    font-weight: 900; 
    color: #010100; 
    letter-spacing: -1px;
    text-transform: uppercase;
  }
  
  .logo-sub { 
    font-size: 10px; 
    color: #666; 
    font-weight: 500;
    letter-spacing: 1px;
  }
  
  .order-badge { 
    text-align: right;
  }
  
  .badge-label {
    font-size: 9px;
    color: #888;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 4px;
  }

  .badge-value { 
    background: #010100; 
    color: #fff; 
    padding: 6px 14px; 
    border-radius: 4px; 
    font-size: 14px; 
    font-weight: 800; 
  }
  
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 25px;
  }

  .meta-item {
    color: #444;
  }

  .meta-item strong {
    color: #010100;
    font-size: 10px;
    text-transform: uppercase;
    margin-right: 6px;
  }
  
  .nota-box { 
    background: #f8f9fa; 
    border-left: 4px solid #010100; 
    padding: 12px 16px; 
    margin-bottom: 30px; 
    border-radius: 0 4px 4px 0; 
  }
  
  table { 
    width: 100%; 
    border-collapse: collapse; 
    margin-bottom: 40px;
  }
  
  th { 
    background: #f1f5f9; 
    color: #475569; 
    padding: 10px 12px; 
    text-align: left; 
    font-size: 10px; 
    font-weight: 700;
    text-transform: uppercase;
    border-bottom: 1px solid #e2e8f0;
  }
  
  td { 
    padding: 10px 12px; 
    border-bottom: 1px solid #f1f5f9; 
  }
  
  tr:nth-child(even) { 
    background: #fafafa; 
  }
  
  .signature-section { 
    margin-top: 60px;
    display: flex;
    justify-content: space-between;
    gap: 40px;
  }
  
  .signature-box {
    flex: 1;
    border-top: 1px solid #010100;
    padding-top: 8px;
  }
  
  .signature-box p {
    margin: 0;
    font-size: 10px;
    font-weight: 600;
    color: #010100;
  }

  .signature-box span {
    font-size: 9px;
    color: #888;
  }
  
  .footer { 
    margin-top: 50px; 
    border-top: 1px solid #eee; 
    padding-top: 20px; 
    display: flex; 
    justify-content: space-between; 
    color: #94a3b8; 
    font-size: 9px; 
  }
</style>
</head>
<body>
  <div class="header">
    <div class="logo-container">
      <img src="${SERRUCHO_LOGO}" class="logo-img" />
      <div class="logo-text-group">
        <span class="logo-text">EL SERRUCHO</span>
        <span class="logo-sub">ORDEN DE CAMBIO</span>
      </div>
    </div>
    <div class="order-badge">
      <div class="badge-label">Referencia</div>
      <div class="badge-value">#${String(orderId).padStart(4,'0')}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><strong>Fecha Emisión:</strong> ${now}</div>
    <div class="meta-item"><strong>Total Productos:</strong> ${items.length}</div>
  </div>

  ${nota ? `<div class="nota-box"><strong>Observaciones:</strong><br/>${nota}</div>` : ''}

  <table>
    <thead>
      <tr>
        <th>SKU</th>
        <th>Descripción</th>
        <th style="text-align:center;">Stock Anterior</th>
        <th style="text-align:center;">Stock Nuevo</th>
        <th style="text-align:center;">Ajuste</th>
        <th>Comentario</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="signature-section">
    <div class="signature-box">
      <p>Firma Responsable</p>
      <span>Nombre y Cédula</span>
    </div>
    <div class="signature-box">
      <p>Validación Sistema (Hybrid)</p>
      <span>Firma y Sello</span>
    </div>
  </div>

  <div class="footer">
    <span>Generado via El Serrucho GO v1.0</span>
    <span>ID Documento: ${orderId}-${Date.now()}</span>
  </div>
</body>
</html>`;
}
