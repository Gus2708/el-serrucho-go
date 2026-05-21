import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  View,
  Pressable,
  Animated,
  ActivityIndicator,
  Platform,
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
  const [hasScanned, setHasScanned] = useState(false);

  // Animation for the pulsing scan line
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // Track if scanner is active to avoid double scans
  const scannedRef = useRef(false);

  // Reset scanner state when modal is opened/closed
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (visible) {
      setHasScanned(false);
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

  // Handle scanned barcodes
  const handleBarcodeScanned = ({ type, data }: { type: string; data: string }) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    setHasScanned(true);
    
    // Callback to parent component
    onScan(data);
  };

  // Skip rendering if not visible
  if (!visible) return null;

  // Render permission states
  const renderPermissionState = () => {
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
  };

  // Interpolate the animated value to Y offset of the scan line
  const translateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 230], // height of bounding box (240px) minus margins
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
        <View style={[styles.container, { backgroundColor: colors.bg }]}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            onBarcodeScanned={handleBarcodeScanned}
          >
            {/* Dark overlay surrounding the scanning target */}
            <View style={styles.overlayContainer}>
              <View style={styles.overlayRow} />
              
              <View style={styles.overlayMiddleRow}>
                <View style={styles.overlayCol} />
                
                {/* Target bounding box */}
                <View style={[styles.targetBox, { borderColor: colors.primary }]}>
                  {/* Glowing corners for premium aesthetics */}
                  <View style={[styles.corner, styles.topLeft, { borderColor: colors.primary }]} />
                  <View style={[styles.corner, styles.topRight, { borderColor: colors.primary }]} />
                  <View style={[styles.corner, styles.bottomLeft, { borderColor: colors.primary }]} />
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

              <View style={styles.overlayRow}>
                <Text style={[styles.instructionText, { color: colors.text }]}>
                  Apunta la cámara al código de barras o QR
                </Text>
                
                {/* Close button inside the camera screen */}
                <Pressable
                  style={({ pressed }) => [
                    styles.btnClose,
                    {
                      backgroundColor: colors.surface + 'DD',
                      borderColor: colors.border,
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={onClose}
                >
                  <Feather name="x" size={20} color={colors.text} style={{ marginRight: 8 }} />
                  <Text style={[styles.btnCloseText, { color: colors.text }]}>Cerrar Escáner</Text>
                </Pressable>
              </View>
            </View>
          </CameraView>
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

  // Overlay Layout
  overlayContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  overlayRow: {
    flex: 1,
    backgroundColor: 'rgba(1, 1, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  overlayMiddleRow: {
    height: 240,
    flexDirection: 'row',
  },
  overlayCol: {
    flex: 1,
    backgroundColor: 'rgba(1, 1, 0, 0.7)',
  },

  // Bounding Box
  targetBox: {
    width: 240,
    height: 240,
    borderWidth: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 3,
  },

  // Instruction and buttons
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
  },
});
