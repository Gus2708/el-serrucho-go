(global as any).__DEV__ = true;

jest.mock('../lib/supabase', () => ({
  supabase: {},
}));

import { buildBarcodeSearchVariants, cleanScannedBarcode } from './useProductos';

describe('buildBarcodeSearchVariants & cleanScannedBarcode', () => {
  it('incluye versión EAN-13 (0 + 12 dígitos) y sin ceros iniciales para un UPC-A de 12 dígitos', () => {
    const variants = buildBarcodeSearchVariants('028877543210');
    expect(variants).toContain('028877543210');
    expect(variants).toContain('0028877543210');
    expect(variants).toContain('28877543210');
  });

  it('incluye versión UPC-A (12 dígitos) y sin ceros iniciales cuando el escáner devuelve EAN-13 con 0 inicial', () => {
    const variants = buildBarcodeSearchVariants('0076174209876');
    expect(variants).toContain('0076174209876');
    expect(variants).toContain('076174209876');
    expect(variants).toContain('76174209876');
  });

  it('expande códigos UPC-E (6 u 8 dígitos) a su UPC-A (12 dígitos) y EAN-13 (13 dígitos) equivalentes y viceversa', () => {
    // UPC-E 04252614 <-> UPC-A 042100005264 <-> EAN-13 0042100005264
    const fromUpce8 = buildBarcodeSearchVariants('04252614');
    expect(fromUpce8).toContain('04252614');
    expect(fromUpce8).toContain('425261');
    expect(fromUpce8).toContain('042100005264');
    expect(fromUpce8).toContain('0042100005264');

    const fromUpca = buildBarcodeSearchVariants('042100005264');
    expect(fromUpca).toContain('042100005264');
    expect(fromUpca).toContain('04252614');
    expect(fromUpca).toContain('425261');
  });

  it('extrae el EAN-13 / UPC-A unitario desde un código de caja ITF-14 / DUN-14 / GTIN-14 de 14 dígitos', () => {
    // ITF-14 con indicador de empaque 1 para el EAN-13 7591234000018 -> 17591234000015
    const variants = buildBarcodeSearchVariants('17591234000015');
    expect(variants).toContain('17591234000015');
    expect(variants).toContain('7591234000018');
  });

  it('extrae el GTIN y EAN-13 desde un código GS1-128 / DataBar con prefijo ]C1 o AI (01)', () => {
    const cleaned = cleanScannedBarcode(']C10107591234000018');
    const variants = buildBarcodeSearchVariants(cleaned);
    expect(variants).toContain('07591234000018');
    expect(variants).toContain('7591234000018');
  });

  it('genera variantes con y sin caracteres de guarda para Codabar (A..D) y Code 39 (*)', () => {
    const codabarVariants = buildBarcodeSearchVariants('A40156B');
    expect(codabarVariants).toContain('A40156B');
    expect(codabarVariants).toContain('40156');

    const code39Cleaned = cleanScannedBarcode('*FER-990*');
    expect(code39Cleaned).toBe('FER-990');
    const code39Variants = buildBarcodeSearchVariants('*FER-990*');
    expect(code39Variants).toContain('FER-990');
  });

  it('mantiene un EAN-13 estándar', () => {
    const variants = buildBarcodeSearchVariants('7591234000018');
    expect(variants).toContain('7591234000018');
  });
});
