jest.mock('react-native', () => ({
  Platform: {
    OS: 'web',
  },
}));

jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: {
    Base64: 'base64',
  },
}));

jest.mock('base64-arraybuffer', () => ({
  decode: jest.fn(),
}));

jest.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(),
    },
  },
}));

import { uploadPdfAndGetUrl, sanitizeStorageFileName } from './pdfStorage';
import { supabase } from './supabase';

global.fetch = jest.fn();

describe('pdfStorage Security & Path Traversal Sanitization', () => {
  const mockFrom = supabase.storage.from as jest.Mock;
  const mockUpload = jest.fn();
  const mockCreateSignedUrl = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({
      upload: mockUpload,
      createSignedUrl: mockCreateSignedUrl,
    });
    mockUpload.mockResolvedValue({ error: null });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://example.com/signed/test.pdf' },
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      blob: jest.fn().mockResolvedValue(new Blob(['dummy pdf'])),
    });
  });

  describe('sanitizeStorageFileName', () => {
    it('strips directory traversal dots and slashes', () => {
      expect(sanitizeStorageFileName('../../etc/passwd.pdf')).toBe('etc_passwd.pdf');
      expect(sanitizeStorageFileName('..\\..\\windows\\system32.pdf')).toBe('windows_system32.pdf');
      expect(sanitizeStorageFileName('/absolute/path/file.pdf')).toBe('absolute_path_file.pdf');
    });

    it('replaces dangerous and control characters with safe underscores', () => {
      expect(sanitizeStorageFileName('factura#1<test>?.pdf')).toBe('factura_1_test__.pdf');
      expect(sanitizeStorageFileName('Presupuesto No 123.pdf')).toBe('Presupuesto_No_123.pdf');
    });

    it('falls back to a default filename if empty or entirely sanitized away', () => {
      expect(sanitizeStorageFileName('')).toBe('document.pdf');
      expect(sanitizeStorageFileName('../../..')).toBe('document.pdf');
    });
  });

  describe('uploadPdfAndGetUrl defense-in-depth', () => {
    it('uploads with sanitized filename preventing path traversal in storage bucket', async () => {
      await uploadPdfAndGetUrl('blob:http://localhost/test', '../../escape_attempt.pdf');
      expect(mockUpload).toHaveBeenCalledWith(
        'escape_attempt.pdf',
        expect.anything(),
        expect.objectContaining({ contentType: 'application/pdf' })
      );
    });
  });
});
