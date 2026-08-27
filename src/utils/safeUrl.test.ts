import { isSafeHttpUrl, getSafeUrlOrNull } from './safeUrl';

describe('Safe URL Validation & Scheme Enforcement', () => {
  it('accepts valid https URLs', () => {
    expect(isSafeHttpUrl('https://example.supabase.co/storage/v1/object/sign/change-orders/test.pdf')).toBe(true);
    expect(getSafeUrlOrNull('https://el-serrucho.com/doc.pdf')).toBe('https://el-serrucho.com/doc.pdf');
  });

  it('accepts valid http URLs (for local development)', () => {
    expect(isSafeHttpUrl('http://localhost:3000/test.pdf')).toBe(true);
    expect(getSafeUrlOrNull('http://192.168.1.143:5678/webhook')).toBe('http://192.168.1.143:5678/webhook');
  });

  it('rejects javascript: and other dangerous pseudo-protocols', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('JAVASCRIPT:alert(document.cookie)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);

    expect(getSafeUrlOrNull('javascript:steal()')).toBeNull();
    expect(getSafeUrlOrNull('data:text/html;base64,...')).toBeNull();
  });

  it('rejects malformed, empty, or non-string values', () => {
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl('   ')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);

    expect(getSafeUrlOrNull('')).toBeNull();
    expect(getSafeUrlOrNull(null)).toBeNull();
    expect(getSafeUrlOrNull(undefined)).toBeNull();
  });
});
