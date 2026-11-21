import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { scaleFont } from '../theme/responsive';
import { MAX_DOCUMENT_BYTES } from '../lib/facturaDocumento';
import { readPhotoBytes, type PickResult } from '../lib/facturaDocumentoPicker';
import { reportFacturaThrown } from '../lib/facturaTelemetry';
import { PressableScale } from './PressableScale';

export interface FacturaCamaraFotoProps {
  visible: boolean;
  /** Owner context guard: a result is emitted only while this still returns true. */
  estaVigente: () => boolean;
  onClose: () => void;
  onCapturada: (resultado: PickResult) => void;
  /** Camera cannot be used (web): the caller falls back to the file picker. */
  onNoDisponible?: () => void;
}

const FOTO_NOMBRE = 'foto-factura.jpg';

/**
 * Takes one invoice photo on explicit request. It only hands bytes to the caller: it never uploads,
 * reads the invoice or creates anything. A result that outlives its open generation, its owner context
 * or the component is dropped.
 */
export default function FacturaCamaraFoto(props: FacturaCamaraFotoProps): React.JSX.Element | null {
  const { visible } = props;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const live = useRef(props);
  live.current = props;
  const generation = useRef(0);
  const open = useRef(false);
  const capturing = useRef(false);
  const cameraRef = useRef<CameraView>(null);
  const [capturando, setCapturando] = useState(false);
  const [error, setError] = useState(false);
  const isWeb = Platform.OS === 'web';

  function vigente(mine: number): boolean {
    return open.current && mine === generation.current && live.current.estaVigente();
  }

  useEffect(() => {
    if (!visible) return;
    generation.current += 1;
    open.current = true;
    capturing.current = false;
    setCapturando(false);
    setError(false);
    if (isWeb && live.current.estaVigente()) (live.current.onNoDisponible ?? live.current.onClose)();
    return () => {
      open.current = false;
      generation.current += 1;
    };
  }, [visible]);

  useEffect(() => {
    if (visible && !isWeb && permission?.status === 'undetermined' && permission.canAskAgain) void requestPermission();
  }, [visible, permission, requestPermission]);

  async function capturar(): Promise<void> {
    const mine = generation.current;
    if (capturing.current || !vigente(mine)) return;
    capturing.current = true;
    setCapturando(true);
    setError(false);
    try {
      const camera = cameraRef.current;
      if (!camera) throw new Error('camera_unavailable');
      const picture = await camera.takePictureAsync({ quality: 0.8 });
      if (!vigente(mine)) return;
      const bytes = await readPhotoBytes(picture.uri);
      if (!vigente(mine)) return;
      live.current.onCapturada(
        bytes.length > MAX_DOCUMENT_BYTES
          ? { ok: false, error: 'El archivo supera el límite de 10 MB' }
          : { ok: true, bytes, nombre: FOTO_NOMBRE },
      );
    } catch (failure) {
      reportFacturaThrown('pick_document', failure);
      if (vigente(mine)) setError(true);
    } finally {
      if (mine === generation.current) {
        capturing.current = false;
        setCapturando(false);
      }
    }
  }

  if (!visible || isWeb) return null;

  function renderPermission(): React.JSX.Element {
    if (!permission) {
      return (
        <View style={[styles.center, { backgroundColor: colors.bg }]}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Preparando la cámara" />
        </View>
      );
    }
    const bloqueado = permission.canAskAgain === false;
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Feather name="camera-off" size={40} color={colors.danger} />
          <Text style={[styles.title, { color: colors.text }]}>Permiso de cámara requerido</Text>
          <Text selectable style={[styles.body, { color: colors.textMuted }]}>
            {bloqueado
              ? 'La cámara está bloqueada para esta app. Actívala en los ajustes del teléfono o sube la foto como archivo.'
              : 'Para fotografiar la factura necesitamos acceso a tu cámara.'}
          </Text>
          <View style={styles.actions}>
            {bloqueado ? null : (
              <PressableScale
                accessibilityRole="button"
                style={[styles.primary, { backgroundColor: colors.primary }]}
                onPress={() => { void requestPermission(); }}
              >
                <Text style={[styles.primaryText, { color: colors.onPrimary }]}>Permitir cámara</Text>
              </PressableScale>
            )}
            {props.onNoDisponible ? (
              <PressableScale
                accessibilityRole="button"
                style={[styles.secondary, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                onPress={props.onNoDisponible}
              >
                <Text style={[styles.secondaryText, { color: colors.text }]}>Subir foto o PDF</Text>
              </PressableScale>
            ) : null}
            <PressableScale
              accessibilityRole="button"
              style={[styles.secondary, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              onPress={props.onClose}
            >
              <Text style={[styles.secondaryText, { color: colors.text }]}>Cancelar</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    );
  }

  return (
    <Modal visible animationType="slide" transparent={false} onRequestClose={props.onClose}>
      {permission?.granted ? (
        <View style={[styles.container, { backgroundColor: colors.bg }]}>
          <CameraView ref={cameraRef} style={styles.camera} facing="back" />
          <View style={[styles.bar, { backgroundColor: colors.bg, paddingBottom: insets.bottom + 16 }]}>
            <Text style={[styles.hint, { color: colors.text }]}>Encuadra la factura completa y pulsa Tomar foto.</Text>
            {error ? (
              <Text selectable accessibilityLiveRegion="polite" style={[styles.error, { color: colors.danger }]}>
                No se pudo tomar la foto. Inténtalo de nuevo.
              </Text>
            ) : null}
            <View style={styles.actions}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Tomar foto"
                accessibilityState={{ busy: capturando, disabled: capturando }}
                disabled={capturando}
                dimmed={capturando}
                style={[styles.primary, { backgroundColor: colors.primary }]}
                onPress={() => { void capturar(); }}
              >
                <Feather name="camera" size={18} color={colors.onPrimary} />
                <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
                  {capturando ? 'Procesando…' : 'Tomar foto'}
                </Text>
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Cerrar cámara"
                style={[styles.secondary, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                onPress={props.onClose}
              >
                <Feather name="x" size={18} color={colors.text} />
                <Text style={[styles.secondaryText, { color: colors.text }]}>Cerrar</Text>
              </PressableScale>
            </View>
          </View>
        </View>
      ) : renderPermission()}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  camera: { flex: 1 },
  bar: { gap: 12, paddingHorizontal: 16, paddingTop: 16 },
  hint: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_500Medium', textAlign: 'center' },
  error: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium', textAlign: 'center' },
  actions: { gap: 12, width: '100%' },
  primary: { minHeight: 52, borderRadius: 12, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryText: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  secondary: { minHeight: 48, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  secondaryText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_500Medium' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: 16, borderWidth: 1, padding: 24, alignItems: 'center', gap: 16 },
  title: { fontSize: scaleFont(18), fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center' },
  body: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(20) },
});
