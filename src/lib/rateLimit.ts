interface RateLimitEntry {
  attempts: number;
  lockedUntil: number | null;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export interface RateLimitStatus {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSec?: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MS = 30_000; // 30 seconds

/**
 * Checks whether an action key is currently allowed or locked out.
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  _lockoutMs: number = DEFAULT_LOCKOUT_MS,
): RateLimitStatus {
  const entry = rateLimitStore.get(key);
  const now = Date.now();

  if (!entry) {
    return { allowed: true, remainingAttempts: maxAttempts };
  }

  // Check if active lockout
  if (entry.lockedUntil && entry.lockedUntil > now) {
    const retryAfterSec = Math.ceil((entry.lockedUntil - now) / 1000);
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSec,
    };
  }

  // Lockout expired, reset attempts
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    rateLimitStore.delete(key);
    return { allowed: true, remainingAttempts: maxAttempts };
  }

  const remaining = Math.max(0, maxAttempts - entry.attempts);
  return {
    allowed: remaining > 0,
    remainingAttempts: remaining,
  };
}

/**
 * Records a failed attempt for an action key. Locks out if threshold reached.
 */
export function recordFailedAttempt(
  key: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  lockoutMs: number = DEFAULT_LOCKOUT_MS,
): RateLimitStatus {
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  if (!entry || (entry.lockedUntil && entry.lockedUntil <= now)) {
    entry = { attempts: 0, lockedUntil: null };
  }

  entry.attempts += 1;

  if (entry.attempts >= maxAttempts) {
    entry.lockedUntil = now + lockoutMs;
    rateLimitStore.set(key, entry);
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSec: Math.ceil(lockoutMs / 1000),
    };
  }

  rateLimitStore.set(key, entry);
  return {
    allowed: true,
    remainingAttempts: maxAttempts - entry.attempts,
  };
}

/**
 * Resets rate limit counters upon successful action (e.g. login success).
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}
