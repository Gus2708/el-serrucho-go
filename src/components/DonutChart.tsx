import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';
import { useTheme } from '../theme/ThemeContext';

export interface VelocidadCounts {
  rapido:         number;
  lento:          number;
  sin_movimiento: number;
  total:          number;
}

interface Props {
  counts: VelocidadCounts;
}

export function DonutChart({ counts }: Props) {
  const { colors } = useTheme();

  const { rapido, lento, sin_movimiento, total } = counts;

  if (total === 0) {
    return (
      <View style={[styles.empty, { borderColor: colors.border }]}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Sin datos</Text>
      </View>
    );
  }

  const pieData = [
    { value: rapido,          color: colors.success, text: rapido > 0 ? `${rapido}` : '' },
    { value: lento,           color: colors.warning, text: lento  > 0 ? `${lento}`  : '' },
    { value: sin_movimiento,  color: colors.textDim, text: sin_movimiento > 0 ? `${sin_movimiento}` : '' },
  ].filter(d => d.value > 0);

  return (
    <View style={styles.wrap}>
      <PieChart
        data={pieData}
        donut
        radius={64}
        innerRadius={42}
        innerCircleColor={colors.surface}
        centerLabelComponent={() => (
          <View style={styles.center}>
            <Text style={[styles.centerNum, { color: colors.text }]}>{total}</Text>
            <Text style={[styles.centerLabel, { color: colors.textMuted }]}>SKUs</Text>
          </View>
        )}
        showText={false}
        strokeWidth={1}
        strokeColor={colors.surface}
      />

      <View style={styles.legend}>
        <LegendItem color={colors.success} label="Rápido" count={rapido} total={total} />
        <LegendItem color={colors.warning} label="Lento"  count={lento}  total={total} />
        <LegendItem color={colors.textDim} label="Sin mov." count={sin_movimiento} total={total} />
      </View>
    </View>
  );
}

function LegendItem({
  color, label, count, total,
}: { color: string; label: string; count: number; total: number }) {
  const { colors } = useTheme();
  const pct = total > 0 ? ((count / total) * 100).toFixed(0) : '0';
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.legendLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.legendPct, { color: colors.text }]}>{pct}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            24,
    paddingLeft:    8,
  },
  center: {
    alignItems: 'center',
  },
  centerNum: {
    fontSize:   20,
    fontWeight: '700',
  },
  centerLabel: {
    fontSize: 10,
  },
  legend: {
    gap: 10,
    flex: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  dot: {
    width:        8,
    height:       8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 13,
    flex:      1,
  },
  legendPct: {
    fontSize:   13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    borderWidth:  0.5,
    borderRadius: 14,
    padding:      32,
    alignItems:   'center',
  },
  emptyText: {
    fontSize: 13,
  },
});
