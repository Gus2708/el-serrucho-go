import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/theme/ThemeContext';
import { useProfitDaily } from '../../src/hooks/useProfitSummary';
import { useTopProductos } from '../../src/hooks/useTopProductos';
import { useVelocidad } from '../../src/hooks/useVelocidad';
import { GananciaChart } from '../../src/components/GananciaChart';
import { DonutChart } from '../../src/components/DonutChart';
import { CurrencyText } from '../../src/components/CurrencyText';

type Period = 7 | 30 | 90;
type ChartMode = 'ganancia' | 'ingreso';

const PERIODS: { value: Period; label: string }[] = [
  { value: 7,  label: '7d'  },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

export default function ReportesScreen() {
  const { colors, formatUSD } = useTheme();
  const queryClient = useQueryClient();

  const [period,    setPeriod]    = useState<Period>(30);
  const [chartMode, setChartMode] = useState<ChartMode>('ganancia');
  const [refreshing, setRefreshing] = useState(false);

  const { data: daily      = [], isLoading: loadingDaily }   = useProfitDaily(period);
  const { data: topProductos = [], isLoading: loadingTop  }  = useTopProductos();
  const { data: velocidad,       isLoading: loadingVel   }   = useVelocidad();

  async function handleRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  // Compute totals from the daily slice
  const totals = daily.reduce(
    (acc, d) => ({
      ingreso:  acc.ingreso  + d.ingreso_bruto,
      ganancia: acc.ganancia + d.ganancia,
      ventas:   acc.ventas   + d.num_ventas,
    }),
    { ingreso: 0, ganancia: 0, ventas: 0 }
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Reportes</Text>
        </View>

        {/* Period selector */}
        <View style={[styles.row, styles.padH]}>
          {PERIODS.map(p => {
            const active = period === p.value;
            return (
              <Pressable
                key={p.value}
                style={({ pressed }) => [
                  styles.periodBtn,
                  {
                    backgroundColor: active ? colors.primary  : colors.surfaceAlt,
                    borderColor:     active ? colors.primary  : colors.border,
                  },
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => setPeriod(p.value)}
              >
                <Text style={[styles.periodText, { color: active ? colors.onPrimary : colors.textMuted }]}>
                  {p.label}
                </Text>
              </Pressable>
            );
          })}

          {/* Chart mode toggle */}
          <View style={styles.spacer} />
          {(['ganancia', 'ingreso'] as ChartMode[]).map(m => {
            const active = chartMode === m;
            return (
              <Pressable
                key={m}
                style={({ pressed }) => [
                  styles.periodBtn,
                  {
                    backgroundColor: active ? colors.surfaceAlt : 'transparent',
                    borderColor:     active ? colors.border      : 'transparent',
                  },
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => setChartMode(m)}
              >
                <Text style={[styles.periodText, { color: active ? colors.text : colors.textDim }]}>
                  {m === 'ganancia' ? 'Ganancia' : 'Ingresos'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Summary row */}
        {!loadingDaily && (
          <View style={[styles.summaryRow, styles.padH]}>
            <SummaryPill label="Ingresos"  value={formatUSD(totals.ingreso)}  color={colors.text}    />
            <SummaryPill label="Ganancia"  value={formatUSD(totals.ganancia)} color={totals.ganancia >= 0 ? colors.primary : colors.danger} />
            <SummaryPill label="Facturas"  value={`${totals.ventas}`}         color={colors.text}    />
          </View>
        )}

        {/* Bar chart */}
        {loadingDaily
          ? <View style={styles.loadingRow}><ActivityIndicator color={colors.primary} /></View>
          : <GananciaChart data={daily} mode={chartMode} />
        }

        {/* Product velocity donut */}
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
          Velocidad de productos · 30 días
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {loadingVel
            ? <ActivityIndicator color={colors.primary} />
            : velocidad
            ? <DonutChart counts={velocidad} />
            : <Text style={[styles.emptyText, { color: colors.textMuted }]}>Sin datos</Text>
          }
        </View>

        {/* Top 20 products */}
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
          Top productos · últimos 30 días
        </Text>
        {loadingTop
          ? <View style={styles.loadingRow}><ActivityIndicator color={colors.primary} /></View>
          : topProductos.length === 0
          ? (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>Sin ventas registradas</Text>
            </View>
          )
          : topProductos.map((p, i) => (
            <View
              key={p.codigo_producto}
              style={[styles.productRow, { borderColor: colors.border }]}
            >
              <Text style={[styles.rank, { color: colors.textDim }]}>{i + 1}</Text>
              <View style={styles.productInfo}>
                <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>
                  {p.descripcion}
                </Text>
                <Text style={[styles.productMeta, { color: colors.textMuted }]}>
                  {p.unidades_vendidas} uds vendidas
                </Text>
              </View>
              <View style={styles.productAmounts}>
                <CurrencyText amount={p.ingreso}   style={styles.amountText}      />
                <CurrencyText amount={p.ganancia}  style={styles.gananciaText}
                  primary={p.ganancia >= 0}
                  muted={p.ganancia < 0}
                />
              </View>
            </View>
          ))
        }

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryPill({ label, value, color }: { label: string; value: string; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.pillLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.pillValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1 },
  scroll: { gap: 10 },

  header: {
    paddingHorizontal: 16,
    paddingTop:        12,
    paddingBottom:     4,
  },
  title: { fontSize: 26, fontFamily: 'JetBrainsMono_700Bold' },

  row:     { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  padH:    { paddingHorizontal: 16 },
  spacer:  { flex: 1 },

  periodBtn: {
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   6,
    paddingHorizontal: 14,
  },
  periodText: { fontSize: 12, fontFamily: 'JetBrainsMono_500Medium' },

  summaryRow: {
    flexDirection: 'row',
    gap:           8,
  },
  pill: {
    flex:          1,
    borderRadius:  12,
    borderWidth:   0.5,
    padding:       12,
    alignItems:    'center',
    gap:           3,
  },
  pillLabel: { fontSize: 10, fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.3 },
  pillValue: { fontSize: 13, fontFamily: 'JetBrainsMono_700Bold' },

  sectionLabel: {
    fontSize:          11,
    fontFamily:        'JetBrainsMono_500Medium',
    textTransform:     'uppercase',
    letterSpacing:     0.5,
    paddingHorizontal: 16,
    marginTop:         4,
  },

  card: {
    marginHorizontal: 16,
    borderRadius:     14,
    borderWidth:      0.5,
    padding:          16,
    alignItems:       'center',
  },
  emptyText: { fontSize: 13, fontFamily: 'JetBrainsMono_400Regular' },

  productRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   10,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    gap:               10,
  },
  rank:         { fontSize: 12, width: 20, textAlign: 'right', fontFamily: 'JetBrainsMono_400Regular' },
  productInfo:  { flex: 1, gap: 2 },
  productName:  { fontSize: 13, fontFamily: 'JetBrainsMono_500Medium' },
  productMeta:  { fontSize: 11, fontFamily: 'JetBrainsMono_400Regular' },
  productAmounts: { alignItems: 'flex-end', gap: 2 },
  amountText:   { fontSize: 13, fontFamily: 'JetBrainsMono_700Bold' },
  gananciaText: { fontSize: 11, fontFamily: 'JetBrainsMono_400Regular' },

  loadingRow: { paddingVertical: 24, alignItems: 'center' },
  bottomPad:  { height: 110 },
});
