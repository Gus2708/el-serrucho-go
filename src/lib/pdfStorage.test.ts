jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
  },
}));

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { uploadPdfAndGetUrl } from './pdfStorage';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(),
    },
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

global.fetch = jest.fn();

describe('uploadPdfAndGetUrl', () => {
  const mockFrom = supabase.storage.from as jest.Mock;
  const mockReadAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;
  const mockDecode = decode as jest.Mock;
  let originalPlatformOS: string;

  beforeAll(() => {
    originalPlatformOS = Platform.OS;
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['pdf'])),
    });
    mockReadAsStringAsync.mockResolvedValue('base64pdf');
    mockDecode.mockReturnValue(new ArrayBuffer(8));
  });

  describe('on Web platform', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    });

    it('returns signed URL on success', async () => {
      mockFrom.mockReturnValue({
        upload:          jest.fn().mockResolvedValue({ error: null }),
        createSignedUrl: jest.fn().mockResolvedValue({
          data: { signedUrl: 'https://storage.example.com/file.pdf' },
        }),
      });
      const url = await uploadPdfAndGetUrl('file:///tmp/test.pdf', 'orden-1.pdf');
      expect(url).toBe('https://storage.example.com/file.pdf');
      expect(global.fetch).toHaveBeenCalledWith('file:///tmp/test.pdf');
      expect(mockReadAsStringAsync).not.toHaveBeenCalled();
    });
  });

  describe('on Native platform (Android/iOS)', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    });

    it('returns signed URL on success', async () => {
      mockFrom.mockReturnValue({
        upload:          jest.fn().mockResolvedValue({ error: null }),
        createSignedUrl: jest.fn().mockResolvedValue({
          data: { signedUrl: 'https://storage.example.com/file.pdf' },
        }),
      });
      const url = await uploadPdfAndGetUrl('file:///tmp/test.pdf', 'orden-1.pdf');
      expect(url).toBe('https://storage.example.com/file.pdf');
      expect(mockReadAsStringAsync).toHaveBeenCalledWith('file:///tmp/test.pdf', {
        encoding: 'base64',
      });
      expect(mockDecode).toHaveBeenCalledWith('base64pdf');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws when upload fails', async () => {
      mockFrom.mockReturnValue({
        upload: jest.fn().mockResolvedValue({ error: { message: 'Bucket full' } }),
      });
      await expect(
        uploadPdfAndGetUrl('file:///tmp/test.pdf', 'orden-1.pdf'),
      ).rejects.toThrow('Bucket full');
    });

    it('throws when signed URL is null', async () => {
      mockFrom.mockReturnValue({
        upload:          jest.fn().mockResolvedValue({ error: null }),
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: null } }),
      });
      await expect(
        uploadPdfAndGetUrl('file:///tmp/test.pdf', 'orden-1.pdf'),
      ).rejects.toThrow('signed URL');
    });
  });
});

