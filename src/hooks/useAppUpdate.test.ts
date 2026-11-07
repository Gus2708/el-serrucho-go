const mockStorage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStorage[key];
  }),
  clear: jest.fn(async () => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  }),
}));

let mockPlatformOS = 'android';
jest.mock('react-native', () => ({
  get Platform() {
    return {
      get OS() {
        return mockPlatformOS;
      },
    };
  },
  Linking: {
    openURL: jest.fn(),
  },
}));

const mockCheckForUpdate = jest.fn();
const mockDownloadAndInstallApk = jest.fn();
let mockCurrentVersion = '1.2.0';

function mockParseVersion(v: string): number[] {
  if (!v || typeof v !== 'string') return [0, 0, 0];
  const clean = v.replace(/^[vV]/, '').trim();
  const base = clean.split('-')[0].split('+')[0];
  return base
    .split('.')
    .map((part) => parseInt(part, 10))
    .map((num) => (isNaN(num) ? 0 : num));
}

function mockIsNewerVersion(remoteVersion: string, currentVersion: string): boolean {
  const remoteParts = mockParseVersion(remoteVersion);
  const currentParts = mockParseVersion(currentVersion);
  const maxLen = Math.max(remoteParts.length, currentParts.length);
  for (let i = 0; i < maxLen; i++) {
    const r = remoteParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

jest.mock('../lib/appUpdater', () => ({
  checkForUpdate: (...args: any[]) => mockCheckForUpdate(...args),
  downloadAndInstallApk: (...args: any[]) => mockDownloadAndInstallApk(...args),
  getCurrentVersion: () => mockCurrentVersion,
  parseVersion: mockParseVersion,
  isNewerVersion: mockIsNewerVersion,
}));

import {
  useAppUpdateStore,
  STORAGE_LAST_CHECK_KEY,
  STORAGE_CACHED_UPDATE_KEY,
  STORAGE_LEGACY_DISMISSED_KEY,
} from './useAppUpdate';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('useAppUpdateStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
    mockPlatformOS = 'android';
    mockCurrentVersion = '1.2.0';

    // Reset store state
    useAppUpdateStore.setState({
      isChecking: false,
      isDownloading: false,
      downloadProgress: 0,
      updateInfo: null,
      error: null,
      isModalVisible: false,
      currentVersion: '1.2.0',
      sessionDismissed: false,
    });
  });

  it('detects available update and shows modal immediately on cold start', async () => {
    mockCheckForUpdate.mockResolvedValueOnce({
      isAvailable: true,
      currentVersion: '1.2.0',
      latestVersion: '1.2.3',
      releaseName: 'v1.2.3',
      releaseNotes: 'Notas de version',
      releaseUrl: 'https://github.com/releases/tag/v1.2.3',
      apkAsset: {
        id: 1,
        name: 'el-serrucho-go-v1.2.3.apk',
        size: 50000000,
        browser_download_url: 'https://github.com/download.apk',
        content_type: 'application/vnd.android.package-archive',
      },
      publishedAt: '2026-11-07T10:00:00Z',
    });

    const info = await useAppUpdateStore.getState().checkForUpdates(false);

    expect(info).not.toBeNull();
    expect(info?.latestVersion).toBe('1.2.3');
    expect(useAppUpdateStore.getState().isModalVisible).toBe(true);
    expect(useAppUpdateStore.getState().updateInfo?.latestVersion).toBe('1.2.3');

    // Should cache update and last check timestamp in AsyncStorage
    expect(mockStorage[STORAGE_CACHED_UPDATE_KEY]).toBeDefined();
    expect(mockStorage[STORAGE_LAST_CHECK_KEY]).toBeDefined();

    // Should also purge legacy dismissed flag
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(STORAGE_LEGACY_DISMISSED_KEY);
  });

  it('restores cached update on launch without waiting for network call', async () => {
    const cachedUpdate = {
      isAvailable: true,
      currentVersion: '1.2.0',
      latestVersion: '1.2.5',
      releaseName: 'v1.2.5',
      releaseNotes: 'Fixes',
      releaseUrl: 'https://github.com/releases/tag/v1.2.5',
      apkAsset: null,
      publishedAt: '2026-11-07T10:00:00Z',
    };
    mockStorage[STORAGE_CACHED_UPDATE_KEY] = JSON.stringify(cachedUpdate);
    mockStorage[STORAGE_LAST_CHECK_KEY] = String(Date.now()); // within throttle

    const info = await useAppUpdateStore.getState().checkForUpdates(false);

    // Returned cached without re-hitting network
    expect(mockCheckForUpdate).not.toHaveBeenCalled();
    expect(info?.latestVersion).toBe('1.2.5');
    expect(useAppUpdateStore.getState().isModalVisible).toBe(true);
    expect(useAppUpdateStore.getState().updateInfo?.latestVersion).toBe('1.2.5');
  });

  it('dismisses modal for current session when user clicks "MÁS TARDE"', async () => {
    useAppUpdateStore.setState({
      updateInfo: {
        isAvailable: true,
        currentVersion: '1.2.0',
        latestVersion: '1.2.3',
        releaseName: 'v1.2.3',
        releaseNotes: '',
        releaseUrl: '',
        apkAsset: null,
        publishedAt: '',
      },
      isModalVisible: true,
    });

    await useAppUpdateStore.getState().dismissCurrentUpdate();

    expect(useAppUpdateStore.getState().isModalVisible).toBe(false);
    expect(useAppUpdateStore.getState().sessionDismissed).toBe(true);

    // In the same session, subsequent automated checks should not re-open the modal
    mockCheckForUpdate.mockResolvedValue({
      isAvailable: true,
      currentVersion: '1.2.0',
      latestVersion: '1.2.3',
      releaseName: 'v1.2.3',
      releaseNotes: '',
      releaseUrl: '',
      apkAsset: null,
      publishedAt: '',
    });

    await useAppUpdateStore.getState().checkForUpdates(false);
    expect(useAppUpdateStore.getState().isModalVisible).toBe(false);

    // But manual check (e.g. from Perfil) or openModal() will open it
    await useAppUpdateStore.getState().checkForUpdates(true);
    expect(useAppUpdateStore.getState().isModalVisible).toBe(true);
  });

  it('clears cached update and keeps modal hidden when app is up to date', async () => {
    mockCurrentVersion = '1.2.3';
    useAppUpdateStore.setState({ currentVersion: '1.2.3' });

    mockCheckForUpdate.mockResolvedValueOnce({
      isAvailable: false,
      currentVersion: '1.2.3',
      latestVersion: '1.2.3',
      releaseName: 'v1.2.3',
      releaseNotes: '',
      releaseUrl: '',
      apkAsset: null,
      publishedAt: '',
    });

    const info = await useAppUpdateStore.getState().checkForUpdates(false);

    expect(info?.isAvailable).toBe(false);
    expect(useAppUpdateStore.getState().isModalVisible).toBe(false);
    expect(mockStorage[STORAGE_CACHED_UPDATE_KEY]).toBeUndefined();
  });

  it('does nothing on non-Android platform during automatic checks', async () => {
    mockPlatformOS = 'ios';

    const info = await useAppUpdateStore.getState().checkForUpdates(false);

    expect(info).toBeNull();
    expect(mockCheckForUpdate).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().isModalVisible).toBe(false);
  });
});
