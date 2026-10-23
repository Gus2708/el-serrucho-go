// Supplier-invoice review domain: persisted revision content, motivated corrections,
// exact calculation and review state. Pure and offline: no persistence, catalog,
// stock or network access, and no purchase authority of any kind.
//
// The content shape mirrors facturas_privado.validar_contenido_revision (migration
// *_facturas_proveedores_revisiones.sql) rule for rule, so anything this module
// produces is accepted by guardar_revision_factura and anything it rejects is rejected
// there too. The server stays authoritative; this is the early, structured copy.

import {
  absDecimal,
  addDecimal,
  allocateLargestRemainder,
  cmpDecimal,
  divExactDecimal,
  isZeroDecimal,
  mulDecimal,
  parseDecimal,
  roundDecimal,
  scaleDownPow10,
  subDecimal,
  toDecimalString,
  type Decimal,
  type RoundingMode,
} from './facturaDecimal';
import type {
  ExtraidaLinea,
  ExtraidoDescuento,
  ExtraidoImpuesto,
  FacturaExtraccionPayload,
} from './facturaExtractionContract';
import type { LineMatch } from './facturaMatching';
import { normalizeDecimal } from './facturaProveedor';

export const REVIEW_SCHEMA = 1;
export const CALCULO_VERSION = 'calc-v1';
export const MATCHING_VERSION = 'matching-v1';

// ── Persisted content (matches the SQL validator) ───────────────────────────

export type CabeceraCampoEscalar =
  | 'proveedorNombre'
  | 'proveedorRif'
  | 'numeroDocumento'
  | 'numeroControl'
  | 'fechaEmision'
  | 'moneda'
  | 'tasaCambio'
  | 'subtotal'
  | 'total';

export type LineaCampoEscalar =
  | 'codigoProveedor'
  | 'descripcion'
  | 'cantidad'
  | 'unidad'
  | 'precioUnitario'
  | 'tasaIva'
  | 'total';

export type DecisionCabecera = 'precioIncluyeIva' | 'recepcionCompleta' | 'documentoCompletoConfirmado';

export interface Correccion<T> {
  readonly valor: T;
  readonly motivo: string;
}

export type CorreccionesCabecera = {
  readonly [K in CabeceraCampoEscalar]?: Correccion<string | null>;
} & {
  readonly descuentos?: Correccion<readonly ExtraidoDescuento[]>;
  readonly impuestos?: Correccion<readonly ExtraidoImpuesto[]>;
};

export type CorreccionesLinea = {
  readonly [K in LineaCampoEscalar]?: Correccion<string | null>;
} & {
  readonly descuentos?: Correccion<readonly ExtraidoDescuento[]>;
};

export type AsociacionTipo = 'pendiente' | 'confirmado' | 'producto_nuevo';
export type AsociacionEvidencia = 'sugerencia' | 'manual';

export interface AsociacionRevision {
  readonly tipo: AsociacionTipo;
  readonly codigoInterno: string | null;
  readonly evidencia: AsociacionEvidencia | null;
  readonly motivo: string | null;
}

export interface LineaRevision {
  readonly lineaId: string;
  readonly origen: { readonly numeroLinea: number } | null;
  readonly correcciones: CorreccionesLinea;
  readonly factorConversion: string | null;
  readonly asociacion: AsociacionRevision;
  readonly codigoBarras: { readonly usarCodigoFactura: boolean };
}

export interface CabeceraRevision {
  readonly correcciones: CorreccionesCabecera;
  readonly tasaConfirmada: null;
  readonly precioIncluyeIva: boolean | null;
  readonly recepcionCompleta: boolean | null;
  readonly documentoCompletoConfirmado: boolean | null;
}

export interface RevisionContenido {
  readonly review_schema: typeof REVIEW_SCHEMA;
  readonly calculo_version: typeof CALCULO_VERSION;
  readonly matching_version: typeof MATCHING_VERSION;
  readonly extraccion_id: string | null;
  readonly cabecera: CabeceraRevision;
  readonly lineas: readonly LineaRevision[];
}

export interface RevisionError {
  readonly codigo: 'contenido_invalido' | 'edicion_invalida' | 'id_invalido';
  readonly ruta: string;
  readonly mensaje: string;
}

export type ResultadoRevision =
  | { readonly ok: true; readonly contenido: RevisionContenido }
  | { readonly ok: false; readonly error: RevisionError };

const CABECERA_ESCALARES: readonly CabeceraCampoEscalar[] = [
  'proveedorNombre',
  'proveedorRif',
  'numeroDocumento',
  'numeroControl',
  'fechaEmision',
  'moneda',
  'tasaCambio',
  'subtotal',
  'total',
];
const LINEA_ESCALARES: readonly LineaCampoEscalar[] = [
  'codigoProveedor',
  'descripcion',
  'cantidad',
  'unidad',
  'precioUnitario',
  'tasaIva',
  'total',
];
const CAMPOS_DECIMALES: readonly string[] = ['tasaCambio', 'subtotal', 'total', 'cantidad', 'precioUnitario', 'tasaIva'];
const LONGITUDES: Readonly<Record<string, number>> = {
  proveedorNombre: 200,
  proveedorRif: 40,
  numeroDocumento: 60,
  numeroControl: 60,
  codigoProveedor: 80,
  unidad: 40,
  descripcion: 500,
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_LINEAS_REVISION = 500;
const MAX_LISTA = 20;

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is Plain {
  if (!isPlain(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function longitud(text: string): number {
  return Array.from(text).length;
}

function nonBlank(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.trim() !== '' && longitud(value) <= max;
}

function isRealDate(text: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Same rule as normalizeDecimal in the extraction parser, but a blank string is rejected. */
function decimalExtraidoValido(value: unknown, enteros: number, escala: number): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 30) return false;
  const match = /^([0-9]+)(?:[.,]([0-9]+))?$/.exec(value.trim());
  if (!match) return false;
  return match[1].replace(/^0+(?=[0-9])/, '').length <= enteros && (match[2] ?? '').replace(/0+$/, '').length <= escala;
}

function valorEscalarValido(campo: string, valor: unknown): boolean {
  if (valor === null) return true;
  if (typeof valor !== 'string' || valor.length === 0) return false;
  if (CAMPOS_DECIMALES.includes(campo)) return /^[0-9]{1,12}(\.[0-9]{1,8})?$/.test(valor);
  if (campo === 'fechaEmision') return isRealDate(valor);
  if (campo === 'moneda') return /^[A-Z]{3}$/.test(valor);
  const max = LONGITUDES[campo] ?? 500;
  return longitud(valor) >= 1 && longitud(valor) <= max;
}

function listaDescuentosValida(valor: unknown): boolean {
  if (!Array.isArray(valor) || valor.length > MAX_LISTA) return false;
  const ordenes = new Set<number>();
  for (const item of valor) {
    if (!exactKeys(item, ['orden', 'porcentaje', 'monto', 'alcance', 'incluidoEnPrecio'])) return false;
    const { orden, porcentaje, monto, alcance, incluidoEnPrecio } = item;
    if (typeof orden !== 'number' || !Number.isSafeInteger(orden) || orden < 1 || orden >= 1e15 || ordenes.has(orden)) return false;
    ordenes.add(orden);
    if (!decimalExtraidoValido(porcentaje, 5, 4) || !decimalExtraidoValido(monto, 11, 4)) return false;
    if (alcance !== null && alcance !== 'renglon' && alcance !== 'global') return false;
    if (incluidoEnPrecio !== null && typeof incluidoEnPrecio !== 'boolean') return false;
  }
  return true;
}

function listaImpuestosValida(valor: unknown): boolean {
  if (!Array.isArray(valor) || valor.length > MAX_LISTA) return false;
  return valor.every(
    item =>
      exactKeys(item, ['tasa', 'base', 'monto', 'exento']) &&
      decimalExtraidoValido(item.tasa, 5, 4) &&
      decimalExtraidoValido(item.base, 11, 4) &&
      decimalExtraidoValido(item.monto, 11, 4) &&
      (item.exento === null || typeof item.exento === 'boolean')
  );
}

function fallo(ruta: string, mensaje: string): { ok: false; error: RevisionError } {
  return { ok: false, error: { codigo: 'contenido_invalido', ruta, mensaje } };
}

function validarCorrecciones(
  correcciones: unknown,
  escalares: readonly string[],
  conImpuestos: boolean,
  ruta: string
): string | null {
  if (!isPlain(correcciones)) return `${ruta}: correcciones debe ser un objeto`;
  for (const [campo, corr] of Object.entries(correcciones)) {
    const esLista = campo === 'descuentos' || (conImpuestos && campo === 'impuestos');
    if (!esLista && !escalares.includes(campo)) return `${ruta}: campo no corregible ${campo}`;
    if (!exactKeys(corr, ['valor', 'motivo']) || !nonBlank(corr.motivo)) return `${ruta}.${campo}: requiere valor y motivo`;
    if (campo === 'descuentos' ? !listaDescuentosValida(corr.valor) : campo === 'impuestos' ? !listaImpuestosValida(corr.valor) : !valorEscalarValido(campo, corr.valor)) {
      return `${ruta}.${campo}: valor invalido`;
    }
  }
  return null;
}

function validarAsociacion(aso: unknown): boolean {
  if (!exactKeys(aso, ['tipo', 'codigoInterno', 'evidencia', 'motivo'])) return false;
  const { tipo, codigoInterno, evidencia, motivo } = aso;
  if (typeof tipo !== 'string') return false;
  if (codigoInterno !== null && typeof codigoInterno !== 'string') return false;
  if (evidencia !== null && typeof evidencia !== 'string') return false;
  if (motivo !== null && !nonBlank(motivo)) return false;
  if (tipo === 'pendiente') return codigoInterno === null && evidencia === null && motivo === null;
  if (tipo === 'confirmado') {
    return (
      typeof codigoInterno === 'string' &&
      longitud(codigoInterno) >= 1 &&
      longitud(codigoInterno) <= 80 &&
      (evidencia === 'sugerencia' || evidencia === 'manual') &&
      (evidencia !== 'manual' || motivo !== null)
    );
  }
  return tipo === 'producto_nuevo' && codigoInterno === null && evidencia === 'manual' && motivo !== null;
}

/**
 * Fail-closed structural check, rule for rule the same as the SQL validator. `extraccion` is
 * the staged result the revision references (null for a manual-only revision).
 */
export function validarContenidoRevision(
  contenido: unknown,
  extraccion: FacturaExtraccionPayload | null
): ResultadoRevision {
  if (!exactKeys(contenido, ['review_schema', 'calculo_version', 'matching_version', 'extraccion_id', 'cabecera', 'lineas'])) {
    return fallo('', 'claves de contenido');
  }
  if (contenido.review_schema !== REVIEW_SCHEMA || contenido.calculo_version !== CALCULO_VERSION || contenido.matching_version !== MATCHING_VERSION) {
    return fallo('', 'version de contrato');
  }
  const extraccionId = contenido.extraccion_id;
  if (extraccionId !== null && typeof extraccionId !== 'string') return fallo('extraccion_id', 'debe ser texto o null');
  if ((extraccionId === null) !== (extraccion === null)) return fallo('extraccion_id', 'no coincide con la extraccion');

  const cabecera = contenido.cabecera;
  if (
    !exactKeys(cabecera, ['correcciones', 'tasaConfirmada', 'precioIncluyeIva', 'recepcionCompleta', 'documentoCompletoConfirmado']) ||
    cabecera.tasaConfirmada !== null ||
    [cabecera.precioIncluyeIva, cabecera.recepcionCompleta, cabecera.documentoCompletoConfirmado].some(
      v => v !== null && typeof v !== 'boolean'
    )
  ) {
    return fallo('cabecera', 'forma de cabecera');
  }
  const errorCabecera = validarCorrecciones(cabecera.correcciones, CABECERA_ESCALARES, true, 'cabecera');
  if (errorCabecera) return fallo('cabecera.correcciones', errorCabecera);

  const lineas = contenido.lineas;
  if (!Array.isArray(lineas) || lineas.length > MAX_LINEAS_REVISION) return fallo('lineas', 'debe ser un arreglo de hasta 500');

  const ids = new Set<string>();
  const origenes = new Set<number>();
  for (let index = 0; index < lineas.length; index += 1) {
    const ruta = `lineas[${index}]`;
    const linea: unknown = lineas[index];
    if (!exactKeys(linea, ['lineaId', 'origen', 'correcciones', 'factorConversion', 'asociacion', 'codigoBarras'])) {
      return fallo(ruta, 'claves de renglon');
    }
    if (typeof linea.lineaId !== 'string' || !UUID_RE.test(linea.lineaId) || ids.has(linea.lineaId)) {
      return fallo(`${ruta}.lineaId`, 'UUID invalido o repetido');
    }
    ids.add(linea.lineaId);

    const errorLinea = validarCorrecciones(linea.correcciones, LINEA_ESCALARES, false, ruta);
    if (errorLinea) return fallo(`${ruta}.correcciones`, errorLinea);

    if (linea.origen === null) {
      if (Object.keys(linea.correcciones as Plain).length === 0) return fallo(`${ruta}.origen`, 'un renglon manual requiere una correccion con motivo');
    } else {
      const origen = linea.origen;
      if (!exactKeys(origen, ['numeroLinea']) || typeof origen.numeroLinea !== 'number' || !Number.isSafeInteger(origen.numeroLinea) || origen.numeroLinea < 1 || origen.numeroLinea > 999_999_999) {
        return fallo(`${ruta}.origen`, 'origen invalido');
      }
      if (extraccion === null) return fallo(`${ruta}.origen`, 'origen sin extraccion');
      if (origenes.has(origen.numeroLinea)) return fallo(`${ruta}.origen`, 'origen repetido');
      origenes.add(origen.numeroLinea);
      if (extraccion.lineas.filter(l => l.numeroLinea === origen.numeroLinea).length !== 1) {
        return fallo(`${ruta}.origen`, 'origen desconocido o ambiguo');
      }
    }

    const factor = linea.factorConversion;
    if (factor !== null && (typeof factor !== 'string' || !/^[0-9]{1,12}(\.[0-9]{1,8})?$/.test(factor) || !/[1-9]/.test(factor))) {
      return fallo(`${ruta}.factorConversion`, 'factor invalido');
    }
    if (!validarAsociacion(linea.asociacion)) return fallo(`${ruta}.asociacion`, 'asociacion incoherente');
    if (!exactKeys(linea.codigoBarras, ['usarCodigoFactura']) || typeof linea.codigoBarras.usarCodigoFactura !== 'boolean') {
      return fallo(`${ruta}.codigoBarras`, 'forma de codigo de barras');
    }
  }
  if (extraccion !== null && extraccion.lineas.length !== origenes.size) {
    return fallo('lineas', 'faltan renglones de la extraccion');
  }
  return { ok: true, contenido: contenido as unknown as RevisionContenido };
}

/** Allocates a lineaId per slot; `origenes[i]` is the source numeroLinea of the slot, or null for a manual row. */
export type AsignadorLineaId = (numeroLinea: number | null) => string;

function asignarIds(origenes: readonly (number | null)[], nuevoId: AsignadorLineaId): string[] | RevisionError {
  const ids: string[] = [];
  for (let i = 0; i < origenes.length; i += 1) {
    const id = nuevoId(origenes[i]);
    if (typeof id !== 'string' || !UUID_RE.test(id) || ids.includes(id)) {
      return { codigo: 'id_invalido', ruta: `lineas[${i}].lineaId`, mensaje: 'el generador devolvio un UUID invalido o repetido' };
    }
    ids.push(id);
  }
  return ids;
}

function lineaPendiente(lineaId: string, numeroLinea: number | null): LineaRevision {
  return {
    lineaId,
    origen: numeroLinea === null ? null : { numeroLinea },
    correcciones: {},
    factorConversion: null,
    asociacion: { tipo: 'pendiente', codigoInterno: null, evidencia: null, motivo: null },
    codigoBarras: { usarCodigoFactura: false },
  };
}

const CABECERA_VACIA: CabeceraRevision = {
  correcciones: {},
  tasaConfirmada: null,
  precioIncluyeIva: null,
  recepcionCompleta: null,
  documentoCompletoConfirmado: null,
};

/**
 * First revision of an extraction: one pending line per raw line, in document order, repeated
 * supplier codes kept apart. Every decision starts unknown; nothing is confirmed on the user's behalf.
 * The allocator receives each slot's source numeroLinea, so a caller that re-applies an extraction
 * already seen in the invoice history (A/detach/A, A/B/A) can hand back that extraction's historical
 * lineaId for the same source line instead of minting a new one.
 */
export function crearRevisionDesdeExtraccion(
  extraccion: FacturaExtraccionPayload,
  extraccionId: string,
  nuevoId: AsignadorLineaId
): ResultadoRevision {
  const ids = asignarIds(extraccion.lineas.map(l => l.numeroLinea), nuevoId);
  if (!Array.isArray(ids)) return { ok: false, error: ids };
  const contenido: RevisionContenido = {
    review_schema: REVIEW_SCHEMA,
    calculo_version: CALCULO_VERSION,
    matching_version: MATCHING_VERSION,
    extraccion_id: extraccionId,
    cabecera: CABECERA_VACIA,
    lineas: extraccion.lineas.map((linea, index) => lineaPendiente(ids[index], linea.numeroLinea)),
  };
  return validarContenidoRevision(contenido, extraccion);
}

export function crearRevisionManual(): RevisionContenido {
  return {
    review_schema: REVIEW_SCHEMA,
    calculo_version: CALCULO_VERSION,
    matching_version: MATCHING_VERSION,
    extraccion_id: null,
    cabecera: CABECERA_VACIA,
    lineas: [],
  };
}

// ── Edits (pure: never mutate the extraction or a previous revision) ────────

export type Edicion =
  | { readonly tipo: 'cabecera_escalar'; readonly campo: CabeceraCampoEscalar; readonly valor: string | null; readonly motivo: string }
  | { readonly tipo: 'cabecera_descuentos'; readonly valor: readonly ExtraidoDescuento[]; readonly motivo: string }
  | { readonly tipo: 'cabecera_impuestos'; readonly valor: readonly ExtraidoImpuesto[]; readonly motivo: string }
  | { readonly tipo: 'linea_escalar'; readonly lineaId: string; readonly campo: LineaCampoEscalar; readonly valor: string | null; readonly motivo: string }
  | { readonly tipo: 'linea_descuentos'; readonly lineaId: string; readonly valor: readonly ExtraidoDescuento[]; readonly motivo: string }
  | { readonly tipo: 'revertir_cabecera'; readonly campo: CabeceraCampoEscalar | 'descuentos' | 'impuestos' }
  | { readonly tipo: 'revertir_linea'; readonly lineaId: string; readonly campo: LineaCampoEscalar | 'descuentos' }
  | { readonly tipo: 'decision_cabecera'; readonly campo: DecisionCabecera; readonly valor: boolean | null }
  | { readonly tipo: 'factor_conversion'; readonly lineaId: string; readonly valor: string | null }
  | { readonly tipo: 'asociacion'; readonly lineaId: string; readonly asociacion: AsociacionRevision }
  | { readonly tipo: 'codigo_barras'; readonly lineaId: string; readonly usarCodigoFactura: boolean }
  | { readonly tipo: 'agregar_linea_manual'; readonly correcciones: CorreccionesLinea }
  | { readonly tipo: 'quitar_linea_manual'; readonly lineaId: string };

export type ResultadoEdicion =
  | { readonly ok: true; readonly contenido: RevisionContenido; readonly cambio: boolean }
  | { readonly ok: false; readonly error: RevisionError };

function igualesProfundo(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => igualesProfundo(item, b[index]));
  }
  if (isPlain(a) && isPlain(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => key in b && igualesProfundo(a[key], b[key]));
  }
  return false;
}

function quitarClave<T extends object>(objeto: T, clave: string): T {
  const copia: Plain = { ...(objeto as Plain) };
  delete copia[clave];
  return copia as T;
}

function conCorreccion<T extends object>(correcciones: T, campo: string, valor: unknown, original: unknown, motivo: string): T {
  if (igualesProfundo(valor, original)) return quitarClave(correcciones, campo);
  return { ...correcciones, [campo]: { valor, motivo } } as T;
}

function lineaOrigen(extraccion: FacturaExtraccionPayload | null, linea: LineaRevision): ExtraidaLinea | null {
  return linea.origen && extraccion ? extraccion.lineas.find(l => l.numeroLinea === linea.origen?.numeroLinea) ?? null : null;
}

/** Applies one explicit user edit. Returns the same object with `cambio: false` for a no-op. */
export function aplicarEdicion(
  contenido: RevisionContenido,
  extraccion: FacturaExtraccionPayload | null,
  edicion: Edicion,
  nuevoId?: AsignadorLineaId
): ResultadoEdicion {
  const rechazo = (mensaje: string): ResultadoEdicion => ({ ok: false, error: { codigo: 'edicion_invalida', ruta: edicion.tipo, mensaje } });
  const actualizarLinea = (lineaId: string, fn: (linea: LineaRevision, origen: ExtraidaLinea | null) => LineaRevision): RevisionContenido | null => {
    if (!contenido.lineas.some(l => l.lineaId === lineaId)) return null;
    return { ...contenido, lineas: contenido.lineas.map(l => (l.lineaId === lineaId ? fn(l, lineaOrigen(extraccion, l)) : l)) };
  };

  let siguiente: RevisionContenido | null;
  switch (edicion.tipo) {
    case 'cabecera_escalar': {
      const original = extraccion ? extraccion.cabecera[edicion.campo] : null;
      siguiente = { ...contenido, cabecera: { ...contenido.cabecera, correcciones: conCorreccion(contenido.cabecera.correcciones, edicion.campo, edicion.valor, original, edicion.motivo) } };
      break;
    }
    case 'cabecera_descuentos':
    case 'cabecera_impuestos': {
      const campo = edicion.tipo === 'cabecera_descuentos' ? 'descuentos' : 'impuestos';
      const original = extraccion ? extraccion.cabecera[campo] : [];
      siguiente = { ...contenido, cabecera: { ...contenido.cabecera, correcciones: conCorreccion(contenido.cabecera.correcciones, campo, edicion.valor, original, edicion.motivo) } };
      break;
    }
    case 'linea_escalar':
      siguiente = actualizarLinea(edicion.lineaId, (l, origen) => ({
        ...l,
        correcciones: conCorreccion(l.correcciones, edicion.campo, edicion.valor, origen ? origen[edicion.campo] : null, edicion.motivo),
      }));
      break;
    case 'linea_descuentos':
      siguiente = actualizarLinea(edicion.lineaId, (l, origen) => ({
        ...l,
        correcciones: conCorreccion(l.correcciones, 'descuentos', edicion.valor, origen ? origen.descuentos : [], edicion.motivo),
      }));
      break;
    case 'revertir_cabecera':
      siguiente = { ...contenido, cabecera: { ...contenido.cabecera, correcciones: quitarClave(contenido.cabecera.correcciones, edicion.campo) } };
      break;
    case 'revertir_linea':
      siguiente = actualizarLinea(edicion.lineaId, l => ({ ...l, correcciones: quitarClave(l.correcciones, edicion.campo) }));
      break;
    case 'decision_cabecera':
      siguiente = { ...contenido, cabecera: { ...contenido.cabecera, [edicion.campo]: edicion.valor } };
      break;
    case 'factor_conversion':
      siguiente = actualizarLinea(edicion.lineaId, l => ({ ...l, factorConversion: edicion.valor }));
      break;
    case 'asociacion':
      siguiente = actualizarLinea(edicion.lineaId, l => ({ ...l, asociacion: edicion.asociacion }));
      break;
    case 'codigo_barras':
      siguiente = actualizarLinea(edicion.lineaId, l => ({ ...l, codigoBarras: { usarCodigoFactura: edicion.usarCodigoFactura } }));
      break;
    case 'agregar_linea_manual': {
      if (!nuevoId) return rechazo('falta el generador de UUID');
      const ids = asignarIds([null], nuevoId);
      if (!Array.isArray(ids)) return { ok: false, error: ids };
      if (contenido.lineas.some(l => l.lineaId === ids[0])) return rechazo('UUID repetido');
      siguiente = { ...contenido, lineas: [...contenido.lineas, { ...lineaPendiente(ids[0], null), correcciones: edicion.correcciones }] };
      break;
    }
    case 'quitar_linea_manual': {
      const objetivo = contenido.lineas.find(l => l.lineaId === edicion.lineaId);
      if (!objetivo) return rechazo('renglon desconocido');
      if (objetivo.origen !== null) return rechazo('un renglon de la extraccion no se puede quitar');
      siguiente = { ...contenido, lineas: contenido.lineas.filter(l => l.lineaId !== edicion.lineaId) };
      break;
    }
  }
  if (siguiente === null) return rechazo('renglon desconocido');
  if (igualesProfundo(siguiente, contenido)) return { ok: true, contenido, cambio: false };

  const validado = validarContenidoRevision(siguiente, extraccion);
  return validado.ok ? { ok: true, contenido: validado.contenido, cambio: true } : { ok: false, error: validado.error };
}

/** Explicit association from a T3 suggestion; anything outside the candidates needs a manual motive. */
export function asociacionDesdeCandidato(
  match: Pick<LineMatch, 'candidates'>,
  codigoInterno: string,
  motivo: string | null
): AsociacionRevision | null {
  const razon = motivo !== null && motivo.trim() !== '' ? motivo : null;
  if (match.candidates.some(c => c.codigoInterno === codigoInterno)) {
    return { tipo: 'confirmado', codigoInterno, evidencia: 'sugerencia', motivo: razon };
  }
  return razon ? { tipo: 'confirmado', codigoInterno, evidencia: 'manual', motivo: razon } : null;
}

// ── Effective values: original plus corrections, kept distinct ──────────────

export interface ValorEfectivo<T> {
  readonly valor: T;
  readonly original: T;
  readonly corregido: boolean;
  readonly motivo: string | null;
}

export interface LineaEfectiva {
  readonly lineaId: string;
  readonly numeroLinea: number | null;
  readonly campos: Readonly<Record<LineaCampoEscalar, ValorEfectivo<string | null>>>;
  readonly descuentos: ValorEfectivo<readonly ExtraidoDescuento[]>;
  readonly factorConversion: string | null;
  readonly asociacion: AsociacionRevision;
  readonly usarCodigoFactura: boolean;
  readonly lecturaOcr: { readonly confianza: number | null; readonly advertencias: readonly string[]; readonly campoDudoso: readonly string[] } | null;
}

export interface FacturaEfectiva {
  readonly campos: Readonly<Record<CabeceraCampoEscalar, ValorEfectivo<string | null>>>;
  readonly descuentos: ValorEfectivo<readonly ExtraidoDescuento[]>;
  readonly impuestos: ValorEfectivo<readonly ExtraidoImpuesto[]>;
  readonly lineas: readonly LineaEfectiva[];
}

function efectivo<T>(correccion: Correccion<T> | undefined, original: T): ValorEfectivo<T> {
  return correccion
    ? { valor: correccion.valor, original, corregido: true, motivo: correccion.motivo }
    : { valor: original, original, corregido: false, motivo: null };
}

export function resolverFactura(extraccion: FacturaExtraccionPayload | null, contenido: RevisionContenido): FacturaEfectiva {
  const campos = {} as Record<CabeceraCampoEscalar, ValorEfectivo<string | null>>;
  for (const campo of CABECERA_ESCALARES) {
    campos[campo] = efectivo(contenido.cabecera.correcciones[campo], extraccion ? extraccion.cabecera[campo] : null);
  }
  const lineas = contenido.lineas.map((linea): LineaEfectiva => {
    const origen = lineaOrigen(extraccion, linea);
    const camposLinea = {} as Record<LineaCampoEscalar, ValorEfectivo<string | null>>;
    for (const campo of LINEA_ESCALARES) camposLinea[campo] = efectivo(linea.correcciones[campo], origen ? origen[campo] : null);
    return {
      lineaId: linea.lineaId,
      numeroLinea: linea.origen?.numeroLinea ?? null,
      campos: camposLinea,
      descuentos: efectivo<readonly ExtraidoDescuento[]>(linea.correcciones.descuentos, origen ? origen.descuentos : []),
      factorConversion: linea.factorConversion,
      asociacion: linea.asociacion,
      usarCodigoFactura: linea.codigoBarras.usarCodigoFactura,
      lecturaOcr: origen?.incertidumbre
        ? { confianza: origen.incertidumbre.confianzaLectura, advertencias: origen.incertidumbre.advertencias, campoDudoso: origen.incertidumbre.campoDudoso }
        : null,
    };
  });
  return {
    campos,
    descuentos: efectivo<readonly ExtraidoDescuento[]>(contenido.cabecera.correcciones.descuentos, extraccion ? extraccion.cabecera.descuentos : []),
    impuestos: efectivo<readonly ExtraidoImpuesto[]>(contenido.cabecera.correcciones.impuestos, extraccion ? extraccion.cabecera.impuestos : []),
    lineas,
  };
}

// ── Barcode intent ──────────────────────────────────────────────────────────

export type EstadoCodigoBarras =
  | 'sin_codigo'
  | 'unico_verificado'
  | 'ya_asignado_a_este_producto'
  | 'colision'
  | 'reemplazo_requiere_confirmacion'
  | 'no_verificable';

export interface CatalogoCodigosBarras {
  readonly productos: readonly { readonly codigoInterno: string; readonly codigoBarras: string | null }[];
  /** true only when `productos` is the whole catalog, not a capped candidate subset. */
  readonly completo: boolean;
}

/**
 * Compares the literal printed code (no trimming, no leading-zero stripping) with the catalog.
 * Absence from a partial catalog never proves uniqueness.
 */
export function evaluarCodigoBarras(input: {
  readonly codigoFactura: string | null;
  readonly codigoInternoAsociado: string | null;
  readonly catalogo: CatalogoCodigosBarras;
}): EstadoCodigoBarras {
  const { codigoFactura, codigoInternoAsociado, catalogo } = input;
  if (codigoFactura === null || codigoFactura === '') return 'sin_codigo';
  const duenos = catalogo.productos.filter(p => p.codigoBarras === codigoFactura);
  if (duenos.some(p => p.codigoInterno !== codigoInternoAsociado)) return 'colision';
  if (duenos.length > 0) return 'ya_asignado_a_este_producto';
  const asociado = codigoInternoAsociado === null ? undefined : catalogo.productos.find(p => p.codigoInterno === codigoInternoAsociado);
  if (asociado && asociado.codigoBarras !== null && asociado.codigoBarras !== '') return 'reemplazo_requiere_confirmacion';
  return catalogo.completo ? 'unico_verificado' : 'no_verificable';
}

// ── Calculation ─────────────────────────────────────────────────────────────

export type CodigoBloqueo =
  | 'moneda_desconocida'
  | 'moneda_sin_tasa_aprobada'
  | 'documento_completitud_no_confirmada'
  | 'recepcion_no_confirmada'
  | 'iva_inclusion_desconocida'
  | 'iva_tasa_desconocida'
  | 'iva_incluido_division_inexacta'
  | 'asociacion_pendiente'
  | 'conversion_no_confirmada'
  | 'dato_faltante'
  | 'valor_invalido'
  | 'cantidad_cero'
  | 'costo_unitario_division_inexacta'
  | 'descuento_alcance_desconocido'
  | 'descuento_alcance_inconsistente'
  | 'descuento_inclusion_desconocida'
  | 'descuento_sin_valor'
  | 'descuento_invalido'
  | 'descuento_inconsistente'
  | 'descuento_excede_importe'
  | 'descuento_global_sin_politica'
  | 'descuento_global_no_representable'
  | 'diferencia_documental'
  | 'codigo_barras_no_verificado'
  | 'politica_no_aprobada';

export interface Bloqueo {
  readonly codigo: CodigoBloqueo;
  readonly ambito: 'documento' | 'linea';
  readonly lineaId: string | null;
  readonly detalle: string | null;
}

/** Policies are empty in production. Anything injected here is test-only and never an approval. */
export interface PoliticasCalculo {
  readonly descuentoGlobal?: { readonly escala: number; readonly lineasElegibles: readonly string[] };
  /** Absolute tolerance for percent-vs-amount and printed-vs-calculated differences. */
  readonly tolerancia?: string;
  /** What the POS could represent; only quantifies the effect, it never verifies the POS. */
  readonly salidaPos?: { readonly escala: number; readonly modo: RoundingMode };
}

export const POLITICAS_PRODUCCION: PoliticasCalculo = Object.freeze({});

export interface DescuentoAplicado {
  readonly orden: number;
  readonly tipo: 'porcentaje' | 'monto';
  readonly valor: string;
  readonly importeAntes: string;
  readonly importeDespues: string;
}

export interface CalculoLinea {
  readonly lineaId: string;
  readonly numeroLinea: number | null;
  readonly codigoProveedor: string | null;
  readonly descripcion: string | null;
  readonly unidadDocumento: string | null;
  /** Literal documentary quantity: never changed by the conversion factor or the association. */
  readonly cantidadDocumento: string | null;
  readonly factorConversion: string | null;
  readonly cantidadStock: string | null;
  readonly precioUnitario: string | null;
  readonly importeBruto: string | null;
  readonly descuentosAplicados: readonly DescuentoAplicado[];
  readonly descuentosYaIncluidos: readonly number[];
  readonly importeTrasDescuentos: string | null;
  readonly descuentoGlobalAsignado: string | null;
  readonly importeFinal: string | null;
  readonly tasaIva: string | null;
  readonly base: string | null;
  readonly iva: string | null;
  readonly totalConIva: string | null;
  readonly costoNetoUnitarioStock: string | null;
  /** How well the OCR read the line (extraction evidence); independent from the decision below. */
  readonly lecturaOcr: LineaEfectiva['lecturaOcr'];
  /** The human association decision; independent from the OCR confidence above. */
  readonly decisionAsociacion: AsociacionRevision;
}

export interface GrupoTasa {
  readonly tasa: string;
  readonly base: string;
  readonly iva: string;
}

export interface Diferencia {
  readonly ambito: 'linea' | 'cabecera';
  readonly lineaId: string | null;
  readonly campo: string;
  readonly impreso: string | null;
  readonly calculado: string | null;
  readonly diferencia: string | null;
}

export interface CuantizacionPos {
  readonly escala: number;
  readonly lineas: readonly {
    readonly lineaId: string;
    readonly costoDocumental: string;
    readonly costoPos: string;
    readonly importeDocumental: string;
    readonly importePos: string;
    readonly diferencia: string;
  }[];
  readonly diferenciaTotal: string;
}

export interface TotalesCalculo {
  readonly base: string;
  readonly iva: string;
  readonly total: string;
}

export interface CalculoRevision {
  readonly calculo_version: typeof CALCULO_VERSION;
  readonly moneda: string | null;
  readonly lineas: readonly CalculoLinea[];
  readonly porTasa: readonly GrupoTasa[] | null;
  /** null while any line is unknown: a partial sum is never presented as the total. */
  readonly totales: TotalesCalculo | null;
  readonly diferencias: readonly Diferencia[];
  readonly cuantizacionPos: CuantizacionPos | null;
  readonly pos: 'no_verificado';
  readonly bloqueos: readonly Bloqueo[];
  /** True only with zero blockers. Review readiness, not purchase authority. */
  readonly sinBloqueos: boolean;
}

const FORMA_CANTIDAD = { intDigits: 11, scale: 4 };
const FORMA_PRECIO = { intDigits: 9, scale: 6 };
const FORMA_TOTAL = { intDigits: 11, scale: 4 };
const FORMA_PORCENTAJE = { intDigits: 5, scale: 4 };
const CIEN = parseDecimal('100') as Decimal;
const CERO = parseDecimal('0') as Decimal;

type Lectura = { readonly ok: true; readonly valor: Decimal | null } | { readonly ok: false };

function leer(texto: string | null, forma: { intDigits: number; scale: number }): Lectura {
  if (texto === null) return { ok: true, valor: null };
  const normalizado = normalizeDecimal(texto, forma);
  if (!normalizado.ok) return { ok: false };
  return { ok: true, valor: normalizado.value === null ? null : parseDecimal(normalizado.value) };
}

const texto = (valor: Decimal | null, minScale = 0): string | null => (valor ? toDecimalString(valor, minScale) : null);

export function calcularRevision(input: {
  readonly extraccion: FacturaExtraccionPayload | null;
  readonly contenido: RevisionContenido;
  readonly politicas?: PoliticasCalculo;
  /** Per lineaId result of evaluarCodigoBarras; a missing entry counts as not verified. */
  readonly estadosCodigoBarras?: Readonly<Record<string, EstadoCodigoBarras>>;
}): CalculoRevision {
  const { extraccion, contenido } = input;
  const politicas = input.politicas ?? POLITICAS_PRODUCCION;
  const efectiva = resolverFactura(extraccion, contenido);
  const bloqueos: Bloqueo[] = [];
  const bloquear = (codigo: CodigoBloqueo, lineaId: string | null, detalle: string | null = null) => {
    if (!bloqueos.some(b => b.codigo === codigo && b.lineaId === lineaId && b.detalle === detalle)) {
      bloqueos.push({ codigo, ambito: lineaId === null ? 'documento' : 'linea', lineaId, detalle });
    }
  };

  if (Object.keys(politicas).length > 0) bloquear('politica_no_aprobada', null, 'politicas inyectadas son de prueba');
  const toleranciaLeida = politicas.tolerancia === undefined ? CERO : parseDecimal(politicas.tolerancia) ?? CERO;

  // Document level confirmations and currency.
  const moneda = efectiva.campos.moneda.valor;
  if (moneda === null) bloquear('moneda_desconocida', null);
  else if (moneda !== 'USD') bloquear('moneda_sin_tasa_aprobada', null, moneda);
  if (contenido.cabecera.documentoCompletoConfirmado !== true) bloquear('documento_completitud_no_confirmada', null);
  if (contenido.cabecera.recepcionCompleta !== true) bloquear('recepcion_no_confirmada', null);
  const incluyeIva = contenido.cabecera.precioIncluyeIva;
  if (incluyeIva === null) bloquear('iva_inclusion_desconocida', null);

  // Per line: gross, ordered line discounts, conversion.
  interface Trabajo {
    efectiva: LineaEfectiva;
    cantidad: Decimal | null;
    factor: Decimal | null;
    precio: Decimal | null;
    importe: Decimal | null;
    importeRenglon: Decimal | null;
    bruto: Decimal | null;
    aplicados: DescuentoAplicado[];
    incluidos: number[];
    tasa: Decimal | null;
    final: Decimal | null;
    globalAsignado: Decimal | null;
    base: Decimal | null;
    iva: Decimal | null;
    costo: Decimal | null;
    stock: Decimal | null;
  }

  const trabajos: Trabajo[] = efectiva.lineas.map(linea => {
    const id = linea.lineaId;
    const lectura = (campo: LineaCampoEscalar, forma: { intDigits: number; scale: number }, requerido: boolean): Decimal | null => {
      const resultado = leer(linea.campos[campo].valor, forma);
      if (!resultado.ok) {
        bloquear('valor_invalido', id, campo);
        return null;
      }
      if (resultado.valor === null && requerido) bloquear('dato_faltante', id, campo);
      return resultado.valor;
    };

    if (linea.asociacion.tipo === 'pendiente') bloquear('asociacion_pendiente', id);
    const cantidad = lectura('cantidad', FORMA_CANTIDAD, true);
    const precio = lectura('precioUnitario', FORMA_PRECIO, true);
    const tasa = lectura('tasaIva', FORMA_PORCENTAJE, false);
    if (tasa === null && linea.campos.tasaIva.valor === null) bloquear('iva_tasa_desconocida', id);
    const factor = linea.factorConversion === null ? null : parseDecimal(linea.factorConversion);
    if (factor === null) bloquear('conversion_no_confirmada', id);

    const bruto = cantidad && precio ? mulDecimal(cantidad, precio) : null;
    const aplicados: DescuentoAplicado[] = [];
    const incluidos: number[] = [];
    let importe: Decimal | null = bruto;
    for (const descuento of [...linea.descuentos.valor].sort((a, b) => a.orden - b.orden)) {
      if (descuento.alcance === null) {
        bloquear('descuento_alcance_desconocido', id, String(descuento.orden));
        importe = null;
        continue;
      }
      if (descuento.alcance === 'global') {
        bloquear('descuento_alcance_inconsistente', id, String(descuento.orden));
        importe = null;
        continue;
      }
      if (descuento.incluidoEnPrecio === null) {
        bloquear('descuento_inclusion_desconocida', id, String(descuento.orden));
        importe = null;
        continue;
      }
      if (descuento.incluidoEnPrecio) {
        incluidos.push(descuento.orden);
        continue;
      }
      if (descuento.porcentaje === null && descuento.monto === null) {
        bloquear('descuento_sin_valor', id, String(descuento.orden));
        importe = null;
        continue;
      }
      const porcentaje = leer(descuento.porcentaje, FORMA_PORCENTAJE);
      const monto = leer(descuento.monto, FORMA_TOTAL);
      if (!porcentaje.ok || !monto.ok) {
        bloquear('valor_invalido', id, `descuento ${descuento.orden}`);
        importe = null;
        continue;
      }
      if (importe === null) continue;
      const antes = importe;
      if (porcentaje.valor) {
        if (cmpDecimal(porcentaje.valor, CIEN) > 0) {
          bloquear('descuento_invalido', id, String(descuento.orden));
          importe = null;
          continue;
        }
        if (monto.valor) {
          // Percent and amount are two readings of one discount: check, then apply once.
          const esperado = scaleDownPow10(mulDecimal(antes, porcentaje.valor), 2);
          if (cmpDecimal(absDecimal(subDecimal(esperado, monto.valor)), toleranciaLeida) > 0) {
            bloquear('descuento_inconsistente', id, String(descuento.orden));
            importe = null;
            continue;
          }
        }
        importe = scaleDownPow10(mulDecimal(antes, subDecimal(CIEN, porcentaje.valor)), 2);
        aplicados.push({ orden: descuento.orden, tipo: 'porcentaje', valor: toDecimalString(porcentaje.valor), importeAntes: toDecimalString(antes), importeDespues: toDecimalString(importe) });
      } else if (monto.valor) {
        const despues = subDecimal(antes, monto.valor);
        if (despues.neg) {
          bloquear('descuento_excede_importe', id, String(descuento.orden));
          importe = null;
          continue;
        }
        importe = despues;
        aplicados.push({ orden: descuento.orden, tipo: 'monto', valor: toDecimalString(monto.valor), importeAntes: toDecimalString(antes), importeDespues: toDecimalString(importe) });
      }
    }

    return {
      efectiva: linea,
      cantidad,
      factor,
      precio,
      importe,
      importeRenglon: importe,
      bruto,
      aplicados,
      incluidos,
      tasa,
      final: importe,
      globalAsignado: null,
      base: null,
      iva: null,
      costo: null,
      stock: cantidad && factor ? mulDecimal(cantidad, factor) : null,
    };
  });

  // Header discounts: only explicit, included-or-eligible ones; never a guessed distribution.
  let globalPendiente = false;
  for (const descuento of [...efectiva.descuentos.valor].sort((a, b) => a.orden - b.orden)) {
    const etiqueta = String(descuento.orden);
    if (descuento.alcance === null) {
      bloquear('descuento_alcance_desconocido', null, etiqueta);
      continue;
    }
    if (descuento.alcance === 'renglon') {
      bloquear('descuento_alcance_inconsistente', null, etiqueta);
      continue;
    }
    if (descuento.incluidoEnPrecio === null) {
      bloquear('descuento_inclusion_desconocida', null, etiqueta);
      continue;
    }
    if (descuento.incluidoEnPrecio) continue;
    if (descuento.porcentaje === null && descuento.monto === null) {
      bloquear('descuento_sin_valor', null, etiqueta);
      continue;
    }
    const politica = politicas.descuentoGlobal;
    if (!politica) {
      globalPendiente = true;
      bloquear('descuento_global_sin_politica', null, etiqueta);
      continue;
    }
    const elegibles = trabajos.filter(t => politica.lineasElegibles.includes(t.efectiva.lineaId));
    if (elegibles.some(t => t.final === null)) {
      globalPendiente = true;
      continue;
    }
    const porcentaje = leer(descuento.porcentaje, FORMA_PORCENTAJE);
    const monto = leer(descuento.monto, FORMA_TOTAL);
    if (!porcentaje.ok || !monto.ok) {
      bloquear('valor_invalido', null, `descuento global ${etiqueta}`);
      continue;
    }
    const sumaBases = elegibles.reduce<Decimal>((acc, t) => addDecimal(acc, t.final as Decimal), CERO);
    const porPorcentaje = porcentaje.valor ? scaleDownPow10(mulDecimal(sumaBases, porcentaje.valor), 2) : null;
    if (porPorcentaje && monto.valor && cmpDecimal(absDecimal(subDecimal(porPorcentaje, monto.valor)), toleranciaLeida) > 0) {
      bloquear('descuento_inconsistente', null, etiqueta);
      continue;
    }
    const total = monto.valor ?? (porPorcentaje as Decimal);
    const reparto = allocateLargestRemainder({
      total,
      scale: politica.escala,
      bases: elegibles.map(t => ({ id: t.efectiva.lineaId, base: t.final as Decimal })),
    });
    if (!reparto || elegibles.some(t => cmpDecimal(t.final as Decimal, CERO) < 0)) {
      bloquear('descuento_global_no_representable', null, etiqueta);
      continue;
    }
    for (const parte of reparto) {
      const trabajo = trabajos.find(t => t.efectiva.lineaId === parte.id) as Trabajo;
      const final = subDecimal(trabajo.final as Decimal, parte.share);
      if (final.neg) {
        bloquear('descuento_excede_importe', parte.id, etiqueta);
        trabajo.final = null;
        continue;
      }
      trabajo.final = final;
      trabajo.globalAsignado = addDecimal(trabajo.globalAsignado ?? CERO, parte.share);
    }
  }

  // VAT, net amounts, stock quantity and net unit cost per stock unit.
  for (const t of trabajos) {
    const id = t.efectiva.lineaId;
    if (t.final === null || t.tasa === null || incluyeIva === null) continue;
    if (incluyeIva && !isZeroDecimal(t.tasa)) {
      const neto = divExactDecimal(mulDecimal(t.final, CIEN), addDecimal(CIEN, t.tasa));
      if (neto === null) {
        bloquear('iva_incluido_division_inexacta', id);
        continue;
      }
      t.base = neto;
      t.iva = subDecimal(t.final, neto);
    } else if (incluyeIva) {
      t.base = t.final;
      t.iva = CERO;
    } else {
      t.base = t.final;
      t.iva = scaleDownPow10(mulDecimal(t.final, t.tasa), 2);
    }
    if (t.stock && t.base) {
      if (isZeroDecimal(t.stock)) bloquear('cantidad_cero', id);
      else {
        t.costo = divExactDecimal(t.base, t.stock);
        if (t.costo === null) bloquear('costo_unitario_division_inexacta', id);
      }
    }
  }

  // Totals only when every line is known; per-rate bases and VAT.
  const todasConocidas = trabajos.every(t => t.base !== null && t.iva !== null);
  let porTasa: GrupoTasa[] | null = null;
  let totales: TotalesCalculo | null = null;
  let sumaBase: Decimal | null = null;
  let totalCalculado: Decimal | null = null;
  const grupos = new Map<string, { tasa: Decimal; base: Decimal; iva: Decimal }>();
  if (todasConocidas && !globalPendiente) {
    for (const t of trabajos) {
      const clave = toDecimalString(t.tasa as Decimal);
      const previo = grupos.get(clave) ?? { tasa: t.tasa as Decimal, base: CERO, iva: CERO };
      grupos.set(clave, { tasa: previo.tasa, base: addDecimal(previo.base, t.base as Decimal), iva: addDecimal(previo.iva, t.iva as Decimal) });
    }
    const ordenados = [...grupos.values()].sort((a, b) => cmpDecimal(a.tasa, b.tasa));
    porTasa = ordenados.map(g => ({ tasa: toDecimalString(g.tasa), base: toDecimalString(g.base, 2), iva: toDecimalString(g.iva, 2) }));
    sumaBase = ordenados.reduce<Decimal>((acc, g) => addDecimal(acc, g.base), CERO);
    const sumaIva = ordenados.reduce<Decimal>((acc, g) => addDecimal(acc, g.iva), CERO);
    totalCalculado = addDecimal(sumaBase, sumaIva);
    totales = { base: toDecimalString(sumaBase, 2), iva: toDecimalString(sumaIva, 2), total: toDecimalString(totalCalculado, 2) };
  }

  // Printed versus calculated: shown exactly, unknown stays unknown, a mismatch blocks.
  const diferencias: Diferencia[] = [];
  const comparar = (ambito: Diferencia['ambito'], lineaId: string | null, campo: string, impresoTexto: string | null, forma: { intDigits: number; scale: number }, calculado: Decimal | null) => {
    const impreso = leer(impresoTexto, forma);
    if (!impreso.ok) {
      bloquear('valor_invalido', lineaId, campo);
      return;
    }
    if (impreso.valor === null) return;
    const diferencia = calculado ? subDecimal(impreso.valor, calculado) : null;
    diferencias.push({ ambito, lineaId, campo, impreso: toDecimalString(impreso.valor, 2), calculado: texto(calculado, 2), diferencia: texto(diferencia, 2) });
    if (diferencia && cmpDecimal(absDecimal(diferencia), toleranciaLeida) > 0) bloquear('diferencia_documental', lineaId, campo);
  };
  for (const t of trabajos) comparar('linea', t.efectiva.lineaId, 'total', t.efectiva.campos.total.valor, FORMA_TOTAL, t.importeRenglon);
  comparar('cabecera', null, 'subtotal', efectiva.campos.subtotal.valor, FORMA_TOTAL, sumaBase);
  comparar('cabecera', null, 'total', efectiva.campos.total.valor, FORMA_TOTAL, totalCalculado);
  efectiva.impuestos.valor.forEach((impuesto, index) => {
    const tasa = leer(impuesto.tasa, FORMA_PORCENTAJE);
    const clave = tasa.ok && tasa.valor ? toDecimalString(tasa.valor) : impuesto.exento ? '0' : null;
    const grupo = clave !== null && todasConocidas && !globalPendiente ? grupos.get(clave) ?? null : null;
    comparar('cabecera', null, `impuestos[${index}].base`, impuesto.base, FORMA_TOTAL, grupo ? grupo.base : null);
    comparar('cabecera', null, `impuestos[${index}].monto`, impuesto.monto, FORMA_TOTAL, grupo ? grupo.iva : null);
  });

  // Barcode intent: needs an exact, completeness-aware check before any use.
  for (const t of trabajos) {
    const linea = t.efectiva;
    if (!linea.usarCodigoFactura || linea.asociacion.tipo === 'pendiente') continue;
    const estado = input.estadosCodigoBarras?.[linea.lineaId] ?? 'no_verificable';
    if (estado !== 'unico_verificado' && estado !== 'ya_asignado_a_este_producto') bloquear('codigo_barras_no_verificado', linea.lineaId, estado);
  }

  // Test-only POS precision effect: informs, never verifies or blocks.
  let cuantizacionPos: CuantizacionPos | null = null;
  if (politicas.salidaPos) {
    const { escala, modo } = politicas.salidaPos;
    const filas = trabajos.flatMap(t => {
      if (!t.costo || !t.stock || !t.base) return [];
      const costoPos = roundDecimal(t.costo, escala, modo);
      const importePos = mulDecimal(costoPos, t.stock);
      return [{
        lineaId: t.efectiva.lineaId,
        costoDocumental: toDecimalString(t.costo, 2),
        costoPos: toDecimalString(costoPos, escala),
        importeDocumental: toDecimalString(t.base, 2),
        importePos: toDecimalString(importePos, 2),
        diferencia: toDecimalString(subDecimal(t.base, importePos), 2),
        valor: subDecimal(t.base, importePos),
      }];
    });
    cuantizacionPos = {
      escala,
      lineas: filas.map(({ valor: _valor, ...fila }) => fila),
      diferenciaTotal: toDecimalString(filas.reduce<Decimal>((acc, fila) => addDecimal(acc, fila.valor), CERO), 2),
    };
  }

  const lineas = trabajos.map((t): CalculoLinea => ({
    lineaId: t.efectiva.lineaId,
    numeroLinea: t.efectiva.numeroLinea,
    codigoProveedor: t.efectiva.campos.codigoProveedor.valor,
    descripcion: t.efectiva.campos.descripcion.valor,
    unidadDocumento: t.efectiva.campos.unidad.valor,
    cantidadDocumento: t.efectiva.campos.cantidad.valor,
    factorConversion: t.efectiva.factorConversion,
    cantidadStock: texto(t.stock),
    precioUnitario: t.efectiva.campos.precioUnitario.valor,
    importeBruto: texto(t.bruto, 2),
    descuentosAplicados: t.aplicados,
    descuentosYaIncluidos: t.incluidos,
    importeTrasDescuentos: texto(t.importeRenglon, 2),
    descuentoGlobalAsignado: texto(t.globalAsignado, 2),
    importeFinal: texto(t.final, 2),
    tasaIva: texto(t.tasa),
    base: texto(t.base, 2),
    iva: texto(t.iva, 2),
    totalConIva: t.base && t.iva ? toDecimalString(addDecimal(t.base, t.iva), 2) : null,
    costoNetoUnitarioStock: texto(t.costo, 2),
    lecturaOcr: t.efectiva.lecturaOcr,
    decisionAsociacion: t.efectiva.asociacion,
  }));

  return {
    calculo_version: CALCULO_VERSION,
    moneda,
    lineas,
    porTasa,
    totales,
    diferencias,
    cuantizacionPos,
    pos: 'no_verificado',
    bloqueos,
    sinBloqueos: bloqueos.length === 0,
  };
}

// ── Review state ────────────────────────────────────────────────────────────

export interface IdentidadRevision {
  readonly fingerprint: string;
  readonly facturaVersion: number;
  readonly documentoSha256: string | null;
}

export type EstadoRevision = 'con_bloqueos' | 'pendiente_atestacion' | 'atestacion_obsoleta' | 'validada';

/**
 * `ultima` identifies the latest saved revision (server fingerprint, base invoice version and
 * document SHA); `atestacion` is the identity the person attested, or null. Validada needs an
 * attestation of exactly that identity and a fresh calculation with zero blockers. The
 * attestation alone never approves the amounts and is not purchase authority.
 */
export function estadoRevision(input: {
  readonly calculo: CalculoRevision;
  readonly ultima: IdentidadRevision;
  readonly atestacion: IdentidadRevision | null;
}): EstadoRevision {
  const { calculo, ultima, atestacion } = input;
  if (atestacion !== null && !igualesProfundo(atestacion, ultima)) return 'atestacion_obsoleta';
  if (!calculo.sinBloqueos) return 'con_bloqueos';
  return atestacion === null ? 'pendiente_atestacion' : 'validada';
}
