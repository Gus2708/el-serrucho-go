import { useState, useCallback, useRef, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/theme/ThemeContext';
import { useInventarioStore } from '../../src/hooks/useInventarioStore';
import { useProfitDaily } from '../../src/hooks/useProfitSummary';
import { useTopProductos } from '../../src/hooks/useTopProductos';
import { useVelocidad } from '../../src/hooks/useVelocidad';
import { useDeviceSize } from '../../src/hooks/useDeviceSize';
import { useUserRole } from '../../src/hooks/useUserRole';
import { GananciaChart } from '../../src/components/GananciaChart';
import { TopProductsDonut } from '../../src/components/TopProductsDonut';
import { CurrencyText } from '../../src/components/CurrencyText';

type Period = 7 | 30 | 90;
type ChartMode = 'ganancia' | 'ingreso' | 'items';

const PERIODS: { value: Period; label: string }[] = [
  { value: 7,  label: '7d'  },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

export default function Reportes() {
  const { colors, formatUSD } = useTheme();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const { isDesktop } = useDeviceSize();
  const { scrollOffsetReportes, setScrollOffsetReportes } = useInventarioStore();
  const { width: screenW } = useWindowDimensions();

  const [period,    setPeriod]    = useState<Period>(30);
  const [chartMode, setChartMode] = useState<ChartMode>('ganancia');
  const { data: roleData } = useUserRole();
  const isAdmin = roleData?.role === 'admin';

  // Force 'items' mode for employees
  useEffect(() => {
    if (roleData && !isAdmin) {
      setChartMode('items');
    }
  }, [roleData, isAdmin]);
  const [refreshing, setRefreshing] = useState(false);

  // Restaurar scroll al entrar
  useFocusEffect(
    useCallback(() => {
      if (scrollOffsetReportes > 0 && scrollRef.current) {
        const timer = setTimeout(() => {
          scrollRef.current?.scrollTo({ y: scrollOffsetReportes, animated: false });
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [scrollOffsetReportes])
  );

  // Guardar scroll al mover
  const handleScroll = (event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset >= 0) {
      setScrollOffsetReportes(offset);
    }
  };

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
      items:    acc.items    + (d.num_items || 0),
    }),
    { ingreso: 0, ganancia: 0, ventas: 0, items: 0 }
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, isDesktop && styles.scrollDesktop]}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
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
                <Text style={[styles.periodText, { color: active ? colors.onPrimary : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                  {p.label}
                </Text>
              </Pressable>
            );
          })}

          {/* Chart mode toggle */}
          <View style={styles.spacer} />
          {isAdmin && (['ganancia', 'ingreso'] as ChartMode[]).map(m => {
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
                <Text style={[styles.periodText, { color: active ? colors.text : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                  {m === 'ganancia' ? 'Ganancia' : 'Ingresos'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Summary row */}
        {!loadingDaily && (
          <View style={[styles.summaryRow, styles.padH]}>
            {isAdmin ? (
              <>
                <SummaryPill label="Ingresos"  value={formatUSD(totals.ingreso)}  color={colors.text}    />
                <SummaryPill label="Ganancia"  value={formatUSD(totals.ganancia)} color={totals.ganancia >= 0 ? colors.primary : colors.danger} />
              </>
            ) : (
              <>
                <SummaryPill label="Items Vendidos" value={`${totals.items}`} color={colors.text} />
                <SummaryPill label="Promedio Item/Venta" value={(totals.items / (totals.ventas || 1)).toFixed(1)} color={colors.primary} />
              </>
            )}
            <SummaryPill label="Facturas"  value={`${totals.ventas}`}         color={colors.text}    />
          </View>
        )}

        {/* Top 4 Products High-Impact Chart */}
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
          Productos Estrella (Top 4)
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: 0 }]}>
          <TopProductsDonut data={topProductos} loading={loadingTop} useUnits={!isAdmin} />
        </View>

        {/* Main Trends Chart */}
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
          Tendencia de {chartMode === 'ganancia' ? 'Ganancia' : chartMode === 'ingreso' ? 'Ingresos' : 'Unidades'}
        </Text>
        <View style={isDesktop ? styles.chartsRowDesktop : undefined}>
          <View style={isDesktop ? { flex: 1 } : undefined}>
            {loadingDaily
              ? <View style={styles.loadingRow}><ActivityIndicator color={colors.primary} /></View>
              : <GananciaChart data={daily} mode={chartMode} />
            }
          </View>
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
              <Text style={[styles.rank, { color: colors.textMuted }]}>{i + 1}</Text>
              <View style={styles.productInfo}>
                <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                  {p.descripcion}
                </Text>
                <Text style={[styles.productMeta, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                  {p.unidades_vendidas} uds vendidas
                </Text>
              </View>
              <View style={styles.productAmounts}>
                {isAdmin ? (
                  <>
                    <CurrencyText amount={p.ingreso}   style={styles.amountText}      />
                    <CurrencyText amount={p.ganancia}  style={styles.gananciaText}
                      primary={p.ganancia >= 0}
                      muted={p.ganancia < 0}
                    />
                  </>
                ) : (
                  <Text style={[styles.amountText, { color: colors.text }]}>
                    {p.unidades_vendidas} uds
                  </Text>
                )}
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
      <Text style={[styles.pillLabel, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
      <Text style={[styles.pillValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1 },
  scroll: { gap: 16, paddingBottom: 20 },
  scrollDesktop: {
    maxWidth: 1000,
    alignSelf: 'center',
    width: '100%',
    paddingTop: 20,
  },

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
  chartsRowDesktop: {
    flexDirection: 'row',
    gap:           16,
    paddingHorizontal: 16,
    marginTop:     8,
  },
  pill: {
    flex:          1,
    borderRadius:  16,
    borderWidth:   0.5,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems:    'center',
    gap:           6,
  },
  pillLabel: { fontSize: 9, fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  pillValue: { fontSize: 16, fontFamily: 'JetBrainsMono_700Bold' },

  sectionLabel: {
    fontSize:          11,
    fontFamily:        'JetBrainsMono_500Medium',
    textTransform:     'uppercase',
    letterSpacing:     0.8,
    paddingHorizontal: 16,
    marginTop:         12,
    marginBottom:      4,
  },

  card: {
    marginHorizontal: 16,
    borderRadius:     24,
    borderWidth:      0.5,
    padding:          20,
    overflow:         'hidden',
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
