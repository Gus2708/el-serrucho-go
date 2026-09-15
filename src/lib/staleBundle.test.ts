import { isStaleBundleError, STALE_BUNDLE_RELOAD_KEY } from './staleBundle';

describe('isStaleBundleError', () => {
  it('detects the Expo/Metro lazy chunk failure seen in the PWA after a deploy', () => {
    const message =
      'Loading module /_expo/static/js/web/index-50aac812fded9ed05e0e7cb2fd2c7042.js failed. ' +
      '(error: https://el-serrucho-go.vercel.app/_expo/static/js/web/index-50aac812fded9ed05e0e7cb2fd2c7042.js)';

    expect(isStaleBundleError(new Error(message))).toBe(true);
  });

  it('detects the Safari and Chrome dynamic import failures', () => {
    expect(isStaleBundleError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(
      isStaleBundleError(new TypeError('Failed to fetch dynamically imported module: https://el-serrucho-go.vercel.app/x.js')),
    ).toBe(true);
  });

  it('accepts plain strings and error-like objects', () => {
    expect(isStaleBundleError('Importing a module script failed.')).toBe(true);
    expect(isStaleBundleError({ message: 'Loading module /_expo/x.js failed.' })).toBe(true);
  });

  it('ignores camera permission and unrelated errors', () => {
    const denied = new Error('Permission denied');
    denied.name = 'NotAllowedError';

    expect(isStaleBundleError(denied)).toBe(false);
    expect(isStaleBundleError(new Error('Could not start video source'))).toBe(false);
  });

  it('ignores values without a message', () => {
    expect(isStaleBundleError(undefined)).toBe(false);
    expect(isStaleBundleError(null)).toBe(false);
    expect(isStaleBundleError(404)).toBe(false);
    expect(isStaleBundleError({ message: 404 })).toBe(false);
  });
});

describe('STALE_BUNDLE_RELOAD_KEY', () => {
  it('keeps the sessionStorage key stable so an in-flight reload guard still matches', () => {
    expect(STALE_BUNDLE_RELOAD_KEY).toBe('serrucho-stale-bundle-reload');
  });
});
