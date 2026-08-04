import { scaleFont } from '../../theme/responsive';
import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { saldoColor, saldoLabel } from '../../lib/creditos';
import type { CreditoCuenta } from '../../lib/supabase';

interface SaldoHeroProps {
  cuenta: CreditoCuenta;
}

/**
 * El número más importante de la pantalla. Todo lo demás en el detalle de
 * cuenta es contexto; esto es lo que el cobrador necesita leer de un vistazo,
 * imposible de malinterpretar.
 */
export function SaldoHero({ cuenta }: SaldoHeroProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const color = saldoColor(cuenta.saldo, colors);
  const tieneContacto = !!cuenta.telefono || !!cuenta.documento_id;

  return (
    <View style={styles.root}>
      <Text style={[styles.label, { color: colors.textMuted }]}>SALDO</Text>

      <Text style={[styles.monto, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {formatUSD(Math.abs(cuenta.saldo))}
      </Text>

      <Text style={[styles.estado, { color }]}>{saldoLabel(cuenta.saldo)}</Text>

      <View style={[styles.statsRow, { borderColor: colors.border }]}>
        <View style={styles.statCol}>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Se llevó</Text>
          <Text style={[styles.statValue, { color: colors.text }]} numberOfLines={1}>
            {formatUSD(cuenta.total_cargos)}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.statCol}>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Ha pagado</Text>
          <Text style={[styles.statValue, { color: colors.text }]} numberOfLines={1}>
            {formatUSD(cuenta.total_abonos)}
          </Text>
        </View>
      </View>

      {tieneContacto && (
        <Text style={[styles.contacto, { color: colors.textDim }]} numberOfLines={1}>
          {[cuenta.telefono, cuenta.documento_id].filter(Boolean).join('  ·  ')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  label: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  monto: {
    fontSize: scaleFont(40),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: -1,
  },
  estado: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 0.5,
    width: '100%',
    justifyContent: 'center',
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  divider: {
    width: 0.5,
    height: 28,
  },
  statLabel: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  statValue: {
    fontSize: scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  contacto: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop: 14,
  },
});
