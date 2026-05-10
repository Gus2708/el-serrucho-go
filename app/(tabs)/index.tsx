import React, { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';

// Padding interior del bigCard (debe coincidir con `bigCard.padding` en styles)
const BIG_CARD_PADDING = 20;
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeContext';
import { useProfitSummary, useProfitDaily, useProfitHourly } from '../../src/hooks/useProfitSummary';
import { useUserRole } from '../../src/hooks/useUserRole';
import { SyncBadge } from '../../src/components/SyncBadge';
import { SparklineChart } from '../../src/components/SparklineChart';
import { GananciaChart } from '../../src/components/GananciaChart';
import { getLocalDateStr, getDateDaysAgo } from '../../src/lib/supabase';
import { TasaCard } from '../../src/components/TasaCard';

const logo = require('../../src/assets/img/EL SERRUCHO go.png');

type Period = 'dia' | 'ayer' | 'semana' | 'mes';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'dia',    label: 'Hoy'    },
  { key: 'ayer',   label: 'Ayer'   },
  { key: 'semana', label: 'Semana' },
  { key: 'mes',    label: 'Mes'    },
];

function LogoMark() {
  return (
    <View style={styles.logoImgWrap}>
      <Image source={logo} style={styles.logoImg} contentFit="contain" />
    </View>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function Index() {
  const { colors, formatUSD } = useTheme();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { width: screenW } = useWindowDimensions();
  const isDesktop = screenW >= 768;
  // BigCard outer width: on desktop it fills the content column minus margins
  const BIG_CARD_OUTER_W = screenW - 16 * 2;

  const [refreshing, setRefreshing] = useState(false);
  const [userName,   setUserName]   = useState('');
  const [period,     setPeriod]     = useState<Period>('mes');

  const todayStr     = useMemo(() => getLocalDateStr(), []);
  const yesterdayStr = useMemo(() => getDateDaysAgo(1), []);

  const { data: summary,      isLoading: loadingSum    } = useProfitSummary();
  const { data: daily7  = [], isLoading: loadingDaily7 } = useProfitDaily(7);
  // daily30 only needed when period === 'mes'; gate it.
  const { data: daily30 = [], isLoading: loadingDaily30 } = useProfitDaily(30, period === 'mes');
  // Hourly queries are expensive (24-bucket fill) — only run them when actually displayed.
  const { data: hourlyHoy   = [], isLoading: loadingHourlyHoy  } = useProfitHourly(todayStr,    period === 'dia');
  const { data: hourlyAyer  = [], isLoading: loadingHourlyAyer } = useProfitHourly(yesterdayStr, period === 'ayer');
  const { data: userAuth, isLoading: loadingRole } = useUserRole();
  const role = userAuth?.role ?? 'empleado';
  const profile = userAuth?.profile;
  const isAdmin = role === 'admin';
  const sessionUser = profile;

  useEffect(() => {
    if (profile?.display_name) {
      setUserName(profile.display_name);
    } else {
      setUserName('');
    }
  }, [profile]);

  async function handleRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  // ── Stats por período ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!summary) return { ganancia: 0, ingreso: 0, ventas: 0, items: 0, label: '' };
    switch (period) {
      case 'dia':
        return {
          ganancia: summary.ganancia_hoy,
          ingreso:  summary.ingreso_hoy,
          ventas:   summary.ventas_hoy,
          items:    summary.items_hoy,
          label:    'Ganancia hoy',
        };
      case 'ayer':
        return {
          ganancia: summary.ganancia_ayer,
          ingreso:  summary.ingreso_ayer,
          ventas:   summary.ventas_ayer,
          items:    summary.items_ayer,
          label:    'Ganancia ayer',
        };
      case 'semana':
        return {
          ganancia: summary.ganancia_semana,
          ingreso:  summary.ingreso_semana,
          ventas:   summary.ventas_semana,
          items:    summary.items_semana,
          label:    'Ganancia últimos 7 días',
        };
      case 'mes':
      default:
        return {
          ganancia: summary.ganancia_mes,
          ingreso:  summary.ingreso_mes,
          ventas:   summary.ventas_mes,
          items:    summary.items_mes,
          label:    'Ganancia últimos 30 días',
        };
    }
  }, [period, summary]);

  // ── Datos del sparkline por período ─────────────────────────────────────────
  // Día/Ayer: usa la tendencia por hora del día específico
  // Semana:   usa exactamente los últimos 7 días
  // Mes:      usa los últimos 30 días
  const chartData = useMemo(() => {
    if (period === 'mes')    return daily30;
    if (period === 'semana') return daily7;
    if (period === 'ayer')   return hourlyAyer;
    return hourlyHoy;
  }, [period, daily7, daily30, hourlyHoy, hourlyAyer]);

  const loadingChart = useMemo(() => {
    if (period === 'mes')    return loadingDaily30;
    if (period === 'semana') return loadingDaily7;
    if (period === 'ayer')   return loadingHourlyAyer;
    return loadingHourlyHoy;
  }, [period, loadingDaily30, loadingDaily7, loadingHourlyAyer, loadingHourlyHoy]);

  // KPIs del grid según período
  const kpiVentas = stats.ventas;

  const isNeg = stats.ganancia < 0;

  // Detección de bug del backend: cuando productos.costo = 0 para todos los
  // ítems, ganancia = ingreso (porque ganancia = ingreso − costo = ingreso − 0).
  // Es matemáticamente imposible en operación normal, así que es un signo
  // claro de que los costos no están sincronizados desde HybridLite.
  const costosPendientes =
    stats.ingreso > 0 && Math.abs(stats.ganancia - stats.ingreso) < 0.01;

  if (loadingRole && !userAuth) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textDim, marginTop: 12, fontSize: 12 }}>Cargando perfil...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {/* ── Logo strip ── */}
        <View style={styles.logoStrip}>
          <LogoMark />
          <View style={styles.logoWords}>
            <Text style={[styles.logoSub,  { color: colors.textDim  }]}>Ferretería</Text>
            <Text style={[styles.logoName, { color: colors.primary  }]}>El Serrucho GO</Text>
          </View>
          
          <View style={styles.headerActions}>
            <Pressable
              style={({ pressed }) => [styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
              onPress={() => router.push('/(tabs)/alertas')}
            >
              <Feather name="bell" size={18} color={colors.textMuted} />
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
              onPress={() => router.push('/perfil')}
            >
              <Feather name="user" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>

        {/* ── Greeting ── */}
        <View style={styles.greeting}>
          <Text style={[styles.greetSub,   { color: colors.textMuted }]}>
            {getGreeting()}{userName ? `, ${userName}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
            <Text style={[styles.greetTitle, { color: colors.text, flex: 1 }]} numberOfLines={1} adjustsFontSizeToFit>
              Estadísticas:
            </Text>
            {sessionUser?.email && (
              <Text style={{ fontSize: 9, color: colors.textDim, opacity: 0.6, marginBottom: 5 }}>
                {sessionUser.email}
              </Text>
            )}
          </View>
        </View>

        {/* ── SyncBadge ── */}
        <SyncBadge />

        {/* ── TasaCard ── */}
        <TasaCard />

        {/* ── Period toggle ── */}
        <View style={[styles.periodRow, isDesktop && styles.periodRowDesktop]}>
          {PERIODS.map(p => {
            const active = period === p.key;
            return (
              <Pressable
                key={p.key}
                style={({ pressed }) => [
                  isDesktop ? styles.periodBtnDesktop : styles.periodBtn,
                  {
                    backgroundColor: active ? colors.primary    : colors.surface,
                    borderColor:     active ? colors.primary    : colors.border,
                  },
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => setPeriod(p.key)}
              >
                <Text
                  style={[styles.periodText, { color: active ? colors.onPrimary : colors.textMuted }]}
                  numberOfLines={1}
                >
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── Big card ── */}
        {isAdmin && (
          <View style={[styles.bigCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.bigLabel, { color: colors.textMuted }]}>
              {/* Si los costos están pendientes, no podemos mostrar "Ganancia" */}
              {costosPendientes ? stats.label.replace('Ganancia', 'Ingreso') : stats.label}
            </Text>
            {loadingSum ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
            ) : (
              <Text style={[styles.bigValue, { color: isNeg ? colors.danger : colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
                {formatUSD(costosPendientes ? stats.ingreso : stats.ganancia)}
              </Text>
            )}
            {!loadingSum && (
              <Text style={[styles.bigSub, { color: colors.textDim }]} numberOfLines={1} adjustsFontSizeToFit>
                {isAdmin
                  ? (costosPendientes
                      ? `${kpiVentas} facturas · ganancia no disponible`
                      : `Ingreso ${formatUSD(stats.ingreso)}${kpiVentas > 0 ? `  ·  ${kpiVentas} facturas` : ''}`)
                  : `Ticket promedio: ${formatUSD(summary?.ticket_promedio ?? 0)}${kpiVentas > 0 ? `  ·  ${kpiVentas} facturas` : ''}`}
              </Text>
            )}
            {!loadingSum && costosPendientes && (
              <View style={[styles.warnBanner, { backgroundColor: colors.warning + '15', borderColor: colors.warning + '40' }]}>
                <Feather name="alert-triangle" size={11} color={colors.warning} />
                <Text style={[styles.warnText, { color: colors.warning }]} numberOfLines={2}>
                  Costos sin sincronizar · ganancia se calculará cuando el widget
                  envíe los costos del POS
                </Text>
              </View>
            )}
            {loadingChart
              ? <View style={styles.chartPlaceholder} />
              : (
                // Sale del padding del bigCard para que la línea cubra todo
                // el ancho del contenedor, de borde a borde, y el gradient
                // se extienda hasta el bottom del card (height más generoso).
                <View style={{
                  marginHorizontal: -BIG_CARD_PADDING,
                  marginBottom:     -BIG_CARD_PADDING,
                }}>
                  <SparklineChart data={chartData} width={BIG_CARD_OUTER_W} height={140} />
                </View>
              )
            }
          </View>
        )}

        {/* ── KPI grid: 2×2 mobile / 4×1 desktop ── */}
        <View style={[styles.kpiGrid, isDesktop && styles.kpiGridDesktop]}>
          <KpiCard
            icon="shopping-cart"
            value={String(stats.ventas)}
            label={`Ventas ${period === 'dia' ? 'hoy' : period === 'ayer' ? 'ayer' : period === 'semana' ? 'semana' : 'del mes'}`}
            loading={loadingSum}
            desktop={isDesktop}
          />
          <KpiCard
            icon="file-text"
            value={formatUSD(summary?.ticket_promedio ?? 0)}
            label="Ticket promedio"
            loading={loadingSum}
            desktop={isDesktop}
          />
          <KpiCard
            icon="package"
            value={String(Math.round(stats.items))}
            label={`Unidades ${period === 'dia' ? 'hoy' : period === 'ayer' ? 'ayer' : period === 'semana' ? 'semana' : 'del mes'}`}
            loading={loadingSum}
            desktop={isDesktop}
          />
          {isAdmin ? (
            <KpiCard
              icon="trending-up"
              value={formatUSD(stats.ingreso)}
              label={`Ingreso ${period === 'dia' ? 'hoy' : period === 'ayer' ? 'ayer' : period === 'semana' ? 'semana' : 'mes'}`}
              loading={loadingSum}
              desktop={isDesktop}
            />
          ) : (
            <KpiCard
              icon="layers"
              value={stats.ventas > 0 ? (stats.items / stats.ventas).toFixed(1) : '0'}
              label="Artículos / ticket"
              loading={loadingSum}
              desktop={isDesktop}
            />
          )}
        </View>

        {/* ── Charts: stacked on mobile, side-by-side on desktop ── */}
        {isAdmin && (
          <View style={[{ marginTop: 4 }, isDesktop && { flexDirection: 'row', gap: 12, paddingHorizontal: 16 }]}>
            <View style={[{ gap: 8 }, isDesktop && { flex: 1 }]}>
              <Text style={[styles.sectionLabel, { color: colors.textDim }, isDesktop && { paddingHorizontal: 0 }]}>Tendencia de Ganancia</Text>
              <GananciaChart data={daily7} mode="ganancia" />
            </View>
            <View style={[{ gap: 8 }, isDesktop && { flex: 1 }]}>
              <Text style={[styles.sectionLabel, { color: colors.textDim }, isDesktop && { paddingHorizontal: 0 }]}>Tendencia de Ingreso</Text>
              <GananciaChart data={daily7} mode="ingreso" />
            </View>
          </View>
        )}

        {/* ── Resumen del día / Actividad Reciente ── */}
        <View style={{ marginTop: 16 }}>
          <Text style={[styles.sectionLabel, { color: colors.textDim }]}>
            {isAdmin ? 'Resumen hoy' : 'Actividad Reciente'}
          </Text>
          <TopToday isAdmin={isAdmin} />
          
          {!isAdmin && (
            <Pressable
              onPress={() => router.push('/(tabs)/ventas')}
              style={({ pressed }) => [styles.seeMoreBtn, { borderColor: colors.border }, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.seeMoreText, { color: colors.primary }]}>Ver todas las ventas</Text>
              <Feather name="arrow-right" size={14} color={colors.primary} />
            </Pressable>
          )}
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Top today ─────────────────────────────────────────────────────────────────

function TopToday({ isAdmin }: { isAdmin: boolean }) {
  const { colors, formatUSD } = useTheme();
  const { data: daily = [] } = useProfitDaily(7);

  const todayStr = getLocalDateStr();
  const today = daily.find(d => d.dia === todayStr) ?? daily[daily.length - 1];

  if (!today) return null;

  return (
    <View style={[styles.topRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.topLeft}>
        <Text style={[styles.topDate, { color: colors.textMuted }]}>
          {new Date(today.dia + 'T12:00:00').toLocaleDateString('es-VE', {
            weekday: 'short', day: 'numeric', month: 'short',
          })}
        </Text>
        <Text style={[styles.topVal, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
          {isAdmin ? formatUSD(today.ganancia) : today.num_ventas}
        </Text>
        <Text style={[styles.topSub, { color: colors.textDim }]} numberOfLines={1} adjustsFontSizeToFit>
          {isAdmin 
            ? `${today.num_ventas} facturas · ingreso ${formatUSD(today.ingreso_bruto)}`
            : `Ventas registradas · Ticket promedio: ${formatUSD(today.num_ventas > 0 ? today.ingreso_bruto / today.num_ventas : 0)}`
          }
        </Text>
      </View>
      <View style={[styles.topBadge, { backgroundColor: colors.primaryFaded, borderColor: colors.primary + '40' }]}>
        <Text style={[styles.topBadgeText, { color: colors.primary }]}>Hoy</Text>
      </View>
    </View>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon, value, label, loading, desktop }: {
  icon:     React.ComponentProps<typeof Feather>['name'];
  value:    string;
  label:    string;
  loading?: boolean;
  desktop?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[
      desktop ? styles.kpiCardDesktop : styles.kpiCard,
      { backgroundColor: colors.surface, borderColor: colors.border },
    ]}>
      <Feather name={icon} size={17} color={colors.primary} style={styles.kpiIcon} />
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: 'flex-start', marginVertical: 4 }} />
      ) : (
        <Text style={[styles.kpiVal, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      )}
      <Text style={[styles.kpiLabel, { color: colors.textDim }]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1 },
  scroll: { gap: 0 },

  logoStrip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               16,
    paddingHorizontal: 16,
    paddingTop:        14,
  },
  logoImgWrap: {
    width:        72,
    height:       72,
    borderRadius: 14,
    overflow:     'hidden',
    backgroundColor: 'transparent',
  },
  logoImg: { width: 72, height: 72 },
  logoWords:   { flex: 1 },
  logoSub:     { fontSize: 11, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1.5, textTransform: 'uppercase' },
  logoName:    { fontSize: 20, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -0.5 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 13, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },

  greeting: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  greetSub:   { fontSize: 11, marginBottom: 2, fontFamily: 'JetBrainsMono_400Regular' },
  greetTitle: { fontSize: 24, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -0.5 },

  periodRow: {
    flexDirection:     'row',
    gap:               6,
    paddingHorizontal: 16,
    marginBottom:      12,
  },
  periodRowDesktop: {
    gap:               8,
    justifyContent:    'flex-start',
  },
  periodBtn: {
    flex:              1,
    alignItems:        'center',
    paddingVertical:   8,
    borderRadius:      12,
    borderWidth:       0.5,
  },
  // Desktop: complete replacement (NOT merged) — explicit basis-auto so text shows
  periodBtnDesktop: {
    alignItems:        'center',
    justifyContent:    'center',
    paddingVertical:   9,
    paddingHorizontal: 22,
    borderRadius:      10,
    borderWidth:       0.5,
    minWidth:          96,
  },
  periodText: { fontSize: 12, fontFamily: 'JetBrainsMono_500Medium' },

  bigCard: {
    marginHorizontal: 16,
    marginBottom:     12,
    borderRadius:     22,
    borderWidth:      0.5,
    padding:          20,
    overflow:         'hidden',
  },
  bigLabel:         { fontSize: 11, marginBottom: 4, fontFamily: 'JetBrainsMono_400Regular' },
  bigValue:         { fontSize: 32, fontFamily: 'JetBrainsMono_700Bold', lineHeight: 36, marginBottom: 2 },
  bigSub:           { fontSize: 11, fontFamily: 'JetBrainsMono_400Regular' },
  warnBanner: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              6,
    marginTop:        10,
    paddingVertical:  6,
    paddingHorizontal: 10,
    borderRadius:     8,
    borderWidth:      0.5,
  },
  warnText: { fontSize: 10, fontFamily: 'JetBrainsMono_500Medium', flex: 1, lineHeight: 14 },
  chartPlaceholder: { height: 150, marginTop: 14 },

  kpiGrid: {
    flexDirection:     'row',
    flexWrap:          'wrap',
    justifyContent:    'space-between',
    rowGap:            10,
    paddingHorizontal: 16,
    marginBottom:      14,
  },
  kpiGridDesktop: {
    flexWrap:       'nowrap',   // 4 cards in a single row
    gap:            12,
  },
  kpiLoading: { paddingVertical: 24, alignItems: 'center', marginBottom: 14 },
  kpiCard: {
    width:        '48.5%',   // 2-col on mobile
    borderRadius: 16,
    borderWidth:  0.5,
    padding:      14,
  },
  // Desktop: complete replacement (NOT merged with kpiCard) — flex:1 + no width
  kpiCardDesktop: {
    flex:         1,
    flexBasis:    0,
    borderRadius: 16,
    borderWidth:  0.5,
    padding:      16,
  },
  kpiIcon:  { marginBottom: 8 },
  kpiVal:   { fontSize: 17, fontFamily: 'JetBrainsMono_700Bold', marginBottom: 2 },
  kpiLabel: { fontSize: 9, fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },

  sectionLabel: {
    fontSize: 10, fontFamily: 'JetBrainsMono_700Bold', textTransform: 'uppercase',
    letterSpacing: 0.7, paddingHorizontal: 16, marginBottom: 8,
  },

  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, borderRadius: 14, borderWidth: 0.5,
    padding: 14, marginBottom: 8,
  },
  topLeft:      { gap: 2 },
  topDate:      { fontSize: 10, fontFamily: 'JetBrainsMono_400Regular' },
  topVal:       { fontSize: 20, fontFamily: 'JetBrainsMono_700Bold' },
  topSub:       { fontSize: 10, fontFamily: 'JetBrainsMono_400Regular' },
  topBadge: {
    borderRadius: 999, borderWidth: 0.5,
    paddingVertical: 4, paddingHorizontal: 12,
  },
  topBadgeText: { fontSize: 11, fontFamily: 'JetBrainsMono_700Bold' },

  bottomPad: { height: 110 },
  seeMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 0.5,
  },
  seeMoreText: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
