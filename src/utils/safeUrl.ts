/**
 * Validates that a given URL string safely uses HTTP or HTTPS protocol,
 * preventing execution of dangerous pseudo-protocols like javascript:, data:, or vbscript:.
 */
export function isSafeHttpUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Returns the trimmed URL if it is a safe HTTP/HTTPS URL, or null otherwise.
 */
export function getSafeUrlOrNull(url: unknown): string | null {
  if (!isSafeHttpUrl(url)) return null;
  return (url as string).trim();
}
