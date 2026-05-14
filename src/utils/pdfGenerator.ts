import { Cliente, PresupuestoItem } from '../hooks/usePresupuestoStore';

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
      <tr style="border-bottom: 1px solid #cbd5e1;">
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
    border: 1px solid #475569;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }

  .header { 
    display: flex; 
    align-items: center; 
    justify-content: space-between;
    border-bottom: 2px solid #475569; 
    padding-bottom: 20px; 
    margin-bottom: 30px; 
  }
  
  .logo-text { 
    font-size: 28px; 
    font-weight: 800; 
    color: #f59e0b; 
    text-transform: uppercase;
    letter-spacing: -0.5px;
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
    background: #f1f5f9;
    border-radius: 8px;
    border: 1px solid #475569;
  }

  .meta-item { font-size: 14px; color: #475569; }
  .meta-item strong { color: #0f172a; font-size: 11px; text-transform: uppercase; margin-right: 12px; opacity: 0.8; }
  
  .note-section { 
    border-radius: 4px;
    border-left: 4px solid #f59e0b; 
    padding: 20px; 
    margin-bottom: 30px; 
    background: #fffbeb;
    font-size: 13px;
    color: #92400e;
  }
  
  table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
  th { background: #e2e8f0; color: #0f172a; padding: 12px 15px; text-align: left; font-size: 11px; font-weight: 800; text-transform: uppercase; border-bottom: 2px solid #475569; border-top: 1px solid #475569; }
  td { padding: 12px 15px; font-size: 13px; color: #1e293b; }

  .footer-info { 
    margin-top: auto;
    padding-top: 30px;
    border-top: 1px solid #475569;
    display: flex; 
    justify-content: space-between; 
    color: #64748b; 
    font-size: 12px; 
    font-weight: 500;
  }

  @media print {
    body { background: #fff !important; padding: 0 !important; }
    .ticket { 
      box-shadow: none !important; 
      border: 1px solid #cbd5e1 !important; 
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
      <span class="logo-text">EL SERRUCHO</span>
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
      <span>EL SERRUCHO v1.1.0</span>
      <span>VALIDACIÓN DE INVENTARIO</span>
    </div>
  </div>
</body>
</html>`;
}

export function buildPresupuestoPdfHtml(cliente: Cliente | null, items: any[], nota: string, presupuestoId: number): string {
  const now  = new Date().toLocaleString('es-VE');
  const rows = items.map(item => {
    const code = item.producto ? item.producto.codigo_interno : item.codigo_producto;
    const desc = item.producto ? item.producto.descripcion : item.descripcion;
    return `
      <tr style="border-bottom: 1px solid #cbd5e1;">
        <td style="font-family: 'JetBrains Mono'; font-weight: 700; color: #000; font-size: 14px; background: transparent !important; border: none !important;">${code}</td>
        <td style="color: #444; font-size: 14px; background: transparent !important; border: none !important;">${desc}</td>
        <td style="text-align:center; color: #666; background: transparent !important; border: none !important;">${item.cantidad}</td>
        <td style="text-align:right; color: #000; background: transparent !important; border: none !important;">$${item.precio_unitario.toFixed(2)}</td>
        <td style="text-align:right; color: #000; font-weight: 700; font-size: 16px; background: transparent !important; border: none !important;">$${(item.cantidad * item.precio_unitario).toFixed(2)}</td>
      </tr>`;
  }).join('');

  const totalUsd = items.reduce((acc, item) => acc + (item.cantidad * item.precio_unitario), 0).toFixed(2);

  const clienteInfo = cliente ? `
    <div class="meta-container" style="display: flex; flex-direction: column; gap: 8px; height: 100%; box-sizing: border-box; justify-content: center;">
      <div class="meta-item"><strong>CLIENTE</strong> ${cliente.nombre}</div>
      <div class="meta-item"><strong>RIF/CI</strong> ${cliente.rif}</div>
      ${cliente.telefono ? `<div class="meta-item"><strong>TELÉFONO</strong> ${cliente.telefono}</div>` : ''}
      ${cliente.direccion ? `<div class="meta-item"><strong>DIRECCIÓN</strong> ${cliente.direccion}</div>` : ''}
    </div>
  ` : `
    <div class="meta-container" style="display: flex; flex-direction: column; height: 100%; box-sizing: border-box; justify-content: center;">
      <div class="meta-item"><strong>CLIENTE</strong> Cliente Casual</div>
    </div>
  `;

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
    border: 1px solid #475569;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }

  .header { 
    display: flex; 
    align-items: center; 
    justify-content: space-between;
    border-bottom: 2px solid #475569; 
    padding-bottom: 20px; 
    margin-bottom: 30px; 
  }
  
  .logo-text { 
    font-size: 28px; 
    font-weight: 800; 
    color: #f59e0b; 
    text-transform: uppercase;
    letter-spacing: -0.5px;
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
    margin-bottom: 0;
    padding: 20px;
    background: #f1f5f9;
    border-radius: 8px;
    border: 1px solid #475569;
  }

  .meta-item { font-size: 14px; color: #475569; }
  .meta-item strong { color: #0f172a; font-size: 11px; text-transform: uppercase; margin-right: 12px; opacity: 0.8; }
  
  .note-section { 
    border-radius: 4px;
    border-left: 4px solid #f59e0b; 
    padding: 20px; 
    margin-bottom: 30px; 
    background: #fffbeb;
    font-size: 13px;
    color: #92400e;
  }
  
  table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
  th { background: #e2e8f0; color: #0f172a; padding: 12px 15px; text-align: left; font-size: 11px; font-weight: 800; text-transform: uppercase; border-bottom: 2px solid #475569; border-top: 1px solid #475569; }
  td { padding: 12px 15px; font-size: 13px; color: #1e293b; }

  .total-row {
    border-top: 2px solid #475569;
    font-weight: 800;
    font-size: 18px;
  }
  .total-row td {
    padding-top: 20px;
  }

  .footer-info { 
    margin-top: auto;
    padding-top: 30px;
    border-top: 1px solid #475569;
    display: flex; 
    justify-content: space-between; 
    color: #64748b; 
    font-size: 12px; 
    font-weight: 500;
  }

  @media print {
    body { background: #fff !important; padding: 0 !important; }
    .ticket { 
      box-shadow: none !important; 
      border: 1px solid #cbd5e1 !important; 
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
      <span class="logo-text">EL SERRUCHO</span>
      <div class="order-id">PRESUPUESTO #${String(presupuestoId).padStart(5,'0')}</div>
    </div>

    <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 35px; align-items: stretch;">
      <div style="flex: 1;">
        ${clienteInfo}
      </div>
      <div style="flex: 1;">
        <div class="meta-container" style="display: flex; flex-direction: column; gap: 8px; height: 100%; box-sizing: border-box; justify-content: center;">
          <div class="meta-item"><strong>FECHA DE EMISIÓN</strong> ${now}</div>
        </div>
      </div>
    </div>

    ${nota ? `<div class="note-section"><strong>OBSERVACIONES:</strong><br/>${nota}</div>` : ''}

    <table>
      <thead>
        <tr>
          <th>CÓDIGO</th>
          <th>DESCRIPCIÓN</th>
          <th style="text-align:center;">CANTIDAD</th>
          <th style="text-align:right;">P. UNIT</th>
          <th style="text-align:right;">SUBTOTAL</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td colspan="3"></td>
          <td style="text-align:right;">TOTAL USD:</td>
          <td style="text-align:right;">$${totalUsd}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer-info">
      <span>EL SERRUCHO v1.1.0</span>
      <span>DOCUMENTO NO FISCAL</span>
    </div>
  </div>
</body>
</html>`;
}
