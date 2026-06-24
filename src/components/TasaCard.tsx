import { scaleFont } from '../theme/responsive';
import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useTazas, calcBrecha } from '../hooks/useTazas';
import { Feather } from '@expo/vector-icons';

export function TasaCard() {
  const { colors } = useTheme();
  const { data: tasa, isLoading } = useTazas();

  if (isLoading) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (!tasa) return null;

  const brecha = calcBrecha(tasa);
  const isPositive = brecha > 0;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.row}>
          <Feather name="trending-up" size={14} color={colors.primary} />
          <Text style={[styles.title, { color: colors.textMuted }]}>Tasas de Cambio</Text>
        </View>
        <Text style={[styles.time, { color: colors.textMuted }]}>
          Actualizado: {new Date(tasa.created_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      <View style={styles.content}>
        <View style={styles.stat}>
          <Text style={[styles.label, { color: colors.textMuted }]}>BCV</Text>
          <Text style={[styles.value, { color: colors.text }]}>
            {tasa.bcv_usd.toFixed(2)}
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.stat}>
          <Text style={[styles.label, { color: colors.textMuted }]}>BINANCE</Text>
          <Text style={[styles.value, { color: colors.text }]}>
            {tasa.binance_p2p.toFixed(2)}
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.stat}>
          <Text style={[styles.label, { color: colors.textMuted }]}>BRECHA</Text>
          <View style={styles.brechaRow}>
            <Text style={[styles.brechaValue, { color: isPositive ? colors.danger : colors.success }]}>
              {isPositive ? '+' : ''}{brecha.toFixed(2)}%
            </Text>
            <Feather 
              name={isPositive ? 'arrow-up-right' : 'arrow-down-right'} 
              size={12} 
              color={isPositive ? colors.danger : colors.success} 
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 0.5,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  time: {
    fontSize: scaleFont(9),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  divider: {
    width: 0.5,
    height: 20,
    backgroundColor: '#333',
  },
  label: {
    fontSize: scaleFont(9),
    fontFamily: 'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
  },
  value: {
    fontSize: scaleFont(16),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  brechaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  brechaValue: {
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
