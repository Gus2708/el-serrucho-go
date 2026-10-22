import {
  MAX_DOCUMENT_BYTES,
  buildDocumentPath,
  bytesToHex,
  detectDocumentMime,
  displayNameFor,
  extensionFor,
  validateDocumentBytes,
} from './facturaDocumento';

const OWNER = '11111111-1111-4111-8111-111111111111';
const FACTURA = 'f0000000-0000-4000-8000-000000000001';
const DOC = 'd0000000-0000-4000-8000-000000000001';

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe('detectDocumentMime', () => {
  it.each([
    ['PDF', PDF, 'application/pdf'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['WebP', WEBP, 'image/webp'],
  ])('reconoce %s por su contenido', (_label, bytes, mime) => {
    expect(detectDocumentMime(bytes)).toBe(mime);
  });

  it('no confia en la extension: HTML disfrazado no es un documento valido', () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');

    expect(detectDocumentMime(html)).toBeNull();
  });

  it('rechaza RIFF que no es WebP y contenido vacio o corto', () => {
    const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

    expect(detectDocumentMime(wav)).toBeNull();
    expect(detectDocumentMime(new Uint8Array(0))).toBeNull();
    expect(detectDocumentMime(Uint8Array.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('validateDocumentBytes', () => {
  it('acepta un documento reconocido y devuelve MIME y extension', () => {
    expect(validateDocumentBytes(PNG)).toEqual({ ok: true, mime: 'image/png', extension: 'png' });
  });

  it('rechaza archivos vacios, grandes o de tipo desconocido con mensaje en espanol', () => {
    const tooBig = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    tooBig.set(PDF);

    expect(validateDocumentBytes(new Uint8Array(0))).toMatchObject({ ok: false, error: expect.stringMatching(/vac/i) });
    expect(validateDocumentBytes(tooBig)).toMatchObject({ ok: false, error: expect.stringMatching(/10 MB/) });
    expect(validateDocumentBytes(Uint8Array.from([1, 2, 3, 4, 5, 6]))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/PDF|imagen/i),
    });
  });

  it('acepta exactamente el limite', () => {
    const atLimit = new Uint8Array(MAX_DOCUMENT_BYTES);
    atLimit.set(PDF);

    expect(validateDocumentBytes(atLimit).ok).toBe(true);
  });
});

describe('buildDocumentPath', () => {
  it('sigue el contrato <propietario>/<factura>/<documento>.<ext> que exige Storage', () => {
    const path = buildDocumentPath(OWNER, FACTURA, DOC, 'image/jpeg');

    expect(path).toBe(`${OWNER}/${FACTURA}/${DOC}.jpg`);
    expect(path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/);
  });

  it('normaliza a minusculas y rechaza identificadores que no son UUID', () => {
    expect(buildDocumentPath(OWNER.toUpperCase(), FACTURA, DOC, 'application/pdf')).toBe(`${OWNER}/${FACTURA}/${DOC}.pdf`);
    expect(() => buildDocumentPath('../x', FACTURA, DOC, 'application/pdf')).toThrow();
    expect(() => buildDocumentPath(OWNER, `${FACTURA}/..`, DOC, 'application/pdf')).toThrow();
  });
});

describe('utilidades', () => {
  it('extensionFor mapea cada MIME permitido', () => {
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(extensionFor('image/webp')).toBe('webp');
  });

  it('bytesToHex produce hex en minusculas de 2 digitos por byte', () => {
    expect(bytesToHex(Uint8Array.from([0, 15, 255]))).toBe('000fff');
    expect(bytesToHex(Uint8Array.from([1, 2]).buffer)).toBe('0102');
  });

  it('displayNameFor conserva solo el nombre base, sin rutas ni caracteres de control', () => {
    expect(displayNameFor('C:\\Users\\x\\factura 01.pdf')).toBe('factura 01.pdf');
    expect(displayNameFor('../../etc/passwd')).toBe('passwd');
    expect(displayNameFor('a\u0000b\nc.pdf')).toBe('abc.pdf');
    expect(displayNameFor('')).toBe('documento');
    expect(displayNameFor('x'.repeat(300) + '.pdf').length).toBeLessThanOrEqual(120);
  });
});
