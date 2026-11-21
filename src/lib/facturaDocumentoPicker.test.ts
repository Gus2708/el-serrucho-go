import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { MAX_DOCUMENT_BYTES } from './facturaDocumento';
import { reportFacturaThrown } from './facturaTelemetry';
import { newUuid, pickFacturaDocument, readPhotoBytes, sha256Hex } from './facturaDocumentoPicker';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(),
  randomUUID: jest.fn(),
}));
jest.mock('./facturaTelemetry', () => ({ reportFacturaThrown: jest.fn() }));

const getDocumentAsync = DocumentPicker.getDocumentAsync as jest.Mock;
const readAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;
const PDF_BASE64 = 'JVBERi0x'; // "%PDF-1"
const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];

beforeEach(() => {
  jest.clearAllMocks();
  readAsStringAsync.mockResolvedValue(PDF_BASE64);
});

describe('pickFacturaDocument', () => {
  it('returns null when the user cancels and reads nothing', async () => {
    getDocumentAsync.mockResolvedValue({ canceled: true, assets: null });

    await expect(pickFacturaDocument()).resolves.toBeNull();
    expect(readAsStringAsync).not.toHaveBeenCalled();
  });

  it('reads a PDF into bytes and keeps the picked file name', async () => {
    getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/factura.pdf', name: 'factura.pdf', size: 6 }],
    });

    const result = await pickFacturaDocument();

    expect(result).toEqual({ ok: true, bytes: new Uint8Array(PDF_BYTES), nombre: 'factura.pdf' });
    expect(readAsStringAsync).toHaveBeenCalledWith('file:///cache/factura.pdf', { encoding: 'base64' });
  });

  it('rejects an oversized asset before reading it', async () => {
    getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/grande.pdf', name: 'grande.pdf', size: MAX_DOCUMENT_BYTES + 1 }],
    });

    await expect(pickFacturaDocument()).resolves.toEqual({
      ok: false,
      error: 'El archivo supera el límite de 10 MB',
    });
    expect(readAsStringAsync).not.toHaveBeenCalled();
  });

  it('reports and rethrows a picker failure', async () => {
    const failure = new Error('picker exploded');
    getDocumentAsync.mockRejectedValue(failure);

    await expect(pickFacturaDocument()).rejects.toBe(failure);
    expect(reportFacturaThrown).toHaveBeenCalledWith('pick_document', failure);
  });
});

describe('readPhotoBytes', () => {
  it('decodes the base64 content of a local photo uri', async () => {
    const bytes = await readPhotoBytes('file:///cache/photo.jpg');

    expect(bytes).toEqual(new Uint8Array(PDF_BYTES));
    expect(readAsStringAsync).toHaveBeenCalledWith('file:///cache/photo.jpg', { encoding: 'base64' });
  });

  it('propagates a read failure to the caller', async () => {
    const failure = new Error('read failed');
    readAsStringAsync.mockRejectedValue(failure);

    await expect(readPhotoBytes('file:///cache/photo.jpg')).rejects.toBe(failure);
  });
});

describe('hash and uuid adapters', () => {
  it('hashes bytes to lowercase hex through SHA-256', async () => {
    (Crypto.digest as jest.Mock).mockResolvedValue(new Uint8Array([0x00, 0xab, 0xff]).buffer);
    const input = new Uint8Array([1, 2, 3]);

    await expect(sha256Hex(input)).resolves.toBe('00abff');
    expect(Crypto.digest).toHaveBeenCalledWith('SHA-256', input);
  });

  it('delegates uuid creation to expo-crypto', () => {
    (Crypto.randomUUID as jest.Mock).mockReturnValue('c0000000-0000-4000-8000-000000000001');

    expect(newUuid()).toBe('c0000000-0000-4000-8000-000000000001');
  });
});
