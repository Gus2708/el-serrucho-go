import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';

const logo = require('../../src/assets/img/EL SERRUCHO go.png');
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/theme/ThemeContext';
import { useProfitSummary, useProfitMonthly, useProfitDaily } from '../../src/hooks/useProfitSummary';
import { useUserRole } from '../../src/hooks/useUserRole';
import { SyncBadge } from '../../src/components/SyncBadge';
import { SparklineChart } from '../../src/components/SparklineChart';
import { GananciaChart } from '../../src/components/GananciaChart';
import { supabase, getLocalDateStr } from '../../src/lib/supabase';

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

export default function DashboardScreen() {
  const { colors, formatUSD } = useTheme();
  const router      = useRouter();
  const queryClient = useQueryClient();

  const [refreshing, setRefreshing] = useState(false);
  const [userName,   setUserName]   = useState('');
  const [period,     setPeriod]     = useState<Period>('mes');

  const { data: summary,      isLoading: loadingSum     } = useProfitSummary();
  const { data: monthly = [], isLoading: loadingMonthly } = useProfitMonthly();
  const { data: daily7  = [], isLoading: loadingDaily7  } = useProfitDaily(7);
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
  // Semana: agrupa los 7 días del daily en una sola serie
  // Mes:    usa los datos mensuales (12 meses)
  // Día:    usa los últimos 7 días como contexto visual
  const chartData = period === 'mes' ? monthly : daily7;
  const loadingChart = period === 'mes' ? loadingMonthly : loadingDaily7;

  // KPIs del grid según período
  const kpiVentas = stats.ventas;

  const isNeg = stats.ganancia < 0;

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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[styles.greetTitle, { color: colors.text }]}>Estadisticas:</Text>
            {sessionUser?.email && (
              <Text style={{ fontSize: 10, color: colors.textDim, opacity: 0.6 }}>
                {sessionUser.email}
              </Text>
            )}
          </View>
        </View>

        {/* ── SyncBadge ── */}
        <SyncBadge />

        {/* ── Period toggle ── */}
        <View style={styles.periodRow}>
          {PERIODS.map(p => {
            const active = period === p.key;
            return (
              <Pressable
                key={p.key}
                style={({ pressed }) => [
                  styles.periodBtn,
                  {
                    backgroundColor: active ? colors.primary    : colors.surface,
                    borderColor:     active ? colors.primary    : colors.border,
                  },
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => setPeriod(p.key)}
              >
                <Text style={[styles.periodText, { color: active ? colors.onPrimary : colors.textMuted }]}>
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── Big card ── */}
        {isAdmin && (
          <View style={[styles.bigCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.bigLabel, { color: colors.textMuted }]}>{stats.label}</Text>
            {loadingSum ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
            ) : (
              <Text style={[styles.bigValue, { color: isNeg ? colors.danger : colors.primary }]}>
                {formatUSD(stats.ganancia)}
              </Text>
            )}
            {!loadingSum && (
              <Text style={[styles.bigSub, { color: colors.textDim }]}>
                Ingreso {formatUSD(stats.ingreso)}
                {kpiVentas > 0 ? `  ·  ${kpiVentas} facturas` : ''}
              </Text>
            )}
            {loadingChart
              ? <View style={styles.chartPlaceholder} />
              : <SparklineChart data={chartData} />
            }
          </View>
        )}

        {/* ── KPI grid 2×2 ── */}
        <View style={styles.kpiGrid}>
          <KpiCard
            icon="shopping-cart"
            value={String(stats.ventas)}
            label={`Ventas ${period === 'dia' ? 'hoy' : period === 'ayer' ? 'ayer' : period === 'semana' ? 'semana' : 'del mes'}`}
            loading={loadingSum}
          />
          <KpiCard
            icon="file-text"
            value={formatUSD(summary?.ticket_promedio ?? 0)}
            label="Ticket promedio"
            loading={loadingSum}
          />
          <KpiCard
            icon="package"
            value={String(Math.round(stats.items))}
            label={`Unidades ${period === 'dia' ? 'hoy' : period === 'ayer' ? 'ayer' : period === 'semana' ? 'semana' : 'del mes'}`}
            loading={loadingSum}
          />
          {isAdmin && (
            <KpiCard
              icon="trending-up"
              value={formatUSD(stats.ingreso)}
              label={`Ingreso ${period === 'dia' ? 'hoy' : period === 'ayer' ? 'ayer' : period === 'semana' ? 'semana' : 'mes'}`}
              loading={loadingSum}
            />
          )}
        </View>

        {/* ── Charts ── */}
        {isAdmin && (
          <View style={{ gap: 12, marginTop: 4 }}>
            <Text style={[styles.sectionLabel, { color: colors.textDim }]}>Tendencia de Ganancia</Text>
            <GananciaChart data={daily7} mode="ganancia" />
            
            <Text style={[styles.sectionLabel, { color: colors.textDim }]}>Tendencia de Ingreso</Text>
            <GananciaChart data={daily7} mode="ingreso" />
          </View>
        )}

        {/* ── Resumen del día / Actividad Reciente ── */}
        <View style={{ marginTop: 16 }}>
          <Text style={[styles.sectionLabel, { color: colors.textDim }]}>
            {isAdmin ? 'Resumen hoy' : 'Actividad Reciente'}
          </Text>
          <TopToday />
          
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

function TopToday() {
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
        <Text style={[styles.topVal, { color: colors.primary }]}>
          {formatUSD(today.ganancia)}
        </Text>
        <Text style={[styles.topSub, { color: colors.textDim }]}>
          {today.num_ventas} facturas · ingreso {formatUSD(today.ingreso_bruto)}
        </Text>
      </View>
      <View style={[styles.topBadge, { backgroundColor: colors.primaryFaded, borderColor: colors.primary + '40' }]}>
        <Text style={[styles.topBadgeText, { color: colors.primary }]}>Hoy</Text>
      </View>
    </View>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon, value, label, loading }: {
  icon:  React.ComponentProps<typeof Feather>['name'];
  value: string;
  label: string;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Feather name={icon} size={17} color={colors.primary} style={styles.kpiIcon} />
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: 'flex-start', marginVertical: 4 }} />
      ) : (
        <Text style={[styles.kpiVal, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      )}
      <Text style={[styles.kpiLabel, { color: colors.textDim }]}>{label}</Text>
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
  logoSub:     { fontSize: 11, fontWeight: '600', letterSpacing: 1.5, textTransform: 'uppercase' },
  logoName:    { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 13, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },

  greeting: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  greetSub:   { fontSize: 11, marginBottom: 2 },
  greetTitle: { fontSize: 22, fontWeight: '700' },

  periodRow: {
    flexDirection:     'row',
    gap:               6,
    paddingHorizontal: 16,
    marginBottom:      12,
  },
  periodBtn: {
    flex:              1,
    alignItems:        'center',
    paddingVertical:   8,
    borderRadius:      12,
    borderWidth:       0.5,
  },
  periodText: { fontSize: 12, fontWeight: '600' },

  bigCard: {
    marginHorizontal: 16,
    marginBottom:     12,
    borderRadius:     22,
    borderWidth:      0.5,
    padding:          20,
    overflow:         'hidden',
  },
  bigLabel:         { fontSize: 11, marginBottom: 4 },
  bigValue:         { fontSize: 32, fontWeight: '800', lineHeight: 36, marginBottom: 2 },
  bigSub:           { fontSize: 11 },
  chartPlaceholder: { height: 68, marginTop: 14 },

  kpiGrid: {
    flexDirection:     'row',
    flexWrap:          'wrap',
    justifyContent:    'flex-start',
    gap:               10,
    paddingHorizontal: 16,
    marginBottom:      14,
  },
  kpiLoading: { paddingVertical: 24, alignItems: 'center', marginBottom: 14 },
  kpiCard: {
    width: '47.5%', borderRadius: 16, borderWidth: 0.5, padding: 14,
  },
  kpiIcon:  { marginBottom: 8 },
  kpiVal:   { fontSize: 17, fontWeight: '700', marginBottom: 2 },
  kpiLabel: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 },

  sectionLabel: {
    fontSize: 10, fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.7, paddingHorizontal: 16, marginBottom: 8,
  },

  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, borderRadius: 14, borderWidth: 0.5,
    padding: 14, marginBottom: 8,
  },
  topLeft:      { gap: 2 },
  topDate:      { fontSize: 10 },
  topVal:       { fontSize: 20, fontWeight: '800' },
  topSub:       { fontSize: 10 },
  topBadge: {
    borderRadius: 999, borderWidth: 0.5,
    paddingVertical: 4, paddingHorizontal: 12,
  },
  topBadgeText: { fontSize: 11, fontWeight: '700' },

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
    fontWeight: '700',
  },
});
