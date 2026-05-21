import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  View,
  Pressable,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScan:  (data: string) => void;
}

export function BarcodeScannerModal({ visible, onClose, onScan }: Props) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();

  // Track if scanner is active to avoid double scans
  const scannedRef = useRef(false);

  // Animation for the pulsing scan line
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // Reset scanner state when modal is opened/closed
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (visible) {
      scannedRef.current = false;

      scanLineAnim.setValue(0);
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(scanLineAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    }

    return () => {
      if (animation) {
        animation.stop();
      }
    };
  }, [visible, scanLineAnim]);

  // Handle scanned barcodes - called by expo-camera native layer
  function handleBarcodeScanned({ data }: { type: string; data: string }) {
    if (scannedRef.current) return;
    scannedRef.current = true;
    onScan(data);
  }

  // Skip rendering if not visible
  if (!visible) return null;

  // Render permission states
  function renderPermissionState() {
    if (!permission) {
      return (
        <View style={[styles.centerContainer, { backgroundColor: colors.bg }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (!permission.granted) {
      return (
        <View style={[styles.centerContainer, { backgroundColor: colors.bg }]}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="camera-off" size={48} color={colors.danger} style={styles.icon} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Permiso de Cámara Requerido</Text>
            <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
              Para poder escanear códigos de barras y códigos QR en El Serrucho GO, necesitamos acceso a tu cámara.
            </Text>

            <View style={styles.buttonRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.btnSecondary,
                  { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={onClose}
              >
                <Text style={[styles.btnSecondaryText, { color: colors.text }]}>Cancelar</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.btnPrimary,
                  { backgroundColor: colors.primary },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={requestPermission}
              >
                <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>Otorgar Permiso</Text>
              </Pressable>
            </View>
          </View>
        </View>
      );
    }

    return null;
  }

  // Interpolate the animated value to Y offset of the scan line
  const translateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 230],
  });

  const permissionOverlay = renderPermissionState();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      {permissionOverlay ? (
        permissionOverlay
      ) : (
        <View style={[styles.container, { backgroundColor: '#000' }]}>
          {/*
           * CRITICAL: CameraView does NOT support children in expo-camera 16.x+.
           * The overlay MUST be a sibling View using absolute positioning,
           * NOT nested inside <CameraView>. Placing children inside CameraView
           * causes the barcode scanner to malfunction silently.
           */}
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            onBarcodeScanned={handleBarcodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: [
                'qr',
                'ean13',
                'ean8',
                'code39',
                'code93',
                'code128',
                'upc_a',
                'upc_e',
                'pdf417',
                'aztec',
                'datamatrix',
                'codabar',
                'itf14',
              ],
            }}
          />

          {/* Overlay as a SIBLING — absolute positioned on top of the camera */}
          <View style={styles.overlayContainer} pointerEvents="box-none">
            {/* Top dark strip */}
            <View style={styles.overlayRow} pointerEvents="none" />

            {/* Middle row: dark sides + transparent target box */}
            <View style={styles.overlayMiddleRow} pointerEvents="none">
              <View style={styles.overlayCol} />

              {/* Target bounding box — transparent so camera sees through */}
              <View style={[styles.targetBox, { borderColor: colors.primary }]}>
                {/* Glowing corners */}
                <View style={[styles.corner, styles.topLeft,     { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.topRight,    { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.bottomLeft,  { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.bottomRight, { borderColor: colors.primary }]} />

                {/* Pulsing Scan Line */}
                <Animated.View
                  style={[
                    styles.scanLine,
                    {
                      backgroundColor: colors.primary,
                      transform: [{ translateY }],
                    },
                  ]}
                />
              </View>

              <View style={styles.overlayCol} />
            </View>

            {/* Bottom strip with instruction text and close button */}
            <View style={styles.overlayRow}>
              <Text style={[styles.instructionText, { color: '#fff' }]}>
                Apunta la cámara al código de barras o QR
              </Text>

              <Pressable
                style={({ pressed }) => [
                  styles.btnClose,
                  { backgroundColor: colors.surface + 'DD', borderColor: colors.border },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={onClose}
              >
                <Feather name="x" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.btnCloseText}>Cerrar Escáner</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  icon: {
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: 'JetBrainsMono_700Bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  cardSubtitle: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  btnPrimary: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  btnSecondary: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnSecondaryText: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_500Medium',
  },

  // Overlay Layout — absolute fill, sibling to CameraView
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  overlayRow: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  overlayMiddleRow: {
    height: 250,
    flexDirection: 'row',
  },
  overlayCol: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },

  // Bounding Box — NO overflow:hidden so camera layer is not clipped
  targetBox: {
    width: 250,
    height: 250,
    borderWidth: 1,
    position: 'relative',
    backgroundColor: 'transparent',
  },
  corner: {
    position: 'absolute',
    width: 22,
    height: 22,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  scanLine: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 3,
    shadowColor: '#F5B200',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 3,
  },

  // Instruction and close button
  instructionText: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_500Medium',
    textAlign: 'center',
    marginBottom: 20,
  },
  btnClose: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  btnCloseText: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_700Bold',
    color: '#fff',
  },
});
