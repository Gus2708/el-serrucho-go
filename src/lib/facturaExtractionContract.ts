import { MAX_LINEAS, normalizeDecimal } from './facturaProveedor.ts';

export const EXTRACTION_CONTRACT_VERSION = 1;

const DECIMAL_SHAPES = {
  cantidad: { intDigits: 11, scale: 4 },
  precio: { intDigits: 9, scale: 6 },
  total: { intDigits: 11, scale: 4 },
  porcentaje: { intDigits: 5, scale: 4 },
} as const;

const TEXT_BOUNDS = {
  proveedorNombre: 200,
  proveedorRif: 50,
  numeroDocumento: 60,
  numeroControl: 60,
  fechaEmision: 50,
  moneda: 20,
  tasaCambio: 30,
  subtotal: 30,
  total: 30,
  codigoProveedor: 80,
  descripcion: 500,
  unidad: 40,
  cantidad: 30,
  precioUnitario: 30,
  tasaIva: 20,
  advertencia: 500,
  campoDudoso: 100,
  decimalString: 30,
} as const;

const COLLECTION_BOUNDS = {
  lineas: MAX_LINEAS,
  descuentos: 20,
  impuestos: 20,
  paginasProcesadas: 1000,
  advertencias: 50,
  campoDudoso: 50,
} as const;

const FORBIDDEN_AUTHORITY_KEYS: readonly string[] = [
  'compraId',
  'compra_id',
  'compra',
  'compras',
  'aprobado',
  'aprobada',
  'approved',
  'approval',
  'estadoAprobacion',
  'productoId',
  'producto_id',
  'codigoProducto',
  'codigo_producto',
  'skuMatch',
  'sku_match',
  'stockAjuste',
  'stock_ajuste',
  'compensacionNegativo',
  'compensacion_negativo',
  'inventario',
  'stock',
  'emitir',
  'emitida',
];

const ALLOWED_ROOT_KEYS: readonly string[] = ['version', 'cabecera', 'lineas', 'metadatos'];

const ALLOWED_CABECERA_KEYS: readonly string[] = [
  'proveedorNombre',
  'proveedorRif',
  'numeroDocumento',
  'numeroControl',
  'fechaEmision',
  'moneda',
  'tasaCambio',
  'subtotal',
  'descuentos',
  'impuestos',
  'total',
];

const ALLOWED_LINEA_KEYS: readonly string[] = [
  'numeroLinea',
  'pagina',
  'codigoProveedor',
  'descripcion',
  'cantidad',
  'unidad',
  'precioUnitario',
  'descuentos',
  'tasaIva',
  'total',
  'incertidumbre',
];

const ALLOWED_DESCUENTO_KEYS: readonly string[] = [
  'orden',
  'porcentaje',
  'monto',
  'alcance',
  'incluidoEnPrecio',
];

const ALLOWED_IMPUESTO_KEYS: readonly string[] = ['tasa', 'base', 'monto', 'exento'];

const ALLOWED_INCERTIDUMBRE_KEYS: readonly string[] = [
  'confianzaLectura',
  'advertencias',
  'campoDudoso',
];

const ALLOWED_METADATOS_KEYS: readonly string[] = [
  'totalPaginas',
  'paginasProcesadas',
  'documentoCompleto',
  'advertencias',
  'confianzaGlobal',
];

export type DescuentoAlcance = 'renglon' | 'global';

export interface ExtraidoDescuento {
  readonly orden: number;
  readonly porcentaje: string | null;
  readonly monto: string | null;
  readonly alcance: DescuentoAlcance | null;
  readonly incluidoEnPrecio: boolean | null;
}

export interface ExtraidoImpuesto {
  readonly tasa: string | null;
  readonly base: string | null;
  readonly monto: string | null;
  readonly exento: boolean | null;
}

export interface ExtraidaLineaIncertidumbre {
  readonly confianzaLectura: number | null;
  readonly advertencias: readonly string[];
  readonly campoDudoso: readonly string[];
}

export interface ExtraidaLinea {
  readonly numeroLinea: number;
  readonly pagina: number | null;
  readonly codigoProveedor: string | null;
  readonly descripcion: string | null;
  readonly cantidad: string | null;
  readonly unidad: string | null;
  readonly precioUnitario: string | null;
  readonly descuentos: readonly ExtraidoDescuento[];
  readonly tasaIva: string | null;
  readonly total: string | null;
  readonly incertidumbre: ExtraidaLineaIncertidumbre | null;
}

export interface ExtraidaCabecera {
  readonly proveedorNombre: string | null;
  readonly proveedorRif: string | null;
  readonly numeroDocumento: string | null;
  readonly numeroControl: string | null;
  readonly fechaEmision: string | null;
  readonly moneda: string | null;
  readonly tasaCambio: string | null;
  readonly subtotal: string | null;
  readonly descuentos: readonly ExtraidoDescuento[];
  readonly impuestos: readonly ExtraidoImpuesto[];
  readonly total: string | null;
}

export interface ExtraidaMetadatos {
  readonly totalPaginas: number | null;
  readonly paginasProcesadas: readonly number[];
  readonly documentoCompleto: boolean | null;
  readonly advertencias: readonly string[];
  readonly confianzaGlobal: number | null;
}

export interface FacturaExtraccionPayload {
  readonly version: typeof EXTRACTION_CONTRACT_VERSION;
  readonly cabecera: ExtraidaCabecera;
  readonly lineas: readonly ExtraidaLinea[];
  readonly metadatos: ExtraidaMetadatos;
}

export type ExtractionErrorCode =
  | 'invalid_payload'
  | 'unsupported_version'
  | 'forbidden_authority_field'
  | 'unexpected_field'
  | 'max_lines_exceeded'
  | 'invalid_field_type'
  | 'invalid_field_value'
  | 'invalid_decimal_format'
  | 'inconsistent_document_completeness'
  | 'text_length_exceeded';

export interface ExtractionParseError {
  readonly code: ExtractionErrorCode;
  readonly message: string;
  readonly path?: string;
}

export type ParseExtractionResult =
  | { readonly ok: true; readonly data: FacturaExtraccionPayload }
  | { readonly ok: false; readonly error: ExtractionParseError };

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isPositiveSafeInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 1;
}

function checkObjectKeys(
  obj: Record<string, unknown>,
  allowedKeys: readonly string[],
  context: string,
): ExtractionParseError | null {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_AUTHORITY_KEYS.includes(key)) {
      return {
        code: 'forbidden_authority_field',
        message: `Campo no autorizado en extracción: '${key}' no puede otorgar autoridad fiscal, de compra ni de catálogo.`,
        path: `${context}.${key}`,
      };
    }
    if (!allowedKeys.includes(key)) {
      return {
        code: 'unexpected_field',
        message: `Campo no reconocido en ${context}: '${key}'`,
        path: `${context}.${key}`,
      };
    }
  }
  return null;
}

function validateConfidence(
  val: unknown,
  field: string,
): { error: ExtractionParseError | null; value: number | null } {
  if (val === null || val === undefined) {
    return { error: null, value: null };
  }
  if (typeof val !== 'number') {
    return {
      error: {
        code: 'invalid_field_type',
        message: `El campo '${field}' debe ser un número o null`,
        path: field,
      },
      value: null,
    };
  }
  if (!Number.isFinite(val) || val < 0 || val > 1) {
    return {
      error: {
        code: 'invalid_field_value',
        message: `El campo '${field}' debe ser un número finito entre 0 y 1`,
        path: field,
      },
      value: null,
    };
  }
  return { error: null, value: val };
}

function validateOptionalString(
  val: unknown,
  max: number,
  field: string,
): { error: ExtractionParseError | null; value: string | null } {
  if (val === null || val === undefined) {
    return { error: null, value: null };
  }
  if (typeof val !== 'string') {
    return {
      error: {
        code: 'invalid_field_type',
        message: `El campo '${field}' debe ser una cadena de texto o null`,
        path: field,
      },
      value: null,
    };
  }
  if (val.length > max) {
    return {
      error: {
        code: 'text_length_exceeded',
        message: `El campo '${field}' excede el límite de caracteres (${max})`,
        path: field,
      },
      value: null,
    };
  }
  return { error: null, value: val };
}

function validateDecimalField(
  val: unknown,
  shape: { intDigits: number; scale: number },
  field: string,
): { error: ExtractionParseError | null; text: string | null } {
  if (val === null || val === undefined) {
    return { error: null, text: null };
  }
  if (typeof val === 'number') {
    return {
      error: {
        code: 'invalid_field_type',
        message: `El campo '${field}' debe proporcionarse como texto decimal exacto, no numérico`,
        path: field,
      },
      text: null,
    };
  }
  if (typeof val !== 'string') {
    return {
      error: {
        code: 'invalid_field_type',
        message: `El campo '${field}' debe ser una cadena de texto`,
        path: field,
      },
      text: null,
    };
  }
  if (val.length > TEXT_BOUNDS.decimalString) {
    return {
      error: {
        code: 'text_length_exceeded',
        message: `El campo '${field}' excede el límite de caracteres (${TEXT_BOUNDS.decimalString})`,
        path: field,
      },
      text: null,
    };
  }
  const check = normalizeDecimal(val, shape);
  if (!check.ok) {
    return {
      error: {
        code: 'invalid_decimal_format',
        message: `Formato decimal inválido en '${field}': ${val}`,
        path: field,
      },
      text: null,
    };
  }
  return { error: null, text: val };
}

function parseDescuentos(
  rawList: unknown,
  context: string,
  defaultAlcance: DescuentoAlcance,
): {
  error: ExtractionParseError | null;
  descuentos: ExtraidoDescuento[];
} {
  if (rawList === null || rawList === undefined) {
    return { error: null, descuentos: [] };
  }
  if (!Array.isArray(rawList)) {
    return {
      error: {
        code: 'invalid_field_type',
        message: `El campo descuentos en ${context} debe ser un arreglo`,
        path: `${context}.descuentos`,
      },
      descuentos: [],
    };
  }
  if (rawList.length > COLLECTION_BOUNDS.descuentos) {
    return {
      error: {
        code: 'invalid_field_value',
        message: `Demasiados descuentos en ${context} (máximo ${COLLECTION_BOUNDS.descuentos})`,
        path: `${context}.descuentos`,
      },
      descuentos: [],
    };
  }

  const descuentos: ExtraidoDescuento[] = [];
  for (let index = 0; index < rawList.length; index++) {
    const item = rawList[index];
    if (!isObject(item)) {
      return {
        error: {
          code: 'invalid_field_type',
          message: `El descuento en ${context}[${index}] debe ser un objeto`,
          path: `${context}[${index}]`,
        },
        descuentos: [],
      };
    }

    const keyErr = checkObjectKeys(item, ALLOWED_DESCUENTO_KEYS, `${context}[${index}]`);
    if (keyErr) return { error: keyErr, descuentos: [] };

    let orden = index + 1;
    if (item.orden !== undefined && item.orden !== null) {
      if (!isPositiveSafeInteger(item.orden)) {
        return {
          error: {
            code: 'invalid_field_value',
            message: `El campo orden en ${context}[${index}] debe ser un entero positivo`,
            path: `${context}[${index}].orden`,
          },
          descuentos: [],
        };
      }
      orden = item.orden;
    }

    const porcCheck = validateDecimalField(
      item.porcentaje,
      DECIMAL_SHAPES.porcentaje,
      `${context}[${index}].porcentaje`,
    );
    if (porcCheck.error) return { error: porcCheck.error, descuentos: [] };

    const montoCheck = validateDecimalField(
      item.monto,
      DECIMAL_SHAPES.total,
      `${context}[${index}].monto`,
    );
    if (montoCheck.error) return { error: montoCheck.error, descuentos: [] };

    let alcance: DescuentoAlcance | null = defaultAlcance;
    if (item.alcance !== undefined && item.alcance !== null) {
      if (item.alcance === 'renglon' || item.alcance === 'global') {
        alcance = item.alcance;
      } else {
        return {
          error: {
            code: 'invalid_field_value',
            message: `El campo alcance en ${context}[${index}] debe ser 'renglon', 'global' o null`,
            path: `${context}[${index}].alcance`,
          },
          descuentos: [],
        };
      }
    }

    let incluidoEnPrecio: boolean | null = null;
    if (item.incluidoEnPrecio !== undefined && item.incluidoEnPrecio !== null) {
      if (typeof item.incluidoEnPrecio === 'boolean') {
        incluidoEnPrecio = item.incluidoEnPrecio;
      } else {
        return {
          error: {
            code: 'invalid_field_type',
            message: `El campo incluidoEnPrecio en ${context}[${index}] debe ser booleano o null`,
            path: `${context}[${index}].incluidoEnPrecio`,
          },
          descuentos: [],
        };
      }
    }

    descuentos.push({
      orden,
      porcentaje: porcCheck.text,
      monto: montoCheck.text,
      alcance,
      incluidoEnPrecio,
    });
  }
  return { error: null, descuentos };
}

function parseImpuestos(rawList: unknown): {
  error: ExtractionParseError | null;
  impuestos: ExtraidoImpuesto[];
} {
  if (rawList === null || rawList === undefined) {
    return { error: null, impuestos: [] };
  }
  if (!Array.isArray(rawList)) {
    return {
      error: {
        code: 'invalid_field_type',
        message: 'El campo impuestos en cabecera debe ser un arreglo',
        path: 'cabecera.impuestos',
      },
      impuestos: [],
    };
  }
  if (rawList.length > COLLECTION_BOUNDS.impuestos) {
    return {
      error: {
        code: 'invalid_field_value',
        message: `Demasiados impuestos en cabecera (máximo ${COLLECTION_BOUNDS.impuestos})`,
        path: 'cabecera.impuestos',
      },
      impuestos: [],
    };
  }

  const impuestos: ExtraidoImpuesto[] = [];
  for (let index = 0; index < rawList.length; index++) {
    const item = rawList[index];
    if (!isObject(item)) {
      return {
        error: {
          code: 'invalid_field_type',
          message: `El impuesto en cabecera.impuestos[${index}] debe ser un objeto`,
          path: `cabecera.impuestos[${index}]`,
        },
        impuestos: [],
      };
    }

    const keyErr = checkObjectKeys(item, ALLOWED_IMPUESTO_KEYS, `cabecera.impuestos[${index}]`);
    if (keyErr) return { error: keyErr, impuestos: [] };

    const tasaCheck = validateDecimalField(
      item.tasa,
      DECIMAL_SHAPES.porcentaje,
      `cabecera.impuestos[${index}].tasa`,
    );
    if (tasaCheck.error) return { error: tasaCheck.error, impuestos: [] };

    const baseCheck = validateDecimalField(
      item.base,
      DECIMAL_SHAPES.total,
      `cabecera.impuestos[${index}].base`,
    );
    if (baseCheck.error) return { error: baseCheck.error, impuestos: [] };

    const montoCheck = validateDecimalField(
      item.monto,
      DECIMAL_SHAPES.total,
      `cabecera.impuestos[${index}].monto`,
    );
    if (montoCheck.error) return { error: montoCheck.error, impuestos: [] };

    let exento: boolean | null = null;
    if (item.exento !== undefined && item.exento !== null) {
      if (typeof item.exento === 'boolean') {
        exento = item.exento;
      } else {
        return {
          error: {
            code: 'invalid_field_type',
            message: `El campo exento en cabecera.impuestos[${index}] debe ser booleano o null`,
            path: `cabecera.impuestos[${index}].exento`,
          },
          impuestos: [],
        };
      }
    }

    impuestos.push({
      tasa: tasaCheck.text,
      base: baseCheck.text,
      monto: montoCheck.text,
      exento,
    });
  }
  return { error: null, impuestos };
}

function parseStringList(
  rawList: unknown,
  maxItems: number,
  maxCharsPerItem: number,
  field: string,
): { error: ExtractionParseError | null; list: readonly string[] } {
  if (rawList === null || rawList === undefined) {
    return { error: null, list: [] };
  }
  if (!Array.isArray(rawList)) {
    return {
      error: {
        code: 'invalid_field_type',
        message: `El campo '${field}' debe ser un arreglo de cadenas`,
        path: field,
      },
      list: [],
    };
  }
  if (rawList.length > maxItems) {
    return {
      error: {
        code: 'invalid_field_value',
        message: `El campo '${field}' supera el límite de ${maxItems} elementos`,
        path: field,
      },
      list: [],
    };
  }

  const list: string[] = [];
  for (let index = 0; index < rawList.length; index++) {
    const item = rawList[index];
    if (typeof item !== 'string') {
      return {
        error: {
          code: 'invalid_field_type',
          message: `El elemento en ${field}[${index}] debe ser una cadena de texto`,
          path: `${field}[${index}]`,
        },
        list: [],
      };
    }
    if (item.length > maxCharsPerItem) {
      return {
        error: {
          code: 'text_length_exceeded',
          message: `El elemento en ${field}[${index}] excede el límite de caracteres (${maxCharsPerItem})`,
          path: `${field}[${index}]`,
        },
        list: [],
      };
    }
    list.push(item);
  }
  return { error: null, list };
}

function parsePaginasProcesadas(
  rawList: unknown,
): { error: ExtractionParseError | null; list: readonly number[] } {
  if (rawList === null || rawList === undefined) {
    return { error: null, list: [] };
  }
  if (!Array.isArray(rawList)) {
    return {
      error: {
        code: 'invalid_field_type',
        message: 'El campo paginasProcesadas en metadatos debe ser un arreglo',
        path: 'metadatos.paginasProcesadas',
      },
      list: [],
    };
  }
  if (rawList.length > COLLECTION_BOUNDS.paginasProcesadas) {
    return {
      error: {
        code: 'invalid_field_value',
        message: `Demasiadas páginas procesadas (máximo ${COLLECTION_BOUNDS.paginasProcesadas})`,
        path: 'metadatos.paginasProcesadas',
      },
      list: [],
    };
  }

  const list: number[] = [];
  for (let index = 0; index < rawList.length; index++) {
    const item = rawList[index];
    if (typeof item !== 'number') {
      return {
        error: {
          code: 'invalid_field_type',
          message: `El elemento en metadatos.paginasProcesadas[${index}] debe ser un número entero positivo`,
          path: `metadatos.paginasProcesadas[${index}]`,
        },
        list: [],
      };
    }
    if (!isPositiveSafeInteger(item)) {
      return {
        error: {
          code: 'invalid_field_value',
          message: `El número de página en metadatos.paginasProcesadas[${index}] debe ser un entero positivo (>= 1)`,
          path: `metadatos.paginasProcesadas[${index}]`,
        },
        list: [],
      };
    }
    list.push(item);
  }
  return { error: null, list };
}

export function parseFacturaExtraction(raw: unknown): ParseExtractionResult {
  if (!isObject(raw)) {
    return {
      ok: false,
      error: { code: 'invalid_payload', message: 'El payload de extracción debe ser un objeto' },
    };
  }

  const rootErr = checkObjectKeys(raw, ALLOWED_ROOT_KEYS, 'payload');
  if (rootErr) return { ok: false, error: rootErr };

  if (raw.version !== EXTRACTION_CONTRACT_VERSION) {
    return {
      ok: false,
      error: {
        code: 'unsupported_version',
        message: `Versión de contrato no soportada: ${String(raw.version)} (se espera ${EXTRACTION_CONTRACT_VERSION})`,
        path: 'version',
      },
    };
  }

  // cabecera
  if (!isObject(raw.cabecera)) {
    return {
      ok: false,
      error: {
        code: 'invalid_field_type',
        message: 'El campo "cabecera" debe ser un objeto',
        path: 'cabecera',
      },
    };
  }
  const rawCabecera = raw.cabecera;
  const cabeceraErr = checkObjectKeys(rawCabecera, ALLOWED_CABECERA_KEYS, 'cabecera');
  if (cabeceraErr) return { ok: false, error: cabeceraErr };

  const provNombreCheck = validateOptionalString(rawCabecera.proveedorNombre, TEXT_BOUNDS.proveedorNombre, 'cabecera.proveedorNombre');
  if (provNombreCheck.error) return { ok: false, error: provNombreCheck.error };

  const provRifCheck = validateOptionalString(rawCabecera.proveedorRif, TEXT_BOUNDS.proveedorRif, 'cabecera.proveedorRif');
  if (provRifCheck.error) return { ok: false, error: provRifCheck.error };

  const numDocCheck = validateOptionalString(rawCabecera.numeroDocumento, TEXT_BOUNDS.numeroDocumento, 'cabecera.numeroDocumento');
  if (numDocCheck.error) return { ok: false, error: numDocCheck.error };

  const numCtrlCheck = validateOptionalString(rawCabecera.numeroControl, TEXT_BOUNDS.numeroControl, 'cabecera.numeroControl');
  if (numCtrlCheck.error) return { ok: false, error: numCtrlCheck.error };

  const fechaCheck = validateOptionalString(rawCabecera.fechaEmision, TEXT_BOUNDS.fechaEmision, 'cabecera.fechaEmision');
  if (fechaCheck.error) return { ok: false, error: fechaCheck.error };

  const monedaCheck = validateOptionalString(rawCabecera.moneda, TEXT_BOUNDS.moneda, 'cabecera.moneda');
  if (monedaCheck.error) return { ok: false, error: monedaCheck.error };

  const tasaCambioCheck = validateDecimalField(rawCabecera.tasaCambio, DECIMAL_SHAPES.precio, 'cabecera.tasaCambio');
  if (tasaCambioCheck.error) return { ok: false, error: tasaCambioCheck.error };

  const subtotalCheck = validateDecimalField(rawCabecera.subtotal, DECIMAL_SHAPES.total, 'cabecera.subtotal');
  if (subtotalCheck.error) return { ok: false, error: subtotalCheck.error };

  const totalCheck = validateDecimalField(rawCabecera.total, DECIMAL_SHAPES.total, 'cabecera.total');
  if (totalCheck.error) return { ok: false, error: totalCheck.error };

  const descCabecera = parseDescuentos(rawCabecera.descuentos, 'cabecera', 'global');
  if (descCabecera.error) return { ok: false, error: descCabecera.error };

  const impuestosCabecera = parseImpuestos(rawCabecera.impuestos);
  if (impuestosCabecera.error) return { ok: false, error: impuestosCabecera.error };

  const cabecera: ExtraidaCabecera = {
    proveedorNombre: provNombreCheck.value,
    proveedorRif: provRifCheck.value,
    numeroDocumento: numDocCheck.value,
    numeroControl: numCtrlCheck.value,
    fechaEmision: fechaCheck.value,
    moneda: monedaCheck.value,
    tasaCambio: tasaCambioCheck.text,
    subtotal: subtotalCheck.text,
    descuentos: descCabecera.descuentos,
    impuestos: impuestosCabecera.impuestos,
    total: totalCheck.text,
  };

  // lineas
  if (!Array.isArray(raw.lineas)) {
    return {
      ok: false,
      error: { code: 'invalid_field_type', message: 'El campo "lineas" debe ser un arreglo', path: 'lineas' },
    };
  }

  if (raw.lineas.length > COLLECTION_BOUNDS.lineas) {
    return {
      ok: false,
      error: {
        code: 'max_lines_exceeded',
        message: `El número de renglones (${raw.lineas.length}) supera el máximo permitido (${COLLECTION_BOUNDS.lineas})`,
        path: 'lineas',
      },
    };
  }

  const lineas: ExtraidaLinea[] = [];
  for (let index = 0; index < raw.lineas.length; index++) {
    const rawLinea = raw.lineas[index];
    if (!isObject(rawLinea)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: `El renglón ${index + 1} debe ser un objeto`, path: `lineas[${index}]` },
      };
    }

    const lineaErr = checkObjectKeys(rawLinea, ALLOWED_LINEA_KEYS, `lineas[${index}]`);
    if (lineaErr) return { ok: false, error: lineaErr };

    // numeroLinea
    let numeroLinea = index + 1;
    if (rawLinea.numeroLinea !== undefined && rawLinea.numeroLinea !== null) {
      if (!isPositiveSafeInteger(rawLinea.numeroLinea)) {
        return {
          ok: false,
          error: {
            code: 'invalid_field_value',
            message: `El número de línea en lineas[${index}] debe ser un entero positivo`,
            path: `lineas[${index}].numeroLinea`,
          },
        };
      }
      numeroLinea = rawLinea.numeroLinea;
    }

    // pagina
    let pagina: number | null = null;
    if (rawLinea.pagina !== undefined && rawLinea.pagina !== null) {
      if (!isPositiveSafeInteger(rawLinea.pagina)) {
        return {
          ok: false,
          error: {
            code: 'invalid_field_value',
            message: `El número de página en lineas[${index}] debe ser un entero positivo o null`,
            path: `lineas[${index}].pagina`,
          },
        };
      }
      pagina = rawLinea.pagina;
    }

    // codigoProveedor: MUST be string or null, never number
    if (typeof rawLinea.codigoProveedor === 'number') {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: `El código de proveedor debe ser texto para preservar ceros a la izquierda, no numérico (línea ${index + 1})`,
          path: `lineas[${index}].codigoProveedor`,
        },
      };
    }
    const codProvCheck = validateOptionalString(rawLinea.codigoProveedor, TEXT_BOUNDS.codigoProveedor, `lineas[${index}].codigoProveedor`);
    if (codProvCheck.error) return { ok: false, error: codProvCheck.error };

    // descripcion: string or null
    const descCheck = validateOptionalString(rawLinea.descripcion, TEXT_BOUNDS.descripcion, `lineas[${index}].descripcion`);
    if (descCheck.error) return { ok: false, error: descCheck.error };

    // unidad
    const unidadCheck = validateOptionalString(rawLinea.unidad, TEXT_BOUNDS.unidad, `lineas[${index}].unidad`);
    if (unidadCheck.error) return { ok: false, error: unidadCheck.error };

    // cantidad
    const cantCheck = validateDecimalField(rawLinea.cantidad, DECIMAL_SHAPES.cantidad, `lineas[${index}].cantidad`);
    if (cantCheck.error) return { ok: false, error: cantCheck.error };

    // precioUnitario
    const precioCheck = validateDecimalField(
      rawLinea.precioUnitario,
      DECIMAL_SHAPES.precio,
      `lineas[${index}].precioUnitario`,
    );
    if (precioCheck.error) return { ok: false, error: precioCheck.error };

    // tasaIva
    const ivaCheck = validateDecimalField(rawLinea.tasaIva, DECIMAL_SHAPES.porcentaje, `lineas[${index}].tasaIva`);
    if (ivaCheck.error) return { ok: false, error: ivaCheck.error };

    // total
    const totalLineaCheck = validateDecimalField(rawLinea.total, DECIMAL_SHAPES.total, `lineas[${index}].total`);
    if (totalLineaCheck.error) return { ok: false, error: totalLineaCheck.error };

    // descuentos
    const descLinea = parseDescuentos(rawLinea.descuentos, `lineas[${index}]`, 'renglon');
    if (descLinea.error) return { ok: false, error: descLinea.error };

    // incertidumbre
    let incertidumbre: ExtraidaLineaIncertidumbre | null = null;
    if (rawLinea.incertidumbre !== undefined && rawLinea.incertidumbre !== null) {
      if (!isObject(rawLinea.incertidumbre)) {
        return {
          ok: false,
          error: {
            code: 'invalid_field_type',
            message: `incertidumbre en lineas[${index}] debe ser un objeto o null`,
            path: `lineas[${index}].incertidumbre`,
          },
        };
      }
      const incErr = checkObjectKeys(rawLinea.incertidumbre, ALLOWED_INCERTIDUMBRE_KEYS, `lineas[${index}].incertidumbre`);
      if (incErr) return { ok: false, error: incErr };

      const confCheck = validateConfidence(rawLinea.incertidumbre.confianzaLectura, `lineas[${index}].incertidumbre.confianzaLectura`);
      if (confCheck.error) return { ok: false, error: confCheck.error };

      const advCheck = parseStringList(
        rawLinea.incertidumbre.advertencias,
        COLLECTION_BOUNDS.advertencias,
        TEXT_BOUNDS.advertencia,
        `lineas[${index}].incertidumbre.advertencias`,
      );
      if (advCheck.error) return { ok: false, error: advCheck.error };

      const dudCheck = parseStringList(
        rawLinea.incertidumbre.campoDudoso,
        COLLECTION_BOUNDS.campoDudoso,
        TEXT_BOUNDS.campoDudoso,
        `lineas[${index}].incertidumbre.campoDudoso`,
      );
      if (dudCheck.error) return { ok: false, error: dudCheck.error };

      incertidumbre = {
        confianzaLectura: confCheck.value,
        advertencias: advCheck.list,
        campoDudoso: dudCheck.list,
      };
    }

    lineas.push({
      numeroLinea,
      pagina,
      codigoProveedor: codProvCheck.value,
      descripcion: descCheck.value,
      cantidad: cantCheck.text,
      unidad: unidadCheck.value,
      precioUnitario: precioCheck.text,
      descuentos: descLinea.descuentos,
      tasaIva: ivaCheck.text,
      total: totalLineaCheck.text,
      incertidumbre,
    });
  }

  // metadatos
  if (!isObject(raw.metadatos)) {
    return {
      ok: false,
      error: {
        code: 'invalid_field_type',
        message: 'El campo "metadatos" debe ser un objeto',
        path: 'metadatos',
      },
    };
  }
  const rawMeta = raw.metadatos;
  const metaErr = checkObjectKeys(rawMeta, ALLOWED_METADATOS_KEYS, 'metadatos');
  if (metaErr) return { ok: false, error: metaErr };

  let totalPaginas: number | null = null;
  if (rawMeta.totalPaginas !== undefined && rawMeta.totalPaginas !== null) {
    if (!isPositiveSafeInteger(rawMeta.totalPaginas)) {
      return {
        ok: false,
        error: {
          code: 'invalid_field_value',
          message: 'metadatos.totalPaginas debe ser un entero positivo (>= 1) o null',
          path: 'metadatos.totalPaginas',
        },
      };
    }
    totalPaginas = rawMeta.totalPaginas;
  }

  const paginasCheck = parsePaginasProcesadas(rawMeta.paginasProcesadas);
  if (paginasCheck.error) return { ok: false, error: paginasCheck.error };

  let documentoCompleto: boolean | null = null;
  if (rawMeta.documentoCompleto !== undefined && rawMeta.documentoCompleto !== null) {
    if (typeof rawMeta.documentoCompleto === 'boolean') {
      documentoCompleto = rawMeta.documentoCompleto;
    } else {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: 'metadatos.documentoCompleto debe ser booleano o null',
          path: 'metadatos.documentoCompleto',
        },
      };
    }
  }

  // Completeness consistency
  if (documentoCompleto === true) {
    if (totalPaginas === null) {
      return {
        ok: false,
        error: {
          code: 'inconsistent_document_completeness',
          message: 'El documento no puede marcarse completo cuando totalPaginas es null o desconocido',
          path: 'metadatos.documentoCompleto',
        },
      };
    }
    for (let p = 1; p <= totalPaginas; p++) {
      if (!paginasCheck.list.includes(p)) {
        return {
          ok: false,
          error: {
            code: 'inconsistent_document_completeness',
            message: `El documento no puede marcarse completo cuando faltan páginas procesadas respecto al total (falta página ${p} de ${totalPaginas})`,
            path: 'metadatos.documentoCompleto',
          },
        };
      }
    }
  }

  const advertenciasMeta = parseStringList(
    rawMeta.advertencias,
    COLLECTION_BOUNDS.advertencias,
    TEXT_BOUNDS.advertencia,
    'metadatos.advertencias',
  );
  if (advertenciasMeta.error) return { ok: false, error: advertenciasMeta.error };

  const confGlobalCheck = validateConfidence(rawMeta.confianzaGlobal, 'metadatos.confianzaGlobal');
  if (confGlobalCheck.error) return { ok: false, error: confGlobalCheck.error };

  const metadatos: ExtraidaMetadatos = {
    totalPaginas,
    paginasProcesadas: paginasCheck.list,
    documentoCompleto,
    advertencias: advertenciasMeta.list,
    confianzaGlobal: confGlobalCheck.value,
  };

  return {
    ok: true,
    data: {
      version: EXTRACTION_CONTRACT_VERSION,
      cabecera,
      lineas,
      metadatos,
    },
  };
}
