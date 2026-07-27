import { isTransientNetworkError, withRetry, withSupabaseRetry } from './retry';

describe('isTransientNetworkError', () => {
  it('matches Chromium "Failed to fetch"', () => {
    expect(isTransientNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('matches WebKit/Safari "Load failed"', () => {
    expect(isTransientNetworkError(new TypeError('Load failed'))).toBe(true);
  });

  it('matches supabase-js AuthRetryableFetchError by name', () => {
    expect(isTransientNetworkError({ name: 'AuthRetryableFetchError', message: '' })).toBe(true);
  });

  it('matches React Native "Network request failed"', () => {
    expect(isTransientNetworkError({ message: 'Network request failed' })).toBe(true);
  });

  it('ignores real Postgres/RLS errors', () => {
    expect(isTransientNetworkError({ code: '42501', message: 'permission denied' })).toBe(false);
  });

  it('ignores null/undefined', () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
  });
});

describe('withRetry', () => {
  const fast = { delayMs: 0 };

  it('returns the first successful result without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, fast)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(fn, fast)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error', async () => {
    const err = { code: '23505', message: 'duplicate key' };
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetry(fn, fast)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries and throws the last error', async () => {
    const err = new TypeError('Failed to fetch');
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { retries: 2, delayMs: 0 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('withSupabaseRetry', () => {
  const fast = { delayMs: 0 };

  it('retries when the resolved error is transient', async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
      .mockResolvedValueOnce({ data: { id: 7 }, error: null });
    const result = await withSupabaseRetry(fn, fast);
    expect(result).toEqual({ data: { id: 7 }, error: null });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns a non-transient error result without retrying', async () => {
    const result = { data: null, error: { code: '42501', message: 'permission denied' } };
    const fn = jest.fn().mockResolvedValue(result);
    await expect(withSupabaseRetry(fn, fast)).resolves.toBe(result);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
