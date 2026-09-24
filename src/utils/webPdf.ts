/**
 * Native stub for webPdf functions.
 * Real web implementations live in webPdf.web.ts.
 * This prevents jspdf and html2canvas-pro from being bundled into Hermes on Android/iOS,
 * which causes "RangeError: Unknown encoding: latin1".
 */

export async function htmlToPdfBlob(html: string): Promise<Blob> {
  return new Blob([html], { type: 'application/pdf' });
}

export async function downloadOrSharePdfWeb(_blob: Blob, _filename = 'documento.pdf'): Promise<void> {
  // No-op on native platforms
}

export async function printWebPdf(_html: string, _filename = 'documento.pdf'): Promise<void> {
  // No-op on native platforms
}
