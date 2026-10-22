/**
 * Source-document rules for supplier invoices. The content is the authority, not
 * the file name or the MIME the picker reports. These limits mirror the private
 * `facturas_proveedores` bucket and the SQL checks in the invoice migration.
 */

export type FacturaMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
export type FacturaExtension = 'pdf' | 'jpg' | 'png' | 'webp';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_DISPLAY_NAME = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const EXTENSIONS: Record<FacturaMime, FacturaExtension> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type DocumentValidation =
  | { ok: true; mime: FacturaMime; extension: FacturaExtension }
  | { ok: false; error: string };

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export function detectDocumentMime(bytes: Uint8Array): FacturaMime | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

export function extensionFor(mime: FacturaMime): FacturaExtension {
  return EXTENSIONS[mime];
}

export function validateDocumentBytes(bytes: Uint8Array): DocumentValidation {
  if (bytes.length === 0) return { ok: false, error: 'El archivo está vacío' };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, error: 'El archivo supera el límite de 10 MB' };

  const mime = detectDocumentMime(bytes);
  if (mime === null) {
    return { ok: false, error: 'Solo se aceptan PDF o imágenes (JPG, PNG, WebP)' };
  }
  return { ok: true, mime, extension: extensionFor(mime) };
}

function assertUuid(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (!UUID.test(normalized)) throw new Error(`${label} must be a UUID`);
  return normalized;
}

/** `<owner uid>/<factura id>/<document uuid>.<ext>`: the shape Storage policies and the save RPC require. */
export function buildDocumentPath(ownerId: string, facturaId: string, documentId: string, mime: FacturaMime): string {
  const owner = assertUuid(ownerId, 'ownerId');
  const factura = assertUuid(facturaId, 'facturaId');
  const document = assertUuid(documentId, 'documentId');
  return `${owner}/${factura}/${document}.${extensionFor(mime)}`;
}

export function bytesToHex(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function stripControlChars(text: string): string {
  return Array.from(text)
    .filter(char => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('');
}

/** Base name only, no control characters, bounded length. For display; never used as a storage path. */
export function displayNameFor(rawName: string): string {
  const base = rawName.split(/[\\/]/).pop() ?? '';
  const clean = stripControlChars(base).trim();
  if (clean === '') return 'documento';
  if (clean.length <= MAX_DISPLAY_NAME) return clean;

  const extension = /\.[A-Za-z0-9]{1,5}$/.exec(clean)?.[0] ?? '';
  return clean.slice(0, MAX_DISPLAY_NAME - extension.length) + extension;
}
