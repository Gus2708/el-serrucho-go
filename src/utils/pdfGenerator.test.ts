// Mock react-native and expo-print so the module can be imported in node environment
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-print', () => ({ printAsync: jest.fn() }));

import { buildPdfHtml, buildPresupuestoPdfHtml, DraftItem } from './pdfGenerator';

const ITEMS: DraftItem[] = [
  {
    codigo_producto:   'ABC-001',
    descripcion:       'Tornillo 1/4"',
    existencia_actual: 10,
    nueva_existencia:  15,
    nota:              'Urgente',
  },
];

describe('buildPdfHtml', () => {
  it('returns valid HTML', () => {
    const html = buildPdfHtml(ITEMS, 'Nota de prueba', 42, 'Admin');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('ORDEN #00042');
    expect(html).toContain('ABC-001');
    expect(html).toContain('Admin');
    expect(html).toContain('Nota de prueba');
  });

  it('escapes HTML in item fields', () => {
    const xssItems: DraftItem[] = [
      { ...ITEMS[0], descripcion: '<script>alert("xss")</script>' },
    ];
    const html = buildPdfHtml(xssItems, '', 1);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders without creadoPor', () => {
    const html = buildPdfHtml(ITEMS, '', 1);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('undefined');
  });
});

describe('buildPresupuestoPdfHtml', () => {
  it('returns valid HTML with null client', () => {
    const html = buildPresupuestoPdfHtml(null, [], '', 1, undefined);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('PRESUPUESTO');
  });
});

describe('getPresupuestoFilename and sanitizeFilename', () => {
  it('sanitizes filenames correctly', () => {
    const { sanitizeFilename } = require('./pdfGenerator');
    expect(sanitizeFilename('Maria José / C.A.')).toBe('Maria_José_CA');
    expect(sanitizeFilename('   Juan   ')).toBe('Juan');
    expect(sanitizeFilename('Abc!?@#$123')).toBe('Abc123');
  });

  it('generates the correct presupuesto filename with and without client', () => {
    const { getPresupuestoFilename } = require('./pdfGenerator');
    expect(getPresupuestoFilename(null, 123)).toBe('Presupuesto_#123.pdf');
    expect(getPresupuestoFilename({ nombre: 'Maria' } as any, 3344343)).toBe('Presupuesto_Maria_#3344343.pdf');
    expect(getPresupuestoFilename({ nombre: 'Ferretería El Sol C.A.' } as any, 99)).toBe('Presupuesto_Ferretería_El_Sol_CA_#99.pdf');
  });
});
