import { scaleFont } from '../../src/theme/responsive';
import React, { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
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
import { PressableScale } from '../../src/components/PressableScale';

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
  // Solo seleccionamos el setter (referencia estable). Suscribirse al valor
  // `scrollOffsetReportes` re-renderizaba toda la pantalla en cada frame de
  // scroll (~60 fps). El valor solo se necesita al recuperar foco, así que
  // se lee con getState() sin suscripción.
  const setScrollOffsetReportes = useInventarioStore(s => s.setScrollOffsetReportes);
  const { width: screenW } = useWindowDimensions();
  const isNarrow = screenW < 420;
  const hasRestored = useRef(false);
  const scrollOffsetRef = useRef(0);

  const [period,    setPeriod]    = useState<Period>(30);
  const [chartMode, setChartMode] = useState<ChartMode>('items');
  const { data: roleData, isLoading: loadingRole } = useUserRole();
  const isAdmin = roleData?.role === 'admin';

  // Force 'items' mode for employees
  useEffect(() => {
    if (roleData && !isAdmin) {
      setChartMode('items');
    }
  }, [roleData, isAdmin]);
  const [refreshing, setRefreshing] = useState(false);

  // Restaurar scroll al entrar (solo una vez por enfoque).
  // Leemos el offset guardado una sola vez con getState() sin suscripción.
  useFocusEffect(
    useCallback(() => {
      scrollOffsetRef.current = useInventarioStore.getState().scrollOffsetReportes;
      const offset = scrollOffsetRef.current;
      if (!hasRestored.current && offset > 0 && scrollRef.current) {
        const timer = setTimeout(() => {
          scrollRef.current?.scrollTo({ y: offset, animated: false });
          hasRestored.current = true;
        }, 100);
        return () => clearTimeout(timer);
      }
      return () => {
        hasRestored.current = false;
      };
    }, []) // Estable: solo corre al ganar foco
  );

  const { data: daily = [], isLoading: loadingDaily } = useProfitDaily(period);

  // Memoize total calculations to avoid heavy lifting on every render
  // Renamed to reportTotals to avoid any potential collision
  const reportTotals = useMemo(() => daily.reduce(
    (acc, d) => ({
      ingreso:  acc.ingreso  + (d.ingreso_bruto || 0),
      ganancia: acc.ganancia + (d.ganancia || 0),
      ventas:   acc.ventas   + (d.num_ventas || 0),
      items:    acc.items    + (d.num_items || 0),
    }),
    { ingreso: 0, ganancia: 0, ventas: 0, items: 0 }
  ), [daily]);

  // Memoize sorting criteria
  const topOrderBy = useMemo(() => 
    chartMode === 'items' ? 'unidades_vendidas' : chartMode === 'ganancia' ? 'ganancia' : 'ingreso',
    [chartMode]
  );

  const { data: topProductos = [], isLoading: loadingTop  }  = useTopProductos(topOrderBy, period);

  // Save scroll only on end to avoid lag during scrolling
  const handleScrollEnd = (event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset >= 0) {
      setScrollOffsetReportes(offset);
    }
  };

  async function handleRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  if (loadingRole) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, isDesktop && styles.scrollDesktop]}
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        scrollEventThrottle={32}
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
        <View style={[
          styles.selectorsRow, 
          styles.padH,
          isNarrow && { flexDirection: 'column', alignItems: 'stretch', gap: 10 }
        ]}>
          <View style={[styles.periodGroup, isNarrow && { width: '100%' }]}>
            {PERIODS.map(p => {
              const active = period === p.value;
              return (
                <PressableScale
                  key={p.value}
                  style={[
                    styles.selectorBtn,
                    {
                      backgroundColor: active ? colors.primary  : colors.surfaceAlt,
                      borderColor:     active ? colors.primary  : colors.border,
                    },
                    isNarrow && { flex: 1, paddingVertical: 8 },
                  ]}
                  onPress={() => setPeriod(p.value)}
                >
                  <Text style={[
                    styles.selectorText,
                    { color: active ? colors.onPrimary : colors.textMuted },
                    isNarrow && { fontSize: scaleFont(10) }
                  ]}>
                    {p.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          {/* Chart mode toggle */}
          <View style={[
            styles.modeGroup,
            isNarrow && { width: '100%', flex: undefined, justifyContent: 'center' }
          ]}>
            {(['ganancia', 'ingreso', 'items'] as ChartMode[]).map(m => {
              const active = chartMode === m;
              if (!isAdmin && m !== 'items') return null;

              return (
                <PressableScale
                  key={m}
                  style={[
                    styles.selectorBtn,
                    {
                      backgroundColor: active ? colors.surfaceAlt : 'transparent',
                      borderColor:     active ? colors.border      : 'transparent',
                    },
                    isNarrow && (isAdmin ? { flex: 1, paddingVertical: 8 } : { paddingVertical: 8, paddingHorizontal: 16 }),
                  ]}
                  onPress={() => setChartMode(m)}
                >
                  <Text style={[
                    styles.selectorText,
                    { color: active ? colors.text : colors.textMuted },
                    isNarrow && { fontSize: scaleFont(10) }
                  ]}>
                    {m === 'ganancia' ? 'Ganancia' : m === 'ingreso' ? 'Ingresos' : 'Unidades'}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        {/* Summary row */}
        {!loadingDaily && (
          <View style={[styles.summaryRow, styles.padH]}>
            {isAdmin ? (
              <>
                {chartMode === 'items' ? (
                  <SummaryPill label="Items Vendidos" value={`${reportTotals.items}`} color={colors.text} />
                ) : (
                  <SummaryPill label="Ingresos"  value={formatUSD(reportTotals.ingreso)}  color={colors.text}    />
                )}
                <SummaryPill label="Ganancia"  value={formatUSD(reportTotals.ganancia)} color={reportTotals.ganancia >= 0 ? colors.primary : colors.danger} />
              </>
            ) : (
              <>
                <SummaryPill label="Items Vendidos" value={`${reportTotals.items}`} color={colors.text} />
                <SummaryPill label="Promedio Item/Venta" value={(reportTotals.items / (reportTotals.ventas || 1)).toFixed(1)} color={colors.primary} />
              </>
            )}
            <SummaryPill label="Facturas"  value={`${reportTotals.ventas}`}         color={colors.text}    />
          </View>
        )}

        {/* Top 4 Products High-Impact Chart */}
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
          {chartMode === 'items' ? 'Productos Más Vendidos (Top 4)' : chartMode === 'ganancia' ? 'Productos Más Rentables (Top 4)' : 'Productos Estrella (Top 4)'}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: 0 }]}>
          <TopProductsDonut data={topProductos} loading={loadingTop} mode={chartMode} />
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
          Top por {chartMode === 'items' ? 'unidades' : chartMode === 'ganancia' ? 'ganancia' : 'ingresos'} · últimos {period} días
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
            <ProductRow 
              key={p.codigo_producto} 
              product={p} 
              index={i} 
              mode={chartMode} 
              isAdmin={isAdmin}
            />
          ))
        }

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const SummaryPill = memo(({ label, value, color }: { label: string; value: string; color: string }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.pillLabel, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
      <Text style={[styles.pillValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
});

const ProductRow = memo(({ product, index, mode, isAdmin }: { product: any; index: number; mode: ChartMode; isAdmin: boolean }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.productRow, { borderColor: colors.border }]}>
      <Text style={[styles.rank, { color: colors.textMuted }]}>{index + 1}</Text>
      <View style={styles.productInfo}>
        <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
          {product.descripcion}
        </Text>
        <Text style={[styles.productMeta, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
          {product.unidades_vendidas} uds vendidas
        </Text>
      </View>
      <View style={styles.productAmounts}>
        {isAdmin ? (
          <>
            <CurrencyText amount={product.ingreso}   style={styles.amountText}      />
            <CurrencyText amount={product.ganancia}  style={styles.gananciaText}
              primary={product.ganancia >= 0}
              muted={product.ganancia < 0}
            />
          </>
        ) : (
          <Text style={[styles.amountText, { color: colors.text }]}>
            {product.unidades_vendidas} uds
          </Text>
        )}
      </View>
    </View>
  );
});

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
  title: { fontSize: scaleFont(26), fontFamily: 'JetBrainsMono_700Bold' },

  selectorsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  padH:    { paddingHorizontal: 16 },
  periodGroup: { flexDirection: 'row', gap: 4 },
  modeGroup:   { flexDirection: 'row', gap: 4, flex: 1, justifyContent: 'flex-end' },

  selectorBtn: {
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   6,
    paddingHorizontal: 10,
    minWidth:          40,
    alignItems:        'center',
  },
  selectorText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_500Medium' },

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
  pillLabel: { fontSize: scaleFont(9), fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  pillValue: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },

  sectionLabel: {
    fontSize:          scaleFont(11),
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
  emptyText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular' },

  productRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   10,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    gap:               10,
  },
  rank:         { fontSize: scaleFont(12), width: 20, textAlign: 'right', fontFamily: 'JetBrainsMono_400Regular' },
  productInfo:  { flex: 1, gap: 2 },
  productName:  { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium' },
  productMeta:  { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular' },
  productAmounts: { alignItems: 'flex-end', gap: 2 },
  amountText:   { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  gananciaText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular' },

  loadingRow: { paddingVertical: 24, alignItems: 'center' },
  bottomPad:  { height: 110 },
});
