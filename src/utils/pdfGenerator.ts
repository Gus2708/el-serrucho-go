export interface DraftItem {
  codigo_producto:   string;
  descripcion:       string;
  existencia_actual: number;
  nueva_existencia:  number;
  nota:              string;
}

export function buildPdfHtml(items: DraftItem[], nota: string, orderId: number): string {
  const now  = new Date().toLocaleString('es-VE');
  const rows = items.map(item => {
    const delta  = item.nueva_existencia - item.existencia_actual;
    const sign   = delta >= 0 ? '+' : '';
    const color  = delta >= 0 ? '#10b981' : '#ef4444';
    
    return `
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="font-family: 'JetBrains Mono'; font-weight: 700; color: #000; font-size: 14px; background: transparent !important; border: none !important;">${item.codigo_producto}</td>
        <td style="color: #444; font-size: 14px; background: transparent !important; border: none !important;">${item.descripcion}</td>
        <td style="text-align:center; color: #666; background: transparent !important; border: none !important;">${item.existencia_actual}</td>
        <td style="text-align:center; color: #000; font-weight: 700; background: transparent !important; border: none !important;">${item.nueva_existencia}</td>
        <td style="text-align:center; color:${color}; font-weight:800; font-size: 16px; background: transparent !important; border: none !important;">${sign}${delta}</td>
        <td style="font-size: 12px; color: #888; font-style: italic; background: transparent !important; border: none !important;">${item.nota || ''}</td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap');
  
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  body { 
    font-family: 'JetBrains Mono', monospace; 
    background-color: #f8fafc; 
    color: #000;
    margin: 0;
    padding: 0;
    display: flex;
    justify-content: center;
    padding: 40px 15px;
  }
  
  .ticket {
    width: 100%;
    max-width: 850px;
    background: #fff;
    padding: 50px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }

  .header { 
    display: flex; 
    align-items: center; 
    justify-content: space-between;
    border-bottom: 2px solid #f1f5f9; 
    padding-bottom: 30px; 
    margin-bottom: 35px; 
  }
  
  .logo-text { 
    font-size: 26px; 
    font-weight: 800; 
    color: #F5B200; 
    text-transform: uppercase;
    letter-spacing: -1px;
  }
  
  .order-id { 
    background: #000; 
    color: #fff; 
    padding: 8px 16px; 
    border-radius: 6px; 
    font-size: 16px; 
    font-weight: 800; 
  }
  
  .meta-container {
    display: flex;
    justify-content: space-between;
    margin-bottom: 35px;
    padding: 20px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px solid #f1f5f9;
  }

  .meta-item { font-size: 14px; color: #64748b; }
  .meta-item strong { color: #0f172a; font-size: 11px; text-transform: uppercase; margin-right: 12px; opacity: 0.8; }
  
  .note-section { 
    border-left: 4px solid #F5B200; 
    padding: 20px; 
    margin-bottom: 35px; 
    background: #fffbeb;
    font-size: 14px;
    color: #92400e;
    border-radius: 0 8px 8px 0;
  }
  
  table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
  th { background: #f8fafc; color: #475569; padding: 15px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; border-bottom: 2px solid #f1f5f9; }
  td { padding: 15px; font-size: 14px; color: #1e293b; }

  .footer-info { 
    margin-top: auto;
    padding-top: 30px;
    border-top: 1px solid #f1f5f9;
    display: flex; 
    justify-content: space-between; 
    color: #94a3b8; 
    font-size: 12px; 
    font-weight: 500;
  }

  @media print {
    body { background: #fff !important; padding: 0 !important; }
    .ticket { 
      box-shadow: none !important; 
      border: 1px solid #eee !important; 
      padding: 30px; 
      max-width: none; 
      width: 100%;
    }
    .note-section { border: 1px solid #fef3c7; }
  }
</style>
</head>
<body>
  <div class="ticket">
    <div class="header">
      <span class="logo-text">EL SERRUCHO GO</span>
      <div class="order-id">ORDEN #${String(orderId).padStart(5,'0')}</div>
    </div>

    <div class="meta-container">
      <div class="meta-item"><strong>FECHA Y HORA</strong> ${now}</div>
      <div class="meta-item"><strong>TOTAL ÍTEMS</strong> ${items.length}</div>
    </div>

    ${nota ? `<div class="note-section"><strong>OBSERVACIONES:</strong><br/>${nota}</div>` : ''}

    <table>
      <thead>
        <tr>
          <th>CÓDIGO</th>
          <th>DESCRIPCIÓN</th>
          <th style="text-align:center;">ACTUAL</th>
          <th style="text-align:center;">NUEVA</th>
          <th style="text-align:center;">AJUSTE</th>
          <th>NOTA</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="footer-info">
      <span>EL SERRUCHO GO v1.1.0</span>
      <span>VALIDACIÓN DE INVENTARIO</span>
    </div>
  </div>
</body>
</html>`;
}
