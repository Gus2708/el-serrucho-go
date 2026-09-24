import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas-pro';

const getHtml2Canvas = () => {
  const h = html2canvas as any;
  return typeof h === 'function' ? h : h.default || h;
};

/**
 * Converts an HTML document string to a PDF Blob using an isolated iframe
 * and html2canvas-pro + jsPDF for full CSS/color (oklch) fidelity.
 */
export async function htmlToPdfBlob(html: string): Promise<Blob> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return new Blob([html], { type: 'application/pdf' });
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = '850px';
  iframe.style.height = '1200px';
  iframe.style.border = 'none';
  iframe.style.zIndex = '-9999';
  document.body.appendChild(iframe);

  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      throw new Error('Unable to access iframe document');
    }

    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    if (iframeDoc.fonts && iframeDoc.fonts.ready) {
      try {
        await iframeDoc.fonts.ready;
      } catch {
        // Proceed even if external font loading times out
      }
    }

    // Brief tick to ensure DOM layouts are evaluated
    await new Promise(resolve => setTimeout(resolve, 150));

    const targetElement = (iframeDoc.querySelector('.ticket') as HTMLElement) || iframeDoc.body;
    const renderFn = getHtml2Canvas();

    const canvas = await renderFn(targetElement, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: 850,
    });

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'letter',
    });

    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 20;
    const printableWidth = pageWidth - margin * 2;
    const printableHeight = pageHeight - margin * 2;

    const scale = printableWidth / canvas.width;
    const totalPdfHeight = canvas.height * scale;

    if (totalPdfHeight <= printableHeight) {
      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      pdf.addImage(imgData, 'JPEG', margin, margin, printableWidth, totalPdfHeight);
    } else {
      const pageHeightPx = printableHeight / scale;
      let currentY = 0;
      let pageIndex = 0;

      while (currentY < canvas.height) {
        const sliceHeightPx = Math.min(pageHeightPx, canvas.height - currentY);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeightPx;

        const ctx = sliceCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(
            canvas,
            0, currentY, canvas.width, sliceHeightPx,
            0, 0, canvas.width, sliceHeightPx
          );

          if (pageIndex > 0) {
            pdf.addPage('letter', 'portrait');
          }

          const sliceHeightPt = sliceHeightPx * scale;
          const sliceImgData = sliceCanvas.toDataURL('image/jpeg', 0.98);
          pdf.addImage(sliceImgData, 'JPEG', margin, margin, printableWidth, sliceHeightPt);
        }

        currentY += sliceHeightPx;
        pageIndex++;
      }
    }

    return pdf.output('blob');
  } finally {
    if (document.body.contains(iframe)) {
      document.body.removeChild(iframe);
    }
  }
}

/**
 * Shares the PDF using Web Share API Level 2 (mobile Chrome/Safari PWA)
 * or triggers a direct file download as fallback.
 */
export async function downloadOrSharePdfWeb(blob: Blob, filename: string): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  if (typeof navigator !== 'undefined' && typeof (navigator as any).canShare === 'function') {
    try {
      const file = new File([blob], filename, { type: 'application/pdf' });
      if ((navigator as any).canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return;
      }
    } catch (shareErr: any) {
      if (shareErr.name === 'AbortError') {
        return;
      }
      console.warn('Web share failed, falling back to direct download:', shareErr);
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (typeof document !== 'undefined' && document.body && document.body.contains(a)) {
      document.body.removeChild(a);
    }
    if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(blobUrl);
    }
  }, 1000);
}

/**
 * Complete Web PDF handler: converts HTML to PDF blob and shares/downloads it.
 */
export async function printWebPdf(html: string, filename = 'documento.pdf'): Promise<void> {
  try {
    const blob = await htmlToPdfBlob(html);
    await downloadOrSharePdfWeb(blob, filename);
  } catch (error) {
    console.error('Error generating web PDF, attempting fallback:', error);
    if (typeof document !== 'undefined') {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename.replace(/\.pdf$/i, '.html');
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        if (typeof document !== 'undefined' && document.body && document.body.contains(link)) {
          document.body.removeChild(link);
        }
        if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(url);
        }
      }, 1000);
    }
  }
}
