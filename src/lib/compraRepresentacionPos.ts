// What a supplier-invoice review would mean for Hybrid stock and the POS purchase, quantified for display only.
//
// This module never grants anything: `emisionImportada.permitida` is the literal `false` for every input, and the
// precision / execution-time stock blockers are always present. Neither the monetary representation nor the
// numeric precision of the POS is verified, so the bases below are two DOCUMENTARY or HYPOTHETICAL calculations
// (ex-VAT quantity x cost), never an observed supplier debt. Pure and offline: no stock read, no catalog, no write.

import { calcularCantidadesCompraDecimal } from './compraCantidades';
import { addDecimal, cmpDecimal, isZeroDecimal, mulDecimal, parseDecimal, roundDecimal, subDecimal, toDecimalString, type Decimal } from './facturaDecimal';
import type { CalculoRevision, FacturaEfectiva, PoliticasCalculo } from './facturaRevision';

export type CodigoBloqueoPos =
  | 'revision_con_bloqueos'
  | 'existencia_no_leida'
  | 'producto_nuevo_identidad_no_verificada'
  | 'sku_repetido_costo_distinto'
  | 'compensacion_altera_base'
  | 'cuantizacion_altera_base'
  | 'precision_pos_no_verificada'
  | 'control_fecha_no_transmisibles'
  | 'existencia_ejecucion_no_verificada';

export interface BloqueoPos {
  readonly codigo: CodigoBloqueoPos;
  readonly ambito: 'documento' | 'sku';
  readonly codigoProducto: string | null;
  readonly lineaIds: readonly string[];
}

/** One confirmed SKU (all its lines together) or one new-product line. Amounts are ex-VAT bases, not supplier debt. */
export interface ProyeccionSku {
  /** null for a new product: it has no confirmed Hybrid identity yet. */
  readonly codigoProducto: string | null;
  readonly lineaIds: readonly string[];
  /** Documentary quantity in inventory units, summed over the SKU's lines. */
  readonly cantidadDocumentoStock: string;
  readonly existenciaLeida: string | null;
  readonly compensacion: string | null;
  readonly cantidadPos: string | null;
  readonly existenciaEsperada: string | null;
  /** Sum of the lines' ex-VAT bases from the review calculation. */
  readonly baseDocumentalExIva: string;
  /** Net unit cost the POS would receive: the review cost, or the test-injected quantization of it. */
  readonly costoPosHipotetico: string | null;
  /** costoPosHipotetico x cantidadPos. A hypothetical calculation, not what Hybrid books. */
  readonly baseHipoteticaPosExIva: string | null;
  /** baseDocumentalExIva minus baseHipoteticaPosExIva. */
  readonly diferenciaBase: string | null;
}

export interface RepresentacionPos {
  /** When the stock snapshot was observed, or null when no read was observed. Never the evaluation time. */
  readonly lecturaExistenciasEn: string | null;
  readonly skus: readonly ProyeccionSku[];
  /** The review's documentary total including VAT; independent from every base above. */
  readonly totalDocumentalConImpuestos: string | null;
  readonly baseDocumentalExIvaTotal: string | null;
  readonly baseHipoteticaPosExIvaTotal: string | null;
  readonly emisionImportada: { readonly permitida: false; readonly bloqueos: readonly BloqueoPos[] };
}

interface LineaLeida {
  readonly lineaId: string;
  /** Confirmed internal code; null for a new product. */
  readonly codigo: string | null;
  readonly cantidad: Decimal;
  readonly base: Decimal;
  readonly costo: Decimal;
}

interface Grupo {
  readonly codigo: string | null;
  readonly lineas: LineaLeida[];
}

const CERO = parseDecimal('0') as Decimal;

function bloqueoDocumento(codigo: CodigoBloqueoPos): BloqueoPos {
  return { codigo, ambito: 'documento', codigoProducto: null, lineaIds: [] };
}

const BLOQUEOS_SIEMPRE: readonly BloqueoPos[] = [bloqueoDocumento('precision_pos_no_verificada'), bloqueoDocumento('existencia_ejecucion_no_verificada')];

function sumar(valores: readonly Decimal[]): Decimal {
  return valores.reduce(addDecimal, CERO);
}

function hayTexto(valor: string | null): boolean {
  return valor !== null && valor.trim() !== '';
}

/** A stock that is not a finite number with a plain decimal form is unknown; it is never read as zero. */
function leerExistencia(valor: unknown): Decimal | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? parseDecimal(String(valor)) : null;
}

/** Null when any figure the projection needs is unreadable: the caller then treats the review as blocked. */
function leerLineas(calculo: CalculoRevision): LineaLeida[] | null {
  const leidas: LineaLeida[] = [];
  for (const linea of calculo.lineas) {
    const { tipo, codigoInterno } = linea.decisionAsociacion;
    const cantidad = linea.cantidadStock === null ? null : parseDecimal(linea.cantidadStock);
    const base = linea.base === null ? null : parseDecimal(linea.base);
    const costo = linea.costoNetoUnitarioStock === null ? null : parseDecimal(linea.costoNetoUnitarioStock);
    if (!cantidad || !base || !costo || tipo === 'pendiente' || (tipo === 'confirmado' && codigoInterno === null)) return null;
    leidas.push({ lineaId: linea.lineaId, codigo: tipo === 'confirmado' ? codigoInterno : null, cantidad, base, costo });
  }
  return leidas;
}

/** Confirmed lines of one SKU share a group (first-appearance order); every new-product line stands alone. */
function agrupar(lineas: readonly LineaLeida[]): Grupo[] {
  const grupos: Grupo[] = [];
  const porCodigo = new Map<string, Grupo>();
  for (const linea of lineas) {
    const existente = linea.codigo === null ? undefined : porCodigo.get(linea.codigo);
    if (existente) {
      existente.lineas.push(linea);
      continue;
    }
    const grupo: Grupo = { codigo: linea.codigo, lineas: [linea] };
    grupos.push(grupo);
    if (linea.codigo !== null) porCodigo.set(linea.codigo, grupo);
  }
  return grupos;
}

function bloqueadaSinProyeccion(lecturaExistenciasEn: string | null): RepresentacionPos {
  return {
    lecturaExistenciasEn,
    skus: [],
    totalDocumentalConImpuestos: null,
    baseDocumentalExIvaTotal: null,
    baseHipoteticaPosExIvaTotal: null,
    emisionImportada: { permitida: false, bloqueos: [bloqueoDocumento('revision_con_bloqueos'), ...BLOQUEOS_SIEMPRE] },
  };
}

export function evaluarRepresentacionPos(input: {
  readonly calculo: CalculoRevision;
  readonly efectiva: FacturaEfectiva;
  /** Stock by internal code; a missing or non-finite entry is unknown, never zero. */
  readonly existencias: Readonly<Record<string, number>>;
  /** Observed read time of `existencias`, or null when it was not observed. */
  readonly lecturaExistenciasEn: string | null;
  /** Test-only POS cost quantization. It quantifies an effect; it is not a production precision. */
  readonly salidaPos?: PoliticasCalculo['salidaPos'];
}): RepresentacionPos {
  const { calculo, efectiva, existencias, lecturaExistenciasEn, salidaPos } = input;
  const lineas = calculo.sinBloqueos ? leerLineas(calculo) : null;
  if (!lineas) return bloqueadaSinProyeccion(lecturaExistenciasEn);

  const bloqueos: BloqueoPos[] = [];
  const skus = agrupar(lineas).map((grupo): ProyeccionSku => {
    const lineaIds = grupo.lineas.map(linea => linea.lineaId);
    const bloquear = (codigo: CodigoBloqueoPos): void => {
      bloqueos.push({ codigo, ambito: 'sku', codigoProducto: grupo.codigo, lineaIds });
    };
    const cantidadDocumento = sumar(grupo.lineas.map(linea => linea.cantidad));
    const baseDocumental = sumar(grupo.lineas.map(linea => linea.base));

    // Different net costs on one SKU are never averaged: the POS cost for the SKU stays unknown.
    const costo = grupo.lineas.every(linea => cmpDecimal(linea.costo, grupo.lineas[0].costo) === 0) ? grupo.lineas[0].costo : null;
    if (costo === null) bloquear('sku_repetido_costo_distinto');
    // A new product has no hypothetical POS figures at all.
    const costoUsable = grupo.codigo === null ? null : costo;
    const costoPos = costoUsable && salidaPos ? roundDecimal(costoUsable, salidaPos.escala, salidaPos.modo) : costoUsable;
    if (costoUsable && costoPos && cmpDecimal(costoUsable, costoPos) !== 0) bloquear('cuantizacion_altera_base');

    // A new product has no confirmed identity: its stock is never assumed zero.
    const existencia = grupo.codigo === null ? null : leerExistencia(existencias[grupo.codigo]);
    if (grupo.codigo === null) bloquear('producto_nuevo_identidad_no_verificada');
    else if (!existencia) bloquear('existencia_no_leida');
    const cantidades = existencia ? calcularCantidadesCompraDecimal(cantidadDocumento, existencia) : null;
    if (cantidades && costo && !isZeroDecimal(costo) && !isZeroDecimal(cantidades.compensacionNegativo)) bloquear('compensacion_altera_base');

    const baseHipotetica = costoPos && cantidades ? mulDecimal(costoPos, cantidades.cantidadPos) : null;
    return {
      codigoProducto: grupo.codigo,
      lineaIds,
      cantidadDocumentoStock: toDecimalString(cantidadDocumento),
      existenciaLeida: existencia ? toDecimalString(existencia) : null,
      compensacion: cantidades ? toDecimalString(cantidades.compensacionNegativo) : null,
      cantidadPos: cantidades ? toDecimalString(cantidades.cantidadPos) : null,
      existenciaEsperada: cantidades ? toDecimalString(cantidades.existenciaEsperada) : null,
      baseDocumentalExIva: toDecimalString(baseDocumental, 2),
      costoPosHipotetico: costoPos ? toDecimalString(costoPos, 2) : null,
      baseHipoteticaPosExIva: baseHipotetica ? toDecimalString(baseHipotetica, 2) : null,
      diferenciaBase: baseHipotetica ? toDecimalString(subDecimal(baseDocumental, baseHipotetica), 2) : null,
    };
  });

  // The current purchase schema carries neither the printed control number nor the issue date.
  if (hayTexto(efectiva.campos.numeroControl.valor) || hayTexto(efectiva.campos.fechaEmision.valor)) bloqueos.push(bloqueoDocumento('control_fecha_no_transmisibles'));
  bloqueos.push(...BLOQUEOS_SIEMPRE);

  const hipoteticas = skus.map(sku => sku.baseHipoteticaPosExIva);
  const completas = hipoteticas.every((base): base is string => base !== null);
  return {
    lecturaExistenciasEn,
    skus,
    totalDocumentalConImpuestos: calculo.totales?.total ?? null,
    baseDocumentalExIvaTotal: skus.length > 0 ? toDecimalString(sumar(skus.map(sku => parseDecimal(sku.baseDocumentalExIva) as Decimal)), 2) : null,
    baseHipoteticaPosExIvaTotal: skus.length > 0 && completas ? toDecimalString(sumar(hipoteticas.map(base => parseDecimal(base as string) as Decimal)), 2) : null,
    emisionImportada: { permitida: false, bloqueos },
  };
}
