// After a deploy, a PWA still running the old JS bundle references a hashed
// chunk (e.g. a dynamic import) that no longer exists and 404s. Detecting
// that failure lets the caller reload once to pick up the new bundle.

export const STALE_BUNDLE_RELOAD_KEY = 'serrucho-stale-bundle-reload';

const STALE_BUNDLE_PATTERN = /Loading module|dynamically imported module|Importing a module script failed/i;

function extractMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return '';
}

export function isStaleBundleError(error: unknown): boolean {
  return STALE_BUNDLE_PATTERN.test(extractMessage(error));
}
