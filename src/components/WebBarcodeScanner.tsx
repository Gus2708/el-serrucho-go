import { scaleFont } from '../theme/responsive';
/**
 * WebBarcodeScanner.tsx
 *
 * Scanner de códigos de barras 1D para la versión PWA/Web.
 *
 * Mejoras clave:
 * 1. Reutiliza el MediaStream activo entre escaneos mientras la PWA está en primer plano
 *    (pausa con track.enabled = false sin destruir el permiso con track.stop()) y persiste
 *    el deviceId de la cámara trasera en localStorage para que solo pida permiso una vez.
 * 2. Combina BarcodeDetector nativo (cuando soporta 1D) + @zxing/library con TRY_HARDER,
 *    recorte en la franja central de la retícula y doble binarizador (Hybrid + GlobalHistogram
 +    e inversión para etiquetas oscuras) sobre un único canvas reutilizable en 1080p con enfoque continuo.
 * 3. Integra controles de linterna (flash/torch) y zoom 1x/2x.
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
import { isStaleBundleError, STALE_BUNDLE_RELOAD_KEY } from '../lib/staleBundle';
import { cleanScannedBarcode } from '../lib/barcode';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

type ScannerStatus = 'requesting' | 'denied' | 'scanning' | 'error';

declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>;
  constructor(opts: { formats: string[] });
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<Array<{ rawValue: string; format: string }>>;
}

const CAMERA_DEVICE_STORAGE_KEY = 'serrucho_camera_device_id';
const CAMERA_GRANTED_STORAGE_KEY = 'serrucho_camera_granted';

const WEB_1D_FORMATS = [
  'ean_13',
  'ean_8',
  'code_128',
  'code_39',
  'code_93',
  'upc_a',
  'upc_e',
  'codabar',
  'itf',
];

let cachedStream: MediaStream | null = null;
let lifecycleListenersBound = false;

function hasLiveVideoTrack(stream: MediaStream | null): boolean {
  if (!stream) return false;
  const tracks = stream.getVideoTracks?.() ?? [];
  return tracks.length > 0 && tracks.some((t) => t.readyState === 'live');
}

function getActiveVideoTrack(stream: MediaStream | null): MediaStreamTrack | null {
  if (!stream) return null;
  const tracks = stream.getVideoTracks?.() ?? [];
  return tracks.find((t) => t.readyState === 'live') ?? tracks[0] ?? null;
}

function stopAndReleaseCachedStream(): void {
  if (!cachedStream) return;
  try {
    cachedStream.getTracks?.().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore track stop error */
      }
    });
  } finally {
    cachedStream = null;
  }
}

function bindStreamLifecycleListeners(): void {
  if (lifecycleListenersBound || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  if (typeof document.addEventListener !== 'function') {
    return;
  }
  lifecycleListenersBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopAndReleaseCachedStream();
    }
  });
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', stopAndReleaseCachedStream);
  }
}

export function resetWebScannerStreamForTests(): void {
  stopAndReleaseCachedStream();
}

function safeStorageGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    /* ignore storage errors */
  }
  return null;
}

function safeStorageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {
    /* ignore storage errors */
  }
}

function isDisallowedFormat(format?: string): boolean {
  const lower = (format || '').toLowerCase();
  return (
    lower.includes('qr') ||
    lower.includes('aztec') ||
    lower.includes('matrix') ||
    lower.includes('pdf417')
  );
}

interface BarcodeReaderEngine {
  decodeVideoFrame: (
    video: HTMLVideoElement,
    cropCenter: boolean,
    digitalScale: number,
    tryInverted: boolean,
  ) => Promise<string | null> | string | null;
}

async function createZxingWasmEngine(): Promise<BarcodeReaderEngine | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  try {
    const { readBarcodesFromImageData, setZXingModuleOverrides } = await import('zxing-wasm/reader');

    setZXingModuleOverrides({
      locateFile: (fileName: string) => {
        return `/${fileName}`;
      },
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!ctx) return null;

    return {
      async decodeVideoFrame(
        video: HTMLVideoElement,
        cropCenter: boolean,
        digitalScale: number,
      ): Promise<string | null> {
        const vw = video.videoWidth || 0;
        const vh = video.videoHeight || 0;
        if (vw < 64 || vh < 64) return null;

        const zoomFactor = digitalScale > 1 ? digitalScale : 1;
        const bandWidthRatio = (cropCenter ? 0.88 : 0.98) / zoomFactor;
        const bandHeightRatio = (cropCenter ? 0.44 : 0.85) / zoomFactor;

        const sw = Math.max(64, Math.floor(vw * bandWidthRatio));
        const sh = Math.max(48, Math.floor(vh * bandHeightRatio));
        const sx = Math.floor((vw - sw) / 2);
        const sy = Math.floor((vh - sh) / 2);

        const targetWidth = Math.min(sw, 960);
        const targetHeight = Math.max(48, Math.floor((sh * targetWidth) / sw));

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          canvas.width = targetWidth;
          canvas.height = targetHeight;
        }

        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
        const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);

        try {
          const results = await readBarcodesFromImageData(imgData, {
            formats: ['Linear-Codes'],
            tryHarder: true,
            tryRotate: true,
            tryInvert: true,
            maxNumberOfSymbols: 1,
          });

          if (results && results.length > 0) {
            const valid = results.find((r) => r.text && !isDisallowedFormat(r.format));
            if (valid?.text) {
              return valid.text;
            }
          }
        } catch {
          /* ignore frame errors */
        }

        return null;
      },
    };
  } catch (err) {
    console.warn('[WebBarcodeScanner] zxing-wasm unavailable, using fallback:', err);
    return null;
  }
}

async function createZxingJsEngine(): Promise<BarcodeReaderEngine | null> {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const {
    BarcodeFormat,
    BinaryBitmap,
    DecodeHintType,
    GlobalHistogramBinarizer,
    HybridBinarizer,
    LuminanceSource,
    MultiFormatOneDReader,
  } = await import('@zxing/library');

  class FastCanvasLuminanceSource extends LuminanceSource {
    private buffer: Uint8ClampedArray;

    constructor(buffer: Uint8ClampedArray, width: number, height: number) {
      super(width, height);
      this.buffer = buffer;
    }

    public getRow(y: number, row?: Uint8ClampedArray | null): Uint8ClampedArray {
      if (y < 0 || y >= this.getHeight()) {
        throw new Error('Requested row is outside the image: ' + y);
      }
      const width = this.getWidth();
      const start = y * width;
      if (!row || row.length < width) {
        return this.buffer.slice(start, start + width);
      }
      row.set(this.buffer.subarray(start, start + width));
      return row;
    }

    public getMatrix(): Uint8ClampedArray {
      return this.buffer;
    }

    public isRotateSupported(): boolean {
      return true;
    }

    public rotateCounterClockwise(): any {
      const width = this.getWidth();
      const height = this.getHeight();
      const newWidth = height;
      const newHeight = width;
      const newBuffer = new Uint8ClampedArray(newWidth * newHeight);

      for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
          const pixel = this.buffer[rowOffset + x];
          const newX = y;
          const newY = width - 1 - x;
          newBuffer[newY * newWidth + newX] = pixel;
        }
      }

      return new FastCanvasLuminanceSource(newBuffer, newWidth, newHeight);
    }

    public invert(): any {
      const len = this.buffer.length;
      const inverted = new Uint8ClampedArray(len);
      for (let i = 0; i < len; i++) {
        inverted[i] = 255 - this.buffer[i];
      }
      return new FastCanvasLuminanceSource(inverted, this.getWidth(), this.getHeight());
    }
  }

  function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
    const total = width * height;
    const gray = new Uint8ClampedArray(total);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
      gray[j] = (306 * rgba[i] + 601 * rgba[i + 1] + 117 * rgba[i + 2] + 512) >> 10;
    }
    return gray;
  }

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODABAR,
    BarcodeFormat.ITF,
    BarcodeFormat.RSS_14,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.ENABLE_CODE_39_EXTENDED_MODE, true);

  const reader = new MultiFormatOneDReader(hints);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext?.('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
  if (!ctx) return null;

  return {
    decodeVideoFrame(
      video: HTMLVideoElement,
      cropCenter: boolean,
      digitalScale: number,
      tryInverted: boolean,
    ): string | null {
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;
      if (vw < 64 || vh < 64) return null;

      const zoomFactor = digitalScale > 1 ? digitalScale : 1;
      const bandWidthRatio = (cropCenter ? 0.86 : 0.96) / zoomFactor;
      const bandHeightRatio = (cropCenter ? 0.42 : 0.75) / zoomFactor;

      const sw = Math.max(64, Math.floor(vw * bandWidthRatio));
      const sh = Math.max(48, Math.floor(vh * bandHeightRatio));
      const sx = Math.floor((vw - sw) / 2);
      const sy = Math.floor((vh - sh) / 2);

      const targetWidth = Math.min(sw, 960);
      const targetHeight = Math.max(48, Math.floor((sh * targetWidth) / sw));

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
      const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const gray = toGrayscale(imgData.data, targetWidth, targetHeight);
      const luminance = new FastCanvasLuminanceSource(gray, targetWidth, targetHeight);

      try {
        const res = reader.decode(new BinaryBitmap(new HybridBinarizer(luminance)), hints);
        const text = res?.getText?.()?.trim();
        if (text) return text;
      } catch {
        /* try GlobalHistogramBinarizer next */
      }

      try {
        const res = reader.decode(new BinaryBitmap(new GlobalHistogramBinarizer(luminance)), hints);
        const text = res?.getText?.()?.trim();
        if (text) return text;
      } catch {
        /* optionally try inverted luminance for light-on-dark labels */
      }

      if (tryInverted) {
        try {
          const inverted = luminance.invert();
          const res = reader.decode(new BinaryBitmap(new GlobalHistogramBinarizer(inverted)), hints);
          const text = res?.getText?.()?.trim();
          if (text) return text;
        } catch {
          /* frame had no readable barcode */
        }
      }

      return null;
    },
  };
}

async function createUnifiedEngine(): Promise<BarcodeReaderEngine | null> {
  const wasmEngine = await createZxingWasmEngine();
  if (wasmEngine) return wasmEngine;
  return createZxingJsEngine();
}

export function WebBarcodeScanner({ visible, onClose, onScan }: Props): React.JSX.Element | null {
  const { colors } = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scannedRef = useRef(false);
  const detectingRef = useRef(false);
  const frameTickRef = useRef(0);
  const cssZoomRef = useRef(false);
  const [status, setStatus] = useState<ScannerStatus>('requesting');
  const [errorMsg, setErrorMsg] = useState('');
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [useCssZoom, setUseCssZoom] = useState(false);
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  function updateCssZoom(value: boolean): void {
    cssZoomRef.current = value;
    setUseCssZoom(value);
  }

  function clearDetectionLoop(): void {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    detectingRef.current = false;
  }

  function pauseScanner(destroyStream: boolean = false): void {
    clearDetectionLoop();
    const track = getActiveVideoTrack(cachedStream);
    if (track) {
      try {
        track.applyConstraints?.({ advanced: [{ torch: false } as any] })?.catch?.(() => {});
      } catch {
        /* ignore torch reset error */
      }
      if (!destroyStream) {
        track.enabled = false;
      }
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        /* ignore detach error */
      }
    }
    if (destroyStream) {
      stopAndReleaseCachedStream();
    }
  }

  async function acquireOrReuseStream(): Promise<MediaStream> {
    bindStreamLifecycleListeners();

    if (hasLiveVideoTrack(cachedStream)) {
      const existingTrack = getActiveVideoTrack(cachedStream);
      if (existingTrack) {
        existingTrack.enabled = true;
      }
      return cachedStream!;
    }

    stopAndReleaseCachedStream();
    const savedDeviceId = safeStorageGet(CAMERA_DEVICE_STORAGE_KEY);

    const videoConstraints: MediaTrackConstraints = {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };
    if (savedDeviceId) {
      videoConstraints.deviceId = { ideal: savedDeviceId };
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false,
    });

    cachedStream = stream;
    const track = getActiveVideoTrack(stream);
    if (track) {
      const settings = track.getSettings?.() as MediaTrackSettings | undefined;
      if (settings?.deviceId) {
        safeStorageSet(CAMERA_DEVICE_STORAGE_KEY, settings.deviceId);
      }
      safeStorageSet(CAMERA_GRANTED_STORAGE_KEY, '1');

      try {
        const capabilities = track.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
        if (capabilities?.focusMode?.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
        }
      } catch {
        /* continuous focus optional */
      }
    }

    return stream;
  }

  async function toggleTorch(): Promise<void> {
    const nextTorch = !torch;
    const track = getActiveVideoTrack(cachedStream);
    if (track?.applyConstraints) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: nextTorch } as any],
        });
      } catch {
        /* continue so state reflects button press even if hardware ignores */
      }
    }
    setTorch(nextTorch);
  }

  async function toggleZoom(): Promise<void> {
    const nextZoom = zoom > 0 ? 0 : 1;
    const targetHardwareZoom = nextZoom > 0 ? 2 : 1;
    const track = getActiveVideoTrack(cachedStream);
    let appliedHardwareZoom = false;

    if (track?.applyConstraints) {
      try {
        const capabilities = track.getCapabilities?.() as (MediaTrackCapabilities & {
          zoom?: { min?: number; max?: number };
        }) | undefined;
        if (capabilities && 'zoom' in capabilities) {
          const minZoom = capabilities.zoom?.min ?? 1;
          const maxZoom = capabilities.zoom?.max ?? 2;
          const clampedZoom = nextZoom > 0 ? Math.min(maxZoom, Math.max(minZoom, targetHardwareZoom)) : minZoom;
          await track.applyConstraints({
            advanced: [{ zoom: clampedZoom } as any],
          });
          appliedHardwareZoom = true;
        }
      } catch {
        appliedHardwareZoom = false;
      }
    }

    updateCssZoom(!appliedHardwareZoom && nextZoom > 0);
    setZoom(nextZoom);
  }

  function handleDetected(rawValue: string): void {
    const clean = cleanScannedBarcode(rawValue);
    if (!clean || scannedRef.current) return;
    scannedRef.current = true;
    pauseScanner(false);
    onScan(clean);
  }

  async function startScanner(): Promise<void> {
    setStatus('requesting');
    setTorch(false);
    setZoom(0);
    updateCssZoom(false);
    scannedRef.current = false;
    frameTickRef.current = 0;

    try {
      async function initNativeDetector(): Promise<BarcodeDetector | null> {
        const hasNativeDetectorGlobal = typeof window !== 'undefined' && 'BarcodeDetector' in window;
        if (!hasNativeDetectorGlobal) return null;
        try {
          let formats = [...WEB_1D_FORMATS];
          const supported = await BarcodeDetector.getSupportedFormats();
          const filtered = WEB_1D_FORMATS.filter((f) => supported.includes(f));
          if (filtered.length > 0) {
            formats = filtered;
            return new BarcodeDetector({ formats });
          }
        } catch {
          return null;
        }
        return null;
      }

      const [nativeDetector, barcodeEngine] = await Promise.all([
        initNativeDetector(),
        createUnifiedEngine(),
      ]);

      const stream = await acquireOrReuseStream();
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute?.('playsinline', 'true');
        await video.play?.();
      }

      setStatus('scanning');
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(STALE_BUNDLE_RELOAD_KEY);
      }

      clearDetectionLoop();
      intervalRef.current = setInterval(async () => {
        if (scannedRef.current || detectingRef.current) return;
        const currentVideo = videoRef.current;
        if (!currentVideo) return;
        if (
          typeof currentVideo.HAVE_ENOUGH_DATA === 'number' &&
          currentVideo.readyState < currentVideo.HAVE_ENOUGH_DATA
        ) {
          return;
        }

        detectingRef.current = true;
        frameTickRef.current += 1;
        const tick = frameTickRef.current;
        const cropCenter = tick % 3 !== 0;
        const tryInverted = tick % 2 === 0;

        try {
          if (nativeDetector) {
            try {
              const results = await nativeDetector.detect(currentVideo);
              const valid = results.find((r) => r?.rawValue && !isDisallowedFormat(r.format));
              if (valid?.rawValue) {
                handleDetected(valid.rawValue);
                return;
              }
            } catch {
              /* fallback to ZXing on this frame */
            }
          }

          if (barcodeEngine && !scannedRef.current) {
            const decoded = await barcodeEngine.decodeVideoFrame(
              currentVideo,
              cropCenter,
              cssZoomRef.current ? 2 : 1,
              tryInverted,
            );
            if (decoded) {
              handleDetected(decoded);
            }
          }
        } finally {
          detectingRef.current = false;
        }
      }, 100);
    } catch (err: any) {
      const isPermissionDenied =
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      pauseScanner(isPermissionDenied);

      const staleBundle = isStaleBundleError(err);
      if (
        staleBundle &&
        typeof sessionStorage !== 'undefined' &&
        !sessionStorage.getItem(STALE_BUNDLE_RELOAD_KEY)
      ) {
        sessionStorage.setItem(STALE_BUNDLE_RELOAD_KEY, '1');
        window.location.reload();
        return;
      }

      if (isPermissionDenied) {
        setStatus('denied');
      } else {
        setErrorMsg(err?.message ?? 'Error desconocido al iniciar la cámara');
        setStatus('error');
      }
    }
  }

  useEffect(() => {
    if (visible) {
      startScanner();
    } else {
      pauseScanner(false);
      setTorch(false);
      setZoom(0);
      updateCssZoom(false);
      setStatus('requesting');
    }
    return () => {
      pauseScanner(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    if (visible && status === 'scanning') {
      scanLineAnim.setValue(0);
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
          Animated.timing(scanLineAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
        ])
      );
      anim.start();
    }
    return () => { anim?.stop(); };
  }, [visible, status, scanLineAnim]);

  const translateY = scanLineAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 142] });

  if (!visible) return null;

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

  return (
    <Modal visible animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* @ts-ignore — video es un elemento nativo web */}
        <video
          ref={videoRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: useCssZoom ? 'scale(2)' : 'scale(1)',
            transformOrigin: 'center center',
          }}
          playsInline
          muted
          autoPlay
        />

        {status === 'requesting' && (
          <View style={[StyleSheet.absoluteFillObject, styles.loadingOverlay]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: '#fff' }]}>Iniciando cámara…</Text>
          </View>
        )}

        {status === 'scanning' && (
          <View style={styles.overlayWrap} pointerEvents="box-none">
            <View style={styles.overlayRow} pointerEvents="none" />

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

            <View style={styles.overlayRow}>
              <Text style={styles.instrText}>Apunta la cámara al código de barras</Text>
              <View style={styles.controlButtonsRow}>
                <PressableScale
                  style={[
                    styles.controlBtn,
                    { backgroundColor: torch ? colors.primary : 'rgba(30,30,30,0.85)', borderColor: colors.border },
                  ]}
                  onPress={toggleTorch}
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
                  onPress={toggleZoom}
                  accessibilityRole="button"
                  accessibilityLabel={zoom > 0 ? 'Zoom 1x' : 'Zoom 2x'}
                >
                  <Text style={[styles.zoomText, { color: zoom > 0 ? colors.onPrimary : '#fff' }]}>
                    {zoom > 0 ? '2x' : '1x'}
                  </Text>
                </PressableScale>

                <PressableScale
                  style={[styles.btnClose, { borderColor: colors.border }]}
                  onPress={() => { pauseScanner(false); onClose(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar Escáner"
                >
                  <Feather name="x" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.btnCloseText}>Cerrar</Text>
                </PressableScale>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
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
  overlayMid:  { height: 160, flexDirection: 'row' },
  overlayCol:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },

  targetBox: { width: 310, height: 160, borderWidth: 1, position: 'relative', backgroundColor: 'transparent', borderRadius: 8 },
  corner:    { position: 'absolute', width: 22, height: 22 },
  tl: { top: 0,    left: 0,  borderTopWidth: 4,    borderLeftWidth: 4, borderTopLeftRadius: 8 },
  tr: { top: 0,    right: 0, borderTopWidth: 4,    borderRightWidth: 4, borderTopRightRadius: 8 },
  bl: { bottom: 0, left: 0,  borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 8 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 8 },
  scanLine: { position: 'absolute', left: 10, right: 10, height: 3 },

  instrText:   { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_500Medium', textAlign: 'center', marginBottom: 20, color: '#fff' },
  controlButtonsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  controlBtn:  { width: 48, height: 48, borderRadius: 24, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  zoomText:    { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  btnClose:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 24, borderWidth: 1, paddingHorizontal: 20, backgroundColor: 'rgba(30,30,30,0.85)' },
  btnCloseText:{ fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold', color: '#fff' },
});
