import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import type { ProfitDailyRow } from '../lib/supabase';

interface Props {
  data:    ProfitDailyRow[];
  mode?:   'ganancia' | 'ingreso';
}

const SCREEN_W = Dimensions.get('window').width;
const CHART_W  = SCREEN_W - 32; // 16px padding each side

export function GananciaChart({ data, mode = 'ganancia' }: Props) {
  const { colors } = useTheme();

  if (!data.length) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Sin datos para el período</Text>
      </View>
    );
  }

  // Show up to last 30 points so bars aren't too thin
  const slice   = data.slice(-30);
  const maxVal  = Math.max(...slice.map(d => mode === 'ganancia' ? d.ganancia : d.ingreso_bruto), 1);

  const barData = slice.map(d => {
    const raw   = mode === 'ganancia' ? d.ganancia : d.ingreso_bruto;
    const isNeg = raw < 0;
    return {
      value:       Math.abs(raw),
      label:       formatShortDate(d.dia),
      frontColor:  isNeg ? colors.danger : colors.primary,
      topLabelComponent: undefined,
    };
  });

  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border, minHeight: 180 }]}>
      <BarChart
        data={barData}
        width={CHART_W - 80}
        height={140}
        barWidth={18}
        spacing={12}
        noOfSections={3}
        maxValue={maxVal * 1.1}
        hideRules
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={colors.border}
        yAxisColor="transparent"
        yAxisTextStyle={{ color: colors.textDim, fontSize: 8, fontFamily: 'JetBrainsMono_400Regular' }}
        xAxisLabelTextStyle={{ color: colors.textDim, fontSize: 8, fontFamily: 'JetBrainsMono_400Regular' }}
        isAnimated={false}
        frontColor={colors.primary}
        initialSpacing={10}
        // ── Bordes superiores redondeados en cada barra ──
        roundedTop
        barBorderTopLeftRadius={4}
        barBorderTopRightRadius={4}
      />
    </View>
  );
}

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    borderWidth:  0.5,
    padding:      16,
    marginHorizontal: 16,
    overflow:     'hidden',
  },
  empty: {
    borderRadius: 14,
    borderWidth:  0.5,
    padding:      32,
    marginHorizontal: 16,
    alignItems:   'center',
  },
  emptyText: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
  },
});
