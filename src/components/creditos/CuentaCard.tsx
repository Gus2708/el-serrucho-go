import { scaleFont } from '../../theme/responsive';
import React, { memo, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { FadeIn } from '../FadeIn';
import { PressableScale } from '../PressableScale';
import { pressScale, staggerDelay } from '../../theme/motion';
import { saldoColor, saldoLabel, antiguedad } from '../../lib/creditos';
import type { CreditoCuenta } from '../../lib/supabase';

interface CuentaCardProps {
  cuenta: CreditoCuenta;
  index: number;
  onPress: (id: number) => void;
}

/** Plural correcto: "1 movimiento" vs "3 movimientos". */
function movimientosLabel(num: number): string {
  return num === 1 ? '1 movimiento' : `${num} movimientos`;
}

function CuentaCardImpl({ cuenta, index, onPress }: CuentaCardProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const cerrada = cuenta.estado === 'cerrada';
  const color = saldoColor(cuenta.saldo, colors);
  const inicial = cuenta.nombre.trim().charAt(0).toUpperCase() || '?';

  // Dispatcher pattern: handler estable, solo depende del id + dispatcher.
  const handlePress = useCallback(() => onPress(cuenta.id), [onPress, cuenta.id]);

  const accessibilityLabel = `${cuenta.nombre}, ${saldoLabel(cuenta.saldo).toLowerCase()} ${formatUSD(Math.abs(cuenta.saldo))}`;

  return (
    <FadeIn delay={staggerDelay(index)}>
      <PressableScale
        activeScale={pressScale.row}
        onPress={handlePress}
        style={[
          styles.row,
          { backgroundColor: colors.surface, borderColor: colors.border },
          cerrada && styles.rowCerrada,
        ]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <View style={[styles.avatar, { backgroundColor: color + '1A' }]}>
          <Text style={[styles.avatarText, { color }]}>{inicial}</Text>
        </View>

        <View style={styles.body}>
          <Text style={[styles.nombre, { color: colors.text }]} numberOfLines={1}>
            {cuenta.nombre}
          </Text>
          <Text style={[styles.sub, { color: colors.textMuted }]} numberOfLines={1}>
            {antiguedad(cuenta.ultima_actividad_en)} · {movimientosLabel(cuenta.num_movimientos)}
          </Text>
        </View>

        <View style={styles.right}>
          <Text style={[styles.monto, { color }]} numberOfLines={1}>
            {formatUSD(Math.abs(cuenta.saldo))}
          </Text>
          <Text style={[styles.montoLabel, { color: colors.textMuted }]} numberOfLines={1}>
            {saldoLabel(cuenta.saldo)}
          </Text>
        </View>

        {cerrada && (
          <View style={[styles.badgeCerrada, { borderColor: colors.border }]}>
            <Text style={[styles.badgeCerradaText, { color: colors.textMuted }]}>CERRADA</Text>
          </View>
        )}
      </PressableScale>
    </FadeIn>
  );
}

// Memo con comparador propio: solo re-renderiza si cambian los campos que se pintan.
export const CuentaCard = memo(CuentaCardImpl, (prev, next) =>
  prev.cuenta.id === next.cuenta.id &&
  prev.cuenta.saldo === next.cuenta.saldo &&
  prev.cuenta.nombre === next.cuenta.nombre &&
  prev.cuenta.estado === next.cuenta.estado &&
  prev.cuenta.ultima_actividad_en === next.cuenta.ultima_actividad_en &&
  prev.cuenta.num_movimientos === next.cuenta.num_movimientos &&
  prev.onPress === next.onPress
);

const styles = StyleSheet.create({
  row: {
    flexDirection:     'row',
    alignItems:         'center',
    borderRadius:       14,
    borderWidth:        0.5,
    marginHorizontal:   16,
    marginBottom:       10,
    padding:            14,
    gap:                12,
  },
  rowCerrada: {
    opacity: 0.55,
  },
  avatar: {
    width:          44,
    height:         44,
    borderRadius:   22,
    alignItems:     'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize:   scaleFont(18),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  body: {
    flex: 1,
    gap:  3,
  },
  nombre: {
    fontSize:   scaleFont(14),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  sub: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  right: {
    alignItems: 'flex-end',
    gap:        2,
  },
  monto: {
    fontSize:   scaleFont(16),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  montoLabel: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  badgeCerrada: {
    position:          'absolute',
    top:                8,
    right:              8,
    borderWidth:        0.5,
    borderRadius:       6,
    paddingVertical:    2,
    paddingHorizontal:  6,
  },
  badgeCerradaText: {
    fontSize:      scaleFont(8),
    fontFamily:    'JetBrainsMono_700Bold',
    letterSpacing: 0.4,
  },
});
