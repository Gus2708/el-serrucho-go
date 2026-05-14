import * as React from 'react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
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
  TextInput,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/theme/ThemeContext';
import { useInventarioStore } from '../../src/hooks/useInventarioStore';
import { useVentasInfinite, VentaHoy, VentasPeriod, useVentasSearchSummary } from '../../src/hooks/useVentasHoy';
import { useProfitSummary } from '../../src/hooks/useProfitSummary';
import { useVentaDetalle } from '../../src/hooks/useVentaDetalle';
import { VentaDetalleUSD, supabase } from '../../src/lib/supabase';
import { useUserRole } from '../../src/hooks/useUserRole';
import { useDeviceSize } from '../../src/hooks/useDeviceSize';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildVentaPdfHtml, printHtml } from '../../src/utils/pdfGenerator';
import Svg, { 
  Path, Rect, Defs, LinearGradient as SvgGradient, Stop, Filter, 
  FeGaussianBlur, FeOffset, FeComponentTransfer, FeFuncA, FeMerge, FeMergeNode, Line 
} from 'react-native-svg';

const PERIODS: { key: VentasPeriod; label: string }[] = [
  { key: 'hoy',    label: 'Hoy'    },
  { key: 'ayer',   label: 'Ayer'   },
  { key: 'semana', label: 'Semana' },
  { key: 'mes',    label: 'Mes'    },
  { key: 'todo',   label: 'Todo'   },
];

const PERIOD_LABELS: Record<VentasPeriod, string> = {
  hoy:    'Ventas de hoy',
  ayer:   'Ventas de ayer',
  semana: 'Últimos 7 días',
  mes:    'Últimos 30 días',
  todo:   'Historial completo',
};

const KPI_LABELS: Record<VentasPeriod, string> = {
  hoy:    'Ingreso hoy',
  ayer:   'Ingreso ayer',
  semana: 'Ingreso semana',
  mes:    'Ingreso mes',
  todo:   'Ingreso total',
};

export default function Ventas() {
  const { data: userAuth } = useUserRole();
  const isAdmin = userAuth?.role === 'admin';
  const { colors, formatUSD } = useTheme();
  const queryClient = useQueryClient();
  const listRef = useRef<FlashList<any>>(null);
  const { isDesktop } = useDeviceSize();
  const { scrollOffsetVentas, setScrollOffsetVentas } = useInventarioStore();
  const [refreshing,    setRefreshing]    = useState(false);
  const [selectedVenta, setSelectedVenta] = useState<VentaHoy | null>(null);
  const [ventaToDelete, setVentaToDelete] = useState<string | null>(null);
  const [period,        setPeriod]        = useState<VentasPeriod>('hoy');
  const [hasDefaulted,  setHasDefaulted]  = useState(false);

  // Restaurar scroll
  useFocusEffect(
    useCallback(() => {
      if (scrollOffsetVentas > 0 && listRef.current) {
        const timer = setTimeout(() => {
          listRef.current?.scrollToOffset({ offset: scrollOffsetVentas, animated: false });
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [scrollOffsetVentas])
  );

  // Guardar scroll
  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset >= 0) {
      setScrollOffsetVentas(offset);
    }
  }, [setScrollOffsetVentas]);

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

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search to optimize network requests
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: loadingVentas,
    refetch,
  } = useVentasInfinite(period, debouncedSearch);

  const isEmpty = !loadingVentas && (!data || data.pages.flat().length === 0);
  const { data: suggestions, isLoading: loadingSuggestions } = useVentasSearchSummary(debouncedSearch, !!(isEmpty && debouncedSearch));

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
        ref={listRef}
        data={ventas}
        keyExtractor={(item) => item.venta_id.toString()}
        estimatedItemSize={114}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
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
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{PERIOD_LABELS[period]}</Text>
              <View style={styles.headerSub}>
                <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>Listado detallado de facturación</Text>
                <Text style={[styles.dateContext, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>{dateRangeLabel}</Text>
              </View>
            </View>

            {/* Search Input */}
            <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
              <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Feather name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
                <TextInput
                  placeholder="Buscar cliente o factura..."
                  placeholderTextColor={colors.textMuted}
                  value={search}
                  onChangeText={setSearch}
                  style={[styles.searchInput, { color: colors.text }]}
                  selectionColor={colors.primary}
                  autoCorrect={false}
                />
                {search.length > 0 && (
                  <Pressable onPress={() => setSearch('')} style={styles.searchClear}>
                    <Feather name="x-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>
            </View>

            {/* Period badges */}
            <View style={[styles.periodRow, isDesktop && styles.periodRowDesktop]}>
              {PERIODS.map(p => {
                const active = period === p.key;
                return (
                  <Pressable
                    key={p.key}
                    style={({ pressed }) => [
                      isDesktop ? styles.periodBtnDesktop : styles.periodBtn,
                      {
                        backgroundColor: active ? colors.primary  : colors.surface,
                        borderColor:     active ? colors.primary  : colors.border,
                      },
                      pressed && { opacity: 0.75 },
                    ]}
                    onPress={() => setPeriod(p.key)}
                  >
                    <Text style={[styles.periodText, { color: active ? colors.onPrimary : colors.textMuted }]} numberOfLines={1}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* KPIs */}
            {period !== 'todo' && (
              <View style={[styles.kpiRow, isDesktop && styles.kpiRowDesktop]}>
                <View style={[styles.kpiCard, isDesktop && styles.kpiCardDesktop, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>
                    {isAdmin ? KPI_LABELS[period] : 'Ticket promedio'}
                  </Text>
                  {loadingStats ? (
                    <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: 'flex-start' }} />
                  ) : (
                    <Text style={[styles.kpiValue, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
                      {isAdmin ? formatUSD(montoTotal) : formatUSD(totalFacturas > 0 ? montoTotal / totalFacturas : 0)}
                    </Text>
                  )}
                </View>
                <View style={[styles.kpiCard, isDesktop && styles.kpiCardDesktop, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>Facturas</Text>
                  {loadingStats ? (
                    <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: 'flex-start' }} />
                  ) : (
                    <Text style={[styles.kpiValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{totalFacturas}</Text>
                  )}
                </View>
              </View>
            )}
          </>
        }
        renderItem={({ item: venta }) => (
          <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
            <VentaCard
              venta={venta}
              onPress={() => {
                setSelectedVenta(venta);
              }}
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
                <Feather name={debouncedSearch ? "search" : "shopping-bag"} size={32} color={colors.textMuted} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>
                {debouncedSearch ? 'Sin resultados' : 'Sin ventas registradas'}
              </Text>
              <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                {debouncedSearch 
                  ? `No encontramos nada para "${debouncedSearch}" ${period === 'hoy' ? 'hoy' : 'en este periodo'}`
                  : 'No hay facturas para este período.'
                }
              </Text>

              {/* Suggestions for search */}
              {debouncedSearch && (loadingSuggestions || (suggestions && Object.values(suggestions).some(c => c > 0))) && (
                <View style={styles.suggestions}>
                  <Text style={[styles.suggestionTitle, { color: colors.textMuted }]}>
                    {loadingSuggestions ? 'Escaneando historial...' : 'Prueba buscando en:'}
                  </Text>
                  
                  {loadingSuggestions ? (
                    <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 8 }} />
                  ) : (
                    <View style={styles.suggestionRow}>
                      {(suggestions?.todo ?? 0) > 0 && period !== 'todo' && (
                      <Pressable
                        style={[styles.suggestionChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                        onPress={() => setPeriod('todo')}
                      >
                        <Text style={[styles.suggestionChipText, { color: colors.textMuted }]}>Todo ({suggestions?.todo})</Text>
                      </Pressable>
                    )}
                    {(suggestions?.ayer ?? 0) > 0 && period !== 'ayer' && (
                      <Pressable
                        style={[styles.suggestionChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                        onPress={() => setPeriod('ayer')}
                      >
                        <Text style={[styles.suggestionChipText, { color: colors.textMuted }]}>Ayer ({suggestions?.ayer})</Text>
                      </Pressable>
                    )}
                    {(suggestions?.semana ?? 0) > 0 && period !== 'semana' && (
                      <Pressable
                        style={[styles.suggestionChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                        onPress={() => setPeriod('semana')}
                      >
                        <Text style={[styles.suggestionChipText, { color: colors.textMuted }]}>Semana ({suggestions?.semana})</Text>
                      </Pressable>
                    )}
                    {(suggestions?.mes ?? 0) > 0 && period !== 'mes' && (
                      <Pressable
                        style={[styles.suggestionChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                        onPress={() => setPeriod('mes')}
                      >
                        <Text style={[styles.suggestionChipText, { color: colors.textMuted }]}>Mes ({suggestions?.mes})</Text>
                      </Pressable>
                    )}
                    </View>
                  )}
                </View>
              )}
            </View>
          )
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={{ paddingVertical: 32, alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'JetBrainsMono_400Regular' }}>
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
          <Text style={[styles.docNum, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
            {venta.documento || `Factura #${venta.id}`}
          </Text>
          <View style={styles.timeRow}>
            <Feather name="clock" size={10} color={colors.textMuted} />
            <Text style={[styles.docTime, { color: colors.textMuted }]}>{time}</Text>
          </View>
        </View>
        <Text style={[styles.docAmount, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
          {formatUSD(Number(venta.total_usd) ?? 0)}
        </Text>
      </View>

      <View style={[styles.cardBottom, { borderTopColor: colors.border + '40' }]}>
        <View style={styles.clientRow}>
          <Feather name="user" size={11} color={colors.primary} />
          <Text style={[styles.clientName, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
            {venta.nombre_cliente}
          </Text>
          <View style={[styles.itemsChip, { backgroundColor: colors.primaryFaded, borderColor: colors.primary + '30' }]}>
            <Feather name="box" size={9} color={colors.primary} />
            <Text style={[styles.itemsChipText, { color: colors.primary }]}>{venta.items_count}</Text>
          </View>
        </View>
        {pago && (
          <View style={[styles.pagoChip, { backgroundColor: pago.color + '18', borderColor: pago.color + '40' }]}>
            <Feather name={pago.icon} size={10} color={pago.color} />
            <Text style={[styles.pagoChipText, { color: pago.color }]} numberOfLines={1} adjustsFontSizeToFit>
              {pago.label}
            </Text>
          </View>
        )}
        <Feather name="chevron-right" size={14} color={colors.textMuted} />
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

function TicketBackground({ width, height, notchY }: { width: number; height: number; notchY: number }) {
  const r = 24; // corner radius
  const nr = 14; // notch radius
  
  const d = `
    M ${r} 0
    H ${width - r}
    A ${r} ${r} 0 0 1 ${width} ${r}
    V ${notchY - nr}
    A ${nr} ${nr} 0 0 0 ${width} ${notchY + nr}
    V ${height - r}
    A ${r} ${r} 0 0 1 ${width - r} ${height}
    H ${r}
    A ${r} ${r} 0 0 1 0 ${height - r}
    V ${notchY + nr}
    A ${nr} ${nr} 0 0 0 0 ${notchY - nr}
    V ${r}
    A ${r} ${r} 0 0 1 ${r} 0
    Z
  `;

  return (
    <View style={{ width, height, position: 'absolute', overflow: 'visible' }}>
      <Svg width={width + 80} height={height + 80} viewBox={`-40 -40 ${width + 80} ${height + 80}`} style={{ position: 'absolute', left: -40, top: -40 }}>
        <Defs>
          <Filter id="premiumShadow" x="-50%" y="-50%" width="200%" height="200%">
            <FeGaussianBlur in="SourceAlpha" stdDeviation="10" />
            <FeOffset dx="0" dy="8" result="offsetblur" />
            <FeComponentTransfer>
              <FeFuncA type="linear" slope="0.4" />
            </FeComponentTransfer>
            <FeMerge>
              <FeMergeNode />
              <FeMergeNode in="SourceGraphic" />
            </FeMerge>
          </Filter>
          
          <SvgGradient id="ticketGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#2A2A2A" stopOpacity="1" />
            <Stop offset="1" stopColor="#181818" stopOpacity="1" />
          </SvgGradient>
        </Defs>
        
        {/* Main Body with Shadow */}
        <Path d={d} fill="url(#ticketGrad)" filter="url(#premiumShadow)" />
        
        {/* Premium Edge Highlight - Notches */}
        <Path 
          d={`M ${width} ${notchY - nr} A ${nr} ${nr} 0 0 0 ${width} ${notchY + nr}`} 
          stroke="rgba(255,255,255,0.06)" 
          strokeWidth="1.5" 
        />
        <Path 
          d={`M 0 ${notchY + nr} A ${nr} ${nr} 0 0 0 0 ${notchY - nr}`} 
          stroke="rgba(255,255,255,0.06)" 
          strokeWidth="1.5" 
        />

        {/* Improved Perforation line */}
        <Line
          x1={nr + 4}
          y1={notchY}
          x2={width - nr - 4}
          y2={notchY}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1.5"
          strokeDasharray="6 6"
        />
      </Svg>
    </View>
  );
}


function VentaDetailModal({ venta, onClose }: { venta: VentaHoy | null; onClose: () => void }) {
  const [showTicketDots, setShowTicketDots] = useState(true);
  const { colors, formatUSD } = useTheme();
  const { data: details = [], isLoading } = useVentaDetalle(venta?.venta_id ?? null);
  const distinctCount = details.length;
  
  const { height: screenHeight } = Dimensions.get('screen');
  const animProgress = useRef(new Animated.Value(0)).current; 
  const [ticketLayout, setTicketLayout] = useState({ width: 0, height: 0 });

  const closeModal = () => {
    Animated.timing(animProgress, {
      toValue: 0,
      duration: 250,
      useNativeDriver: Platform.OS !== 'web',
    }).start(onClose);
  };

  const handleDownloadPdf = async () => {
    if (!venta || details.length === 0) return;
    try {
      const html = buildVentaPdfHtml(venta, details);
      if (Platform.OS === 'web') {
        await printHtml(html);
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
    }
  };

  const onShow = () => {
    animProgress.setValue(0);
    Animated.spring(animProgress, {
      toValue: 1,
      useNativeDriver: Platform.OS !== 'web',
      tension: 65,
      friction: 11
    }).start();
  };

  useEffect(() => {
    if (venta) {
      onShow();
    }
  }, [venta]);

  if (!venta) return null;

  const totalUSD = Number(venta.total_neto_usd  || venta.total_usd || 0);
  const baseUSD  = venta.total_bruto_usd > 0
    ? Number(venta.total_bruto_usd)
    : totalUSD / 1.16;
  const ivaUSD   = venta.total_impuesto_usd > 0
    ? Number(venta.total_impuesto_usd)
    : totalUSD - baseUSD;
  const pagoModal = getPagoMeta(venta.metodo_pago, colors);

  return (
    <Modal
      visible={!!venta}
      transparent={true}
      animationType="none" // Use custom animation
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      onRequestClose={closeModal}
    >
      <Animated.View 
        style={[
          styles.modalOverlay, 
          { 
            opacity: animProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1]
            }) 
          }
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={closeModal}
        />
        <View style={styles.modalCloseContainer}>
          <Pressable 
            onPress={handleDownloadPdf} 
            style={({ pressed }) => [
              styles.modalCloseBtn,
              { 
                opacity: pressed ? 0.7 : 1, 
                marginRight: 10,
                backgroundColor: colors.primary + '20',
                borderColor: colors.primary + '40'
              }
            ]}
          >
            <Feather name="download" size={20} color={colors.primary} />
          </Pressable>
          <Pressable 
            onPress={closeModal} 
            style={({ pressed }) => [
              styles.modalCloseBtn,
              { opacity: pressed ? 0.7 : 1 }
            ]}
          >
            <Feather name="x" size={24} color="#FFF" />
          </Pressable>
        </View>
        <Animated.View 
          style={[
            styles.modalTicketWindow, 
            { 
              transform: [
                { 
                  scale: animProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1]
                  }) 
                },
                {
                  translateY: animProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [20, 0]
                  })
                }
              ] 
            }
          ]}
        >
          {isLoading ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <ScrollView 
              style={styles.modalScroll}
              contentContainerStyle={styles.modalContentWrapper}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.ticketShadowWrapper}>
                {ticketLayout.width > 0 ? (
                  <TicketBackground 
                    width={ticketLayout.width} 
                    height={ticketLayout.height} 
                    notchY={104}
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: '#222', borderRadius: 24 }]} />
                )}
                
                <View 
                  style={[
                    styles.ticketInnerContent,
                    { paddingBottom: 32 }
                  ]}
                  onLayout={(e) => {
                    const { width, height } = e.nativeEvent.layout;
                    if (Math.abs(ticketLayout.width - width) > 1 || Math.abs(ticketLayout.height - height) > 1) {
                      setTicketLayout({ width, height });
                    }
                  }}
                >
                  {/* Header */}
                  <View style={styles.ticketHeader}>
                    <View style={styles.ticketHeaderLeft}>
                      <Text style={[styles.ticketTitle, { color: colors.textMuted }]}>RECIBO DE VENTA</Text>
                      <Text style={[styles.ticketFolio, { color: colors.text }]}>
                        {venta.documento || `#${venta.venta_id}`}
                      </Text>
                      <Text style={[styles.ticketProducts, { color: colors.textMuted }]}>
                        {distinctCount} {distinctCount === 1 ? 'producto' : 'productos'}
                      </Text>
                    </View>
                    <View style={styles.ticketTimeContainer}>
                      <Text style={[styles.ticketDateLabel, { color: colors.textMuted }]}>FECHA / HORA</Text>
                      <Text style={[styles.ticketDate, { color: colors.text }]}>
                        {new Date(venta.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </Text>
                      <Text style={[styles.ticketTime, { color: colors.text }]}>
                        {new Date(venta.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </Text>
                    </View>
                  </View>

                  <View style={{ height: 32 }} />

                  {/* Items List - Internal scroll for 3+ items */}
                  <View style={{ height: 16 }} />
                  <View style={[styles.ticketListContainer, { maxHeight: 180 }]}>
                    <ScrollView 
                      nestedScrollEnabled={true} 
                      showsVerticalScrollIndicator={false}
                      onScroll={(e) => {
                        const y = e.nativeEvent.contentOffset.y;
                        if (y > 10 && showTicketDots) setShowTicketDots(false);
                        if (y <= 10 && !showTicketDots) setShowTicketDots(true);
                      }}
                      scrollEventThrottle={16}
                    >
                      <View style={styles.ticketList}>
                        {details.map((item) => (
                          <View key={item.id} style={styles.ticketItemRow}>
                            <View style={styles.ticketItemMain}>
                              <Text style={[styles.ticketItemDesc, { color: colors.text }]}>
                                {item.descripcion}
                              </Text>
                              <Text style={[styles.ticketItemQty, { color: colors.textMuted }]}>
                                {item.cantidad} × {formatUSD(item.precio_unitario_usd)}
                              </Text>
                            </View>
                            <Text style={[styles.ticketItemPrice, { color: colors.text }]}>
                              {formatUSD(item.subtotal_usd)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                    
                    {details.length > 3 && (
                      <>
                        <LinearGradient
                          colors={['transparent', 'rgba(34,34,34,0.8)', '#222222']}
                          style={styles.ticketListFade}
                        />
                        {showTicketDots && (
                          <View style={styles.ticketScrollIndicator}>
                            <Text style={[styles.ticketScrollDots, { color: colors.text }]}>...</Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>

                  {/* Footer & Totals */}
                  <View style={styles.ticketFooter}>
                    <View style={{ height: 20 }} />
                    
                    <View style={styles.ticketFooterGrid}>
                      <View style={styles.ticketFooterRow}>
                        <Text style={[styles.ticketFooterLabel, { color: colors.textMuted }]}>MÉTODO</Text>
                        {pagoModal ? (
                          <View style={[styles.pagoChip, { backgroundColor: pagoModal.color + '18', borderColor: pagoModal.color + '40', marginRight: 0 }]}>
                            <Feather name={pagoModal.icon} size={10} color={pagoModal.color} />
                            <Text style={[styles.pagoChipText, { color: pagoModal.color, fontFamily: 'JetBrainsMono_700Bold' }]} numberOfLines={1}>
                              {pagoModal.label}
                            </Text>
                          </View>
                        ) : (
                          <Text style={[styles.ticketFooterValue, { color: colors.text }]}>---</Text>
                        )}
                      </View>
                      <View style={styles.ticketFooterRow}>
                        <Text style={[styles.ticketFooterLabel, { color: colors.textMuted }]}>SUBTOTAL</Text>
                        <Text style={[styles.ticketFooterValue, { color: colors.text }]}>{formatUSD(baseUSD)}</Text>
                      </View>
                      <View style={styles.ticketFooterRow}>
                        <Text style={[styles.ticketFooterLabel, { color: colors.textMuted }]}>IVA (16%)</Text>
                        <Text style={[styles.ticketFooterValue, { color: colors.text }]}>{formatUSD(ivaUSD)}</Text>
                      </View>
                    </View>

                    <View style={[styles.ticketTotalSection, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '30' }]}>
                      <Text style={[styles.ticketTotalLabel, { color: colors.textMuted }]}>TOTAL PAGADO</Text>
                      <View style={styles.ticketTotalValueRow}>
                        <Text style={[styles.ticketTotalCurrency, { color: colors.primary }]}>USD</Text>
                        <Text style={[styles.ticketTotalValue, { color: colors.primary }]}>
                          {formatUSD(totalUSD).replace('$', '')}
                        </Text>
                      </View>
                    </View>
                  </View>
                  
                  {/* Bottom Padding */}
                </View>
              </View>
            </ScrollView>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 110 },
  header: { paddingHorizontal: 16, paddingTop: 12, marginBottom: 20 },
  headerSub: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  title: { fontSize: 26, fontFamily: 'JetBrainsMono_700Bold', marginBottom: 4 },
  dateContext: { fontSize: 10, fontFamily: 'JetBrainsMono_500Medium' },
  subtitle: { fontSize: 13, fontFamily: 'JetBrainsMono_400Regular' },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 10 },
  searchInput: {
    flex: 1,
    height: '100%',
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 16, // Prevents auto-zoom on mobile web
    paddingVertical: 0,
  },
  searchClear: { padding: 4 },


  suggestions: {
    marginTop: 24,
    alignItems: 'center',
    width: '100%',
  },
  suggestionTitle: {
    fontSize: 12,
    fontFamily: 'JetBrainsMono_500Medium',
    marginBottom: 12,
    opacity: 0.7,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  suggestionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  suggestionChipText: {
    fontSize: 12,
    fontFamily: 'JetBrainsMono_500Medium',
  },

  periodRow: {
    flexDirection:     'row',
    gap:               6,
    paddingHorizontal: 16,
    marginBottom:      14,
  },
  periodRowDesktop: { gap: 8, justifyContent: 'flex-start' },
  periodBtn: {
    flex:              1,
    alignItems:        'center',
    paddingVertical:   8,
    borderRadius:      12,
    borderWidth:       0.5,
  },
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

  kpiRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  kpiRowDesktop: { gap: 12 },
  kpiCard: {
    flex: 1,
    padding: 16,
    borderRadius: 18,
    borderWidth: 0.5,
    gap: 4,
  },
  kpiCardDesktop: { flexBasis: 0, padding: 18 },
  kpiLabel: { fontSize: 10, fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 20, fontFamily: 'JetBrainsMono_700Bold' },

  list: { paddingHorizontal: 16, gap: 10 },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 0.5,
    gap: 12,
  },
  bottomPad: { height: 110 },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  docInfo: { gap: 4 },
  docNum: { fontSize: 16, fontFamily: 'JetBrainsMono_700Bold' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
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
    fontSize:      12,
    fontFamily:    'JetBrainsMono_700Bold',
    letterSpacing: 0.2,
  },
  itemsChip: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              3,
    borderRadius:     999,
    borderWidth:      0.5,
    paddingVertical:  2,
    paddingHorizontal: 7,
    marginLeft:       6,
  },
  itemsChipText: {
    fontSize:      10,
    fontFamily:    'JetBrainsMono_700Bold',
    lineHeight:    13,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 16 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 22, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 17, fontFamily: 'JetBrainsMono_700Bold' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 20, fontFamily: 'JetBrainsMono_400Regular' },
  
  modalTicketWindow: {
    width: '92%',
    maxWidth: 500,
    maxHeight: '85%',
    borderRadius: 32,
    overflow: 'visible',
    alignSelf: 'center',
  },
  modalScroll: { 
    borderRadius: 32,
    overflow: 'visible',
  },
  modalContentWrapper: {
    padding: 16,
    paddingBottom: 32,
  },
  ticketShadowWrapper: {
    borderRadius: 24,
    backgroundColor: 'transparent',
    overflow: 'visible',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: '0px 4px 10px rgba(0,0,0,0.3)',
      } as any,
    }),
  },
  ticketInnerContent: {
    paddingTop: 32,
    paddingBottom: 32,
    overflow: 'visible',
  },
  ticketHeader: {
    paddingHorizontal: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  ticketHeaderLeft: { gap: 0 },
  ticketTitle: { fontSize: 9, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.85 },
  ticketFolio: { fontSize: 22, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -0.5 },
  ticketProducts: { fontSize: 10, fontFamily: 'JetBrainsMono_500Medium', marginTop: 4, opacity: 0.95 },
  ticketTimeContainer: { alignItems: 'flex-end', gap: 0 },
  ticketDateLabel: { fontSize: 9, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1, opacity: 0.85, marginBottom: 2 },
  ticketDate: { fontSize: 12, fontFamily: 'JetBrainsMono_700Bold' },
  ticketTime: { fontSize: 10, fontFamily: 'JetBrainsMono_500Medium', opacity: 0.9 },
  
  ticketSeparatorContainer: {
    height: 30,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 12,
  },
  ticketDashedLine: {
    fontSize: 16,
    fontFamily: 'JetBrainsMono_400Regular',
    letterSpacing: 4,
    opacity: 0.35, // Increased visibility
    textAlign: 'center',
  },
  
  ticketListContainer: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  ticketList: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
  ticketListFade: {
    position: 'absolute',
    bottom: 0,
    left: 24,
    right: 24,
    height: 45,
    pointerEvents: 'none',
  },
  ticketScrollIndicator: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    alignItems: 'center',
    opacity: 0.5,
  },
  ticketScrollDots: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
    lineHeight: 20,
  },
  ticketItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start', // Top aligned for wrapped text
    marginBottom: 20,
  },
  ticketItemMain: { flex: 1, gap: 2, paddingRight: 16 },
  ticketItemDesc: { fontSize: 13, fontFamily: 'JetBrainsMono_700Bold', lineHeight: 18 },
  ticketItemQty: { fontSize: 11, fontFamily: 'JetBrainsMono_500Medium', opacity: 0.85, marginTop: 2 },
  ticketItemPrice: { fontSize: 15, fontFamily: 'JetBrainsMono_700Bold' },

  ticketFooter: {
    paddingHorizontal: 24,
    marginTop: 10,
  },
  ticketFooterGrid: {
    gap: 14,
    marginBottom: 32,
  },
  ticketFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketFooterLabel: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.85 },
  ticketFooterValue: { fontSize: 18, fontFamily: 'JetBrainsMono_700Bold' },

  ticketTotalSection: {
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 8,
  },
  ticketTotalLabel: { fontSize: 11, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1.5, marginBottom: 8, opacity: 0.85 },
  ticketTotalValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketTotalCurrency: { fontSize: 16, fontFamily: 'JetBrainsMono_700Bold', marginTop: 4 },
  ticketTotalValue: { fontSize: 42, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -1 },

  modalLoading: { height: 200, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseContainer: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
});
