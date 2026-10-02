(global as any).__DEV__ = true;

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
  },
}));

jest.mock('expo-constants', () => ({
  expoConfig: {
    version: '1.2.1',
  },
}));

jest.mock('expo', () => ({
  isRunningInExpoGo: () => false,
}));

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///mock-cache/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getContentUriAsync: jest.fn().mockResolvedValue('content://mock-content-uri'),
  createDownloadResumable: jest.fn().mockReturnValue({
    downloadAsync: jest.fn().mockResolvedValue({ uri: 'file:///mock-cache/updates/update.apk' }),
  }),
}));

jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: jest.fn().mockResolvedValue({ resultCode: 0 }),
}));

import {
  parseVersion,
  isNewerVersion,
  findApkAsset,
  formatBytes,
  checkForUpdate,
  downloadAndInstallApk,
  GitHubReleaseAsset,
} from './appUpdater';
import * as IntentLauncher from 'expo-intent-launcher';
import * as FileSystem from 'expo-file-system';

describe('appUpdater utility', () => {
  describe('parseVersion', () => {
    it('parses simple semver strings', () => {
      expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
      expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
      expect(parseVersion('V2.0.0')).toEqual([2, 0, 0]);
    });

    it('handles prerelease suffixes and build metadata', () => {
      expect(parseVersion('1.2.3-beta.1')).toEqual([1, 2, 3]);
      expect(parseVersion('v1.2.3+20261002')).toEqual([1, 2, 3]);
    });

    it('handles shorter and longer version strings', () => {
      expect(parseVersion('1.2')).toEqual([1, 2]);
      expect(parseVersion('1.2.3.4')).toEqual([1, 2, 3, 4]);
    });

    it('handles invalid or empty inputs gracefully', () => {
      expect(parseVersion('')).toEqual([0, 0, 0]);
      // @ts-expect-error Testing invalid runtime input
      expect(parseVersion(null)).toEqual([0, 0, 0]);
    });
  });

  describe('isNewerVersion', () => {
    it('correctly detects newer versions', () => {
      expect(isNewerVersion('1.2.2', '1.2.1')).toBe(true);
      expect(isNewerVersion('v1.3.0', '1.2.1')).toBe(true);
      expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
      expect(isNewerVersion('1.2.1.1', '1.2.1')).toBe(true);
      expect(isNewerVersion('v2.0.0', 'v1.9.9')).toBe(true);
    });

    it('correctly detects same or older versions', () => {
      expect(isNewerVersion('1.2.1', '1.2.1')).toBe(false);
      expect(isNewerVersion('v1.2.1', '1.2.1')).toBe(false);
      expect(isNewerVersion('1.2.0', '1.2.1')).toBe(false);
      expect(isNewerVersion('1.1.9', '1.2.1')).toBe(false);
      expect(isNewerVersion('0.9.9', '1.2.1')).toBe(false);
    });

    it('treats missing components as zero', () => {
      expect(isNewerVersion('1.2.0', '1.2')).toBe(false);
      expect(isNewerVersion('1.2.1', '1.2')).toBe(true);
      expect(isNewerVersion('1.3', '1.2.5')).toBe(true);
    });
  });

  describe('findApkAsset', () => {
    it('finds the asset ending with .apk', () => {
      const assets: GitHubReleaseAsset[] = [
        {
          id: 1,
          name: 'source.tar.gz',
          size: 1000,
          browser_download_url: 'https://github.com/source.tar.gz',
          content_type: 'application/gzip',
        },
        {
          id: 2,
          name: 'el-serrucho-go-v1.2.2.apk',
          size: 55000000,
          browser_download_url: 'https://github.com/el-serrucho.apk',
          content_type: 'application/vnd.android.package-archive',
        },
      ];

      const found = findApkAsset(assets);
      expect(found).not.toBeNull();
      expect(found?.name).toBe('el-serrucho-go-v1.2.2.apk');
    });

    it('is case-insensitive for APK extension', () => {
      const assets: GitHubReleaseAsset[] = [
        {
          id: 1,
          name: 'APP-RELEASE.APK',
          size: 5000,
          browser_download_url: 'https://example.com/app.apk',
          content_type: 'application/octet-stream',
        },
      ];

      expect(findApkAsset(assets)?.name).toBe('APP-RELEASE.APK');
    });

    it('returns null if no APK asset is present', () => {
      const assets: GitHubReleaseAsset[] = [
        {
          id: 1,
          name: 'bundle.js',
          size: 200,
          browser_download_url: 'https://example.com/bundle.js',
          content_type: 'text/javascript',
        },
      ];

      expect(findApkAsset(assets)).toBeNull();
      // @ts-expect-error Testing invalid runtime input
      expect(findApkAsset(null)).toBeNull();
    });
  });

  describe('formatBytes', () => {
    it('formats bytes into readable strings', () => {
      expect(formatBytes(0)).toBe('0 MB');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024 * 45.5)).toBe('45.5 MB');
      expect(formatBytes(1024 * 1024 * 1024 * 1.5)).toBe('1.5 GB');
    });
  });

  describe('checkForUpdate', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('handles 404 cleanly when no releases are available', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 404,
        ok: false,
      });

      const result = await checkForUpdate('https://api.github.com/test');
      expect(result.isAvailable).toBe(false);
      expect(result.apkAsset).toBeNull();
    });

    it('detects available update when a newer tag and APK exist', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          tag_name: 'v9.9.9',
          name: 'Release 9.9.9',
          body: 'Fixes and features',
          html_url: 'https://github.com/releases/v9.9.9',
          published_at: '2026-10-02T12:00:00Z',
          assets: [
            {
              id: 123,
              name: 'el-serrucho-go-v9.9.9.apk',
              size: 40000000,
              browser_download_url: 'https://download.apk',
              content_type: 'application/vnd.android.package-archive',
            },
          ],
        }),
      });

      const result = await checkForUpdate('https://api.github.com/test');
      expect(result.isAvailable).toBe(true);
      expect(result.latestVersion).toBe('9.9.9');
      expect(result.apkAsset?.name).toBe('el-serrucho-go-v9.9.9.apk');
      expect(result.releaseNotes).toBe('Fixes and features');
    });

    it('reports not available when remote version is older or same', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          tag_name: 'v1.0.0',
          name: 'Older Release',
          body: 'Old version',
          html_url: 'https://github.com/releases/v1.0.0',
          published_at: '2026-01-01T00:00:00Z',
          assets: [],
        }),
      });

      const result = await checkForUpdate('https://api.github.com/test');
      expect(result.isAvailable).toBe(false);
      expect(result.latestVersion).toBe('1.0.0');
    });
  });

  describe('downloadAndInstallApk', () => {
    it('downloads APK and launches Android Intent', async () => {
      const onProgress = jest.fn();
      await downloadAndInstallApk('https://download.apk', '9.9.9', onProgress);

      expect(FileSystem.getContentUriAsync).toHaveBeenCalledWith('file:///mock-cache/updates/update.apk');
      expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith(
        'android.intent.action.VIEW',
        {
          data: 'content://mock-content-uri',
          flags: 1,
          type: 'application/vnd.android.package-archive',
        }
      );
    });
  });
});
