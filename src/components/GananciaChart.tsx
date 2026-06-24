import { scaleFont } from '../theme/responsive';
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { useTheme } from '../theme/ThemeContext';
import type { ProfitDailyRow } from '../lib/supabase';

interface Props {
  data:  ProfitDailyRow[];
  mode?: 'ganancia' | 'ingreso' | 'items';
}

const SCREEN_W = Dimensions.get('window').width;
const CHART_W  = SCREEN_W - 32;

const DAYS_ES   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

/** USD compacto: $0, $245, $1.2K, $15K */
function formatCompactUSD(val: number | string): string {
  const num  = typeof val === 'string' ? parseFloat(val) : val;
  if (!num)  return '$0';
  const sign = num < 0 ? '-' : '';
  const abs  = Math.abs(num);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** Número compacto para unidades */
function formatCompactNumber(val: number | string): string {
  const num  = typeof val === 'string' ? parseFloat(val) : val;
  if (!num)  return '0';
  const abs  = Math.abs(num);
  if (abs >= 1000) return `${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  return `${Math.round(abs)}`;
}

/** USD legible para stats: $1,149 / $245 / -$50 */
function formatFullUSD(val: number): string {
  const sign = val < 0 ? '-' : '';
  const abs  = Math.abs(val);
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Número legible para unidades */
function formatFullNumber(val: number): string {
  return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatBarDate(iso: string, totalPoints: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = new Date(y, m - 1, d);
  if (totalPoints <= 8) return `${DAYS_ES[date.getDay()]} ${d}`;
  return `${d} ${MONTHS_ES[m - 1]}`;
}

function GananciaChartBase({ data, mode = 'ganancia' }: Props) {
  const { colors } = useTheme();

  // Toda la agregación (slice, peak, promedio, barData) se computa una sola vez
  // por cambio de datos/modo. El dashboard re-renderiza con frecuencia y, sin
  // esto, gifted-charts reconstruiría las barras en cada render.
  const model = useMemo(() => {
    if (!data.length) return null;

    const slice  = data.slice(-30);
    const values = slice.map(d => (
      mode === 'items' ? d.num_items : (mode === 'ganancia' ? d.ganancia : d.ingreso_bruto)
    ));
    const maxAbs = Math.max(...values.map(Math.abs), 1);

    // Promedio sobre días con actividad (no infla con domingos cerrados)
    const active = values.filter(v => Math.abs(v) > 0.01);
    const avg    = active.length > 0
      ? active.reduce((s, v) => s + v, 0) / active.length
      : 0;

    // Peak: día más fuerte del período
    const peakIdx  = values.reduce(
      (best, v, i) => (Math.abs(v) > Math.abs(values[best]) ? i : best),
      0,
    );
    const peakVal  = values[peakIdx];
    const peakDate = formatBarDate(slice[peakIdx].dia, slice.length);

    const barData = slice.map(d => {
      const raw   = mode === 'items' ? d.num_items : (mode === 'ganancia' ? d.ganancia : d.ingreso_bruto);
      const isNeg = raw < 0;
      return {
        value:      Math.abs(raw),
        label:      formatBarDate(d.dia, slice.length),
        frontColor: isNeg ? colors.danger : colors.primary,
      };
    });

    return { maxAbs, avg, peakVal, peakDate, barData };
  }, [data, mode, colors.danger, colors.primary]);

  if (!model) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Sin datos para el período</Text>
      </View>
    );
  }

  const { maxAbs, avg, peakVal, peakDate, barData } = model;

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {/* ── Stats header: insights clave SIEMPRE visibles ── */}
      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text style={[styles.statLabel, { color: colors.textMuted }]} numberOfLines={1}>
            Mejor día
          </Text>
          <View style={styles.statRow}>
            <Text style={[styles.statValue, { color: colors.primary }]} numberOfLines={1}>
              {mode === 'items' ? formatFullNumber(peakVal) : formatFullUSD(peakVal)}
            </Text>
            <Text style={[styles.statContext, { color: colors.textMuted }]} numberOfLines={1}>
              · {peakDate}
            </Text>
          </View>
        </View>
        <View style={[styles.statBlock, { alignItems: 'flex-end' }]}>
          <Text style={[styles.statLabel, { color: colors.textMuted }]} numberOfLines={1}>
            Promedio
          </Text>
          <Text style={[styles.statValue, { color: colors.text }]} numberOfLines={1}>
            {mode === 'items' ? formatFullNumber(avg) : formatFullUSD(avg)}
          </Text>
        </View>
      </View>

      <BarChart
        data={barData}
        width={CHART_W - 80}
        height={140}
        barWidth={20}
        spacing={10}
        noOfSections={3}
        maxValue={maxAbs * 1.1}

        hideRules
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={colors.border}
        yAxisColor="transparent"
        yAxisTextStyle={{
          color:      colors.textMuted,
          fontSize:   scaleFont(10),
          fontFamily: 'JetBrainsMono_500Medium',
          opacity:    0.85,
        }}
        xAxisLabelTextStyle={{
          color:      colors.textMuted,
          fontSize:   scaleFont(10),
          fontFamily: 'JetBrainsMono_500Medium',
          opacity:    0.95,
        }}
        formatYLabel={mode === 'items' ? formatCompactNumber : formatCompactUSD}

        isAnimated={false}
        frontColor={colors.primary}
        initialSpacing={10}
        roundedTop
        barBorderTopLeftRadius={4}
        barBorderTopRightRadius={4}

        // ── Línea de promedio (sin label embebido — el header arriba ya lo dice) ──
        showReferenceLine1
        referenceLine1Position={Math.abs(avg)}
        referenceLine1Config={{
          color:     colors.textMuted,
          dashWidth: 3,
          dashGap:   4,
          thickness: 0.8,
          labelText: '',
        }}
      />
    </View>
  );
}

/**
 * `React.memo`: el dashboard re-renderiza con frecuencia. La comparación shallow
 * basta — `data` es referencia estable del cache de TanStack Query.
 */
export const GananciaChart = React.memo(GananciaChartBase);

const styles = StyleSheet.create({
  wrap: {
    borderRadius:     14,
    borderWidth:      0.5,
    paddingHorizontal: 16,
    paddingTop:       14,
    paddingBottom:    16,
    marginHorizontal: 16,
    overflow:         'hidden',
  },
  empty: {
    borderRadius:     14,
    borderWidth:      0.5,
    padding:          32,
    marginHorizontal: 16,
    alignItems:       'center',
  },
  emptyText: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_400Regular',
  },

  // ── Stats header row ──
  statsRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
    marginBottom:   14,
    gap:            12,
  },
  statBlock: {
    flex:        1,
    gap:         2,
  },
  statLabel: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    opacity:       0.85,
  },
  statRow: {
    flexDirection: 'row',
    alignItems:    'baseline',
    gap:           4,
  },
  statValue: {
    fontSize:      scaleFont(18),
    fontFamily:    'JetBrainsMono_700Bold',
    letterSpacing: -0.4,
  },
  statContext: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_500Medium',
  },
});
