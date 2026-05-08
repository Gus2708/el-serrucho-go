import * as React from 'react';
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  Modal,
  FlatList,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/theme/ThemeContext';
import { useVentasInfinite, VentaHoy, VentasPeriod } from '../../src/hooks/useVentasHoy';
import { useProfitSummary } from '../../src/hooks/useProfitSummary';
import { useVentaDetalle } from '../../src/hooks/useVentaDetalle';
import { VentaDetalleUSD } from '../../src/lib/supabase';
import { useUserRole } from '../../src/hooks/useUserRole';

const PERIODS: { key: VentasPeriod; label: string }[] = [
  { key: 'hoy',    label: 'Hoy'    },
  { key: 'ayer',   label: 'Ayer'   },
  { key: 'semana', label: 'Semana' },
  { key: 'mes',    label: 'Mes'    },
];

const PERIOD_LABELS: Record<VentasPeriod, string> = {
  hoy:    'Ventas de hoy',
  ayer:   'Ventas de ayer',
  semana: 'Últimos 7 días',
  mes:    'Últimos 30 días',
};

const KPI_LABELS: Record<VentasPeriod, string> = {
  hoy:    'Ingreso hoy',
  ayer:   'Ingreso ayer',
  semana: 'Ingreso semana',
  mes:    'Ingreso mes',
};

export default function VentasScreen() {
  const { data: userAuth } = useUserRole();
  const isAdmin = userAuth?.role === 'admin';
  const { colors, formatUSD } = useTheme();
  const queryClient = useQueryClient();
  const [refreshing,    setRefreshing]    = useState(false);
  const [selectedVenta, setSelectedVenta] = useState<VentaHoy | null>(null);
  const [period,        setPeriod]        = useState<VentasPeriod>('hoy');
  const [hasDefaulted,  setHasDefaulted]  = useState(false);

  const dateRangeLabel = useMemo(() => {
    const today = new Date();
    const formatDate = (d: Date) => {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    if (period === 'hoy') return formatDate(today);
    if (period === 'ayer') {
      const ayer = new Date();
      ayer.setDate(ayer.getDate() - 1);
      return `ayer ${formatDate(ayer)}`;
    }
    if (period === 'semana') {
      const hace7 = new Date();
      hace7.setDate(hace7.getDate() - 7);
      return `${formatDate(hace7)} a hoy`;
    }
    if (period === 'mes') {
      const hace30 = new Date();
      hace30.setDate(hace30.getDate() - 30);
      return `${formatDate(hace30)} a hoy`;
    }
    return '';
  }, [period]);

  const { 
    data, 
    isLoading: loadingVentas, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage 
  } = useVentasInfinite(period);

  const { data: summary, isLoading: loadingStats } = useProfitSummary();

  const ventas = useMemo(() => {
    const allItems = data?.pages.flat() ?? [];
    // Deduplicate items by venta_id to prevent key errors
    const seen = new Set();
    return allItems.filter(v => {
      if (seen.has(v.venta_id)) return false;
      seen.add(v.venta_id);
      return true;
    });
  }, [data]);

  // Default logic: If today has no sales, switch to yesterday on first load.
  useEffect(() => {
    if (!loadingVentas && !hasDefaulted && period === 'hoy') {
      if (ventas.length === 0) {
        setPeriod('ayer');
      }
      setHasDefaulted(true);
    }
  }, [ventas, loadingVentas, period, hasDefaulted]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ventas-infinite', period] }),
      queryClient.invalidateQueries({ queryKey: ['profit-summary'] }),
    ]);
    setRefreshing(false);
  }

  const periodStats = useMemo(() => {
    if (!summary) return { ingreso: 0, ventas: 0 };
    switch (period) {
      case 'hoy':    return { ingreso: summary.ingreso_hoy,     ventas: summary.ventas_hoy };
      case 'ayer':   return { ingreso: summary.ingreso_ayer,    ventas: summary.ventas_ayer };
      case 'semana': return { ingreso: summary.ingreso_semana,  ventas: summary.ventas_semana };
      case 'mes':    return { ingreso: summary.ingreso_mes,     ventas: summary.ventas_mes };
      default:       return { ingreso: 0,                       ventas: 0 };
    }
  }, [period, summary]);

  const montoTotal    = periodStats.ingreso;
  const totalFacturas = periodStats.ventas;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      <FlashList
        data={ventas}
        keyExtractor={(item) => item.venta_id.toString()}
        estimatedItemSize={114}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <>
            {/* Header */}
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.text }]}>{PERIOD_LABELS[period]}</Text>
              <View style={styles.headerSub}>
                <Text style={[styles.subtitle, { color: colors.textMuted }]}>Listado detallado de facturación</Text>
                <Text style={[styles.dateContext, { color: colors.textDim }]}>{dateRangeLabel}</Text>
              </View>
            </View>

            {/* Period badges */}
            <View style={styles.periodRow}>
              {PERIODS.map(p => {
                const active = period === p.key;
                return (
                  <Pressable
                    key={p.key}
                    style={({ pressed }) => [
                      styles.periodBtn,
                      {
                        backgroundColor: active ? colors.primary  : colors.surface,
                        borderColor:     active ? colors.primary  : colors.border,
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

            {/* KPIs */}
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.kpiLabel, { color: colors.textDim }]}>
                  {isAdmin ? KPI_LABELS[period] : 'Ticket promedio'}
                </Text>
                {loadingStats ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: 'flex-start' }} />
                ) : (
                  <Text style={[styles.kpiValue, { color: colors.primary }]}>
                    {isAdmin ? formatUSD(montoTotal) : formatUSD(totalFacturas > 0 ? montoTotal / totalFacturas : 0)}
                  </Text>
                )}
              </View>
              <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.kpiLabel, { color: colors.textDim }]}>Facturas</Text>
                {loadingStats ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: 'flex-start' }} />
                ) : (
                  <Text style={[styles.kpiValue, { color: colors.text }]}>{totalFacturas}</Text>
                )}
              </View>
            </View>
          </>
        }
        renderItem={({ item: venta }) => (
          <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
            <VentaCard
              venta={venta}
              onPress={() => setSelectedVenta(venta)}
            />
          </View>
        )}
        ListEmptyComponent={
          loadingVentas && !refreshing ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={styles.center}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Feather name="shopping-bag" size={32} color={colors.textDim} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Sin ventas registradas</Text>
              <Text style={[styles.emptySub, { color: colors.textDim }]}>
                No hay facturas para este período.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={{ paddingVertical: 32, alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.textDim, fontSize: 11, fontFamily: 'JetBrainsMono_400Regular' }}>
                Cargando más facturas...
              </Text>
            </View>
          ) : (
            <View style={styles.bottomPad} />
          )
        }
      />

      {/* Modal de Detalle */}
      <VentaDetailModal 
        venta={selectedVenta} 
        onClose={() => setSelectedVenta(null)} 
      />
    </SafeAreaView>
  );
}

function VentaCard({ venta, onPress }: { venta: VentaHoy; onPress: () => void }) {
  const { colors, formatUSD } = useTheme();

  const time = new Date(venta.created_at).toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const pago = getPagoMeta(venta.metodo_pago, colors);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.75 }]}
    >
      <View style={styles.cardTop}>
        <View style={styles.docInfo}>
          <Text style={[styles.docNum, { color: colors.primary }]}>
            {venta.documento || `Factura #${venta.id}`}
          </Text>
          <View style={styles.timeRow}>
            <Feather name="clock" size={10} color={colors.textDim} />
            <Text style={[styles.docTime, { color: colors.textDim }]}>{time}</Text>
          </View>
        </View>
        <Text style={[styles.docAmount, { color: colors.text }]}>
          {formatUSD(Number(venta.total_usd) ?? 0)}
        </Text>
      </View>

      <View style={[styles.cardBottom, { borderTopColor: colors.border + '40' }]}>
        <View style={styles.clientRow}>
          <Feather name="user" size={11} color={colors.primary} />
          <Text style={[styles.clientName, { color: colors.textMuted }]} numberOfLines={1}>
            {venta.nombre_cliente}
          </Text>
        </View>
        {pago && (
          <View style={[styles.pagoChip, { backgroundColor: pago.color + '18', borderColor: pago.color + '40' }]}>
            <Feather name={pago.icon} size={10} color={pago.color} />
            <Text style={[styles.pagoChipText, { color: pago.color }]} numberOfLines={1}>
              {pago.label}
            </Text>
          </View>
        )}
        <Feather name="chevron-right" size={14} color={colors.textDim} />
      </View>
    </Pressable>
  );
}

// ── Payment method helper ─────────────────────────────────────────────────────
// Variantes reales del POS: "EFECTIVO USD", "EFECTIVO", "T. DEBITO", "ZELLE USD",
// "TRANSFERENCIA Y/O PAGO MOVIL", "CESTA TICKET".
function getPagoMeta(
  metodo: string | null,
  colors: { success: string; primary: string; warning: string; textMuted: string; textDim: string }
): { icon: keyof typeof Feather.glyphMap; color: string; label: string } | null {
  if (!metodo) return null;
  const m = metodo.trim().toUpperCase();
  if (m.includes('EFECTIVO') || m.includes('CASH')) {
    return {
      icon:  'dollar-sign',
      color: colors.success,
      label: m.includes('USD') ? 'EFECTIVO $' : 'EFECTIVO',
    };
  }
  if (m.includes('ZELLE')) {
    return { icon: 'send', color: colors.primary, label: 'ZELLE' };
  }
  if (m.includes('DEBITO') || m.includes('DÉBITO') || m.includes('TARJETA') || m.includes('PUNTO')) {
    return { icon: 'credit-card', color: colors.warning, label: 'DÉBITO' };
  }
  if (m.includes('TRANSFER') || m.includes('PAGO MOVIL') || m.includes('PAGO MÓVIL')) {
    return { icon: 'smartphone', color: colors.textMuted, label: 'TRANSF/PM' };
  }
  if (m.includes('CESTA') || m.includes('TICKET')) {
    return { icon: 'gift', color: colors.textMuted, label: 'CESTA TICKET' };
  }
  return { icon: 'tag', color: colors.textMuted, label: m };
}

function VentaDetailModal({ venta, onClose }: { venta: VentaHoy | null; onClose: () => void }) {
  const { colors, formatUSD } = useTheme();
  const { data: details = [], isLoading } = useVentaDetalle(venta?.venta_id ?? null);
  
  const screenHeight = Dimensions.get('window').height;
  const panY = useRef(new Animated.Value(screenHeight)).current;

  const closeModal = () => {
    Animated.timing(panY, {
      toValue: screenHeight,
      duration: 200,
      useNativeDriver: true,
    }).start(onClose);
  };

  // Reset animation when modal opens
  useEffect(() => {
    if (venta) {
      Animated.spring(panY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 40,
        friction: 8,
      }).start();
    }
  }, [venta]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 5,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          panY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 120 || gestureState.vy > 0.5) {
          closeModal();
        } else {
          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 40,
            friction: 8,
          }).start();
        }
      },
    })
  ).current;

  if (!venta) return null;

  // Backend ahora guarda los totales en USD directamente (post-fix sales).
  // Si total_bruto/impuesto del backend están disponibles, usarlos. Caso contrario, derivar de IVA 16%.
  const totalUSD = Number(venta.total_neto_usd  || venta.total_usd || 0);
  const baseUSD  = venta.total_bruto_usd > 0
    ? Number(venta.total_bruto_usd)
    : totalUSD / 1.16;
  const ivaUSD   = venta.total_impuesto_usd > 0
    ? Number(venta.total_impuesto_usd)
    : totalUSD - baseUSD;

  return (
    <Modal
      visible={!!venta}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={closeModal}
        />
        <Animated.View 
          style={[
            styles.modalSheet, 
            { 
              backgroundColor: colors.surface, 
              transform: [{ translateY: panY }] 
            }
          ]}
        >
          <View 
            {...panResponder.panHandlers} 
            style={styles.modalHandleArea}
          >
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
            
            <View style={styles.modalHeaderRow}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Detalle de Venta</Text>
                <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                  Folio: {venta.documento || `#${venta.venta_id}`}
                </Text>
              </View>
              <View style={styles.modalHeaderRight}>
                <Text style={[styles.modalDate, { color: colors.textDim }]}>
                  {new Date(venta.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          </View>

          {isLoading ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <FlatList
              data={details}
              keyExtractor={(item) => item.id.toString()}
              contentContainerStyle={styles.modalList}
              renderItem={({ item }) => (
                <View style={[styles.detailRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  <View style={styles.detailIconContainer}>
                    <View style={[styles.itemIcon, { backgroundColor: colors.surfaceAlt }]}>
                      <Feather name="package" size={16} color={colors.primaryDim} />
                    </View>
                  </View>
                  <View style={styles.detailBody}>
                    <View style={styles.detailMain}>
                      <Text style={[styles.detailDesc, { color: colors.text }]} numberOfLines={2}>
                        {item.descripcion}
                      </Text>
                      <Text style={[styles.detailSubtotal, { color: colors.primary }]}>
                        {formatUSD(item.subtotal_usd)}
                      </Text>
                    </View>
                    <View style={styles.detailMeta}>
                      <Text style={[styles.detailCode, { color: colors.textDim }]}>
                        {item.codigo_producto}
                      </Text>
                      <Text style={[styles.detailUnit, { color: colors.textMuted }]}>
                        {item.cantidad} × {formatUSD(item.precio_unitario_usd)}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
              ListFooterComponent={() => {
                const pagoModal = getPagoMeta(venta.metodo_pago, colors);
                return (
                <View style={[styles.modalFooter, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  {pagoModal && (
                    <>
                      <View style={styles.footerRow}>
                        <Text style={[styles.footerLabel, { color: colors.textMuted }]}>Método de pago</Text>
                        <View style={[styles.pagoChip, { backgroundColor: pagoModal.color + '18', borderColor: pagoModal.color + '40' }]}>
                          <Feather name={pagoModal.icon} size={11} color={pagoModal.color} />
                          <Text style={[styles.pagoChipText, { color: pagoModal.color, fontSize: 11 }]}>
                            {pagoModal.label}
                          </Text>
                        </View>
                      </View>
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    </>
                  )}
                  <View style={styles.footerRow}>
                    <Text style={[styles.footerLabel, { color: colors.textMuted }]}>Subtotal Base</Text>
                    <Text style={[styles.footerValue, { color: colors.text }]}>{formatUSD(baseUSD)}</Text>
                  </View>
                  <View style={styles.footerRow}>
                    <Text style={[styles.footerLabel, { color: colors.textMuted }]}>IVA (16%)</Text>
                    <Text style={[styles.footerValue, { color: colors.text }]}>{formatUSD(ivaUSD)}</Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={[styles.footerRow, styles.totalRow]}>
                    <Text style={[styles.totalLabel, { color: colors.text }]}>TOTAL</Text>
                    <View style={styles.totalValueContainer}>
                      <Text style={[styles.totalCurrency, { color: colors.primaryDim }]}>USD</Text>
                      <Text style={[styles.totalValue, { color: colors.primary }]}>{formatUSD(totalUSD).replace('$', '')}</Text>
                    </View>
                  </View>
                </View>
                );
              }}
            />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 20 },
  header: { paddingHorizontal: 16, paddingTop: 12, marginBottom: 16 },
  headerSub: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  title: { fontSize: 26, fontFamily: 'JetBrainsMono_700Bold' },
  dateContext: { fontSize: 10, fontFamily: 'JetBrainsMono_500Medium' },
  subtitle: { fontSize: 13, fontFamily: 'JetBrainsMono_400Regular' },

  periodRow: {
    flexDirection:     'row',
    gap:               6,
    paddingHorizontal: 16,
    marginBottom:      14,
  },
  periodBtn: {
    flex:              1,
    alignItems:        'center',
    paddingVertical:   8,
    borderRadius:      12,
    borderWidth:       0.5,
  },
  periodText: { fontSize: 12, fontFamily: 'JetBrainsMono_500Medium' },

  kpiRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  kpiCard: {
    flex: 1,
    padding: 16,
    borderRadius: 18,
    borderWidth: 0.5,
    gap: 4,
  },
  kpiLabel: { fontSize: 10, fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 20, fontFamily: 'JetBrainsMono_700Bold' },

  list: { paddingHorizontal: 16, gap: 10 },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 0.5,
    gap: 12,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  docInfo: { gap: 4 },
  docNum: { fontSize: 16, fontFamily: 'JetBrainsMono_700Bold' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  docTime: { fontSize: 11, fontFamily: 'JetBrainsMono_400Regular' },
  docAmount: { fontSize: 18, fontFamily: 'JetBrainsMono_700Bold' },
  
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 0.5,
    paddingTop: 10,
  },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  clientName: { fontSize: 12, fontFamily: 'JetBrainsMono_500Medium' },

  pagoChip: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              4,
    borderRadius:     999,
    borderWidth:      0.5,
    paddingVertical:  3,
    paddingHorizontal: 8,
    marginRight:      6,
    maxWidth:         120,
  },
  pagoChipText: {
    fontSize:      10,
    fontWeight:    '700',
    letterSpacing: 0.2,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 16 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 22, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 17, fontFamily: 'JetBrainsMono_700Bold' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 20, fontFamily: 'JetBrainsMono_400Regular' },
  bottomPad: { height: 120 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    width: '100%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 24,
  },
  modalHandleArea: {
    paddingTop: 12,
    paddingBottom: 4,
    alignItems: 'center',
    width: '100%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 16,
    opacity: 0.5,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 20,
    width: '100%',
  },
  modalHeaderRight: {
    alignItems: 'flex-end',
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: -0.5,
  },
  modalSubtitle: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_500Medium',
    marginTop: 2,
  },
  modalDate: {
    fontSize: 12,
    fontFamily: 'JetBrainsMono_700Bold',
    textTransform: 'uppercase',
  },
  modalLoading: { height: 200, alignItems: 'center', justifyContent: 'center' },
  modalList: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  
  detailRow: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 20,
    gap: 16,
    alignItems: 'center',
    borderWidth: 1,
  },
  detailIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIcon: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailBody: { flex: 1, gap: 4 },
  detailMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  detailDesc: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold', flex: 1, lineHeight: 20 },
  detailSubtotal: { fontSize: 16, fontFamily: 'JetBrainsMono_700Bold' },
  detailMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailCode: { fontSize: 11, fontFamily: 'JetBrainsMono_500Medium' },
  detailUnit: { fontSize: 12, fontFamily: 'JetBrainsMono_500Medium' },

  modalFooter: {
    marginTop: 12,
    marginBottom: 40,
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLabel: { fontSize: 14, fontFamily: 'JetBrainsMono_500Medium' },
  footerValue: { fontSize: 16, fontFamily: 'JetBrainsMono_700Bold' },
  divider: { height: 1, marginVertical: 8, opacity: 0.5 },
  totalRow: {
    marginTop: 4,
    paddingTop: 8,
  },
  totalLabel: { fontSize: 18, fontFamily: 'JetBrainsMono_700Bold' },
  totalValueContainer: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  totalCurrency: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },
  totalValue: { fontSize: 32, fontFamily: 'JetBrainsMono_700Bold' },
});
