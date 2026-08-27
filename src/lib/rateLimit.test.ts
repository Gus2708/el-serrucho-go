import {
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
} from './rateLimit';

describe('Rate Limiting & Brute Force Prevention (src/lib/rateLimit.ts)', () => {
  const TEST_KEY = 'test_login';

  beforeEach(() => {
    resetRateLimit(TEST_KEY);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows attempts when under max threshold', () => {
    const status = checkRateLimit(TEST_KEY, 5, 30_000);
    expect(status.allowed).toBe(true);
    expect(status.remainingAttempts).toBe(5);
  });

  it('decrements remaining attempts on failure and locks out on limit exceeded', () => {
    // 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      const res = recordFailedAttempt(TEST_KEY, 5, 30_000);
      expect(res.allowed).toBe(true);
      expect(res.remainingAttempts).toBe(5 - i);
    }

    // 5th failed attempt -> locks out!
    const lockedRes = recordFailedAttempt(TEST_KEY, 5, 30_000);
    expect(lockedRes.allowed).toBe(false);
    expect(lockedRes.remainingAttempts).toBe(0);
    expect(lockedRes.retryAfterSec).toBeGreaterThan(0);

    // Subsequent checks should be blocked
    const check = checkRateLimit(TEST_KEY, 5, 30_000);
    expect(check.allowed).toBe(false);
    expect(check.retryAfterSec).toBeGreaterThan(0);
  });

  it('automatically unlocks after lockout duration expires', () => {
    // Exceed limit
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(TEST_KEY, 5, 30_000);
    }
    expect(checkRateLimit(TEST_KEY, 5, 30_000).allowed).toBe(false);

    // Advance time past lockout window (30 seconds)
    jest.advanceTimersByTime(31_000);

    const statusAfterExpiry = checkRateLimit(TEST_KEY, 5, 30_000);
    expect(statusAfterExpiry.allowed).toBe(true);
    expect(statusAfterExpiry.remainingAttempts).toBe(5);
  });

  it('clears attempts when explicitly reset (e.g. on successful login)', () => {
    recordFailedAttempt(TEST_KEY, 5, 30_000);
    recordFailedAttempt(TEST_KEY, 5, 30_000);
    expect(checkRateLimit(TEST_KEY, 5, 30_000).remainingAttempts).toBe(3);

    resetRateLimit(TEST_KEY);
    expect(checkRateLimit(TEST_KEY, 5, 30_000).remainingAttempts).toBe(5);
  });
});
