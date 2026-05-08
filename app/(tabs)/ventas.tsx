import React, { useState, useRef, useEffect } from 'react';
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

import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/theme/ThemeContext';
import { useVentasPeriod, VentaHoy, VentasPeriod } from '../../src/hooks/useVentasHoy';
import { useVentaDetalle } from '../../src/hooks/useVentaDetalle';
import { VentaDetalleUSD } from '../../src/lib/supabase';

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
  const { colors, formatUSD } = useTheme();
  const queryClient = useQueryClient();
  const [refreshing,    setRefreshing]    = useState(false);
  const [selectedVenta, setSelectedVenta] = useState<VentaHoy | null>(null);
  const [period,        setPeriod]        = useState<VentasPeriod>('hoy');
  const [hasDefaulted,  setHasDefaulted]  = useState(false);

  const { data: ventas = [], isLoading: loadingVentas } = useVentasPeriod(period);

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
    await queryClient.invalidateQueries({ queryKey: ['ventas-period', period] });
    setRefreshing(false);
  }

  const montoTotal    = ventas.reduce((acc, v) => acc + v.total_usd, 0);
  const totalFacturas = ventas.length;

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
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>{PERIOD_LABELS[period]}</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>Listado detallado de facturación</Text>
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
            <Text style={[styles.kpiLabel, { color: colors.textDim }]}>{KPI_LABELS[period]}</Text>
            <Text style={[styles.kpiValue, { color: colors.primary }]}>{formatUSD(montoTotal)}</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.kpiLabel, { color: colors.textDim }]}>Facturas</Text>
            <Text style={[styles.kpiValue, { color: colors.text }]}>{totalFacturas}</Text>
          </View>
        </View>

        {loadingVentas && !refreshing ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : ventas.length === 0 ? (
          <View style={styles.center}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Feather name="shopping-bag" size={32} color={colors.textDim} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Sin ventas registradas</Text>
            <Text style={[styles.emptySub, { color: colors.textDim }]}>
              No hay facturas para este período.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {ventas.map((venta) => (
              <VentaCard
                key={venta.venta_id}
                venta={venta}
                onPress={() => setSelectedVenta(venta)}
              />
            ))}
          </View>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>

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
        <Feather name="chevron-right" size={14} color={colors.textDim} />
      </View>
    </Pressable>
  );
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
              backgroundColor: colors.bg, 
              transform: [{ translateY: panY }] 
            }
          ]}
        >
          <View 
            {...panResponder.panHandlers} 
            style={[styles.modalHandleArea, { backgroundColor: colors.surface }]}
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
                <View style={[styles.detailRow, { backgroundColor: colors.surface }]}>
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
              ListFooterComponent={() => (
                <View style={[styles.modalFooter, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
              )}
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
  title: { fontSize: 26, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 2 },

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
  periodText: { fontSize: 12, fontWeight: '600' },

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
  kpiLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 20, fontWeight: '800' },

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
  docNum: { fontSize: 16, fontWeight: '700' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  docTime: { fontSize: 11, fontWeight: '500' },
  docAmount: { fontSize: 18, fontWeight: '800' },
  
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 0.5,
    paddingTop: 10,
  },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  clientName: { fontSize: 12, fontWeight: '500' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 16 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 22, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  bottomPad: { height: 120 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: 'transparent',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    width: '100%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 20,
  },
  modalHandleArea: {
    paddingTop: 12,
    paddingBottom: 20,
    alignItems: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
    alignItems: 'flex-end',
    width: '100%',
    paddingHorizontal: 20,
  },
  modalHeaderRight: {
    alignItems: 'flex-end',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  modalSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  modalDate: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  modalLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modalList: { padding: 16, gap: 12 },
  
  detailRow: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 20,
    gap: 16,
    alignItems: 'center',
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
  detailDesc: { fontSize: 14, fontWeight: '700', flex: 1, lineHeight: 20 },
  detailSubtotal: { fontSize: 16, fontWeight: '800' },
  detailMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailCode: { fontSize: 11, fontWeight: '600' },
  detailUnit: { fontSize: 12, fontWeight: '500' },

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
  footerLabel: { fontSize: 14, fontWeight: '600' },
  footerValue: { fontSize: 16, fontWeight: '700' },
  divider: { height: 1, marginVertical: 8, opacity: 0.5 },
  totalRow: {
    marginTop: 4,
    paddingTop: 8,
  },
  totalLabel: { fontSize: 18, fontWeight: '900' },
  totalValueContainer: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  totalCurrency: { fontSize: 14, fontWeight: '800' },
  totalValue: { fontSize: 32, fontWeight: '900' },
});
