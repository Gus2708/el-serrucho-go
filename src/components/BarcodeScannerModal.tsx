import { scaleFont } from '../theme/responsive';
/**
 * BarcodeScannerModal.tsx
 *
 * Despacha automáticamente al scanner correcto según la plataforma:
 * - Android / iOS → CameraView de expo-camera (nativo, optimizado para códigos 1D)
 * - Web / PWA     → WebBarcodeScanner (BarcodeDetector API + @zxing/browser fallback)
 *
 * CRÍTICO:
 * 1. Excluye códigos QR y matrices 2D (solo lee códigos de barras 1D).
 * 2. CameraView NO soporta children en expo-camera 16.x. El overlay DEBE ser sibling View.
 * 3. Retícula horizontal (310x160) adaptada a códigos de barra lineales con linterna y zoom 1x/2x.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  View,
  Animated,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { WebBarcodeScanner } from './WebBarcodeScanner';
import { PressableScale } from './PressableScale';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScan:  (data: string) => void;
}

/** Formatos 1D lineales soportados (sin QR ni matrices 2D) */
export const BARCODE_1D_TYPES: BarcodeType[] = [
  'ean13',
  'ean8',
  'code128',
  'code39',
  'code93',
  'upc_a',
  'upc_e',
  'codabar',
  'itf14',
];

// ─── On web, delegate entirely to WebBarcodeScanner ────────────────────────────
export function BarcodeScannerModal({ visible, onClose, onScan }: Props) {
  if (Platform.OS === 'web') {
    return <WebBarcodeScanner visible={visible} onClose={onClose} onScan={onScan} />;
  }
  return <NativeBarcodeScannerModal visible={visible} onClose={onClose} onScan={onScan} />;
}

// ─── Native implementation (Android / iOS) ────────────────────────────────────
function NativeBarcodeScannerModal({ visible, onClose, onScan }: Props) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);

  // Track if scanner is active to avoid double scans
  const scannedRef = useRef(false);

  // Animation for the pulsing scan line
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // Reset scanner state and start animation when modal opens
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (visible) {
      scannedRef.current = false;
      setTorch(false);
      setZoom(0);
      scanLineAnim.setValue(0);
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
          Animated.timing(scanLineAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
        ])
      );
      animation.start();
    }
    return () => { animation?.stop(); };
  }, [visible, scanLineAnim]);

  function handleBarcodeScanned({ type, data }: { type?: string; data: string }) {
    if (scannedRef.current) return;
    const lowerType = (type || '').toLowerCase();
    // Bloqueo estricto de códigos QR y matrices 2D
    if (
      lowerType.includes('qr') ||
      lowerType.includes('aztec') ||
      lowerType.includes('matrix') ||
      lowerType === 'org.iso.qrcode'
    ) {
      return;
    }
    scannedRef.current = true;
    onScan(data.trim());
  }

  if (!visible) return null;

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
              Para poder escanear códigos de barras en El Serrucho GO, necesitamos acceso a tu cámara.
            </Text>
            <View style={styles.buttonRow}>
              <PressableScale
                style={[styles.btnSecondary, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                onPress={onClose}
              >
                <Text style={[styles.btnSecondaryText, { color: colors.text }]}>Cancelar</Text>
              </PressableScale>
              <PressableScale
                style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
                onPress={requestPermission}
              >
                <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>Otorgar Permiso</Text>
              </PressableScale>
            </View>
          </View>
        </View>
      );
    }

    return null;
  }

  const translateY = scanLineAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [8, 142],
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
        <View style={styles.container}>
          {/*
           * CRITICAL: CameraView does NOT support children in expo-camera 16.x+.
           * The overlay MUST be a sibling View — never nested inside <CameraView>.
           */}
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            enableTorch={torch}
            zoom={zoom}
            autofocus={Platform.OS === 'android' ? 'on' : 'off'}
            onBarcodeScanned={handleBarcodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: BARCODE_1D_TYPES,
            }}
          />

          {/* Overlay as sibling — absolute positioned on top of the camera */}
          <View style={styles.overlayContainer} pointerEvents="box-none">
            <View style={styles.overlayRow} pointerEvents="none" />

            <View style={styles.overlayMiddleRow} pointerEvents="none">
              <View style={styles.overlayCol} />
              <View style={[styles.targetBox, { borderColor: colors.primary }]}>
                <View style={[styles.corner, styles.topLeft,     { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.topRight,    { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.bottomLeft,  { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.bottomRight, { borderColor: colors.primary }]} />
                <Animated.View
                  style={[
                    styles.scanLine,
                    { backgroundColor: colors.primary, transform: [{ translateY }] },
                  ]}
                />
              </View>
              <View style={styles.overlayCol} />
            </View>

            <View style={styles.overlayRow}>
              <Text style={[styles.instructionText, { color: '#fff' }]}>
                Apunta la cámara al código de barras
              </Text>
              <View style={styles.controlButtonsRow}>
                <PressableScale
                  style={[
                    styles.controlBtn,
                    { backgroundColor: torch ? colors.primary : 'rgba(30,30,30,0.85)', borderColor: colors.border },
                  ]}
                  onPress={() => setTorch((t) => !t)}
                  accessibilityRole="button"
                  accessibilityLabel={torch ? 'Apagar linterna' : 'Encender linterna'}
                >
                  <Feather name={torch ? 'zap' : 'zap-off'} size={18} color={torch ? colors.onPrimary : '#fff'} />
                </PressableScale>

                <PressableScale
                  style={[
                    styles.controlBtn,
                    { backgroundColor: zoom > 0 ? colors.primary : 'rgba(30,30,30,0.85)', borderColor: colors.border },
                  ]}
                  onPress={() => setZoom((z) => (z > 0 ? 0 : 0.15))}
                  accessibilityRole="button"
                  accessibilityLabel={zoom > 0 ? 'Zoom 1x' : 'Zoom 2x'}
                >
                  <Text style={[styles.zoomText, { color: zoom > 0 ? colors.onPrimary : '#fff' }]}>
                    {zoom > 0 ? '2x' : '1x'}
                  </Text>
                </PressableScale>

                <PressableScale
                  style={[styles.btnClose, { backgroundColor: 'rgba(30,30,30,0.85)', borderColor: colors.border }]}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar Escáner"
                >
                  <Feather name="x" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.btnCloseText}>Cerrar</Text>
                </PressableScale>
              </View>
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: 16, borderWidth: 1, padding: 24, alignItems: 'center', elevation: 8 },
  icon: { marginBottom: 16 },
  cardTitle: { fontSize: scaleFont(18), fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center', marginBottom: 12 },
  cardSubtitle: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(20), marginBottom: 24 },
  buttonRow: { flexDirection: 'row', gap: 12, width: '100%' },
  btnPrimary: { flex: 1, height: 48, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  btnPrimaryText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  btnSecondary: { flex: 1, height: 48, borderRadius: 10, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  btnSecondaryText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_500Medium' },

  overlayContainer: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  overlayRow: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  overlayMiddleRow: { height: 160, flexDirection: 'row' },
  overlayCol: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },

  targetBox: { width: 310, height: 160, borderWidth: 1, position: 'relative', backgroundColor: 'transparent', borderRadius: 8 },
  corner: { position: 'absolute', width: 22, height: 22 },
  topLeft:     { top: 0,    left: 0,  borderTopWidth: 4,    borderLeftWidth: 4, borderTopLeftRadius: 8 },
  topRight:    { top: 0,    right: 0, borderTopWidth: 4,    borderRightWidth: 4, borderTopRightRadius: 8 },
  bottomLeft:  { bottom: 0, left: 0,  borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 8 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 8 },
  scanLine: { position: 'absolute', left: 10, right: 10, height: 3, elevation: 3 },

  instructionText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_500Medium', textAlign: 'center', marginBottom: 20 },
  controlButtonsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  controlBtn: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  zoomText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  btnClose: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 24, borderWidth: 1, paddingHorizontal: 20 },
  btnCloseText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold', color: '#fff' },
});
