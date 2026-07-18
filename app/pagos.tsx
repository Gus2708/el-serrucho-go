import { scaleFont } from '../src/theme/responsive';
import * as React from 'react';
import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/theme/ThemeContext';
import { useUserRole } from '../src/hooks/useUserRole';
import { usePagosZelle, useConciliarPago } from '../src/hooks/usePagosZelle';
import { PagoZelle } from '../src/lib/supabase';
import { PressableScale } from '../src/components/PressableScale';
import { pressScale } from '../src/theme/motion';

type Filtro = 'todos' | 'recibido' | 'en_revision';

const FILTROS: { key: Filtro; label: string }[] = [
  { key: 'todos',       label: 'Todos'       },
  { key: 'recibido',    label: 'Recibidos'   },
  { key: 'en_revision', label: 'En revisión' },
];

function esHoy(iso: string | null): boolean {
  if (!iso) return false;
  const fecha = new Date(iso);
  const hoy = new Date();
  return (
    fecha.getFullYear() === hoy.getFullYear() &&
    fecha.getMonth() === hoy.getMonth() &&
    fecha.getDate() === hoy.getDate()
  );
}

function formatHora(iso: string | null): string {
  if (!iso) return '—';
  const fecha = new Date(iso);
  const hora = fecha.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (esHoy(iso)) return hora;
  const dia = fecha.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
  return `${dia} ${hora}`;
}

type PagoRowProps = {
  pago: PagoZelle;
  onToggleConciliado: (pago: PagoZelle) => void;
  editable: boolean;
};

function PagoRow({ pago, onToggleConciliado, editable }: PagoRowProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const fecha = pago.recibido_en || pago.procesado_en;
  const enRevision = pago.estado === 'en_revision';
  const montoColor = pago.monto == null ? colors.warning : enRevision ? colors.warning : colors.primary;

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border },
        enRevision && { borderLeftWidth: 3, borderLeftColor: colors.warning },
        pago.conciliado && { opacity: 0.55 },
      ]}
    >
      <View style={styles.rowLeft}>
        <View style={styles.montoRow}>
          <Text style={[styles.monto, { color: montoColor }]}>
            {pago.monto == null ? 'REVISAR' : formatUSD(pago.monto)}
          </Text>
          {enRevision && (
            <View style={[styles.badge, { backgroundColor: colors.warning + '22', borderColor: colors.warning }]}>
              <Feather name="clock" size={10} color={colors.warning} />
              <Text style={[styles.badgeText, { color: colors.warning }]}>EN REVISIÓN</Text>
            </View>
          )}
        </View>
        <Text style={[styles.remitente, { color: colors.text }]} numberOfLines={1}>
          {pago.remitente || pago.asunto}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
            {formatHora(fecha)}
            {pago.banco ? `  ·  ${pago.banco}` : ''}
          </Text>
          {!pago.raw_parse_ok && (
            <View style={[styles.badge, { backgroundColor: colors.danger + '22', borderColor: colors.danger }]}>
              <Text style={[styles.badgeText, { color: colors.danger }]}>SIN MONTO</Text>
            </View>
          )}
        </View>
      </View>

      {editable ? (
        <PressableScale
          onPress={() => onToggleConciliado(pago)}
          hitSlop={10}
          style={[styles.checkBtn]}
          activeScale={pressScale.icon}
        >
          <Feather
            name={pago.conciliado ? 'check-circle' : 'circle'}
            size={24}
            color={pago.conciliado ? colors.success : colors.textDim}
          />
        </PressableScale>
      ) : (
        <View style={styles.checkBtn}>
          <Feather
            name={pago.conciliado ? 'check-circle' : 'circle'}
            size={24}
            color={pago.conciliado ? colors.success : colors.textDim}
          />
        </View>
      )}
    </View>
  );
}

export default function Pagos(): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const router = useRouter();
  const { data: userAuth } = useUserRole();
  const { data: pagos = [], isLoading, refetch } = usePagosZelle();
  const conciliar = useConciliarPago();
  const [refreshing, setRefreshing] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const esAdmin = userAuth?.role === 'admin';

  const resumenHoy = useMemo(() => {
    const recibidosHoy = pagos.filter(
      p => p.estado === 'recibido' && esHoy(p.recibido_en || p.procesado_en),
    );
    const total = recibidosHoy.reduce((acc, p) => acc + (p.monto ?? 0), 0);
    const enRevision = pagos.filter(p => p.estado === 'en_revision').length;
    return { total, cantidad: recibidosHoy.length, enRevision };
  }, [pagos]);

  const pagosFiltrados = useMemo(() => {
    if (esAdmin) {
      if (filtro === 'todos') return pagos;
      return pagos.filter(p => p.estado === filtro);
    }
    return pagos.slice(0, 5);
  }, [pagos, filtro, esAdmin]);

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  function handleToggleConciliado(pago: PagoZelle): void {
    conciliar.mutate({ id: pago.id, conciliado: !pago.conciliado });
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <PressableScale
          onPress={() => router.back()}
          hitSlop={10}
          style={[
            styles.backBtn,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          activeScale={pressScale.icon}
        >
          <Feather name="arrow-left" size={18} color={colors.textMuted} />
        </PressableScale>
        <Text style={[styles.title, { color: colors.text }]}>Pagos Zelle</Text>
        <View style={styles.backBtn} />
      </View>

      {esAdmin && (
        <>
          {/* ── Resumen de hoy ── */}
          <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>RECIBIDO HOY</Text>
              <Text style={[styles.summaryValue, { color: colors.primary }]}>
                {formatUSD(resumenHoy.total)}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>PAGOS</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>{resumenHoy.cantidad}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>EN REVISIÓN</Text>
              <Text style={[styles.summaryValue, { color: resumenHoy.enRevision > 0 ? colors.warning : colors.text }]}>
                {resumenHoy.enRevision}
              </Text>
            </View>
          </View>

          {/* ── Filtro ── */}
          <View style={styles.filterRow}>
            {FILTROS.map(f => {
              const active = filtro === f.key;
              return (
                <PressableScale
                  key={f.key}
                  onPress={() => setFiltro(f.key)}
                  style={[
                    styles.filterBtn,
                    {
                      backgroundColor: active ? colors.primary : colors.surface,
                      borderColor:     active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      { color: active ? colors.onPrimary : colors.textMuted },
                    ]}
                  >
                    {f.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </>
      )}

      {!esAdmin && (
        <View style={styles.limitedNotice}>
          <Feather name="eye" size={12} color={colors.textDim} />
          <Text style={[styles.limitedNoticeText, { color: colors.textDim }]}>
            Mostrando los últimos 5 pagos
          </Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={pagosFiltrados}
          keyExtractor={p => p.id}
          renderItem={({ item }) => (
            <PagoRow
              pago={item}
              onToggleConciliado={handleToggleConciliado}
              editable={esAdmin}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="inbox" size={32} color={colors.textDim} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {filtro === 'todos'
                  ? 'Todavía no hay pagos Zelle detectados.\nLlegarán aquí automáticamente al entrar el correo.'
                  : 'No hay pagos en esta categoría.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: 'transparent',
  },
  title: {
    fontSize: scaleFont(16),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  summary: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
  },
  summaryCol: { flex: 1, alignItems: 'center', gap: 4 },
  summaryDivider: { width: 1, marginVertical: 4 },
  summaryLabel: {
    fontSize: scaleFont(9),
    fontFamily: 'JetBrainsMono_500Medium',
    letterSpacing: 0.8,
  },
  summaryValue: {
    fontSize: scaleFont(17),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  limitedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  limitedNoticeText: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  filterBtn: {
    flex: 1,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  rowLeft: { flex: 1, gap: 3, marginRight: 10 },
  montoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monto: {
    fontSize: scaleFont(17),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  remitente: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
    flexShrink: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: scaleFont(8),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  checkBtn: { padding: 4 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyText: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign: 'center',
    lineHeight: scaleFont(18),
  },
});
