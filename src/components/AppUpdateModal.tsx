import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { PressableScale } from './PressableScale';
import { pressScale } from '../theme/motion';
import { useAppUpdateStore } from '../hooks/useAppUpdate';
import { formatBytes } from '../lib/appUpdater';

export default function AppUpdateModal(): React.JSX.Element | null {
  const { colors } = useTheme();

  const isModalVisible = useAppUpdateStore((s) => s.isModalVisible);
  const isDownloading = useAppUpdateStore((s) => s.isDownloading);
  const downloadProgress = useAppUpdateStore((s) => s.downloadProgress);
  const updateInfo = useAppUpdateStore((s) => s.updateInfo);
  const error = useAppUpdateStore((s) => s.error);
  const downloadAndInstall = useAppUpdateStore((s) => s.downloadAndInstall);
  const dismissCurrentUpdate = useAppUpdateStore((s) => s.dismissCurrentUpdate);
  const openReleasePage = useAppUpdateStore((s) => s.openReleasePage);

  if (!isModalVisible || !updateInfo) {
    return null;
  }

  const hasApk = !!updateInfo.apkAsset?.browser_download_url;
  const progressPercent = Math.round(downloadProgress * 100);

  const handleAction = async () => {
    try {
      await downloadAndInstall();
    } catch {
      // Error is stored in store state
    }
  };

  return (
    <Modal
      visible={isModalVisible}
      transparent
      animationType="fade"
      onRequestClose={isDownloading ? undefined : dismissCurrentUpdate}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.container,
            {
              backgroundColor: colors.surface || '#161616',
              borderColor: colors.border || '#2C2C2C',
            },
          ]}
        >
          {/* Header Icon */}
          <View style={styles.headerRow}>
            <View
              style={[
                styles.iconBox,
                {
                  backgroundColor: colors.primaryFaded || 'rgba(245,178,0,0.12)',
                },
              ]}
            >
              <Feather
                name="download-cloud"
                size={24}
                color={colors.primary || '#F5B200'}
              />
            </View>

            <View style={styles.headerTitles}>
              <Text
                style={[
                  styles.title,
                  { color: colors.text || '#FFFFFF' },
                ]}
              >
                NUEVA VERSIÓN
              </Text>
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.versionBadge,
                    { backgroundColor: colors.surfaceAlt || '#1E1E1E' },
                  ]}
                >
                  <Text
                    style={[
                      styles.versionText,
                      { color: colors.textMuted || '#888888' },
                    ]}
                  >
                    v{updateInfo.currentVersion} →{' '}
                    <Text style={{ color: colors.primary || '#F5B200', fontWeight: 'bold' }}>
                      v{updateInfo.latestVersion}
                    </Text>
                  </Text>
                </View>

                {updateInfo.apkAsset?.size ? (
                  <View
                    style={[
                      styles.sizeBadge,
                      { backgroundColor: colors.surfaceAlt || '#1E1E1E' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sizeText,
                        { color: colors.textMuted || '#888888' },
                      ]}
                    >
                      {formatBytes(updateInfo.apkAsset.size)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {/* Release Notes */}
          {updateInfo.releaseNotes ? (
            <View style={styles.notesWrapper}>
              <Text
                style={[
                  styles.notesLabel,
                  { color: colors.textMuted || '#888888' },
                ]}
              >
                NOVEDADES DE LA VERSIÓN:
              </Text>
              <ScrollView
                style={[
                  styles.notesScroll,
                  {
                    backgroundColor: colors.bg || '#0C0C0C',
                    borderColor: colors.border || '#2C2C2C',
                  },
                ]}
                contentContainerStyle={styles.notesContent}
              >
                <Text
                  style={[
                    styles.notesText,
                    { color: colors.text || '#FFFFFF' },
                  ]}
                >
                  {updateInfo.releaseNotes}
                </Text>
              </ScrollView>
            </View>
          ) : null}

          {/* Downloading Progress Bar */}
          {isDownloading ? (
            <View style={styles.progressContainer}>
              <View style={styles.progressHeader}>
                <Text
                  style={[
                    styles.progressLabel,
                    { color: colors.textMuted || '#888888' },
                  ]}
                >
                  DESCARGANDO ACTUALIZACIÓN...
                </Text>
                <Text
                  style={[
                    styles.progressPercent,
                    { color: colors.primary || '#F5B200' },
                  ]}
                >
                  {progressPercent}%
                </Text>
              </View>

              <View
                style={[
                  styles.progressBarBackground,
                  { backgroundColor: colors.surfaceAlt || '#1E1E1E' },
                ]}
              >
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      backgroundColor: colors.primary || '#F5B200',
                      width: `${progressPercent}%`,
                    },
                  ]}
                />
              </View>

              <Text
                style={[
                  styles.installNotice,
                  { color: colors.textDim || '#666666' },
                ]}
              >
                Al completarse se abrirá el instalador del sistema.
              </Text>
            </View>
          ) : null}

          {/* Error Message */}
          {error ? (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: (colors.danger || '#FF5252') + '15' },
              ]}
            >
              <Feather
                name="alert-circle"
                size={16}
                color={colors.danger || '#FF5252'}
              />
              <Text
                style={[
                  styles.errorText,
                  { color: colors.danger || '#FF5252' },
                ]}
              >
                {error}
              </Text>
            </View>
          ) : null}

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            {!isDownloading && (
              <PressableScale
                activeScale={pressScale.row}
                onPress={dismissCurrentUpdate}
                style={[
                  styles.secondaryBtn,
                  {
                    backgroundColor: colors.surfaceAlt || '#1E1E1E',
                    borderColor: colors.border || '#2C2C2C',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryBtnText,
                    { color: colors.textMuted || '#888888' },
                  ]}
                >
                  MÁS TARDE
                </Text>
              </PressableScale>
            )}

            <PressableScale
              activeScale={pressScale.row}
              disabled={isDownloading}
              onPress={hasApk ? handleAction : openReleasePage}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: colors.primary || '#F5B200',
                  opacity: isDownloading ? 0.7 : 1,
                  flex: isDownloading ? 1 : 1.5,
                },
              ]}
            >
              {isDownloading ? (
                <View style={styles.btnLoadingRow}>
                  <ActivityIndicator
                    size="small"
                    color={colors.onPrimary || '#0C0C0C'}
                  />
                  <Text
                    style={[
                      styles.primaryBtnText,
                      { color: colors.onPrimary || '#0C0C0C' },
                    ]}
                  >
                    DESCARGANDO...
                  </Text>
                </View>
              ) : (
                <View style={styles.btnRow}>
                  <Feather
                    name={hasApk ? 'download' : 'external-link'}
                    size={16}
                    color={colors.onPrimary || '#0C0C0C'}
                  />
                  <Text
                    style={[
                      styles.primaryBtnText,
                      { color: colors.onPrimary || '#0C0C0C' },
                    ]}
                  >
                    {hasApk ? 'ACTUALIZAR' : 'VER EN GITHUB'}
                  </Text>
                </View>
              )}
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    gap: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitles: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: scaleFont(16),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  versionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  versionText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  sizeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  sizeText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  notesWrapper: {
    gap: 8,
  },
  notesLabel: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 1,
  },
  notesScroll: {
    maxHeight: 140,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  notesContent: {
    padding: 12,
  },
  notesText: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: 18,
  },
  progressContainer: {
    gap: 8,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  progressPercent: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  progressBarBackground: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  installNotice: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  errorText: {
    flex: 1,
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  secondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 0.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  primaryBtn: {
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btnLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryBtnText: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
});
