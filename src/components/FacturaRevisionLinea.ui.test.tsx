import * as React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import FacturaRevisionLinea, { type FacturaRevisionLineaProps } from './FacturaRevisionLinea';
import { matchInvoiceLines, type HybridLineRanks, type LineMatch, type SupplierAlias, MATCHING_NORMALIZATION_VERSION } from '../lib/facturaMatching';
import type { ExtraidaLinea } from '../lib/facturaExtractionContract';
import type { LineaEfectiva } from '../lib/facturaRevision';
import type { Producto } from '../lib/producto';
import { ThemeProvider } from '../theme/ThemeContext';
import { elSerrucho } from '../theme/brands/el-serrucho';

jest.mock('./BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('../test-utils/facturaUiHarness').asyncStorage,
}));

const SUPPLIER = 'J-123456789';
const ID = 'revision-linea-7';

function producto(codigo_interno: string, descripcion: string, over: Partial<Producto> = {}): Producto {
  return { codigo_interno, descripcion, unidad: 'UND', codigo_barras: '', costo: 1, precio_venta: 2, existencia: 0, actualizado_en: '2026-01-01T00:00:00Z', ...over } as Producto;
}

function lineaExtraida(over: Partial<ExtraidaLinea> = {}): ExtraidaLinea {
  return { numeroLinea: 7, pagina: 1, codigoProveedor: 'Z-RXB-2-20V', descripcion: 'BATERIA 20V (LI-ION) 24HORAS DE CARGA', cantidad: '1', unidad: 'UND', precioUnitario: '22.00', descuentos: [], tasaIva: null, total: '22.00', incertidumbre: null, ...over };
}

/** Real matcher output, so the UI is tested against the evidence the app really produces. */
function emparejar(linea: ExtraidaLinea, catalog: Producto[], extra: { hybridRanks?: HybridLineRanks[]; aliases?: SupplierAlias[] } = {}): LineMatch {
  const result = matchInvoiceLines({ supplierKey: SUPPLIER, lines: [linea], catalog, ...extra });
  if (!result.ok) throw new Error('fixture');
  return result.lines[0];
}

const CATALOGO_BATERIA = [
  producto('7453118025275', 'BATERIA 20V LITIO 24H CARGA ZASC'),
  producto('7453118025299', 'CARGADOR 2.0A 110V BATERIA 20V ZASC'),
  producto('CV-BC-75A', 'CARGADOR DE BATERIA COVO'),
  producto('CV-BAT-4AH', 'BATERIA O PILA 20V 4AMP COVO'),
  producto('00431', 'BATERIA RECARGABLE 20V / 20AH MARCA INGCO'),
];
const ORDEN_AUDITORIA = ['7453118025275', '7453118025299', 'CV-BC-75A', 'CV-BAT-4AH', '00431'];
const rangos = (): HybridLineRanks[] => [{ lineIndex: 0, lexical: ORDEN_AUDITORIA.map((codigoInterno, i) => ({ codigoInterno, rank: i + 1 })) }];

const valor = (v: string | null) => ({ valor: v, original: v, corregido: false, motivo: null });

function efectiva(over: Partial<ExtraidaLinea> = {}): LineaEfectiva {
  const l = lineaExtraida(over);
  return {
    lineaId: 'linea-7',
    numeroLinea: l.numeroLinea,
    campos: {
      codigoProveedor: valor(l.codigoProveedor),
      descripcion: valor(l.descripcion),
      cantidad: valor(l.cantidad),
      unidad: valor(l.unidad),
      precioUnitario: valor(l.precioUnitario),
      total: valor(l.total),
      tasaIva: valor(l.tasaIva),
    },
    descuentos: { valor: [], original: [], corregido: false, motivo: null },
    factorConversion: null,
    asociacion: { tipo: 'pendiente', codigoInterno: null, evidencia: null, motivo: null },
    usarCodigoFactura: true,
    lecturaOcr: null,
  } as unknown as LineaEfectiva;
}

function props(match: LineMatch | undefined, over: Partial<FacturaRevisionLineaProps> = {}): FacturaRevisionLineaProps {
  return {
    llave: '7',
    numero: '7',
    pagina: 1,
    efectiva: efectiva(),
    calculo: undefined,
    match,
    catalogoParcial: false,
    moneda: null,
    esUsd: true,
    estadoBarras: undefined,
    tipoDocumento: null,
    precioVenta: null,
    borradorPrecio: undefined,
    onBorradorPrecio: jest.fn(),
    onEditar: jest.fn(() => ({ ok: true })),
    onElegirCandidato: jest.fn(),
    estado: 'revisar',
    bloqueos: [],
    abierta: true,
    modo: 'detalle',
    onAlternar: jest.fn(),
    onSiguiente: jest.fn(),
    ...over,
  };
}

function draw(p: FacturaRevisionLineaProps) {
  return render(<ThemeProvider><FacturaRevisionLinea {...p} /></ThemeProvider>);
}

/** Visible strings of a subtree in document order. */
function textos(testID: string): string[] {
  return within(screen.getByTestId(testID)).queryAllByText(/./).map(el => [el.props.children].flat().join(''));
}

const tarjeta = (codigo: string) => `${ID}-tarjeta-${codigo}`;

describe('candidate cards', () => {
  it('keeps manual identity and its motive explicit, with the unchanged association payload', () => {
    const p = props(undefined);
    draw(p);
    fireEvent.press(screen.getByTestId(`${ID}-manual-abrir`));
    expect(screen.getByTestId(`${ID}-manual-codigo`).props.accessibilityLabel).toBe('Código del producto');
    fireEvent.changeText(screen.getByTestId(`${ID}-manual-codigo`), '00123');
    expect(screen.getByTestId(`${ID}-manual-aplicar`).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId(`${ID}-manual-motivo-sugerido`));
    expect(p.onEditar).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(`${ID}-manual-aplicar`));
    expect(p.onEditar).toHaveBeenCalledWith({ tipo: 'asociacion', lineaId: 'linea-7', asociacion: { tipo: 'confirmado', codigoInterno: '00123', evidencia: 'manual', motivo: 'La sugerencia era otro producto' } });
  });

  it('does not invent a new-product confirmation when opening the choice or selecting a motive', () => {
    const p = props(undefined);
    draw(p);
    fireEvent.press(screen.getByTestId(`${ID}-nuevo-abrir`));
    expect(screen.getByTestId(`${ID}-nuevo-aplicar`).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId(`${ID}-nuevo-motivo-sugerido`));
    expect(p.onEditar).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(`${ID}-nuevo-aplicar`));
    expect(p.onEditar).toHaveBeenCalledWith({ tipo: 'asociacion', lineaId: 'linea-7', asociacion: { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'No existe en el inventario' } });
  });

  it('lead with the description, keep the code secondary and offer a short Confirmar', () => {
    draw(props(emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() })));
    const orden = textos(tarjeta('7453118025275'));
    expect(orden[0]).toBe('BATERIA 20V LITIO 24H CARGA ZASC');
    expect(orden.findIndex(t => t.includes('7453118025275'))).toBeGreaterThan(0);
    expect(textos(`${ID}-candidato-7453118025275`)).toEqual(['Sí, es este']);
  });

  it('keep the audited retrieval order of the real matcher', () => {
    draw(props(emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() })));
    const ids = screen.getAllByTestId(/^revision-linea-7-tarjeta-/).map(el => el.props.testID.replace(`${ID}-tarjeta-`, ''));
    expect(ids).toEqual(ORDEN_AUDITORIA);
  });

  it('give the confirm button an accessible name that carries the product and code, and still call onElegirCandidato', () => {
    const p = props(emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() }));
    draw(p);
    const boton = screen.getByTestId(`${ID}-candidato-CV-BC-75A`);
    expect(boton.props.accessibilityRole).toBe('button');
    expect(boton.props.accessibilityLabel).toBe('Confirmar CARGADOR DE BATERIA COVO, código CV-BC-75A');
    fireEvent.press(boton);
    expect(p.onElegirCandidato).toHaveBeenCalledTimes(1);
    expect(p.onElegirCandidato).toHaveBeenCalledWith('CV-BC-75A');
  });

  it('show chips only from the real evidence: description similarity or retrieval, never a code match', () => {
    draw(props(emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() })));
    expect(textos(tarjeta('7453118025275'))).toContain('Descripción parecida');
    expect(textos(tarjeta('CV-BAT-4AH'))).toContain('Encontrado por la búsqueda');
    expect(textos(tarjeta('CV-BAT-4AH'))).not.toContain('Descripción parecida');
    expect(textos(tarjeta('00431'))).toContain('Encontrado por la búsqueda');
    expect(screen.queryByText('Código impreso coincide')).toBeNull();
    expect(screen.queryByText('Alias del proveedor')).toBeNull();
  });

  it('show the code and alias chips when the matcher found those sources', () => {
    const alias: SupplierAlias = { supplierKey: SUPPLIER, keyType: 'codigo_proveedor', keyValue: 'Z-RXB-2-20V', unit: null, codigoInterno: '00431', normalizationVersion: MATCHING_NORMALIZATION_VERSION };
    const conCodigo = [producto('A1', 'BATERIA 20V LITIO 24H CARGA', { codigo_barras: 'Z-RXB-2-20V' }), ...CATALOGO_BATERIA.slice(4)];
    draw(props(emparejar(lineaExtraida(), conCodigo, { aliases: [alias] })));
    expect(textos(tarjeta('A1'))).toContain('Código impreso coincide');
    expect(textos(tarjeta('00431'))).toContain('Alias del proveedor');
  });

  it('never print a percentage or score on a card', () => {
    draw(props(emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() })));
    for (const codigo of ORDEN_AUDITORIA) {
      expect(textos(tarjeta(codigo)).join(' ')).not.toMatch(/\d\s*%|puntaje|score|confianza/i);
    }
  });

  it('uses neutral border and text on unselected candidate confirm button and gold only when selected', () => {
    const match = emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() });
    const view = draw(props(match));
    const boton = screen.getByTestId(`${ID}-candidato-7453118025275`);
    const unselectedStyle = StyleSheet.flatten(boton.props.style);
    const unselectedTextStyle = StyleSheet.flatten(within(boton).getByText('Sí, es este').props.style);

    expect(unselectedStyle.borderColor).toBe(elSerrucho.colors.border);
    expect(unselectedTextStyle.color).toBe(elSerrucho.colors.text);

    const seleccionada = {
      ...efectiva(),
      asociacion: { tipo: 'confirmado' as const, codigoInterno: '7453118025275', evidencia: 'sugerencia' as const, motivo: null },
    };
    view.rerender(<ThemeProvider><FacturaRevisionLinea {...props(match, { efectiva: seleccionada })} /></ThemeProvider>);

    const selectedBtn = screen.getByTestId(`${ID}-candidato-7453118025275`);
    const selectedStyle = StyleSheet.flatten(selectedBtn.props.style);
    const selectedTextStyle = StyleSheet.flatten(within(selectedBtn).getByText('Sí, es este').props.style);
    expect(selectedStyle.borderColor).toBe(elSerrucho.colors.primary);
    expect(selectedStyle.backgroundColor).toBe(elSerrucho.colors.primaryFaded);
    expect(selectedTextStyle.color).toBe(elSerrucho.colors.primary);
  });
});

describe('recommended label', () => {
  const suggested = () => {
    const catalog = [producto('A1', 'BATERIA 20V LITIO 24H CARGA', { codigo_barras: 'Z-RXB-2-20V' }), producto('B1', 'BATERIA 20V LITIO 24H CARGA ZASC', { referencia: 'OTRO' } as Partial<Producto>)];
    return emparejar(lineaExtraida(), catalog);
  };

  it('marks only the top candidate when the matcher status is suggested', () => {
    const match = suggested();
    expect(match.status).toBe('suggested');
    draw(props(match));
    expect(screen.getAllByText('Recomendado')).toHaveLength(1);
    expect(textos(tarjeta(match.candidates[0].codigoInterno))).toContain('Recomendado');
  });

  it('is never shown for review status, even with the same top candidate', () => {
    const match = emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() });
    expect(match.status).toBe('review');
    draw(props(match));
    expect(screen.queryByText('Recomendado')).toBeNull();
  });

  it('is never shown for conflict status', () => {
    const catalog = [producto('A1', 'Tornillo', { codigo_barras: 'Z-RXB-2-20V' }), producto('A2', 'Tornillo', { codigo_barras: 'Z-RXB-2-20V' })];
    const match = emparejar(lineaExtraida({ descripcion: 'Tornillo' }), catalog);
    expect(match.status).toBe('conflict');
    draw(props(match));
    expect(screen.queryByText('Recomendado')).toBeNull();
    expect(screen.getByText('Hay señales en conflicto entre código y descripción: revisa con cuidado.')).toBeTruthy();
  });
});

describe('printed code that matched no candidate', () => {
  it('says that none of the shown candidates has the code, without claiming the product is missing', () => {
    draw(props(emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() })));
    const nota = screen.getByTestId(`${ID}-codigo-sin-coincidencia`);
    const texto = [nota.props.children].flat().join('');
    expect(texto).toBe('Entre estos candidatos, ninguno tiene el código impreso Z-RXB-2-20V.');
    expect(texto).not.toMatch(/no existe|no está|ausen|catálogo/i);
  });

  it('is not shown when a candidate does carry the printed code', () => {
    const catalog = [producto('A1', 'BATERIA 20V LITIO 24H CARGA', { codigo_barras: 'Z-RXB-2-20V' })];
    draw(props(emparejar(lineaExtraida(), catalog)));
    expect(screen.queryByTestId(`${ID}-codigo-sin-coincidencia`)).toBeNull();
  });

  it('is not shown when the line prints no code', () => {
    draw(props(emparejar(lineaExtraida({ codigoProveedor: null }), CATALOGO_BATERIA, { hybridRanks: rangos() }), { efectiva: efectiva({ codigoProveedor: null }) }));
    expect(screen.queryByTestId(`${ID}-codigo-sin-coincidencia`)).toBeNull();
  });
});

describe('partial catalog without candidates', () => {
  const vacio = () => emparejar(lineaExtraida({ codigoProveedor: 'QQQ', descripcion: 'ZZZZZZ' }), CATALOGO_BATERIA);

  it('keeps the no-proof warning and points to the manual SKU search', () => {
    draw(props(vacio(), { catalogoParcial: true }));
    const texto = [screen.getByTestId(`${ID}-sin-candidatos`).props.children].flat().join('');
    expect(texto).toMatch(/no prueba que el producto no exista/);
    expect(texto).toMatch(/Búscalo por su código antes de marcarlo como nuevo/);
  });

  it('opens the manual SKU panel from the warning action', () => {
    draw(props(vacio(), { catalogoParcial: true }));
    expect(screen.queryByTestId(`${ID}-manual-codigo`)).toBeNull();
    fireEvent.press(screen.getByTestId(`${ID}-sin-candidatos-sku`));
    expect(screen.getByTestId(`${ID}-manual-codigo`)).toBeTruthy();
  });

  it('offers no SKU shortcut when the catalog read was complete', () => {
    draw(props(vacio(), { catalogoParcial: false }));
    expect(screen.getByTestId(`${ID}-sin-candidatos`)).toBeTruthy();
    expect(screen.queryByTestId(`${ID}-sin-candidatos-sku`)).toBeNull();
  });
});

describe('quantity and cost in the detail', () => {
  it('shows the document quantity and unit cost without opening anything', () => {
    draw(props(undefined));
    const lectura = [screen.getByTestId(`${ID}-lectura`).props.children].flat().join('');
    expect(lectura).toBe('Leído de la factura: cantidad 1 · costo unitario $22.00');
  });

  it('hides the cost for a document that is not confirmed USD', () => {
    draw(props(undefined, { esUsd: false, moneda: 'VES' }));
    const lectura = [screen.getByTestId(`${ID}-lectura`).props.children].flat().join('');
    expect(lectura).toContain('cantidad 1');
    expect(lectura).toContain('Importe oculto: moneda VES sin conversión aprobada a USD');
    expect(lectura).not.toContain('22');
  });

  it('opens the correction fields from the affordance', () => {
    draw(props(undefined));
    expect(screen.queryByTestId(`${ID}-cantidad-valor`)).toBeNull();
    fireEvent.press(screen.getByTestId(`${ID}-lectura-corregir`));
    expect(screen.getByTestId(`${ID}-cantidad-valor`)).toBeTruthy();
    expect(screen.getByTestId(`${ID}-precioUnitario-valor`)).toBeTruthy();
  });
});


describe('honest candidate support', () => {
  it('explains missing suggestions in plain language without treating a partial search as absence', () => {
    const match = emparejar(lineaExtraida(), []);
    draw(props(match, { catalogoParcial: true, tipoDocumento: 'factura' }));
    expect(textos(`${ID}-sin-candidatos`).join(' ')).toBe('No se revisó todo el inventario: no encontrarlo aquí no prueba que el producto no exista. Búscalo por su código antes de marcarlo como nuevo.');
    expect(screen.getByText('Sin costo neto calculado para este producto: no hay precio sugerido.')).toBeTruthy();
  });

  it('shows description/search leads and unknown comparisons without claiming identity', () => {
    const match = emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() });
    draw(props(match));
    expect(textos(tarjeta('7453118025275'))).toContain('Pista por descripción');
    expect(textos(tarjeta('CV-BAT-4AH'))).toContain('Pista de búsqueda');
    expect(screen.getAllByText(/^No comparado: /).length).toBeGreaterThan(0);
    expect(screen.queryByText('Recomendado')).toBeNull();
    expect(screen.queryByText('Identidad respaldada')).toBeNull();
  });

  it('shows a candidate conflict and never recommends it even if status says suggested', () => {
    const match = emparejar(lineaExtraida({ codigoProveedor: 'A1', descripcion: 'Adhesivo blanco', unidad: 'UND' }), [producto('A1', 'Adhesivo blanco')]);
    draw(props({ ...match, status: 'suggested', conflicts: [{ code: 'alias_vs_code', codigosInternos: ['A1'] }] }));
    expect(textos(tarjeta('A1'))).toContain('Datos en conflicto');
    expect(screen.queryByText('Recomendado')).toBeNull();
    fireEvent.press(screen.getByTestId(`${ID}-candidato-A1`));
  });
});
