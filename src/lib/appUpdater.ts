import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';

export const GITHUB_OWNER = 'Gus2708';
export const GITHUB_REPO = 'el-serrucho-go';
export const GITHUB_API_LATEST_RELEASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
}

export interface GitHubReleaseResponse {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubReleaseAsset[];
  message?: string; // e.g. "Not Found"
}

export interface UpdateInfo {
  isAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string;
  apkAsset: GitHubReleaseAsset | null;
  publishedAt: string;
}

/**
 * Normalizes semver string into numeric components [major, minor, patch, ...].
 */
export function parseVersion(v: string): number[] {
  if (!v || typeof v !== 'string') return [0, 0, 0];
  const clean = v.replace(/^[vV]/, '').trim();
  const base = clean.split('-')[0].split('+')[0];
  return base
    .split('.')
    .map((part) => parseInt(part, 10))
    .map((num) => (isNaN(num) ? 0 : num));
}

/**
 * Returns true if remoteVersion is strictly greater than currentVersion according to semver.
 */
export function isNewerVersion(remoteVersion: string, currentVersion: string): boolean {
  const remoteParts = parseVersion(remoteVersion);
  const currentParts = parseVersion(currentVersion);
  const maxLen = Math.max(remoteParts.length, currentParts.length);

  for (let i = 0; i < maxLen; i++) {
    const r = remoteParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

/**
 * Finds the first asset ending in .apk.
 */
export function findApkAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | null {
  if (!Array.isArray(assets)) return null;
  return assets.find((asset) => asset.name?.toLowerCase().endsWith('.apk')) ?? null;
}

/**
 * Formats bytes to human readable string (KB, MB, GB).
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
  return `${val} ${sizes[i]}`;
}

/**
 * Retrieves the current app version configured in Expo.
 */
export function getCurrentVersion(): string {
  return Constants.expoConfig?.version ?? '1.2.2';
}

/**
 * Queries GitHub Releases API to see if a newer version exists.
 */
export async function checkForUpdate(apiUrl: string = GITHUB_API_LATEST_RELEASE): Promise<UpdateInfo> {
  const currentVersion = getCurrentVersion();

  const response = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'El-Serrucho-GO-App',
    },
  });

  if (response.status === 404) {
    // No releases published yet
    return {
      isAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseName: '',
      releaseNotes: '',
      releaseUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      apkAsset: null,
      publishedAt: '',
    };
  }

  if (!response.ok) {
    throw new Error(`Error al consultar GitHub Releases (${response.status}: ${response.statusText})`);
  }

  const release: GitHubReleaseResponse = await response.json();

  if (!release.tag_name) {
    return {
      isAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseName: '',
      releaseNotes: '',
      releaseUrl: release.html_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      apkAsset: null,
      publishedAt: '',
    };
  }

  const cleanTag = release.tag_name.replace(/^[vV]/, '').trim();
  const newer = isNewerVersion(cleanTag, currentVersion);
  const apkAsset = findApkAsset(release.assets);

  return {
    isAvailable: newer,
    currentVersion,
    latestVersion: cleanTag,
    releaseName: release.name || release.tag_name,
    releaseNotes: release.body || '',
    releaseUrl: release.html_url,
    apkAsset,
    publishedAt: release.published_at,
  };
}

/**
 * Downloads the APK and invokes Android Package Installer intent.
 */
export async function downloadAndInstallApk(
  apkUrl: string,
  targetVersion: string,
  onProgress?: (progressRatio: number) => void
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('La instalación automática de APK solo está soportada en dispositivos Android.');
  }

  if (isRunningInExpoGo()) {
    throw new Error('No es posible actualizar dentro de Expo Go. Esta función requiere el APK instalado.');
  }

  const targetDir = `${FileSystem.cacheDirectory}updates/`;
  const dirInfo = await FileSystem.getInfoAsync(targetDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
  }

  const cleanVersion = targetVersion.replace(/[^a-zA-Z0-9._-]/g, '_');
  const targetFile = `${targetDir}el_serrucho_${cleanVersion}.apk`;

  // Remove existing file if present to guarantee clean download
  const existing = await FileSystem.getInfoAsync(targetFile);
  if (existing.exists) {
    await FileSystem.deleteAsync(targetFile, { idempotent: true });
  }

  const downloadResumable = FileSystem.createDownloadResumable(
    apkUrl,
    targetFile,
    {},
    (downloadProgress) => {
      const total = downloadProgress.totalBytesExpectedToWrite;
      const written = downloadProgress.totalBytesWritten;
      if (total > 0 && onProgress) {
        onProgress(Math.min(1, Math.max(0, written / total)));
      }
    }
  );

  const downloadResult = await downloadResumable.downloadAsync();
  if (!downloadResult || !downloadResult.uri) {
    throw new Error('Error al descargar el archivo APK de la actualización.');
  }

  // Get content:// URI for Android FileProvider compatibility
  const contentUri = await FileSystem.getContentUriAsync(downloadResult.uri);

  // Trigger Android Package Installer Intent
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
