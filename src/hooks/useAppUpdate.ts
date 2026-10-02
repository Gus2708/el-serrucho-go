import { create } from 'zustand';
import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  checkForUpdate,
  downloadAndInstallApk,
  UpdateInfo,
  getCurrentVersion,
} from '../lib/appUpdater';

const STORAGE_LAST_CHECK_KEY = 'serrucho_app_update_last_check';
const STORAGE_DISMISSED_VERSION_KEY = 'serrucho_app_update_dismissed';
const CHECK_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

interface AppUpdateState {
  isChecking: boolean;
  isDownloading: boolean;
  downloadProgress: number; // 0 to 1
  updateInfo: UpdateInfo | null;
  error: string | null;
  isModalVisible: boolean;
  currentVersion: string;

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

  checkForUpdates: async (manual = false) => {
    // Only check automatically on Android
    if (!manual && Platform.OS !== 'android') {
      return null;
    }

    if (!manual) {
      try {
        const lastCheckStr = await AsyncStorage.getItem(STORAGE_LAST_CHECK_KEY);
        if (lastCheckStr) {
          const lastCheck = parseInt(lastCheckStr, 10);
          if (Date.now() - lastCheck < CHECK_COOLDOWN_MS) {
            return null; // Skip check due to cooldown
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

      let shouldShowModal = info.isAvailable;

      // If check was automatic, verify if the user already dismissed this specific version
      if (!manual && info.isAvailable) {
        const dismissedVersion = await AsyncStorage.getItem(STORAGE_DISMISSED_VERSION_KEY);
        if (dismissedVersion === info.latestVersion) {
          shouldShowModal = false;
        }
      }

      set({
        updateInfo: info,
        isModalVisible: shouldShowModal,
        currentVersion: info.currentVersion,
      });

      return info;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al verificar actualizaciones';
      set({ error: message });
      if (manual) throw err;
      return null;
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

  openModal: () => set({ isModalVisible: true }),
  closeModal: () => set({ isModalVisible: false }),

  dismissCurrentUpdate: async () => {
    const { updateInfo } = get();
    if (updateInfo?.latestVersion) {
      try {
        await AsyncStorage.setItem(STORAGE_DISMISSED_VERSION_KEY, updateInfo.latestVersion);
      } catch {
        // Ignore storage error
      }
    }
    set({ isModalVisible: false });
  },

  openReleasePage: async () => {
    const { updateInfo } = get();
    if (updateInfo?.releaseUrl) {
      await Linking.openURL(updateInfo.releaseUrl);
    }
  },
}));
