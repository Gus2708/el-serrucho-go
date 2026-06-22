jest.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(),
    },
  },
}));

global.fetch = jest.fn();

import { uploadPdfAndGetUrl } from './pdfStorage';
import { supabase } from './supabase';

describe('uploadPdfAndGetUrl', () => {
  const mockFrom = supabase.storage.from as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['pdf'])),
    });
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
