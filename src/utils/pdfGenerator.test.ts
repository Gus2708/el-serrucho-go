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
