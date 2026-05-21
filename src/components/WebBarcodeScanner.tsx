/**
 * WebBarcodeScanner.tsx
 *
 * Scanner de códigos de barras para la versión PWA (web).
 *
 * Estrategia de detección:
 * 1. BarcodeDetector API (Chrome Android 83+, Edge 83+) — nativa, detecta EAN-13, QR, etc.
 * 2. @zxing/browser — fallback cross-browser que soporta todos los formatos
 *
 * expo-camera solo soporta QR en web (via jsQR) y no puede usarse para
 * códigos EAN-13/Code128 en la versión PWA.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

type ScannerStatus = 'requesting' | 'denied' | 'scanning' | 'error';

// Declare BarcodeDetector for TypeScript (it's a browser API not in lib.dom)
declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>;
  constructor(opts: { formats: string[] });
  detect(source: HTMLVideoElement | HTMLImageElement | ImageBitmap | ImageData): Promise<Array<{ rawValue: string; format: string }>>;
}

const BARCODE_FORMATS = [
  'qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'code_93',
  'upc_a', 'upc_e', 'pdf417', 'aztec', 'data_matrix', 'codabar', 'itf',
];

export function WebBarcodeScanner({ visible, onClose, onScan }: Props) {
  const { colors } = useTheme();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scannedRef = useRef(false);
  const [status, setStatus] = useState<ScannerStatus>('requesting');
  const [errorMsg, setErrorMsg] = useState('');
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // ─── Cleanup ────────────────────────────────────────────────────────────────
  function cleanup() {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  // ─── Start camera + scanner ──────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setStatus('requesting');
    scannedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }, // back camera
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setStatus('scanning');
      startScanning();
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setStatus('denied');
      } else {
        setErrorMsg(err?.message ?? 'Error desconocido al iniciar la cámara');
        setStatus('error');
      }
    }
  }, []);

  // ─── Scan loop ───────────────────────────────────────────────────────────────
  function startScanning() {
    // Try native BarcodeDetector first
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      startNativeDetector();
    } else {
      startZxingScanner();
    }
  }

  async function startNativeDetector() {
    let formats = BARCODE_FORMATS;
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      // Filter to only formats the browser supports
      formats = BARCODE_FORMATS.filter(f => supported.includes(f));
      if (formats.length === 0) formats = ['qr_code', 'ean_13', 'code_128'];
    } catch {
      // Use default formats
    }

    const detector = new BarcodeDetector({ formats });

    scanIntervalRef.current = setInterval(async () => {
      if (scannedRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < video.HAVE_ENOUGH_DATA) return;

      try {
        const results = await detector.detect(video);
        if (results.length > 0 && results[0].rawValue) {
          handleDetected(results[0].rawValue);
        }
      } catch {
        // Frame not ready — skip
      }
    }, 300);
  }

  async function startZxingScanner() {
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();

      scanIntervalRef.current = setInterval(async () => {
        if (scannedRef.current) return;
        const video = videoRef.current;
        if (!video || video.readyState < video.HAVE_ENOUGH_DATA) return;

        try {
          // Capture frame to canvas
          const canvas = document.createElement('canvas');
          canvas.width  = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(video, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          const result = await reader.decodeFromImageElement(canvas as any).catch(() => null);
          if (result) {
            handleDetected(result.getText());
          }
        } catch {
          // Frame not ready — skip
        }
      }, 400);
    } catch {
      setErrorMsg('No se pudo iniciar el escáner. Intenta con Chrome.');
      setStatus('error');
    }
  }

  function handleDetected(data: string) {
    if (scannedRef.current) return;
    scannedRef.current = true;
    cleanup();
    onScan(data);
  }

  // ─── Scan line animation ─────────────────────────────────────────────────────
  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    if (visible && status === 'scanning') {
      scanLineAnim.setValue(0);
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
          Animated.timing(scanLineAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
        ])
      );
      anim.start();
    }
    return () => { anim?.stop(); };
  }, [visible, status, scanLineAnim]);

  // ─── Mount / unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      startCamera();
    } else {
      cleanup();
      setStatus('requesting');
    }
    return cleanup;
  }, [visible]);

  const translateY = scanLineAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [10, 230],
  });

  if (!visible) return null;

  // ─── Permission denied ───────────────────────────────────────────────────────
  if (status === 'denied') {
    return (
      <Modal visible animationType="slide" transparent={false} onRequestClose={onClose}>
        <View style={[styles.centerContainer, { backgroundColor: colors.bg }]}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="camera-off" size={48} color={colors.danger} style={styles.icon} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Permiso de Cámara Denegado</Text>
            <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
              Ve a Configuración del navegador → Permisos del sitio y permite el acceso a la cámara para usar el escáner.
            </Text>
            <Pressable
              style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
              onPress={onClose}
            >
              <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // ─── Generic error ───────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <Modal visible animationType="slide" transparent={false} onRequestClose={onClose}>
        <View style={[styles.centerContainer, { backgroundColor: colors.bg }]}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="alert-triangle" size={48} color={colors.danger} style={styles.icon} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Error al iniciar la cámara</Text>
            <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>{errorMsg}</Text>
            <Pressable
              style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
              onPress={onClose}
            >
              <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // ─── Camera view ─────────────────────────────────────────────────────────────
  return (
    <Modal visible animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Native HTML video element for web camera */}
        <video
          ref={videoRef}
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
          }}
          playsInline
          muted
          autoPlay
        />

        {/* Loading overlay while requesting permission */}
        {status === 'requesting' && (
          <View style={[StyleSheet.absoluteFillObject, styles.loadingOverlay]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: '#fff' }]}>Iniciando cámara…</Text>
          </View>
        )}

        {/* Scanner UI overlay */}
        {status === 'scanning' && (
          <View style={styles.overlayContainer} pointerEvents="box-none">
            {/* Top dark strip */}
            <View style={styles.overlayRow} pointerEvents="none" />

            {/* Middle row: dark sides + transparent target box */}
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

            {/* Bottom strip */}
            <View style={styles.overlayRow}>
              <Text style={styles.instructionText}>
                Apunta la cámara al código de barras o QR
              </Text>
              <Pressable
                style={({ pressed }) => [styles.btnClose, { borderColor: colors.border }, pressed && { opacity: 0.8 }]}
                onPress={() => { cleanup(); onClose(); }}
              >
                <Feather name="x" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.btnCloseText}>Cerrar Escáner</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centerContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 380, borderRadius: 16, borderWidth: 1,
    padding: 24, alignItems: 'center', elevation: 8,
  },
  icon: { marginBottom: 16 },
  cardTitle: { fontSize: 18, fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center', marginBottom: 12 },
  cardSubtitle: { fontSize: 14, fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btnPrimary: { height: 48, borderRadius: 10, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  btnPrimaryText: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },

  loadingOverlay: { backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, fontFamily: 'JetBrainsMono_400Regular' },

  overlayContainer: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  overlayRow: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  overlayMiddleRow: { height: 250, flexDirection: 'row' },
  overlayCol: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },

  targetBox: { width: 250, height: 250, borderWidth: 1, position: 'relative', backgroundColor: 'transparent' },
  corner: { position: 'absolute', width: 22, height: 22 },
  topLeft:     { top: 0,    left: 0,  borderTopWidth: 4,    borderLeftWidth: 4 },
  topRight:    { top: 0,    right: 0, borderTopWidth: 4,    borderRightWidth: 4 },
  bottomLeft:  { bottom: 0, left: 0,  borderBottomWidth: 4, borderLeftWidth: 4 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },
  scanLine: { position: 'absolute', left: 10, right: 10, height: 3, elevation: 3 },

  instructionText: { fontSize: 14, fontFamily: 'JetBrainsMono_500Medium', textAlign: 'center', marginBottom: 20, color: '#fff' },
  btnClose: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 24, borderWidth: 1, paddingHorizontal: 24, backgroundColor: 'rgba(30,30,30,0.85)' },
  btnCloseText: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold', color: '#fff' },
});
