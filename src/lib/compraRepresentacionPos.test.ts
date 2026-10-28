import { evaluarRepresentacionPos, type CodigoBloqueoPos, type RepresentacionPos } from './compraRepresentacionPos';
import {
  aplicarEdicion,
  calcularRevision,
  crearRevisionDesdeExtraccion,
  resolverFactura,
  type CalculoRevision,
  type Edicion,
  type FacturaEfectiva,
  type PoliticasCalculo,
  type RevisionContenido,
} from './facturaRevision';
import type { ExtraidaLinea, FacturaExtraccionPayload } from './facturaExtractionContract';

// The input is always the REAL review arithmetic (crear -> editar -> calcular -> resolver): nothing here fakes a
// CalculoRevision. salidaPos is injected only to quantify the test; it never approves anything.

const EXTRACCION_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';

function ids(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}

interface LineaSpec {
  readonly cantidad: string;
  readonly precio: string;
  /** Confirmed internal code; 'nuevo' marks the line as a new product. */
  readonly sku: string;
}

interface Escenario {
  readonly calculo: CalculoRevision;
  readonly efectiva: FacturaEfectiva;
}

function extraccion(specs: readonly LineaSpec[], cabecera: Partial<FacturaExtraccionPayload['cabecera']> = {}): FacturaExtraccionPayload {
  const lineas: ExtraidaLinea[] = specs.map((spec, index) => ({
    numeroLinea: index + 1,
    pagina: 1,
    codigoProveedor: `PROV-${index + 1}`,
    descripcion: `Articulo ${index + 1}`,
    cantidad: spec.cantidad,
    unidad: 'UND',
    precioUnitario: spec.precio,
    descuentos: [],
    tasaIva: '16',
    total: null,
    incertidumbre: null,
  }));
  return deepFreeze({
    version: 1,
    cabecera: {
      proveedorNombre: 'Proveedor Uno',
      proveedorRif: null,
      numeroDocumento: 'DOC-001',
      numeroControl: null,
      fechaEmision: null,
      moneda: 'USD',
      tasaCambio: null,
      subtotal: null,
      descuentos: [],
      impuestos: [],
      total: null,
      ...cabecera,
    },
    lineas,
    metadatos: { totalPaginas: 1, paginasProcesadas: [1], documentoCompleto: true, advertencias: [], confianzaGlobal: null },
  } as FacturaExtraccionPayload);
}

function escenario(
  specs: readonly LineaSpec[],
  opciones: { cabecera?: Partial<FacturaExtraccionPayload['cabecera']>; factor?: string | null; extra?: readonly Edicion[] } = {}
): Escenario {
  const ext = extraccion(specs, opciones.cabecera);
  const creada = crearRevisionDesdeExtraccion(ext, EXTRACCION_ID, ids('10000000'));
  if (!creada.ok) throw new Error(JSON.stringify(creada.error));
  const editar = (contenido: RevisionContenido, edicion: Edicion): RevisionContenido => {
    const resultado = aplicarEdicion(contenido, ext, edicion, ids('20000000'));
    if (!resultado.ok) throw new Error(JSON.stringify(resultado.error));
    return resultado.contenido;
  };
  const ediciones: Edicion[] = [
    { tipo: 'decision_cabecera', campo: 'documentoCompletoConfirmado', valor: true },
    { tipo: 'decision_cabecera', campo: 'recepcionCompleta', valor: true },
    { tipo: 'decision_cabecera', campo: 'precioIncluyeIva', valor: false },
    ...creada.contenido.lineas.flatMap((linea, index): Edicion[] => [
      { tipo: 'factor_conversion', lineaId: linea.lineaId, valor: opciones.factor === undefined ? '1' : opciones.factor },
      {
        tipo: 'asociacion',
        lineaId: linea.lineaId,
        asociacion:
          specs[index].sku === 'nuevo'
            ? { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: 'Producto sin ficha en Hybrid' }
            : { tipo: 'confirmado', codigoInterno: specs[index].sku, evidencia: 'sugerencia', motivo: null },
      },
    ]),
    ...(opciones.extra ?? []),
  ];
  const contenido = ediciones.reduce(editar, creada.contenido);
  return {
    calculo: calcularRevision({ extraccion: ext, contenido }),
    efectiva: resolverFactura(ext, contenido),
  };
}

const codigos = (representacion: RepresentacionPos): CodigoBloqueoPos[] => representacion.emisionImportada.bloqueos.map(b => b.codigo).sort();
const SIEMPRE: CodigoBloqueoPos[] = ['existencia_ejecucion_no_verificada', 'precision_pos_no_verificada'];

describe('evaluarRepresentacionPos', () => {
  it('buys the documentary quantity and plans the negative-stock adjustment apart, without inflating the purchase base', () => {
    const { calculo, efectiva } = escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }]);
    const resultado = evaluarRepresentacionPos({ calculo, efectiva, existencias: { 'SKU-A': -3 }, lecturaExistenciasEn: '2026-10-23T12:00:00.000Z' });

    expect(resultado.skus).toEqual([
      {
        codigoProducto: 'SKU-A',
        lineaIds: [calculo.lineas[0].lineaId],
        cantidadDocumentoStock: '10',
        existenciaLeida: '-3',
        compensacion: '3',
        cantidadPos: '10',
        existenciaEsperada: '10',
        ajusteExistencia: { existenciaActual: '-3', nuevaExistencia: '0', cantidad: '3' },
        baseDocumentalExIva: '10.00',
        costoPosHipotetico: '1.00',
        baseHipoteticaPosExIva: '10.00',
        diferenciaBase: '0.00',
      },
    ]);
    expect(resultado.baseDocumentalExIvaTotal).toBe('10.00');
    expect(resultado.baseHipoteticaPosExIvaTotal).toBe('10.00');
    // The T4 documentary total including VAT stays its own figure (10.00 + 16 % VAT).
    expect(resultado.totalDocumentalConImpuestos).toBe('11.60');
    expect(resultado.lecturaExistenciasEn).toBe('2026-10-23T12:00:00.000Z');
    expect(resultado.emisionImportada.bloqueos).toContainEqual({
      codigo: 'ajuste_compensacion_secuencia_no_probada',
      ambito: 'sku',
      codigoProducto: 'SKU-A',
      lineaIds: [calculo.lineas[0].lineaId],
    });
    expect(codigos(resultado)).toEqual(['ajuste_compensacion_secuencia_no_probada', ...SIEMPRE].sort());
    expect(codigos(resultado)).not.toContain('compensacion_altera_base');
    expect(resultado.emisionImportada.permitida).toBe(false);
  });

  it('adds the invoice to positive stock without compensation and still never allows emission', () => {
    const { calculo, efectiva } = escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }]);
    const resultado = evaluarRepresentacionPos({ calculo, efectiva, existencias: { 'SKU-A': 5 }, lecturaExistenciasEn: null });

    expect(resultado.skus[0]).toMatchObject({
      existenciaLeida: '5',
      compensacion: '0',
      cantidadPos: '10',
      existenciaEsperada: '15',
      ajusteExistencia: null,
      baseDocumentalExIva: '10.00',
      baseHipoteticaPosExIva: '10.00',
      diferenciaBase: '0.00',
    });
    expect(codigos(resultado)).toEqual(SIEMPRE);
    expect(resultado.emisionImportada.permitida).toBe(false);
  });

  it('treats a real zero balance as zero, not as unknown', () => {
    const { calculo, efectiva } = escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }]);
    const resultado = evaluarRepresentacionPos({ calculo, efectiva, existencias: { 'SKU-A': 0 }, lecturaExistenciasEn: null });

    expect(resultado.skus[0]).toMatchObject({ existenciaLeida: '0', compensacion: '0', cantidadPos: '10', existenciaEsperada: '10', ajusteExistencia: null });
    expect(codigos(resultado)).toEqual(SIEMPRE);
  });

  it('groups repeated confirmed SKU lines once: one adjustment, line IDs preserved in order', () => {
    const { calculo, efectiva } = escenario([
      { cantidad: '4', precio: '1.00', sku: 'SKU-A' },
      { cantidad: '6', precio: '1.00', sku: 'SKU-A' },
    ]);
    const resultado = evaluarRepresentacionPos({ calculo, efectiva, existencias: { 'SKU-A': -3 }, lecturaExistenciasEn: null });

    expect(resultado.skus).toHaveLength(1);
    expect(resultado.skus[0]).toMatchObject({
      codigoProducto: 'SKU-A',
      lineaIds: calculo.lineas.map(l => l.lineaId),
      cantidadDocumentoStock: '10',
      compensacion: '3',
      cantidadPos: '10',
      existenciaEsperada: '10',
      ajusteExistencia: { existenciaActual: '-3', nuevaExistencia: '0', cantidad: '3' },
      baseDocumentalExIva: '10.00',
      baseHipoteticaPosExIva: '10.00',
    });
    expect(resultado.emisionImportada.bloqueos.filter(b => b.codigo === 'ajuste_compensacion_secuencia_no_probada')).toHaveLength(1);
  });

  it('never invents an average when repeated SKU lines have different net costs', () => {
    const { calculo, efectiva } = escenario([
      { cantidad: '4', precio: '1.00', sku: 'SKU-A' },
      { cantidad: '6', precio: '1.50', sku: 'SKU-A' },
    ]);
    const resultado = evaluarRepresentacionPos({ calculo, efectiva, existencias: { 'SKU-A': -3 }, lecturaExistenciasEn: null });

    expect(resultado.skus[0]).toMatchObject({
      cantidadDocumentoStock: '10',
      compensacion: '3',
      cantidadPos: '10',
      ajusteExistencia: { existenciaActual: '-3', nuevaExistencia: '0', cantidad: '3' },
      baseDocumentalExIva: '13.00',
      costoPosHipotetico: null,
      baseHipoteticaPosExIva: null,
      diferenciaBase: null,
    });
    expect(resultado.baseDocumentalExIvaTotal).toBe('13.00');
    expect(resultado.baseHipoteticaPosExIvaTotal).toBeNull();
    expect(codigos(resultado)).toContain('sku_repetido_costo_distinto');
    expect(codigos(resultado)).toContain('ajuste_compensacion_secuencia_no_probada');
  });

  it('exposes no amounts or quantities while the review has blockers (non-USD, unknown conversion, pending decisions)', () => {
    const casos: Escenario[] = [
      escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }], { cabecera: { moneda: 'VES' } }),
      escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }], { cabecera: { moneda: null } }),
      escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }], { factor: null }),
      escenario([{ cantidad: '', precio: '1.00', sku: 'SKU-A' }]),
    ];
    for (const { calculo, efectiva } of casos) {
      expect(calculo.sinBloqueos).toBe(false);
      const resultado = evaluarRepresentacionPos({ calculo, efectiva, existencias: { 'SKU-A': -3 }, lecturaExistenciasEn: '2026-10-23T12:00:00.000Z' });

      expect(resultado.skus).toEqual([]);
      expect(resultado.totalDocumentalConImpuestos).toBeNull();
      expect(resultado.baseDocumentalExIvaTotal).toBeNull();
      expect(resultado.baseHipoteticaPosExIvaTotal).toBeNull();
      expect(codigos(resultado)).toEqual(['revision_con_bloqueos', ...SIEMPRE].sort());
      expect(resultado.emisionImportada.permitida).toBe(false);
    }
  });

  it('keeps stock unknown when it is missing, null, NaN, infinite or not a plain decimal; it is never read as zero', () => {
    const { calculo, efectiva } = escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }]);
    const ilegibles: Array<Record<string, number>> = [
      {},
      { 'SKU-A': Number.NaN },
      { 'SKU-A': Number.POSITIVE_INFINITY },
      { 'SKU-A': 1e-7 },
      { 'SKU-A': null as unknown as number },
      { 'OTRO-SKU': 0 },
    ];
    for (const existencias of ilegibles) {
      const resultado = evaluarRepresentacionPos({ calculo, efectiva, existencias, lecturaExistenciasEn: null });

      expect(resultado.skus[0]).toMatchObject({
        cantidadDocumentoStock: '10',
        existenciaLeida: null,
        compensacion: null,
        cantidadPos: null,
        existenciaEsperada: null,
        ajusteExistencia: null,
        baseDocumentalExIva: '10.00',
        baseHipoteticaPosExIva: null,
        diferenciaBase: null,
      });
      expect(codigos(resultado)).toEqual(['existencia_no_leida', ...SIEMPRE].sort());
      expect(resultado.lecturaExistenciasEn).toBeNull();
    }
  });

  it('never assumes stock zero for a new product: its identity and stock stay unverified', () => {
    const { calculo, efectiva } = escenario([
      { cantidad: '10', precio: '1.00', sku: 'nuevo' },
      { cantidad: '2', precio: '1.00', sku: 'SKU-A' },
    ]);
    const resultado = evaluarRepresentacionPos({ calculo, efectiva, existencias: { 'SKU-A': 5, nuevo: 0 }, lecturaExistenciasEn: null });

    const nuevo = resultado.skus.find(s => s.codigoProducto === null);
    expect(nuevo).toEqual({
      codigoProducto: null,
      lineaIds: [calculo.lineas[0].lineaId],
      cantidadDocumentoStock: '10',
      existenciaLeida: null,
      compensacion: null,
      cantidadPos: null,
      existenciaEsperada: null,
      ajusteExistencia: null,
      baseDocumentalExIva: '10.00',
      costoPosHipotetico: null,
      baseHipoteticaPosExIva: null,
      diferenciaBase: null,
    });
    expect(resultado.skus.find(s => s.codigoProducto === 'SKU-A')).toMatchObject({ cantidadPos: '2', existenciaEsperada: '7' });
    expect(resultado.emisionImportada.bloqueos).toContainEqual({
      codigo: 'producto_nuevo_identidad_no_verificada',
      ambito: 'sku',
      codigoProducto: null,
      lineaIds: [calculo.lineas[0].lineaId],
    });
    expect(resultado.baseHipoteticaPosExIvaTotal).toBeNull();
  });

  it('blocks a printed control number or issue date: the current purchase schema cannot transmit them', () => {
    const conControl = escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }], { cabecera: { numeroControl: '00-123456' } });
    const conFecha = escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }], { cabecera: { fechaEmision: '2026-10-15' } });
    const limpia = escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }]);
    const corregida = escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }], {
      cabecera: { numeroControl: '00-123456' },
      extra: [{ tipo: 'cabecera_escalar', campo: 'numeroControl', valor: null, motivo: 'No hay control impreso' }],
    });
    const evaluar = ({ calculo, efectiva }: Escenario) => evaluarRepresentacionPos({ calculo, efectiva, existencias: { 'SKU-A': 5 }, lecturaExistenciasEn: null });

    expect(codigos(evaluar(conControl))).toContain('control_fecha_no_transmisibles');
    expect(codigos(evaluar(conFecha))).toContain('control_fecha_no_transmisibles');
    expect(codigos(evaluar(limpia))).not.toContain('control_fecha_no_transmisibles');
    expect(codigos(evaluar(corregida))).not.toContain('control_fecha_no_transmisibles');
    expect(evaluar(conControl).emisionImportada.permitida).toBe(false);
  });

  it('quantifies an injected 2-decimal half-up POS cost (test only) without claiming a production precision', () => {
    const { calculo, efectiva } = escenario([{ cantidad: '1000', precio: '0.1234', sku: 'SKU-A' }]);
    const salidaPos: PoliticasCalculo['salidaPos'] = { escala: 2, modo: 'half_up' };
    const cuantizado = evaluarRepresentacionPos({ calculo, efectiva, existencias: { 'SKU-A': 5 }, lecturaExistenciasEn: null, salidaPos });
    const sinPolitica = evaluarRepresentacionPos({ calculo, efectiva, existencias: { 'SKU-A': 5 }, lecturaExistenciasEn: null });

    expect(cuantizado.skus[0]).toMatchObject({
      baseDocumentalExIva: '123.40',
      costoPosHipotetico: '0.12',
      baseHipoteticaPosExIva: '120.00',
      diferenciaBase: '3.40',
    });
    expect(cuantizado.baseHipoteticaPosExIvaTotal).toBe('120.00');
    expect(codigos(cuantizado)).toEqual(['cuantizacion_altera_base', ...SIEMPRE].sort());
    expect(cuantizado.emisionImportada.permitida).toBe(false);

    expect(sinPolitica.skus[0]).toMatchObject({ costoPosHipotetico: '0.1234', baseHipoteticaPosExIva: '123.40', diferenciaBase: '0.00' });
    expect(codigos(sinPolitica)).toEqual(SIEMPRE);
  });

  it('does not mutate its inputs and never lets stock enter the calculation result', () => {
    const { calculo, efectiva } = escenario([{ cantidad: '10', precio: '1.00', sku: 'SKU-A' }]);
    const antes = JSON.stringify({ calculo, efectiva });
    const existencias = deepFreeze({ 'SKU-A': -3 });

    evaluarRepresentacionPos({ calculo: deepFreeze(calculo), efectiva: deepFreeze(efectiva), existencias, lecturaExistenciasEn: null });

    expect(JSON.stringify({ calculo, efectiva })).toBe(antes);
    expect(calculo.pos).toBe('no_verificado');
  });
});
