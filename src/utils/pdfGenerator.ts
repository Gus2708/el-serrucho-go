import { Platform } from 'react-native';
import * as Print from 'expo-print';
import { Cliente, PresupuestoItem } from '../hooks/usePresupuestoStore';

export interface DraftItem {
  codigo_producto:   string;
  descripcion:       string;
  existencia_actual: number;
  nueva_existencia:  number;
  nota:              string;
}

/* ─── Shared CSS tokens ──────────────────────────────────── */
const SHARED_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@500;700&display=swap');

  :root {
    /* Brand palette — warm slate tinted toward amber */
    --ink:          oklch(0.18 0.02 70);
    --ink-soft:     oklch(0.35 0.015 70);
    --ink-muted:    oklch(0.50 0.01 70);
    --surface:      oklch(0.985 0.005 70);
    --surface-alt:  oklch(0.955 0.008 70);
    --border:       oklch(0.82 0.012 70);
    --border-light: oklch(0.90 0.008 70);
    --accent:       oklch(0.72 0.17 75);
    --accent-dark:  oklch(0.45 0.14 75);
    --positive:     oklch(0.62 0.18 155);
    --negative:     oklch(0.58 0.22 25);
    --white:        oklch(0.995 0.002 70);

    /* Type */
    --font-body: 'DM Sans', system-ui, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, monospace;

    /* Spacing (4pt scale) */
    --sp-2: 8px;
    --sp-3: 12px;
    --sp-4: 16px;
    --sp-5: 20px;
    --sp-6: 24px;
    --sp-8: 32px;
    --sp-10: 40px;
    --sp-12: 48px;
  }

  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  @page { margin: 10mm; }
  @media print {
    body { background: white !important; padding: 0 !important; margin: 0 !important; }
    .ticket {
      box-shadow: none !important;
      border: 1px solid var(--border-light) !important;
      max-width: 100% !important;
      border-radius: 0 !important;
    }
  }

  body {
    font-family: var(--font-body);
    background: var(--surface);
    color: var(--ink);
    margin: 0;
    padding: var(--sp-10) var(--sp-4);
    display: flex;
    justify-content: center;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .ticket {
    width: 100%;
    max-width: 820px;
    background: var(--white);
    padding: var(--sp-10) var(--sp-10) var(--sp-8);
    border: 1px solid var(--border);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    box-shadow:
      0 1px 3px oklch(0.18 0.02 70 / 0.06),
      0 8px 24px oklch(0.18 0.02 70 / 0.04);
  }

  /* ── Header ──────────────────────────────────── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--sp-5);
    margin-bottom: var(--sp-6);
    border-bottom: 2px solid var(--ink);
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: var(--sp-3);
  }

  .brand-name {
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 700;
    color: var(--ink);
    letter-spacing: -0.5px;
  }

  .brand-accent {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    display: inline-block;
    margin-left: 2px;
    vertical-align: super;
  }

  .doc-badge {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--white);
    background: var(--ink);
    padding: 6px 14px;
    border-radius: 6px;
    letter-spacing: 0.5px;
  }

  /* ── Meta grid ───────────────────────────────── */
  .meta-grid {
    display: flex;
    gap: var(--sp-4);
    margin-bottom: var(--sp-6);
  }

  .meta-card {
    flex: 1;
    background: var(--surface-alt);
    border: 1px solid var(--border-light);
    border-radius: 8px;
    padding: var(--sp-4) var(--sp-5);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .meta-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--ink-muted);
  }

  .meta-value {
    font-size: 14px;
    font-weight: 500;
    color: var(--ink);
  }

  /* ── Note / Observations ─────────────────────── */
  .note-box {
    background: oklch(0.96 0.03 75);
    border: 1px solid oklch(0.88 0.06 75);
    border-radius: 8px;
    padding: var(--sp-4) var(--sp-5);
    margin-bottom: var(--sp-6);
    font-size: 13px;
    color: var(--accent-dark);
    line-height: 1.6;
  }

  .note-box strong {
    font-weight: 600;
    display: block;
    margin-bottom: 4px;
    font-size: 10px;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: oklch(0.38 0.10 75);
  }

  /* ── Table ───────────────────────────────────── */
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin-bottom: var(--sp-8);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  thead th {
    background: var(--ink);
    color: var(--white);
    padding: var(--sp-3) var(--sp-4);
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    border: none;
  }

  thead th:first-child { padding-left: var(--sp-5); }
  thead th:last-child  { padding-right: var(--sp-5); }

  tbody td {
    padding: var(--sp-3) var(--sp-4);
    font-size: 13px;
    color: var(--ink);
    border-bottom: 1px solid var(--border-light);
  }

  tbody td:first-child { padding-left: var(--sp-5); }
  tbody td:last-child  { padding-right: var(--sp-5); }

  tbody tr:nth-child(even) td {
    background: var(--surface-alt);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  .col-code {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 13px;
    color: var(--ink);
    white-space: nowrap;
  }

  .col-desc {
    color: var(--ink-soft);
    font-size: 13px;
    max-width: 280px;
  }

  .col-num {
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .col-num-muted {
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--ink-muted);
  }

  .col-delta-pos {
    text-align: center;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 14px;
    color: var(--positive);
  }

  .col-delta-neg {
    text-align: center;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 14px;
    color: var(--negative);
  }

  .col-note {
    font-size: 12px;
    color: var(--ink-muted);
    font-style: italic;
    max-width: 140px;
  }

  .col-money {
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    white-space: nowrap;
  }

  .col-money-bold {
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 15px;
    white-space: nowrap;
  }

  /* ── Total section (outside table — page-break safe) ── */
  .total-section {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--sp-8);
    padding: var(--sp-4) 0 var(--sp-6);
    border-top: 2px solid var(--ink);
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .total-section-multi {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    padding: var(--sp-4) 0 var(--sp-6);
    border-top: 2px solid var(--ink);
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .total-line {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--sp-8);
  }

  .total-line-grand {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--sp-8);
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }

  .total-label {
    font-weight: 700;
    font-size: 13px;
    color: var(--ink);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    min-width: 100px;
    text-align: right;
  }

  .total-amount {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 20px;
    color: var(--ink);
    text-align: right;
    min-width: 130px;
  }

  .total-amount-lg {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 26px;
    color: var(--accent-dark);
    text-align: right;
    min-width: 130px;
  }

  .total-label-lg {
    font-weight: 700;
    font-size: 15px;
    color: var(--accent-dark);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    min-width: 100px;
    text-align: right;
  }

  /* ── Footer ──────────────────────────────────── */
  .footer {
    margin-top: auto;
    padding-top: var(--sp-5);
    border-top: 1px solid var(--border-light);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .footer-left,
  .footer-right {
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-muted);
    letter-spacing: 0.3px;
  }

  .footer-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent);
    display: inline-block;
    margin: 0 6px;
    vertical-align: middle;
  }

  /* ── Print overrides ─────────────────────────── */
  @media print {
    body { background: white !important; padding: 0 !important; }
    .ticket {
      box-shadow: none !important;
      border: none !important;
      padding: 24px;
      max-width: none;
      width: 100%;
      border-radius: 0;
    }
    table {
      overflow: visible !important;
      border-radius: 0 !important;
    }
  }
`;

/* ─── Shared document shell ──────────────────────────────── */
interface PdfDocumentOptions {
  docBadge:    string;
  metaCards:   string;
  noteHtml:    string;
  tableHtml:   string;
  footerLeft:  string;
  footerRight: string;
}

function buildPdfDocument(opts: PdfDocumentOptions): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="ticket">

    <div class="header">
      <div class="brand">
        <span class="brand-name">EL SERRUCHO</span>
        <span class="brand-accent"></span>
      </div>
      <div class="doc-badge">${opts.docBadge}</div>
    </div>

    <div class="meta-grid">
      ${opts.metaCards}
    </div>

    ${opts.noteHtml}

    ${opts.tableHtml}

    <div class="footer">
      <span class="footer-left">${opts.footerLeft}</span>
      <span class="footer-dot"></span>
      <span class="footer-right">${opts.footerRight}</span>
    </div>

  </div>
</body>
</html>`;
}

/* ─── Inventory Adjustment PDF ──────────────────────────── */
export function buildPdfHtml(items: DraftItem[], nota: string, orderId: number, creadoPor?: string): string {
  const now = new Date().toLocaleString('es-VE');

  const rows = items.map((item) => {
    const delta = item.nueva_existencia - item.existencia_actual;
    const sign  = delta >= 0 ? '+' : '';
    const cls   = delta >= 0 ? 'col-delta-pos' : 'col-delta-neg';

    return `
      <tr>
        <td class="col-code">${escHtml(item.codigo_producto ?? '')}</td>
        <td class="col-desc">${escHtml(item.descripcion ?? '')}</td>
        <td class="col-num-muted">${item.existencia_actual}</td>
        <td class="col-num">${item.nueva_existencia}</td>
        <td class="${cls}">${sign}${delta}</td>
        <td class="col-note">${escHtml(item.nota || '—')}</td>
      </tr>`;
  }).join('');

  const metaCards = `
      <div class="meta-card">
        <span class="meta-label">Fecha y Hora</span>
        <span class="meta-value">${now}</span>
      </div>
      <div class="meta-card">
        <span class="meta-label">Total Ítems</span>
        <span class="meta-value">${items.length}</span>
      </div>
      ${creadoPor ? `
      <div class="meta-card">
        <span class="meta-label">Creado por</span>
        <span class="meta-value">${creadoPor}</span>
      </div>` : `
      <div class="meta-card">
        <span class="meta-label">Tipo de Documento</span>
        <span class="meta-value">Validación de Inventario</span>
      </div>`}`;

  const noteHtml = nota ? `
    <div class="note-box">
      <strong>Observaciones</strong>
      ${nota}
    </div>` : '';

  const tableHtml = `
    <table>
      <thead>
        <tr>
          <th>Código</th>
          <th>Descripción</th>
          <th style="text-align:center;">Actual</th>
          <th style="text-align:center;">Nueva</th>
          <th style="text-align:center;">Ajuste</th>
          <th>Nota</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  return buildPdfDocument({
    docBadge:    `ORDEN #${String(orderId).padStart(5, '0')}`,
    metaCards,
    noteHtml,
    tableHtml,
    footerLeft:  'EL SERRUCHO v1.1.0',
    footerRight: 'VALIDACIÓN DE INVENTARIO',
  });
}

function escHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── Budget / Presupuesto PDF ──────────────────────────── */
export function buildPresupuestoPdfHtml(
  cliente: Cliente | null,
  items: any[],
  nota: string,
  presupuestoId: number,
  creadoPor?: string,
): string {
  const now = new Date().toLocaleString('es-VE');

  const rows = items.map((item) => {
    const code = item.producto ? item.producto.codigo_interno : item.codigo_producto;
    const desc = item.producto ? item.producto.descripcion : item.descripcion;
    const qty   = Number(item.cantidad) || 0;
    const price = Number(item.precio_unitario) || 0;
    return `
      <tr>
        <td class="col-code">${escHtml(code ?? '')}</td>
        <td class="col-desc">${escHtml(desc ?? '')}</td>
        <td class="col-num">${qty}</td>
        <td class="col-money">$${price.toFixed(2)}</td>
        <td class="col-money-bold">$${(qty * price).toFixed(2)}</td>
      </tr>`;
  }).join('');

  const totalUsd = items
    .reduce((acc, item) => acc + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0), 0)
    .toFixed(2);

  const clienteCard = cliente
    ? `
      <div class="meta-card" style="flex:1.2;">
        <span class="meta-label">Cliente</span>
        <span class="meta-value">${cliente.nombre}</span>
        <span class="meta-label" style="margin-top:4px;">RIF / CI</span>
        <span class="meta-value">${cliente.rif}</span>
        ${cliente.telefono ? `<span class="meta-label" style="margin-top:4px;">Teléfono</span><span class="meta-value">${cliente.telefono}</span>` : ''}
        ${cliente.direccion ? `<span class="meta-label" style="margin-top:4px;">Dirección</span><span class="meta-value">${cliente.direccion}</span>` : ''}
      </div>`
    : `
      <div class="meta-card" style="flex:1.2;">
        <span class="meta-label">Cliente</span>
        <span class="meta-value">Cliente Casual</span>
      </div>`;

  const metaCards = `
      ${clienteCard}
      <div class="meta-card">
        <span class="meta-label">Fecha de Emisión</span>
        <span class="meta-value">${now}</span>
        ${creadoPor ? `<span class="meta-label" style="margin-top:4px;">Creado por</span><span class="meta-value">${creadoPor}</span>` : ''}
      </div>`;

  const noteHtml = nota ? `
    <div class="note-box">
      <strong>Observaciones</strong>
      ${nota}
    </div>` : '';

  const tableHtml = `
    <table>
      <thead>
        <tr>
          <th>Código</th>
          <th>Descripción</th>
          <th style="text-align:center;">Cantidad</th>
          <th style="text-align:right;">P. Unit</th>
          <th style="text-align:right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="total-section">
      <span class="total-label">Total USD</span>
      <span class="total-amount">$${totalUsd}</span>
    </div>`;

  return buildPdfDocument({
    docBadge:    `PRESUPUESTO #${String(presupuestoId).padStart(5, '0')}`,
    metaCards,
    noteHtml,
    tableHtml,
    footerLeft:  'EL SERRUCHO v1.1.0',
    footerRight: 'DOCUMENTO NO FISCAL',
  });
}

/* ─── Sale / Venta PDF ──────────────────────────── */
export function buildVentaPdfHtml(
  venta: any,
  items: any[],
): string {
  const now = new Date(venta.created_at).toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const rows = items.map((item) => `
    <tr>
      <td class="col-code">${escHtml(item.codigo_producto ?? '')}</td>
      <td class="col-desc">${escHtml(item.descripcion ?? '')}</td>
      <td class="col-num">${Number(item.cantidad) || 0}</td>
      <td class="col-money">$${Number(item.precio_unitario_usd).toFixed(2)}</td>
      <td class="col-money-bold">$${Number(item.subtotal_usd).toFixed(2)}</td>
    </tr>`).join('');

  const totalUSD = Number(venta.total_neto_usd || venta.total_usd || 0);
  const baseUSD  = venta.total_bruto_usd > 0
    ? Number(venta.total_bruto_usd)
    : totalUSD / 1.16;
  const ivaUSD   = venta.total_impuesto_usd > 0
    ? Number(venta.total_impuesto_usd)
    : totalUSD - baseUSD;

  const metaCards = `
      <div class="meta-card" style="flex:1.2;">
        <span class="meta-label">Cliente</span>
        <span class="meta-value">${venta.nombre_cliente || 'Cliente Casual'}</span>
      </div>
      <div class="meta-card">
        <span class="meta-label">Fecha y Hora</span>
        <span class="meta-value">${now}</span>
      </div>
      <div class="meta-card">
        <span class="meta-label">Método de Pago</span>
        <span class="meta-value">${venta.metodo_pago || 'No especificado'}</span>
      </div>`;

  const tableHtml = `
    <table>
      <thead>
        <tr>
          <th>Código</th>
          <th>Descripción</th>
          <th style="text-align:center;">Cant.</th>
          <th style="text-align:right;">P. Unit</th>
          <th style="text-align:right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="total-section-multi">
      <div class="total-line">
        <span class="total-label">Subtotal</span>
        <span class="total-amount">$${baseUSD.toFixed(2)}</span>
      </div>
      <div class="total-line">
        <span class="total-label">IVA (16%)</span>
        <span class="total-amount">$${ivaUSD.toFixed(2)}</span>
      </div>
      <div class="total-line-grand">
        <span class="total-label-lg">Total USD</span>
        <span class="total-amount-lg">$${totalUSD.toFixed(2)}</span>
      </div>
    </div>`;

  return buildPdfDocument({
    docBadge:    `RECIBO DE VENTA ${venta.documento || `#${venta.venta_id || venta.id}`}`,
    metaCards,
    noteHtml:    '',
    tableHtml,
    footerLeft:  'EL SERRUCHO v1.1.0',
    footerRight: 'RECIBO DE VENTA - DOCUMENTO NO FISCAL',
  });
}

/**
 * Robustly triggers the print dialog for a given HTML string.
 * On Web, it uses an iframe-based approach (via expo-print) to avoid opening new windows/tabs,
 * which is critical for a smooth PWA experience.
 */
export async function printHtml(html: string) {
  if (Platform.OS !== 'web') {
    try {
      await Print.printAsync({ html });
    } catch (error) {
      console.error('Error printing PDF native:', error);
    }
    return;
  }

  // Web: Use an isolated hidden iframe for clean printing without opening new tabs.
  // This avoids capturing the main application UI and provides better styling control.
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '-10000px';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow?.document;
  if (!iframeDoc) {
    // Fallback: download as HTML if iframe fails
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'documento.html';
    link.click();
    return;
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  // Give it a moment to load fonts/styles
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      // Cleanup after a delay to ensure print dialog was triggered
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 2000);
    } catch (e) {
      console.error('Error during web print:', e);
    }
  }, 600);
}
