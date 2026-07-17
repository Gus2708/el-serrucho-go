import { scaleFont } from '../src/theme/responsive';
import * as React from 'react';
import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/theme/ThemeContext';
import { useUserRole, isPrivilegedRole } from '../src/hooks/useUserRole';
import { usePagosZelle, useConciliarPago } from '../src/hooks/usePagosZelle';
import { PagoZelle } from '../src/lib/supabase';

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
};

function PagoRow({ pago, onToggleConciliado }: PagoRowProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const fecha = pago.recibido_en || pago.procesado_en;

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pago.conciliado && { opacity: 0.55 },
      ]}
    >
      <View style={styles.rowLeft}>
        <Text style={[styles.monto, { color: pago.monto == null ? colors.warning : colors.primary }]}>
          {pago.monto == null ? 'REVISAR' : formatUSD(pago.monto)}
        </Text>
        <Text style={[styles.remitente, { color: colors.text }]} numberOfLines={1}>
          {pago.remitente || pago.asunto}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
            {formatHora(fecha)}
            {pago.banco ? `  ·  ${pago.banco}` : ''}
          </Text>
          {!pago.raw_parse_ok && (
            <View style={[styles.badge, { backgroundColor: colors.warning + '22', borderColor: colors.warning }]}>
              <Text style={[styles.badgeText, { color: colors.warning }]}>SIN MONTO</Text>
            </View>
          )}
        </View>
      </View>

      <Pressable
        onPress={() => onToggleConciliado(pago)}
        hitSlop={10}
        style={({ pressed }) => [styles.checkBtn, pressed && { opacity: 0.6, transform: [{ scale: 0.9 }] }]}
      >
        <Feather
          name={pago.conciliado ? 'check-circle' : 'circle'}
          size={24}
          color={pago.conciliado ? colors.success : colors.textDim}
        />
      </Pressable>
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

  const privileged = isPrivilegedRole(userAuth?.role);

  const resumenHoy = useMemo(() => {
    const deHoy = pagos.filter(p => esHoy(p.recibido_en || p.procesado_en));
    const total = deHoy.reduce((acc, p) => acc + (p.monto ?? 0), 0);
    return { total, cantidad: deHoy.length };
  }, [pagos]);

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
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [
            styles.backBtn,
            { backgroundColor: colors.surface, borderColor: colors.border },
            pressed && { opacity: 0.7, transform: [{ scale: 0.94 }] },
          ]}
        >
          <Feather name="arrow-left" size={18} color={colors.textMuted} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Pagos Zelle</Text>
        <View style={styles.backBtn} />
      </View>

      {!privileged ? (
        <View style={styles.empty}>
          <Feather name="lock" size={32} color={colors.textDim} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            Sección disponible solo para administradores.
          </Text>
        </View>
      ) : (
        <>
          {/* ── Resumen de hoy ── */}
          <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>ZELLE HOY</Text>
              <Text style={[styles.summaryValue, { color: colors.primary }]}>
                {formatUSD(resumenHoy.total)}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>PAGOS</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>{resumenHoy.cantidad}</Text>
            </View>
          </View>

          {isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={pagos}
              keyExtractor={p => p.id}
              renderItem={({ item }) => (
                <PagoRow pago={item} onToggleConciliado={handleToggleConciliado} />
              )}
              contentContainerStyle={styles.list}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Feather name="inbox" size={32} color={colors.textDim} />
                  <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                    Todavía no hay pagos Zelle detectados.{'\n'}
                    Llegarán aquí automáticamente al entrar el correo.
                  </Text>
                </View>
              }
            />
          )}
        </>
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
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_500Medium',
    letterSpacing: 1,
  },
  summaryValue: {
    fontSize: scaleFont(18),
    fontFamily: 'JetBrainsMono_700Bold',
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
