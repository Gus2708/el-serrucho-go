import * as React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import FacturaRevisionLinea, { type FacturaRevisionLineaProps } from './FacturaRevisionLinea';
import { matchInvoiceLines, type HybridLineRanks, type LineMatch, type SupplierAlias, MATCHING_NORMALIZATION_VERSION } from '../lib/facturaMatching';
import type { ExtraidaLinea } from '../lib/facturaExtractionContract';
import type { CalculoLinea, LineaEfectiva } from '../lib/facturaRevision';
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
    precioCatalogo: null,
    productoElegido: null,
    onUsarPrecioActual: jest.fn(),
    inventario: { producto: null, aviso: null, onBuscar: jest.fn() },
    onAsociarManual: jest.fn(() => ({ ok: true })),
    onMarcarNuevo: jest.fn(() => ({ ok: true })),
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
const tarjetasVisibles = () => screen.queryAllByTestId(/^revision-linea-7-tarjeta-/).map(el => el.props.testID.replace(`${ID}-tarjeta-`, ''));
const verOtras = () => fireEvent.press(screen.getByTestId(`${ID}-ver-otras`));

describe('candidate cards', () => {
  it('keeps manual identity and its motive explicit, choosing the product from the inventory search instead of a typed code', () => {
    const onBuscar = jest.fn();
    const sinElegir = props(undefined, { inventario: { producto: null, aviso: null, onBuscar } });
    const view = draw(sinElegir);
    fireEvent.press(screen.getByTestId(`${ID}-manual-abrir`));
    expect(screen.queryByTestId(`${ID}-manual-codigo`)).toBeNull();
    expect(textos(`${ID}-manual-buscar`)).toEqual(['Buscar en inventario']);
    fireEvent.press(screen.getByTestId(`${ID}-manual-buscar`));
    expect(onBuscar).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(`${ID}-manual-aplicar`).props.accessibilityState.disabled).toBe(true);

    const elegido = producto('00123', 'BATERIA RECARGABLE 20V', { existencia: 0, precio_venta: 48.5 });
    const p = props(undefined, { inventario: { producto: elegido, aviso: null, onBuscar } });
    view.rerender(<ThemeProvider><FacturaRevisionLinea {...p} /></ThemeProvider>);
    expect(textos(`${ID}-manual-elegido`)).toEqual(['BATERIA RECARGABLE 20V', 'Código 00123 · Existencia 0 UND', 'Precio actual: $48.50 (IVA incluido)']);
    expect(textos(`${ID}-manual-buscar`)).toEqual(['Buscar otro']);
    expect(screen.getByTestId(`${ID}-manual-aplicar`).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId(`${ID}-manual-motivo-sugerido`));
    expect(p.onEditar).not.toHaveBeenCalled();
    expect(p.onAsociarManual).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(`${ID}-manual-aplicar`));
    expect(p.onAsociarManual).toHaveBeenCalledWith('La sugerencia era otro producto');
    expect(p.onEditar).not.toHaveBeenCalled();
  });

  it('says when an inventory choice went stale instead of applying it', () => {
    draw(props(undefined, { inventario: { producto: null, aviso: 'Esta elección quedó desactualizada: busca el producto de nuevo.', onBuscar: jest.fn() } }));
    fireEvent.press(screen.getByTestId(`${ID}-manual-abrir`));
    expect(textos(`${ID}-manual-aviso`)).toEqual(['Esta elección quedó desactualizada: busca el producto de nuevo.']);
  });

  it('does not invent a new-product confirmation when opening the choice or selecting a motive', () => {
    const p = props(undefined);
    draw(p);
    fireEvent.press(screen.getByTestId(`${ID}-nuevo-abrir`));
    expect(screen.getByTestId(`${ID}-nuevo-aplicar`).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId(`${ID}-nuevo-motivo-sugerido`));
    expect(p.onEditar).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(`${ID}-nuevo-aplicar`));
    // Through the view's fenced batch, so a previous product's price is cleared with the identity (S6).
    expect(p.onMarcarNuevo).toHaveBeenCalledWith('No existe en el inventario');
    expect(p.onEditar).not.toHaveBeenCalled();
  });

  it('lead with the description, keep the code secondary and offer a short Confirmar', () => {
    draw(props(emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() })));
    const orden = textos(tarjeta('7453118025275'));
    expect(orden[0]).toBe('BATERIA 20V LITIO 24H CARGA ZASC');
    expect(orden.findIndex(t => t.includes('7453118025275'))).toBeGreaterThan(0);
    expect(textos(`${ID}-candidato-7453118025275`)).toEqual(['Sí, es este']);
  });

  it('keep the audited retrieval order of the real matcher, the first three first and the rest only on request', () => {
    draw(props(emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() })));
    expect(tarjetasVisibles()).toEqual(ORDEN_AUDITORIA.slice(0, 3));
    expect(textos(`${ID}-ver-otras`)).toEqual(['Ver otras opciones (2)']);
    verOtras();
    expect(tarjetasVisibles()).toEqual(ORDEN_AUDITORIA);
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
    verOtras();
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
    verOtras();
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
    fireEvent.press(screen.getByTestId(`${ID}-cambiar-producto`));

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

  it('opens the manual inventory search panel from the warning action', () => {
    draw(props(vacio(), { catalogoParcial: true }));
    expect(screen.queryByTestId(`${ID}-manual-buscar`)).toBeNull();
    fireEvent.press(screen.getByTestId(`${ID}-sin-candidatos-sku`));
    expect(screen.getByTestId(`${ID}-manual-buscar`)).toBeTruthy();
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
    fireEvent.press(screen.getByTestId(`${ID}-corregir`));
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
    verOtras();
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

describe('compact identity (S2): the chosen product only, with an explicit change', () => {
  const match = () => emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() });
  const conAsociacion = (asociacion: LineaEfectiva['asociacion']): LineaEfectiva => ({ ...efectiva(), asociacion });
  const sugerido = (codigoInterno: string): LineaEfectiva['asociacion'] => ({ tipo: 'confirmado', codigoInterno, evidencia: 'sugerencia', motivo: null });

  it('unmounts every other candidate and the choice panels once a product is chosen', () => {
    draw(props(match(), { efectiva: conAsociacion(sugerido('CV-BC-75A')) }));
    expect(tarjetasVisibles()).toEqual([]);
    expect(screen.queryByTestId(`${ID}-manual-abrir`)).toBeNull();
    expect(screen.queryByTestId(`${ID}-nuevo-abrir`)).toBeNull();
    expect(screen.queryByTestId(`${ID}-ver-otras`)).toBeNull();
    expect(textos(`${ID}-elegido`)).toEqual(['CARGADOR DE BATERIA COVO', 'Código CV-BC-75A', 'Cambiar producto']);
  });

  it('restores the options on Cambiar producto without touching the saved association, then keeps it on Mantener', () => {
    const p = props(match(), { efectiva: conAsociacion(sugerido('CV-BC-75A')) });
    draw(p);
    fireEvent.press(screen.getByTestId(`${ID}-cambiar-producto`));
    expect(tarjetasVisibles()).toEqual(ORDEN_AUDITORIA.slice(0, 3));
    expect(screen.getByTestId(`${ID}-manual-abrir`)).toBeTruthy();
    expect(screen.getByTestId(`${ID}-nuevo-abrir`)).toBeTruthy();
    expect(screen.getByTestId(`${ID}-pendiente`)).toBeTruthy();
    expect(p.onEditar).not.toHaveBeenCalled();
    expect(p.onElegirCandidato).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(`${ID}-cambiar-cancelar`));
    expect(tarjetasVisibles()).toEqual([]);
    expect(p.onEditar).not.toHaveBeenCalled();
  });

  it('collapses back to the new choice after another candidate is confirmed', () => {
    const m = match();
    const p = props(m, { efectiva: conAsociacion(sugerido('CV-BC-75A')) });
    const view = draw(p);
    fireEvent.press(screen.getByTestId(`${ID}-cambiar-producto`));
    fireEvent.press(screen.getByTestId(`${ID}-candidato-7453118025275`));
    expect(p.onElegirCandidato).toHaveBeenCalledWith('7453118025275');
    view.rerender(<ThemeProvider><FacturaRevisionLinea {...props(m, { efectiva: conAsociacion(sugerido('7453118025275')) })} /></ThemeProvider>);
    expect(tarjetasVisibles()).toEqual([]);
    expect(textos(`${ID}-elegido`)[0]).toBe('BATERIA 20V LITIO 24H CARGA ZASC');
  });

  it('draws candidate and chosen boxes with the same black as the product card, never a lighter gray', () => {
    const view = draw(props(match()));
    expect(StyleSheet.flatten(screen.getByTestId(tarjeta('CV-BC-75A')).props.style).backgroundColor).toBe(elSerrucho.colors.surface);
    view.rerender(<ThemeProvider><FacturaRevisionLinea {...props(match(), { efectiva: conAsociacion(sugerido('CV-BC-75A')) })} /></ThemeProvider>);
    expect(StyleSheet.flatten(screen.getByTestId(`${ID}-elegido`).props.style).backgroundColor).toBe(elSerrucho.colors.surface);
  });

  it('shows the chosen product once while changing: its own candidate card, highlighted, and no summary above it', () => {
    const p = props(match(), { efectiva: conAsociacion(sugerido('CV-BC-75A')) });
    draw(p);
    fireEvent.press(screen.getByTestId(`${ID}-cambiar-producto`));
    expect(screen.queryByTestId(`${ID}-elegido`)).toBeNull();
    expect(screen.getAllByText('CARGADOR DE BATERIA COVO')).toHaveLength(1);
    expect(screen.getByTestId(`${ID}-candidato-CV-BC-75A`).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId(`${ID}-cambiar-cancelar`)).toBeTruthy();
    expect(screen.getByTestId(`${ID}-pendiente`)).toBeTruthy();
    fireEvent.press(screen.getByTestId(`${ID}-cambiar-cancelar`));
    expect(textos(`${ID}-elegido`)).toEqual(['CARGADOR DE BATERIA COVO', 'Código CV-BC-75A', 'Cambiar producto']);
    expect(p.onEditar).not.toHaveBeenCalled();
    expect(p.onElegirCandidato).not.toHaveBeenCalled();
  });

  it('keeps the compact current choice while changing a new-product decision, which has no candidate card', () => {
    draw(props(match(), { efectiva: conAsociacion({ tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'No existe en el inventario' }) }));
    fireEvent.press(screen.getByTestId(`${ID}-cambiar-producto`));
    expect(textos(`${ID}-elegido`)).toEqual(['Producto nuevo (sin crear)', 'Motivo: No existe en el inventario']);
    expect(tarjetasVisibles()).toEqual(ORDEN_AUDITORIA.slice(0, 3));
  });

  it('keeps a manual product outside the candidates, with its motive, and the candidates stay unmounted', () => {
    draw(props(match(), { efectiva: conAsociacion({ tipo: 'confirmado', codigoInterno: 'ZZ-9', evidencia: 'manual', motivo: 'La sugerencia era otro producto' }) }));
    expect(tarjetasVisibles()).toEqual([]);
    expect(textos(`${ID}-elegido`)).toEqual(['Código ZZ-9', 'Elegido a mano. Motivo: La sugerencia era otro producto', 'Cambiar producto']);
    fireEvent.press(screen.getByTestId(`${ID}-cambiar-producto`));
    expect(tarjetasVisibles()).toEqual(ORDEN_AUDITORIA.slice(0, 3));
    expect(textos(`${ID}-elegido`)[0]).toBe('Código ZZ-9');
  });

  it('shows a chosen candidate outside the first three when changing, so the saved choice stays visible', () => {
    draw(props(match(), { efectiva: conAsociacion(sugerido('00431')) }));
    expect(textos(`${ID}-elegido`)[0]).toBe('BATERIA RECARGABLE 20V / 20AH MARCA INGCO');
    fireEvent.press(screen.getByTestId(`${ID}-cambiar-producto`));
    expect(tarjetasVisibles()).toEqual([...ORDEN_AUDITORIA.slice(0, 3), '00431']);
  });

  it('keeps a new product decision compact, with its motive and the same change action', () => {
    draw(props(match(), { efectiva: conAsociacion({ tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'No existe en el inventario' }) }));
    expect(tarjetasVisibles()).toEqual([]);
    expect(textos(`${ID}-elegido`)).toEqual(['Producto nuevo (sin crear)', 'Motivo: No existe en el inventario', 'Cambiar producto']);
  });

  it('never confirms a suggestion by itself, and keeps manual actions and warnings visible before any choice', () => {
    const catalog = [producto('A1', 'Tornillo', { codigo_barras: 'Z-RXB-2-20V' }), producto('A2', 'Tornillo', { codigo_barras: 'Z-RXB-2-20V' })];
    const p = props(emparejar(lineaExtraida({ descripcion: 'Tornillo' }), catalog));
    draw(p);
    expect(p.onEditar).not.toHaveBeenCalled();
    expect(p.onElegirCandidato).not.toHaveBeenCalled();
    expect(screen.getByText('Hay señales en conflicto entre código y descripción: revisa con cuidado.')).toBeTruthy();
    expect(screen.getByTestId(`${ID}-manual-abrir`)).toBeTruthy();
    expect(screen.getByTestId(`${ID}-nuevo-abrir`)).toBeTruthy();
    expect(screen.queryByTestId(`${ID}-elegido`)).toBeNull();
  });

  it('keeps every conflicting candidate in the first view even beyond the first three', () => {
    const m = match();
    draw(props({ ...m, conflicts: [{ code: 'code_description_conflict', codigosInternos: ['00431'] }] } as LineMatch));
    expect(tarjetasVisibles()).toEqual([...ORDEN_AUDITORIA.slice(0, 3), '00431']);
  });
});

describe('detected cost next to the selling price (S2)', () => {
  const calculo = (over: Partial<CalculoLinea>): CalculoLinea => ({ lineaId: 'linea-7', costoNetoUnitarioStock: '22.00', ...over } as CalculoLinea);
  const precio = () => within(screen.getByTestId(`${ID}-precio`));

  it('shows the printed quantity and unit cost inside the selling-price section, once', () => {
    draw(props(undefined, { calculo: calculo({}) }));
    expect(precio().getByTestId(`${ID}-lectura`)).toBeTruthy();
    expect(precio().getByTestId(`${ID}-pvp-valor`)).toBeTruthy();
    expect(screen.queryByTestId(`${ID}-lectura-corregir`)).toBeNull();
    expect(screen.queryAllByText(/costo unitario/)).toHaveLength(1);
    expect(screen.queryByTestId(`${ID}-pvp-costo-neto`)).toBeNull();
  });

  it('distinguishes the discounted ex-VAT cost per stock unit when it differs from the printed cost', () => {
    draw(props(undefined, { calculo: calculo({ costoNetoUnitarioStock: '1.6' }), tipoDocumento: 'nota_entrega' }));
    expect(textos(`${ID}-pvp-costo-neto`)).toEqual(['Costo neto por unidad de inventario (sin IVA, con descuentos): $1.60']);
    expect(precio().getByTestId(`${ID}-pvp-costo-neto`)).toBeTruthy();
    expect(textos(`${ID}-pvp-estado`)).toEqual(['Se usará el precio sugerido: $2.08. Escribe un precio para cambiarlo.']);
  });

  it('hides every amount of the section while the currency is not confirmed USD', () => {
    draw(props(undefined, { esUsd: false, moneda: 'VES', calculo: calculo({ costoNetoUnitarioStock: '1.6' }) }));
    expect(precio().getByTestId(`${ID}-pvp-oculto`)).toBeTruthy();
    expect(screen.queryByTestId(`${ID}-pvp-costo-neto`)).toBeNull();
    expect(textos(`${ID}-precio`).join(' ')).not.toMatch(/22|1[.]6/);
  });
});

describe('VAT is answered for the whole invoice (S4)', () => {
  it('has no per-product VAT question in the main body, only a pointer while it is missing', () => {
    draw(props(undefined, { estado: 'falta_iva' }));
    expect(screen.queryByText('IVA de este producto (obligatorio)')).toBeNull();
    expect(screen.queryByTestId('revision-iva-7-16')).toBeNull();
    expect(textos(`${ID}-iva-factura-aviso`)).toEqual(['Falta el IVA: indícalo una vez en "IVA de la factura", arriba.']);
  });

  it('keeps a per-product VAT exception reachable in Más opciones, with the manual payload', () => {
    const base = efectiva();
    const conIva = { ...base, campos: { ...base.campos, tasaIva: { valor: '16', original: null, corregido: true, motivo: 'IVA indicado manualmente: 16 %' } } } as LineaEfectiva;
    const p = props(undefined, { estado: 'listo', efectiva: conIva });
    draw(p);
    expect(screen.queryByTestId(`${ID}-iva-factura-aviso`)).toBeNull();
    expect(screen.queryByTestId('revision-iva-7-0')).toBeNull();
    fireEvent.press(screen.getByTestId(`${ID}-mas`));
    expect(textos('revision-iva-7-estado')).toEqual(['Indicado: 16 %']);
    fireEvent.press(screen.getByTestId('revision-iva-7-0'));
    expect(p.onEditar).toHaveBeenCalledWith({ tipo: 'linea_escalar', lineaId: 'linea-7', campo: 'tasaIva', valor: '0', motivo: 'IVA indicado manualmente: 0 %' });
  });
});

describe('existing product selling price (S6)', () => {
  const confirmada = (precioIva: boolean = true): LineaEfectiva => {
    const base = efectiva();
    return {
      ...base,
      campos: precioIva ? { ...base.campos, tasaIva: { valor: '16', original: null, corregido: true, motivo: 'm' } } : base.campos,
      asociacion: { tipo: 'confirmado', codigoInterno: 'SKU-9', evidencia: 'manual', motivo: 'Mismo articulo' },
    } as LineaEfectiva;
  };
  const calculo = { lineaId: 'linea-7', costoNetoUnitarioStock: '22.00' } as CalculoLinea;
  const valor = () => screen.getByTestId(`${ID}-pvp-valor`).props.value;

  it('writes the saved selling price of an existing product in the input, named as the current inventory price', () => {
    draw(props(undefined, { efectiva: confirmada(), calculo, tipoDocumento: 'factura', precioVenta: '18', precioCatalogo: { estado: 'listo', valor: '18' } }));
    expect(valor()).toBe('18');
    expect(textos(`${ID}-pvp-estado`)).toEqual(['Precio actual del inventario (IVA incluido): $18.00']);
    expect(screen.queryByTestId(`${ID}-pvp-usar-actual`)).toBeNull();
  });

  it('shows the current price of a saved product without a price as not applied, and applies it only on request', () => {
    const p = props(undefined, { efectiva: confirmada(), calculo, tipoDocumento: 'factura', precioVenta: null, precioCatalogo: { estado: 'listo', valor: '25' } });
    draw(p);
    // The current price is a muted reference, not active text that looks applied (NEW-V1).
    expect(valor()).toBe('');
    expect(screen.getByTestId(`${ID}-pvp-valor`).props.placeholder).toBe('$25.00');
    expect(textos(`${ID}-pvp-estado`)).toEqual(['Precio actual del inventario sin aplicar: $25.00. Úsalo o escribe otro precio antes de confirmar.']);
    expect(p.onEditar).not.toHaveBeenCalled();
    expect(p.onUsarPrecioActual).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(`${ID}-pvp-usar-actual`));
    expect(p.onUsarPrecioActual).toHaveBeenCalledTimes(1);
  });

  it('keeps a typed price and offers the current one beside it', () => {
    const p = props(undefined, { efectiva: confirmada(), calculo, precioVenta: '20', precioCatalogo: { estado: 'listo', valor: '18' } });
    draw(p);
    expect(valor()).toBe('20');
    expect(textos(`${ID}-pvp-estado`)).toEqual(['Se usará tu precio: $20.00. Precio actual del inventario: $18.00.']);
    fireEvent.press(screen.getByTestId(`${ID}-pvp-usar-actual`));
    expect(p.onUsarPrecioActual).toHaveBeenCalledTimes(1);
  });

  it('never proposes the cost markup for an existing product, while reading or when the price is unavailable', () => {
    const view = draw(props(undefined, { efectiva: confirmada(), calculo, tipoDocumento: 'factura', precioCatalogo: { estado: 'cargando' } }));
    expect(valor()).toBe('');
    expect(screen.getByTestId(`${ID}-pvp-valor`).props.placeholder).toBe('Escribe el precio de venta');
    expect(textos(`${ID}-pvp-estado`)).toEqual(['Leyendo el precio actual del inventario…']);
    view.rerender(<ThemeProvider><FacturaRevisionLinea {...props(undefined, { efectiva: confirmada(), calculo, tipoDocumento: 'factura', precioCatalogo: { estado: 'no_disponible' } })} /></ThemeProvider>);
    expect(textos(`${ID}-pvp-estado`)).toEqual(['No se pudo leer el precio actual del inventario: escribe el precio de venta.']);
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/sugerido|33\.06/);
  });

  it('hides every price of an existing product while the currency is not confirmed USD', () => {
    draw(props(undefined, { efectiva: confirmada(), calculo, esUsd: false, moneda: 'VES', precioVenta: null, precioCatalogo: { estado: 'listo', valor: '25' } }));
    expect(screen.queryByTestId(`${ID}-pvp-valor`)).toBeNull();
    expect(screen.queryByTestId(`${ID}-pvp-usar-actual`)).toBeNull();
    expect(textos(`${ID}-precio`).join(' ')).not.toMatch(/25/);
  });
});

describe('units per product once decided (S8)', () => {
  const conFactor = (factorConversion: string | null): LineaEfectiva => ({ ...efectiva(), factorConversion } as LineaEfectiva);

  it('shows a decided factor as one line with a change action, and the controls only when changing', () => {
    const p = props(undefined, { efectiva: conFactor('12') });
    draw(p);
    expect(textos('revision-factor-7-estado')).toEqual(['Confirmado: 12']);
    expect(screen.queryByTestId('revision-factor-7-uno')).toBeNull();
    fireEvent.press(screen.getByTestId('revision-factor-7-cambiar'));
    fireEvent.press(screen.getByTestId('revision-factor-7-uno'));
    expect(p.onEditar).toHaveBeenCalledWith({ tipo: 'factor_conversion', lineaId: 'linea-7', valor: '1' });
  });

  it('keeps the factor controls open while it is still missing', () => {
    draw(props(undefined, { efectiva: conFactor(null) }));
    expect(screen.getByTestId('revision-factor-7-uno')).toBeTruthy();
    expect(screen.queryByTestId('revision-factor-7-cambiar')).toBeNull();
  });
});

describe('editing an existing product price (NEW-V1)', () => {
  const confirmada = (): LineaEfectiva => ({ ...efectiva(), asociacion: { tipo: 'confirmado', codigoInterno: 'SKU-9', evidencia: 'manual', motivo: 'Mismo articulo' } } as LineaEfectiva);
  const calculo = { lineaId: 'linea-7', costoNetoUnitarioStock: '250' } as CalculoLinea;
  const catalogo = { estado: 'listo' as const, valor: '362' };

  it('stays empty after clearing an adopted price, then saves exactly the new typed value', () => {
    const p = props(undefined, { efectiva: confirmada(), calculo, precioVenta: '362', precioCatalogo: catalogo });
    const view = draw(p);
    fireEvent.changeText(screen.getByTestId(`${ID}-pvp-valor`), '');
    expect(p.onEditar).toHaveBeenLastCalledWith({ tipo: 'precio_venta', lineaId: 'linea-7', valor: null });
    // The parent now holds no saved price: the field must not snap back to the catalog value.
    view.rerender(<ThemeProvider><FacturaRevisionLinea {...props(undefined, { ...p, precioVenta: null })} /></ThemeProvider>);
    expect(screen.getByTestId(`${ID}-pvp-valor`).props.value).toBe('');
    expect(screen.getByTestId(`${ID}-pvp-valor`).props.placeholder).toBe('$362.00');
    fireEvent.changeText(screen.getByTestId(`${ID}-pvp-valor`), '375');
    expect(p.onEditar).toHaveBeenLastCalledWith({ tipo: 'precio_venta', lineaId: 'linea-7', valor: '375' });
  });
});

describe('chosen product name from the retained catalog row (NEW-V3)', () => {
  const manual = { tipo: 'confirmado' as const, codigoInterno: 'ZZ-9', evidencia: 'manual' as const, motivo: 'La sugerencia era otro producto' };
  const match = () => emparejar(lineaExtraida(), CATALOGO_BATERIA, { hybridRanks: rangos() });

  it('names a product chosen outside the suggestions with its catalog description', () => {
    draw(props(match(), { efectiva: { ...efectiva(), asociacion: manual } as LineaEfectiva, productoElegido: producto('ZZ-9', 'TALADRO PERCUTOR 500W') }));
    expect(textos(`${ID}-elegido`)).toEqual(['TALADRO PERCUTOR 500W', 'Código ZZ-9', 'Elegido a mano. Motivo: La sugerencia era otro producto', 'Cambiar producto']);
  });

  it('never invents a name when no catalog row is retained', () => {
    draw(props(match(), { efectiva: { ...efectiva(), asociacion: manual } as LineaEfectiva, productoElegido: null }));
    expect(textos(`${ID}-elegido`)[0]).toBe('Código ZZ-9');
  });
});
