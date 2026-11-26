import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { pressScale } from '../theme/motion';
import { PressableScale } from './PressableScale';
import type { EtapaRevision } from './FacturaRevisionView';

/** The guided three-step invoice journey; legacy `'leer'` maps to `'productos'`. */
export type PasoFactura = 'factura' | EtapaRevision;

type PasoVisible = 'factura' | 'productos' | 'compra';

const PASOS: ReadonlyArray<{ paso: PasoVisible; nombre: string }> = [
  { paso: 'factura', nombre: 'Factura' },
  { paso: 'productos', nombre: 'Productos' },
  { paso: 'compra', nombre: 'Compra' },
];

function normalizarPaso(paso: PasoFactura): PasoVisible {
  return paso === 'leer' ? 'productos' : paso;
}

interface FacturaPasosProps {
  seleccionado: PasoFactura;
  onSeleccionar: (paso: PasoFactura) => void;
  /** Steps that cannot be opened yet (for example the review before the invoice is saved). */
  deshabilitados?: readonly PasoFactura[];
}

export function FacturaPasos({ seleccionado, onSeleccionar, deshabilitados = [] }: FacturaPasosProps): React.JSX.Element {
  const { colors } = useTheme();
  const pasoActivo = normalizarPaso(seleccionado);
  const bloqueados = new Set<PasoVisible>(deshabilitados.map(normalizarPaso));

  return (
    <View style={[styles.pasos, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      {PASOS.map(({ paso, nombre }, index) => {
        const activo = paso === pasoActivo;
        const bloqueado = bloqueados.has(paso);
        let tinteBordeNumero = colors.textMuted;
        let colorNumero = colors.text;
        let colorNombre = colors.text;
        let fondoSegmento = 'transparent';
        let bordeSegmento = 'transparent';
        if (activo) {
          tinteBordeNumero = colors.primary;
          colorNumero = colors.onPrimary;
          colorNombre = colors.text;
          fondoSegmento = colors.primaryFaded;
          bordeSegmento = colors.primary;
        } else if (bloqueado) {
          tinteBordeNumero = colors.border;
          colorNumero = colors.textMuted;
          colorNombre = colors.textMuted;
        }

        return (
          <PressableScale
            key={paso}
            onPress={() => onSeleccionar(paso)}
            disabled={bloqueado}
            activeScale={pressScale.row}
            accessibilityRole="button"
            accessibilityLabel={`Paso ${index + 1}: ${nombre}`}
            accessibilityState={{ selected: activo, disabled: bloqueado }}
            testID={`factura-paso-${paso}`}
            style={[
              styles.paso,
              { backgroundColor: fondoSegmento, borderColor: bordeSegmento },
            ]}
          >
            <View
              style={[
                styles.numero,
                { borderColor: tinteBordeNumero, backgroundColor: activo ? colors.primary : 'transparent' },
              ]}
            >
              <Text style={[styles.numeroTexto, { color: colorNumero }]}>{index + 1}</Text>
            </View>
            <Text style={[styles.nombre, { color: colorNombre }, activo && styles.nombreActivo]} numberOfLines={1}>
              {nombre}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

type TonoEstado = 'neutro' | 'aviso' | 'ok';

interface FacturaEstadoPillProps {
  texto: string;
  tono?: TonoEstado;
}

const ICONO_ESTADO: Record<TonoEstado, React.ComponentProps<typeof Feather>['name']> = {
  neutro: 'circle',
  aviso: 'alert-circle',
  ok: 'check-circle',
};

/** Status label with an icon and text, so the state never depends on color alone. */
export function FacturaEstadoPill({ texto, tono = 'neutro' }: FacturaEstadoPillProps): React.JSX.Element {
  const { colors } = useTheme();
  const tintes: Record<TonoEstado, string> = { neutro: colors.textMuted, aviso: colors.warning, ok: colors.success };
  const tinte = tintes[tono];
  return (
    <View style={[styles.pill, { borderColor: tinte }]} testID="factura-estado-pill" accessibilityLiveRegion="polite">
      <Feather name={ICONO_ESTADO[tono]} size={12} color={tinte} />
      <Text style={[styles.pillTexto, { color: tinte }]}>{texto}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pasos: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 0.5 },
  paso: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 10,
  },
  numero: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  numeroTexto: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', fontVariant: ['tabular-nums'] },
  nombre: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium', flexShrink: 1 },
  nombreActivo: { fontFamily: 'JetBrainsMono_700Bold' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 0.5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillTexto: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_500Medium' },
});
