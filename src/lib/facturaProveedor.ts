import type { FacturaMime } from './facturaDocumento';

/**
 * Supplier-invoice draft model. Persistence only: nothing here creates purchases,
 * touches stock or computes the negative-stock compensation (that stays in useCompra).
 * Amounts are decimal strings end to end; a blank field means "unreadable" and is
 * stored as null, never as zero.
 */

export const MAX_LINEAS = 500;

/** Manually entered amounts are always USD; no conversion and no original-currency claim. */
const MONEDA_IMPORTES = 'USD';

const CANTIDAD = { intDigits: 11, scale: 4 } as const;
const COSTO = { intDigits: 9, scale: 6 } as const;
const TOTAL = { intDigits: 11, scale: 4 } as const;

const TEXT_LIMITS = {
  proveedorNombre: 200,
  numeroDocumento: 60,
  numeroControl: 60,
  notas: 1000,
  codigoProveedor: 80,
  codigoProducto: 80,
  descripcion: 500,
  unidad: 40,
  nota: 500,
} as const;

export interface FacturaDocumento {
  path: string;
  nombre: string;
  mime: FacturaMime;
  bytes: number;
  sha256: string;
}

export interface FacturaLineaDraft {
  lineaId: string;
  codigoProveedor: string;
  codigoProducto: string;
  descripcion: string;
  cantidad: string;
  unidad: string;
  costoUnitario: string;
  total: string;
  nota: string;
}

export interface FacturaDraft {
  facturaId: string;
  /** Server version this draft was loaded from; 0 means "not saved yet". */
  version: number;
  proveedorCodigo: string;
  proveedorNombre: string;
  numeroDocumento: string;
  numeroControl: string;
  fechaDocumento: string;
  moneda: string;
  notas: string;
  documento: FacturaDocumento | null;
  lineas: FacturaLineaDraft[];
}

export interface FacturaLineaRecord {
  linea_id: string;
  orden: number;
  codigo_proveedor: string | null;
  codigo_producto: string | null;
  descripcion: string | null;
  cantidad_documento: number | string | null;
  unidad_documento: string | null;
  costo_unitario_documento: number | string | null;
  total_documento: number | string | null;
  nota: string | null;
}

export interface FacturaRecord {
  id: string;
  version: number;
  proveedor_codigo: string | null;
  proveedor_nombre: string | null;
  numero_documento: string | null;
  numero_control: string | null;
  fecha_documento: string | null;
  moneda: string | null;
  notas: string | null;
  documento_path: string | null;
  documento_nombre: string | null;
  documento_mime: FacturaMime | null;
  documento_bytes: number | null;
  documento_sha256: string | null;
  lineas: FacturaLineaRecord[];
}

export interface SavePayload {
  cabecera: Record<string, unknown>;
  lineas: Record<string, unknown>[];
}

export type BuildPayloadResult =
  | ({ ok: true } & SavePayload)
  | { ok: false; errors: Record<string, string> };

export interface PendingSave {
  key: string;
  fingerprint: string;
}

interface DecimalShape {
  intDigits: number;
  scale: number;
}

export type DecimalResult = { ok: true; value: string | null } | { ok: false; error: string };

export function createDraft(init: {
  facturaId: string;
  proveedorCodigo?: string;
  proveedorNombre?: string;
}): FacturaDraft {
  return {
    facturaId: init.facturaId,
    version: 0,
    proveedorCodigo: init.proveedorCodigo ?? '',
    proveedorNombre: init.proveedorNombre ?? '',
    numeroDocumento: '',
    numeroControl: '',
    fechaDocumento: '',
    moneda: 'USD',
    notas: '',
    documento: null,
    lineas: [],
  };
}

export function addLinea(
  draft: FacturaDraft,
  lineaId: string,
  fields: Partial<Omit<FacturaLineaDraft, 'lineaId'>>,
): FacturaDraft {
  const linea: FacturaLineaDraft = {
    lineaId,
    codigoProveedor: '',
    codigoProducto: '',
    descripcion: '',
    cantidad: '',
    unidad: '',
    costoUnitario: '',
    total: '',
    nota: '',
    ...fields,
  };
  return { ...draft, lineas: [...draft.lineas, linea] };
}

export function updateLinea(
  draft: FacturaDraft,
  lineaId: string,
  fields: Partial<Omit<FacturaLineaDraft, 'lineaId'>>,
): FacturaDraft {
  return {
    ...draft,
    lineas: draft.lineas.map(linea => (linea.lineaId === lineaId ? { ...linea, ...fields } : linea)),
  };
}

export function removeLinea(draft: FacturaDraft, lineaId: string): FacturaDraft {
  return { ...draft, lineas: draft.lineas.filter(linea => linea.lineaId !== lineaId) };
}

/** Accepts "1,5" and "1.5"; blank means unreadable (null). Rejects what the database would round or refuse. */
export function normalizeDecimal(raw: string, shape: DecimalShape): DecimalResult {
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };

  const match = /^(\d+)(?:[.,](\d+))?$/.exec(text);
  if (!match) return { ok: false, error: 'Usa solo números positivos, por ejemplo 12,50' };

  const integer = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (integer.length > shape.intDigits) {
    return { ok: false, error: `Máximo ${shape.intDigits} dígitos enteros` };
  }
  if (fraction.length > shape.scale) {
    return { ok: false, error: `Máximo ${shape.scale} decimales` };
  }
  return { ok: true, value: fraction === '' ? integer : `${integer}.${fraction}` };
}

function emptyToNull(raw: string): string | null {
  const text = raw.trim();
  return text === '' ? null : text;
}

function isRealDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function checkLength(errors: Record<string, string>, key: string, value: string | null, max: number): void {
  if (value !== null && value.length > max) errors[key] = `Máximo ${max} caracteres`;
}

function buildLinea(
  linea: FacturaLineaDraft,
  errors: Record<string, string>,
): Record<string, unknown> {
  const cantidad = normalizeDecimal(linea.cantidad, CANTIDAD);
  const costo = normalizeDecimal(linea.costoUnitario, COSTO);
  const total = normalizeDecimal(linea.total, TOTAL);
  if (!cantidad.ok) errors[`${linea.lineaId}:cantidad`] = cantidad.error;
  if (!costo.ok) errors[`${linea.lineaId}:costoUnitario`] = costo.error;
  if (!total.ok) errors[`${linea.lineaId}:total`] = total.error;

  const texto = {
    codigoProveedor: emptyToNull(linea.codigoProveedor),
    codigoProducto: emptyToNull(linea.codigoProducto),
    descripcion: emptyToNull(linea.descripcion),
    unidad: emptyToNull(linea.unidad),
    nota: emptyToNull(linea.nota),
  };
  checkLength(errors, `${linea.lineaId}:codigoProveedor`, texto.codigoProveedor, TEXT_LIMITS.codigoProveedor);
  checkLength(errors, `${linea.lineaId}:codigoProducto`, texto.codigoProducto, TEXT_LIMITS.codigoProducto);
  checkLength(errors, `${linea.lineaId}:descripcion`, texto.descripcion, TEXT_LIMITS.descripcion);
  checkLength(errors, `${linea.lineaId}:unidad`, texto.unidad, TEXT_LIMITS.unidad);
  checkLength(errors, `${linea.lineaId}:nota`, texto.nota, TEXT_LIMITS.nota);

  return {
    linea_id: linea.lineaId,
    codigo_proveedor: texto.codigoProveedor,
    codigo_producto: texto.codigoProducto,
    descripcion: texto.descripcion,
    cantidad_documento: cantidad.ok ? cantidad.value : null,
    unidad_documento: texto.unidad,
    costo_unitario_documento: costo.ok ? costo.value : null,
    total_documento: total.ok ? total.value : null,
    nota: texto.nota,
  };
}

export function buildSavePayload(draft: FacturaDraft): BuildPayloadResult {
  const errors: Record<string, string> = {};

  const fecha = emptyToNull(draft.fechaDocumento);
  if (fecha !== null && !isRealDate(fecha)) {
    errors.fechaDocumento = 'Usa el formato AAAA-MM-DD';
  }

  const moneda = emptyToNull(draft.moneda)?.toUpperCase() ?? MONEDA_IMPORTES;
  if (moneda !== MONEDA_IMPORTES) {
    errors.moneda = 'Los importes se registran en USD';
  }

  const proveedorNombre = emptyToNull(draft.proveedorNombre);
  const numeroDocumento = emptyToNull(draft.numeroDocumento);
  const numeroControl = emptyToNull(draft.numeroControl);
  const notas = emptyToNull(draft.notas);
  checkLength(errors, 'proveedorNombre', proveedorNombre, TEXT_LIMITS.proveedorNombre);
  checkLength(errors, 'numeroDocumento', numeroDocumento, TEXT_LIMITS.numeroDocumento);
  checkLength(errors, 'numeroControl', numeroControl, TEXT_LIMITS.numeroControl);
  checkLength(errors, 'notas', notas, TEXT_LIMITS.notas);

  if (draft.lineas.length > MAX_LINEAS) {
    errors.lineas = `Máximo ${MAX_LINEAS} renglones por factura`;
  }

  const lineas = draft.lineas.map(linea => buildLinea(linea, errors));
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    cabecera: {
      proveedor_codigo: emptyToNull(draft.proveedorCodigo),
      proveedor_nombre: proveedorNombre,
      numero_documento: numeroDocumento,
      numero_control: numeroControl,
      fecha_documento: fecha,
      moneda,
      notas,
      documento: draft.documento,
    },
    lineas,
  };
}

export function payloadFingerprint(payload: SavePayload): string {
  return JSON.stringify({ cabecera: payload.cabecera, lineas: payload.lineas });
}

/**
 * A retry of the same content reuses its idempotency key, so a save whose response
 * was lost cannot be applied twice; changed content gets a fresh key.
 */
export function resolveSaveKey(
  pending: PendingSave | null,
  payload: SavePayload,
  newKey: () => string,
): PendingSave {
  const fingerprint = payloadFingerprint(payload);
  if (pending !== null && pending.fingerprint === fingerprint) return pending;
  return { key: newKey(), fingerprint };
}

function decimalToText(value: number | string | null): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function documentoFromRecord(record: FacturaRecord): FacturaDocumento | null {
  if (
    record.documento_path === null ||
    record.documento_nombre === null ||
    record.documento_mime === null ||
    record.documento_bytes === null ||
    record.documento_sha256 === null
  ) {
    return null;
  }
  return {
    path: record.documento_path,
    nombre: record.documento_nombre,
    mime: record.documento_mime,
    bytes: record.documento_bytes,
    sha256: record.documento_sha256,
  };
}

export function draftFromRecord(record: FacturaRecord): FacturaDraft {
  const lineas = [...record.lineas]
    .sort((a, b) => a.orden - b.orden)
    .map<FacturaLineaDraft>(linea => ({
      lineaId: linea.linea_id,
      codigoProveedor: linea.codigo_proveedor ?? '',
      codigoProducto: linea.codigo_producto ?? '',
      descripcion: linea.descripcion ?? '',
      cantidad: decimalToText(linea.cantidad_documento),
      unidad: linea.unidad_documento ?? '',
      costoUnitario: decimalToText(linea.costo_unitario_documento),
      total: decimalToText(linea.total_documento),
      nota: linea.nota ?? '',
    }));

  return {
    facturaId: record.id,
    version: record.version,
    proveedorCodigo: record.proveedor_codigo ?? '',
    proveedorNombre: record.proveedor_nombre ?? '',
    numeroDocumento: record.numero_documento ?? '',
    numeroControl: record.numero_control ?? '',
    fechaDocumento: record.fecha_documento ?? '',
    moneda: record.moneda ?? '',
    notas: record.notas ?? '',
    documento: documentoFromRecord(record),
    lineas,
  };
}
