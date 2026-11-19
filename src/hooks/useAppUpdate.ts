import { create } from 'zustand';
import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  checkForUpdate,
  downloadAndInstallApk,
  UpdateInfo,
  getCurrentVersion,
  isNewerVersion,
} from '../lib/appUpdater';

export const STORAGE_LAST_CHECK_KEY = 'serrucho_app_update_last_check';
export const STORAGE_CACHED_UPDATE_KEY = 'serrucho_app_update_cached';
export const STORAGE_LEGACY_DISMISSED_KEY = 'serrucho_app_update_dismissed';
export const AUTO_CHECK_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes throttle for automated network checks

interface AppUpdateState {
  isChecking: boolean;
  isDownloading: boolean;
  downloadProgress: number; // 0 to 1
  updateInfo: UpdateInfo | null;
  error: string | null;
  isModalVisible: boolean;
  currentVersion: string;
  sessionDismissed: boolean;

  checkForUpdates: (manual?: boolean) => Promise<UpdateInfo | null>;
  downloadAndInstall: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  dismissCurrentUpdate: () => Promise<void>;
  openReleasePage: () => Promise<void>;
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  isChecking: false,
  isDownloading: false,
  downloadProgress: 0,
  updateInfo: null,
  error: null,
  isModalVisible: false,
  currentVersion: getCurrentVersion(),
  sessionDismissed: false,

  checkForUpdates: async (manual = false) => {
    // Only check automatically on Android
    if (!manual && Platform.OS !== 'android') {
      return null;
    }

    const currentVersion = getCurrentVersion();

    // Clean legacy permanent dismissal flag if present so it doesn't suppress updates
    try {
      await AsyncStorage.removeItem(STORAGE_LEGACY_DISMISSED_KEY);
    } catch {
      // Ignore storage error
    }

    // 1. Restore cached update from storage if not already loaded in memory
    let currentCached: UpdateInfo | null = get().updateInfo;
    if (!currentCached) {
      try {
        const cachedStr = await AsyncStorage.getItem(STORAGE_CACHED_UPDATE_KEY);
        if (cachedStr) {
          const parsed = JSON.parse(cachedStr) as UpdateInfo;
          if (parsed?.latestVersion && isNewerVersion(parsed.latestVersion, currentVersion)) {
            currentCached = { ...parsed, currentVersion, isAvailable: true };
            set({
              updateInfo: currentCached,
              isModalVisible: !get().sessionDismissed,
              currentVersion,
            });
          } else {
            // Outdated cache or app already upgraded
            await AsyncStorage.removeItem(STORAGE_CACHED_UPDATE_KEY);
          }
        }
      } catch {
        // Ignore cache parse/storage errors
      }
    }

    // 2. Throttle automated network requests to avoid redundant traffic or GitHub rate limits
    if (!manual) {
      try {
        const lastCheckStr = await AsyncStorage.getItem(STORAGE_LAST_CHECK_KEY);
        if (lastCheckStr) {
          const lastCheck = parseInt(lastCheckStr, 10);
          if (!isNaN(lastCheck) && Date.now() - lastCheck < AUTO_CHECK_THROTTLE_MS) {
            // Within throttle window: return cached update info without making a new network call
            return currentCached;
          }
        }
      } catch {
        // Ignore storage read errors
      }
    }

    set({ isChecking: true, error: null });

    try {
      const info = await checkForUpdate();
      await AsyncStorage.setItem(STORAGE_LAST_CHECK_KEY, String(Date.now()));

      if (info?.isAvailable) {
        await AsyncStorage.setItem(STORAGE_CACHED_UPDATE_KEY, JSON.stringify(info));
      } else {
        await AsyncStorage.removeItem(STORAGE_CACHED_UPDATE_KEY);
      }

      const shouldShowModal = !!info?.isAvailable && (manual || !get().sessionDismissed);

      set({
        updateInfo: info ?? null,
        isModalVisible: shouldShowModal,
        currentVersion: info?.currentVersion ?? currentVersion,
      });

      return info;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al verificar actualizaciones';
      set({ error: message });
      if (manual) throw err;
      return currentCached;
    } finally {
      set({ isChecking: false });
    }
  },

  downloadAndInstall: async () => {
    const { updateInfo } = get();
    if (!updateInfo) return;

    if (!updateInfo.apkAsset?.browser_download_url) {
      // Fallback: open GitHub release URL if no APK asset is attached
      if (updateInfo.releaseUrl) {
        await Linking.openURL(updateInfo.releaseUrl);
      }
      return;
    }

    set({ isDownloading: true, downloadProgress: 0, error: null });

    try {
      await downloadAndInstallApk(
        updateInfo.apkAsset.browser_download_url,
        updateInfo.latestVersion,
        (progress) => {
          set({ downloadProgress: progress });
        }
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al descargar o instalar la actualización';
      set({ error: message });
      throw err;
    } finally {
      set({ isDownloading: false });
    }
  },

  openModal: () => set({ isModalVisible: true, sessionDismissed: false }),
  closeModal: () => set({ isModalVisible: false }),

  dismissCurrentUpdate: async () => {
    set({ isModalVisible: false, sessionDismissed: true });
  },

  openReleasePage: async () => {
    const { updateInfo } = get();
    if (updateInfo?.releaseUrl) {
      await Linking.openURL(updateInfo.releaseUrl);
    }
  },
}));
