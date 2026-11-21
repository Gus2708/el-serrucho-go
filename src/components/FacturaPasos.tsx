import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { pressScale } from '../theme/motion';
import { PressableScale } from './PressableScale';
import type { EtapaRevision } from './FacturaRevisionView';

/** The guided invoice journey: the form first, then the three review stages. */
export type PasoFactura = 'factura' | EtapaRevision;

const PASOS: ReadonlyArray<{ paso: PasoFactura; nombre: string }> = [
  { paso: 'factura', nombre: 'Factura' },
  { paso: 'leer', nombre: 'Leer' },
  { paso: 'productos', nombre: 'Productos' },
  { paso: 'compra', nombre: 'Compra' },
];

interface FacturaPasosProps {
  seleccionado: PasoFactura;
  onSeleccionar: (paso: PasoFactura) => void;
  /** Steps that cannot be opened yet (for example the review before the invoice is saved). */
  deshabilitados?: readonly PasoFactura[];
}

export function FacturaPasos({ seleccionado, onSeleccionar, deshabilitados = [] }: FacturaPasosProps): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View style={styles.pasos}>
      {PASOS.map(({ paso, nombre }, index) => {
        const activo = paso === seleccionado;
        const bloqueado = deshabilitados.includes(paso);
        let tinte = colors.textMuted;
        if (activo) tinte = colors.primary;
        else if (bloqueado) tinte = colors.textDim;
        return (
          <PressableScale
            key={paso}
            onPress={() => onSeleccionar(paso)}
            disabled={bloqueado}
            dimmed={bloqueado}
            activeScale={pressScale.row}
            accessibilityRole="button"
            accessibilityLabel={`Paso ${index + 1}: ${nombre}`}
            accessibilityState={{ selected: activo, disabled: bloqueado }}
            testID={`factura-paso-${paso}`}
            style={styles.paso}
          >
            <View
              style={[
                styles.numero,
                { borderColor: tinte, backgroundColor: activo ? colors.primary : 'transparent' },
              ]}
            >
              <Text style={[styles.numeroTexto, { color: activo ? colors.onPrimary : tinte }]}>{index + 1}</Text>
            </View>
            <Text style={[styles.nombre, { color: tinte }, activo && styles.nombreActivo]} numberOfLines={1}>{nombre}</Text>
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
  pasos: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6 },
  paso: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 4 },
  numero: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  numeroTexto: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', fontVariant: ['tabular-nums'] },
  nombre: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_500Medium' },
  nombreActivo: { fontFamily: 'JetBrainsMono_700Bold' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 0.5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillTexto: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_500Medium' },
});
