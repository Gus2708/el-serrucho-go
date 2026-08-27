// Mock react-native and expo-print so the module can be imported in node environment
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-print', () => ({ printAsync: jest.fn() }));

import { buildPdfHtml, buildPresupuestoPdfHtml, buildVentaPdfHtml } from './pdfGenerator';

describe('PDF Generator Security & XSS Sanitization', () => {
  const xssPayload = '<script>alert("XSS")</script><img src=x onerror=stealCookies()>';

  it('escapes malicious HTML in change order PDF (buildPdfHtml)', () => {
    const html = buildPdfHtml(
      [
        {
          codigo_producto: 'COD-1',
          descripcion: 'Producto 1',
          existencia_actual: 10,
          nueva_existencia: 15,
          nota: '',
        },
      ],
      xssPayload, // malicious nota
      101,
      xssPayload // malicious creadoPor
    );

    // Raw script tags MUST NOT appear in the generated HTML
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x onerror=stealCookies()>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=stealCookies()&gt;');
  });

  it('escapes malicious client details and note in quote PDF (buildPresupuestoPdfHtml)', () => {
    const maliciousCliente = {
      codigo_cliente: 'CLI-01',
      nombre: 'Cliente <script>alert(1)</script>',
      rif: 'J-12345678-0 <b>bold</b>',
      telefono: '0414-0000000 <style>body{color:red}</style>',
      direccion: 'Av Principal <iframe src="evil.com"></iframe>',
    };

    const html = buildPresupuestoPdfHtml(
      maliciousCliente,
      [
        {
          producto: {
            codigo_interno: 'P-01',
            descripcion: 'Normal item',
            unidad: 'pz',
            codigo_barras: '123',
            costo: 10,
            precio_venta: 20,
            existencia: 5,
            actualizado_en: new Date().toISOString(),
          },
          cantidad: 2,
          precio_unitario: 20,
        },
      ],
      xssPayload, // malicious nota
      42, // presupuestoId
      xssPayload, // malicious creadoPor
      false, // enBs
      undefined, // tasaCambio
      undefined // porcentajeRecargo
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).not.toContain('<style>body{color:red}</style>');
    expect(html).not.toContain('<iframe src="evil.com"></iframe>');
    expect(html).not.toContain('<script>alert("XSS")</script>');

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('escapes malicious customer name, payment method and badge in sales receipt PDF (buildVentaPdfHtml)', () => {
    const maliciousVenta = {
      id: 999,
      documento: 'FAC-<script>alert("hack")</script>',
      created_at: new Date().toISOString(),
      nombre_cliente: 'Hacker <img src=x onerror=alert("pwned")>',
      metodo_pago: 'ZELLE <svg onload=alert(1)>',
      total_neto_usd: 100,
      total_bruto_usd: 86.21,
      total_impuesto_usd: 13.79,
    };

    const html = buildVentaPdfHtml(maliciousVenta, [
      {
        codigo_producto: 'ITEM-1',
        descripcion: 'Item 1',
        cantidad: 1,
        precio_unitario_usd: 100,
        subtotal_usd: 100,
      },
    ]);

    expect(html).not.toContain('<script>alert("hack")</script>');
    expect(html).not.toContain('<img src=x onerror=alert("pwned")>');
    expect(html).not.toContain('<svg onload=alert(1)>');

    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(&quot;pwned&quot;)&gt;');
    expect(html).toContain('&lt;svg onload=alert(1)&gt;');
  });
});
