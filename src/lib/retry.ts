/**
 * Small retry helper for transient network failures.
 *
 * On the web/PWA the first Supabase request after the tab has been idle (or the
 * connection is momentarily cold) frequently rejects with `TypeError: Failed to
 * fetch` (Chromium) or `TypeError: Load failed` (WebKit/Safari). Retrying once
 * after a short backoff lets the connection recover, so the user no longer has
 * to tap "Emitir" a second time.
 */

export interface RetryOptions {
  /** Extra attempts after the first try. Default 2. */
  retries?: number;
  /** Base backoff in ms; grows linearly per attempt. Default 400. */
  delayMs?: number;
  /** Decide whether a given error is worth retrying. Default: transient network errors. */
  shouldRetry?: (error: unknown) => boolean;
}

const TRANSIENT_MESSAGE_FRAGMENTS = [
  'failed to fetch',
  'load failed',
  'network request failed',
  'networkerror',
  'fetch failed',
  'the network connection was lost',
];

/** True for browser/RN fetch failures that usually succeed on a quick retry. */
export function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;

  const err = error as { name?: string; message?: string };
  const name = (err.name ?? '').toLowerCase();
  const message = (err.message ?? '').toLowerCase();

  if (name === 'typeerror') return true;               // browser fetch failure
  if (name === 'authretryablefetcherror') return true; // supabase-js auth network failure

  return TRANSIENT_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Runs `fn`, retrying while `shouldRetry(error)` holds and attempts remain. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 400;
  const shouldRetry = options.shouldRetry ?? isTransientNetworkError;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < retries && shouldRetry(error);
      if (!canRetry) throw error;
      await delay(delayMs * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Retry wrapper for Supabase query builders, which resolve to `{ data, error }`
 * instead of rejecting. Only transient network errors are retried; real errors
 * (RLS, constraints, missing rows, …) are returned untouched so the caller
 * keeps handling them exactly as before.
 */
export async function withSupabaseRetry<R extends { error: unknown }>(
  fn: () => PromiseLike<R>,
  options: RetryOptions = {},
): Promise<R> {
  return withRetry(async () => {
    const result = await fn();
    if (result.error && isTransientNetworkError(result.error)) throw result.error;
    return result;
  }, options);
}
