import { scaleFont } from '../theme/responsive';
/**
 * WebBarcodeScanner.tsx
 *
 * Scanner de códigos de barras para la versión PWA/Web.
 *
 * expo-camera en web solo soporta QR via jsQR — NO EAN-13 ni otros formatos.
 * Esta implementación usa:
 * 1. BarcodeDetector API nativa del navegador (Chrome Android 83+)
 * 2. @zxing/browser vía decodeFromConstraints (fallback cross-browser)
 *
 * La clave: ZXing maneja internamente la cámara y el loop de detección.
 * NO usamos setInterval manual — el SDK lo hace por nosotros.
 */
import React, { useEffect, useRef, useState } from 'react';
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
import { PressableScale } from './PressableScale';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

type ScannerStatus = 'requesting' | 'denied' | 'scanning' | 'error';

// BarcodeDetector no está en lib.dom todavía — declaración manual
declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>;
  constructor(opts: { formats: string[] });
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string; format: string }>>;
}

export function WebBarcodeScanner({ visible, onClose, onScan }: Props) {
  const { colors } = useTheme();
  const videoRef   = useRef<HTMLVideoElement>(null);
  // ZXing IScannerControls — guardado para poder hacer stop()
  const controlsRef   = useRef<{ stop: () => void } | null>(null);
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const scannedRef    = useRef(false);
  const [status, setStatus]   = useState<ScannerStatus>('requesting');
  const [errorMsg, setErrorMsg] = useState('');
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // ─── Cleanup — detiene cámara, ZXing y interval ───────────────────────────
  function cleanup() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (videoRef.current) {
      const stream = videoRef.current.srcObject as MediaStream | null;
      stream?.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
  }

  // ─── Inicia detección con BarcodeDetector API (nativa Chrome Android) ──────
  async function startNativeDetector() {
    const video = videoRef.current!;

    // Obtener stream de cámara trasera
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play();
    setStatus('scanning');

    // Obtener formatos soportados por este browser
    let formats = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'code_93',
                   'upc_a', 'upc_e', 'pdf417', 'aztec', 'data_matrix', 'codabar', 'itf'];
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      const filtered = formats.filter(f => supported.includes(f));
      if (filtered.length > 0) formats = filtered;
    } catch { /* usar todos */ }

    const detector = new BarcodeDetector({ formats });

    intervalRef.current = setInterval(async () => {
      if (scannedRef.current) return;
      if (!video || video.readyState < video.HAVE_ENOUGH_DATA) return;
      try {
        const results = await detector.detect(video);
        if (results.length > 0 && results[0].rawValue) {
          handleDetected(results[0].rawValue);
        }
      } catch { /* frame skip */ }
    }, 250);
  }

  // ─── Inicia detección con @zxing/browser (fallback cross-browser) ───────────
  async function startZxingScanner() {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatReader();

    // decodeFromConstraints: ZXing maneja cámara + loop de detección internamente
    // El callback se llama cada vez que detecta un código (o cuando hay error de frame)
    const controls = await reader.decodeFromConstraints(
      {
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      videoRef.current!,
      (result, err) => {
        // err puede ser NotFoundException (no barcode in frame) — es normal, se ignora
        if (result && !scannedRef.current) {
          handleDetected(result.getText());
        }
      }
    );

    controlsRef.current = controls;
    setStatus('scanning');
  }

  // ─── Callback unificado ────────────────────────────────────────────────────
  function handleDetected(data: string) {
    if (scannedRef.current) return;
    scannedRef.current = true;
    cleanup();
    onScan(data);
  }

  // ─── Arranque principal ────────────────────────────────────────────────────
  async function startScanner() {
    setStatus('requesting');
    scannedRef.current = false;

    try {
      const useNative = typeof window !== 'undefined' && 'BarcodeDetector' in window;
      if (useNative) {
        await startNativeDetector();
      } else {
        await startZxingScanner();
      }
    } catch (err: any) {
      cleanup();
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setStatus('denied');
      } else {
        setErrorMsg(err?.message ?? 'Error desconocido al iniciar la cámara');
        setStatus('error');
      }
    }
  }

  // ─── Efecto: arrancar / limpiar al abrir/cerrar modal ─────────────────────
  useEffect(() => {
    if (visible) {
      startScanner();
    } else {
      cleanup();
      setStatus('requesting');
    }
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ─── Animación línea de escaneo ────────────────────────────────────────────
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

  const translateY = scanLineAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 230] });

  if (!visible) return null;

  // ─── Permiso denegado ──────────────────────────────────────────────────────
  if (status === 'denied') {
    return (
      <Modal visible animationType="slide" transparent={false} onRequestClose={onClose}>
        <View style={[styles.center, { backgroundColor: colors.bg }]}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="camera-off" size={48} color={colors.danger} style={styles.icon} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Permiso de Cámara Denegado</Text>
            <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
              Ve a Configuración del navegador → Permisos del sitio y permite el acceso a la cámara.
            </Text>
            <Pressable style={[styles.btnPrimary, { backgroundColor: colors.primary }]} onPress={onClose}>
              <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // ─── Error genérico ────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <Modal visible animationType="slide" transparent={false} onRequestClose={onClose}>
        <View style={[styles.center, { backgroundColor: colors.bg }]}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="alert-triangle" size={48} color={colors.danger} style={styles.icon} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Error al iniciar la cámara</Text>
            <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>{errorMsg}</Text>
            <Pressable style={[styles.btnPrimary, { backgroundColor: colors.primary }]} onPress={onClose}>
              <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // ─── Vista de cámara ──────────────────────────────────────────────────────
  return (
    <Modal visible animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Elemento <video> nativo — ZXing escribe el stream aquí */}
        {/* @ts-ignore — video es un elemento nativo web, no un componente RN */}
        <video
          ref={videoRef}
          style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
          }}
          playsInline
          muted
          autoPlay
        />

        {/* Spinner mientras inicia */}
        {status === 'requesting' && (
          <View style={[StyleSheet.absoluteFillObject, styles.loadingOverlay]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: '#fff' }]}>Iniciando cámara…</Text>
          </View>
        )}

        {/* Overlay de UI del scanner */}
        {status === 'scanning' && (
          <View style={styles.overlayWrap} pointerEvents="box-none">
            {/* Franja oscura superior */}
            <View style={styles.overlayRow} pointerEvents="none" />

            {/* Fila del medio: oscuro | transparente | oscuro */}
            <View style={styles.overlayMid} pointerEvents="none">
              <View style={styles.overlayCol} />
              <View style={[styles.targetBox, { borderColor: colors.primary }]}>
                <View style={[styles.corner, styles.tl, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.tr, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.bl, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.br, { borderColor: colors.primary }]} />
                <Animated.View
                  style={[styles.scanLine, { backgroundColor: colors.primary, transform: [{ translateY }] }]}
                />
              </View>
              <View style={styles.overlayCol} />
            </View>

            {/* Franja oscura inferior con texto y botón */}
            <View style={styles.overlayRow}>
              <Text style={styles.instrText}>Apunta la cámara al código de barras o QR</Text>
              <PressableScale
                style={[styles.btnClose, { borderColor: colors.border }]}
                onPress={() => { cleanup(); onClose(); }}
              >
                <Feather name="x" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.btnCloseText}>Cerrar Escáner</Text>
              </PressableScale>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#000' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card:        { width: '100%', maxWidth: 380, borderRadius: 16, borderWidth: 1, padding: 24, alignItems: 'center', elevation: 8 },
  icon:        { marginBottom: 16 },
  cardTitle:   { fontSize: scaleFont(18), fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center', marginBottom: 12 },
  cardSubtitle:{ fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(20), marginBottom: 24 },
  btnPrimary:  { height: 48, borderRadius: 10, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  btnPrimaryText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  loadingOverlay: { backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText:    { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_400Regular' },

  overlayWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  overlayRow:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  overlayMid:  { height: 250, flexDirection: 'row' },
  overlayCol:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },

  targetBox: { width: 250, height: 250, borderWidth: 1, position: 'relative', backgroundColor: 'transparent' },
  corner:    { position: 'absolute', width: 22, height: 22 },
  tl: { top: 0,    left: 0,  borderTopWidth: 4,    borderLeftWidth: 4 },
  tr: { top: 0,    right: 0, borderTopWidth: 4,    borderRightWidth: 4 },
  bl: { bottom: 0, left: 0,  borderBottomWidth: 4, borderLeftWidth: 4 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },
  scanLine: { position: 'absolute', left: 10, right: 10, height: 3 },

  instrText:   { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_500Medium', textAlign: 'center', marginBottom: 20, color: '#fff' },
  btnClose:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 24, borderWidth: 1, paddingHorizontal: 24, backgroundColor: 'rgba(20,20,20,0.9)' },
  btnCloseText:{ fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold', color: '#fff' },
});
