import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image, type ImageLoadEventData } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { scaleFont } from '../theme/responsive';
import { isSafeHttpUrl } from '../utils/safeUrl';
import { PressableScale } from './PressableScale';

export interface DocumentoVisor {
  path: string;
  mime: string;
  sha256: string;
  nombre: string;
}

export interface FacturaDocumentoVisorProps {
  visible: boolean;
  documento: DocumentoVisor | null;
  /** Signs a new URL for the stored object. It is called on every open and every retry; the result is never cached here. */
  obtenerUrl: (path: string) => Promise<string>;
  /** Owner context guard: a signed URL is used only while this still returns true. */
  estaVigente: () => boolean;
  onClose: () => void;
  /** Called with a freshly signed image URL that passed every fence, so the caller can show a short-lived thumbnail. */
  onUrlLista?: (url: string) => void;
}

type Estado = { tipo: 'cargando' } | { tipo: 'imagen'; url: string } | { tipo: 'pdf' } | { tipo: 'error' };

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_PASO = 0.5;

interface Medida {
  width: number;
  height: number;
}

/**
 * Full-screen reader for the stored invoice photo or PDF. It only shows the document: it never reads the invoice,
 * saves anything or caches a URL. A signed URL that outlives its open, document, owner context or the component is dropped.
 */
export default function FacturaDocumentoVisor(props: FacturaDocumentoVisorProps): React.JSX.Element | null {
  const { visible, documento } = props;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const ventana = useWindowDimensions();
  const live = useRef(props);
  live.current = props;
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [intento, setIntento] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(ZOOM_MIN);
  const [natural, setNatural] = useState<Medida | null>(null);
  const [medida, setMedida] = useState<Medida | null>(null);

  const path = documento?.path;
  const sha256 = documento?.sha256;
  const mime = documento?.mime;

  useEffect(() => {
    const doc = live.current.documento;
    if (!visible || !doc) return;
    let activo = true;
    const vigente = (): boolean => activo && live.current.estaVigente();
    setEstado({ tipo: 'cargando' });
    setZoom(ZOOM_MIN);
    setNatural(null);
    void (async () => {
      try {
        const url = await live.current.obtenerUrl(doc.path);
        if (!vigente()) return;
        if (!isSafeHttpUrl(url)) throw new Error('unsafe_url');
        if (doc.mime === 'application/pdf') {
          await Linking.openURL(url.trim());
          if (vigente()) setEstado({ tipo: 'pdf' });
        } else {
          setEstado({ tipo: 'imagen', url: url.trim() });
          live.current.onUrlLista?.(url.trim());
        }
      } catch {
        if (vigente()) setEstado({ tipo: 'error' });
      }
    })();
    return () => {
      activo = false;
    };
    // Re-runs only when the viewer opens or the document identity changes; the latest callbacks come from `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, path, sha256, mime, intento]);

  if (!visible || !documento) return null;

  function reintentar(): void {
    setIntento(actual => actual + 1);
  }

  function renderCuerpo(): React.JSX.Element {
    if (estado.tipo === 'cargando') {
      return (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Cargando la factura" />
        </View>
      );
    }
    if (estado.tipo === 'error') {
      return (
        <View style={styles.centro}>
          <Feather name="alert-circle" size={36} color={colors.danger} />
          <Text accessibilityLiveRegion="polite" style={[styles.mensaje, { color: colors.danger }]}>No se pudo abrir la factura.</Text>
          <PressableScale
            onPress={reintentar}
            accessibilityRole="button"
            style={[styles.accion, { backgroundColor: colors.primary }]}
            testID="factura-visor-reintentar"
          >
            <Text style={[styles.accionTexto, { color: colors.onPrimary }]}>Reintentar</Text>
          </PressableScale>
        </View>
      );
    }
    if (estado.tipo === 'pdf') {
      return (
        <View style={styles.centro}>
          <Feather name="file-text" size={36} color={colors.primary} />
          <Text style={[styles.mensaje, { color: colors.text }]}>El PDF se abre en otra pestaña o app.</Text>
          <PressableScale
            onPress={reintentar}
            accessibilityRole="button"
            style={[styles.accion, { borderColor: colors.border, borderWidth: 1 }]}
            testID="factura-visor-reabrir"
          >
            <Text style={[styles.accionTexto, { color: colors.text }]}>Abrir otra vez</Text>
          </PressableScale>
        </View>
      );
    }

    const visor = { width: medida?.width ?? ventana.width, height: medida?.height ?? ventana.height };
    const ajuste = natural ? Math.min(visor.width / natural.width, visor.height / natural.height) : null;
    const base = natural && ajuste !== null ? { width: natural.width * ajuste, height: natural.height * ajuste } : visor;
    return (
      <ScrollView
        testID="factura-visor-pan-vertical"
        style={styles.flex}
        contentContainerStyle={styles.panVertical}
        showsVerticalScrollIndicator
      >
        <ScrollView
          horizontal
          testID="factura-visor-pan-horizontal"
          contentContainerStyle={styles.panHorizontal}
          showsHorizontalScrollIndicator
        >
          <Image
            testID="factura-visor-imagen"
            source={{ uri: estado.url }}
            style={{ width: base.width * zoom, height: base.height * zoom }}
            contentFit="contain"
            accessibilityLabel={`Factura ${documento?.nombre ?? ''}`}
            onLoad={(event: ImageLoadEventData) => setNatural({ width: event.source.width, height: event.source.height })}
            onError={() => setEstado({ tipo: 'error' })}
          />
        </ScrollView>
      </ScrollView>
    );
  }

  const conZoom = estado.tipo === 'imagen';
  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={props.onClose}>
      <View style={[styles.flex, { backgroundColor: colors.bg, paddingTop: insets.top }]} testID="factura-visor">
        <View style={[styles.cabecera, { borderBottomColor: colors.border }]}>
          <Text style={[styles.nombre, { color: colors.text }]} numberOfLines={1}>{documento.nombre}</Text>
          <PressableScale
            onPress={props.onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Cerrar visor"
            style={styles.cerrar}
            testID="factura-visor-cerrar"
          >
            <Feather name="x" size={22} color={colors.text} />
          </PressableScale>
        </View>

        <View
          style={styles.flex}
          onLayout={event => {
            const { width, height } = event.nativeEvent.layout;
            if (width > 0 && height > 0) setMedida({ width, height });
          }}
        >
          {renderCuerpo()}
        </View>

        {conZoom ? (
          <View style={[styles.controles, { borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
            <PressableScale
              onPress={() => setZoom(actual => Math.max(ZOOM_MIN, actual - ZOOM_PASO))}
              disabled={zoom <= ZOOM_MIN}
              dimmed={zoom <= ZOOM_MIN}
              accessibilityRole="button"
              accessibilityLabel="Alejar"
              accessibilityState={{ disabled: zoom <= ZOOM_MIN }}
              style={[styles.control, { borderColor: colors.border, backgroundColor: colors.surface }]}
              testID="factura-visor-alejar"
            >
              <Feather name="minus" size={20} color={colors.text} />
            </PressableScale>
            <Text style={[styles.zoom, { color: colors.textMuted }]} accessibilityLiveRegion="polite">{`${Math.round(zoom * 100)} %`}</Text>
            <PressableScale
              onPress={() => setZoom(actual => Math.min(ZOOM_MAX, actual + ZOOM_PASO))}
              disabled={zoom >= ZOOM_MAX}
              dimmed={zoom >= ZOOM_MAX}
              accessibilityRole="button"
              accessibilityLabel="Acercar"
              accessibilityState={{ disabled: zoom >= ZOOM_MAX }}
              style={[styles.control, { borderColor: colors.border, backgroundColor: colors.surface }]}
              testID="factura-visor-acercar"
            >
              <Feather name="plus" size={20} color={colors.text} />
            </PressableScale>
            <PressableScale
              onPress={() => setZoom(ZOOM_MIN)}
              accessibilityRole="button"
              accessibilityLabel="Ajustar a la pantalla"
              style={[styles.control, styles.ajustar, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]}
              testID="factura-visor-ajustar"
            >
              <Text style={[styles.ajustarTexto, { color: colors.primary }]}>Ajustar</Text>
            </PressableScale>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 8, borderBottomWidth: 0.5 },
  nombre: { flex: 1, fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  cerrar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  mensaje: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_500Medium', textAlign: 'center', lineHeight: scaleFont(20) },
  accion: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  accionTexto: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  panVertical: { flexGrow: 1, justifyContent: 'center' },
  panHorizontal: { flexGrow: 1, justifyContent: 'center' },
  controles: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 12, paddingHorizontal: 16, borderTopWidth: 0.5 },
  control: { minWidth: 48, minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ajustar: { paddingHorizontal: 16 },
  ajustarTexto: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  zoom: { minWidth: 56, textAlign: 'center', fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium', fontVariant: ['tabular-nums'] },
});
