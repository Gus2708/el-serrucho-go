import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { spring, timing, staggerDelay } from '../theme/motion';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notify';
import { usePedidosHistory, PedidoConItems, fetchPedidoItemsForEdit } from '../hooks/usePedidosHistory';
import { usePedido } from '../hooks/usePedido';
import { PressableScale } from './PressableScale';
import PedidoStatusModal from './PedidoStatusModal';

interface PedidosHistorialViewProps {
  onEditRetry?: () => void;   // navega a "Nuevo pedido" tras precargar el draft
}

export default function PedidosHistorialView({ onEditRetry }: PedidosHistorialViewProps): React.JSX.Element {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { data: pedidos = [], isLoading, refetch } = usePedidosHistory();
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<number | null>(null);
  const [statusModalPedido, setStatusModalPedido] = useState<PedidoConItems | null>(null);
  const loadForEdit = usePedido(s => s.loadForEdit);

  const handleEditRetry = useCallback(async (pedido: PedidoConItems) => {
    setLoadingEditId(pedido.id);
    try {
      const items = await fetchPedidoItemsForEdit(pedido.id);
      if (items.length === 0) {
        notify('Sin ítems', 'Este pedido no tiene ítems para editar.');
        return;
      }
      loadForEdit({
        pedidoId:      pedido.id,
        clienteCodigo: pedido.cliente_codigo,
        clienteNombre: pedido.cliente_nombre,
        nota:          pedido.nota ?? '',
        items,
      });
      onEditRetry?.();
    } catch (e: any) {
      notify('Error', e.message ?? 'No se pudieron cargar los ítems del pedido.');
    } finally {
      setLoadingEditId(null);
    }
  }, [loadForEdit, onEditRetry]);

  // Realtime: refresca el historial cuando el backend actualiza el estado de un pedido.
  useEffect(() => {
    const channel = supabase
      .channel('pedidos-history-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_app' }, () => {
        queryClient.refetchQueries({ queryKey: ['pedidos-history'], type: 'all' });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (pedidos.length === 0) {
    return (
      <View style={styles.center}>
        <Feather name="inbox" size={32} color={colors.textDim} />
        <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Sin historial de pedidos</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {pedidos.map((pedido, index) => (
          <PedidoHistCard
            key={pedido.id}
            index={index}
            pedido={pedido}
            expanded={expandedId === pedido.id}
            onToggleExpand={() => setExpandedId(prev => (prev === pedido.id ? null : pedido.id))}
            onEditRetry={() => handleEditRetry(pedido)}
            onOpenStatusModal={() => setStatusModalPedido(pedido)}
            isLoadingEdit={loadingEditId === pedido.id}
          />
        ))}
        <View style={{ height: 150 }} />
      </ScrollView>

      {statusModalPedido && (
        <PedidoStatusModal
          visible={Boolean(statusModalPedido)}
          pedidoId={statusModalPedido.id}
          initialCliente={statusModalPedido.cliente_nombre}
          initialItemCount={statusModalPedido.item_count}
          onClose={() => setStatusModalPedido(null)}
          onProceed={() => setStatusModalPedido(null)}
        />
      )}
    </>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface PedidoHistCardProps {
  pedido:            PedidoConItems;
  expanded:          boolean;
  onToggleExpand:    () => void;
  onEditRetry:       () => void;
  onOpenStatusModal: () => void;
  isLoadingEdit:     boolean;
  index?:            number;
}

function PedidoHistCard({ pedido, expanded, onToggleExpand, onEditRetry, onOpenStatusModal, isLoadingEdit, index = 0 }: PedidoHistCardProps): React.JSX.Element {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(staggerDelay(index), withTiming(1, timing.enter));
  }, [index, progress]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduced
      ? []
      : [{ translateY: (1 - progress.value) * 10 }, { scale: 0.96 + progress.value * 0.04 }],
  }));

  const dateStr = new Date(pedido.creado_en).toLocaleString('es-VE', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const showResultado = pedido.backend_status === 'error' && Boolean(pedido.backend_resultado);

  return (
    <Animated.View
      style={[
        styles.histCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
        enterStyle,
      ]}
    >
      <View style={styles.histTop}>
        <Text style={[styles.histId, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
          PED-{String(pedido.id).padStart(4, '0')}
        </Text>
        <PressableScale onPress={onOpenStatusModal} activeScale={0.94}>
          <BackendChip
            status={pedido.backend_status}
            aplicadoEn={pedido.backend_aplicado_en}
            documento={pedido.documento_hybrid}
          />
        </PressableScale>
      </View>

      {pedido.cliente_nombre ? (
        <Text style={[styles.histClient, { color: colors.text }]} numberOfLines={1}>
          <Feather name="user" size={12} /> {pedido.cliente_nombre}
        </Text>
      ) : null}

      <Text style={[styles.histMeta, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
        {dateStr}
        {'  ·  '}{pedido.item_count} ítem{pedido.item_count !== 1 ? 's' : ''}
        {pedido.creado_por_nombre ? `  ·  ${pedido.creado_por_nombre}` : ''}
      </Text>

      {pedido.backend_status === 'completado' && pedido.documento_hybrid ? (
        <View style={[styles.cajaBox, { backgroundColor: colors.success + '10', borderColor: colors.success + '30' }]}>
          <Feather name="shopping-bag" size={12} color={colors.success} />
          <Text style={[styles.cajaText, { color: colors.success }]} numberOfLines={1}>
            Pedido N° {pedido.documento_hybrid} — pendiente en caja para facturar
          </Text>
        </View>
      ) : null}

      {pedido.nota ? (
        <Text style={[styles.histNota, { color: colors.textMuted }]} numberOfLines={1}>
          {pedido.nota}
        </Text>
      ) : null}

      {expanded && showResultado ? (
        <View style={[styles.resultadoBox, { backgroundColor: colors.danger + '12', borderColor: colors.danger + '30' }]}>
          <Text style={[styles.resultadoText, { color: colors.danger }]}>{pedido.backend_resultado}</Text>
          <View style={styles.resultadoWarnRow}>
            <Feather name="alert-octagon" size={12} color={colors.warning} style={{ marginTop: 1 }} />
            <Text style={[styles.resultadoWarn, { color: colors.warning }]}>
              Antes de reintentarlo, revisa en caja si el pedido ya apareció: re-emitir crearía un pedido duplicado.
            </Text>
          </View>
        </View>
      ) : null}

      {/* Acciones para pedidos en error */}
      {showResultado ? (
        <View style={styles.actionRow}>
          <PressableScale onPress={onToggleExpand} hitSlop={6} style={styles.expandHintRow}>
            <Text style={[styles.expandHint, { color: colors.danger }]}>
              {expanded ? 'Ocultar detalle' : 'Ver detalle del error'}
            </Text>
            <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.danger} />
          </PressableScale>
          <PressableScale
            onPress={onEditRetry}
            disabled={isLoadingEdit}
            dimmed={isLoadingEdit}
            style={[styles.editRetryBtn, { backgroundColor: colors.primary }]}
          >
            {isLoadingEdit ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <>
                <Feather name="edit-2" size={13} color={colors.onPrimary} />
                <Text style={[styles.editRetryBtnText, { color: colors.onPrimary }]}>Editar y reintentar</Text>
              </>
            )}
          </PressableScale>
        </View>
      ) : null}
    </Animated.View>
  );
}

// ── Backend status chip ───────────────────────────────────────────────────────

interface BackendChipProps {
  status:     PedidoConItems['backend_status'];
  aplicadoEn: string | null;
  documento:  string | null;
}

function BackendChip({ status, aplicadoEn, documento }: BackendChipProps): React.JSX.Element {
  const { colors } = useTheme();

  if (status === 'error') {
    return (
      <View style={[styles.chip, { backgroundColor: colors.danger + '18', borderColor: colors.danger + '40' }]}>
        <Feather name="alert-triangle" size={10} color={colors.danger} />
        <Text style={[styles.chipText, { color: colors.danger }]} numberOfLines={1}>ERROR</Text>
      </View>
    );
  }

  if (status === 'aplicando') {
    return (
      <View style={[styles.chip, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '40' }]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.chipText, { color: colors.primary }]} numberOfLines={1}>REGISTRANDO…</Text>
      </View>
    );
  }

  if (status === 'completado') {
    return (
      <View style={[styles.chip, { backgroundColor: colors.success + '18', borderColor: colors.success + '40' }]}>
        <Feather name="check" size={10} color={colors.success} />
        <Text style={[styles.chipText, { color: colors.success }]} numberOfLines={1}>
          EN CAJA{documento ? ` · N° ${documento}` : ''}
        </Text>
      </View>
    );
  }

  // pendiente
  return (
    <View style={[styles.chip, { backgroundColor: colors.warning + '18', borderColor: colors.warning + '40' }]}>
      <Feather name="clock" size={10} color={colors.warning} />
      <Text style={[styles.chipText, { color: colors.warning }]} numberOfLines={1}>EN COLA</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { paddingTop: 12, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },

  histCard: {
    marginHorizontal: 16,
    borderRadius:     12,
    borderWidth:      0.5,
    padding:          14,
    gap:              6,
  },
  histTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  histId: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  histClient: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold', marginTop: 4 },
  histMeta:   { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },
  histNota:   { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },

  cajaBox: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    marginTop:         4,
    paddingVertical:   6,
    paddingHorizontal: 10,
    borderRadius:      8,
    borderWidth:       0.5,
  },
  cajaText: { flex: 1, fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },

  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   3,
    paddingHorizontal: 10,
  },
  chipText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },

  resultadoBox: {
    marginTop:    6,
    padding:      10,
    borderRadius: 8,
    borderWidth:  0.5,
    gap:          8,
  },
  resultadoText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(16) },
  expandHintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  expandHint: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },
  resultadoWarnRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           6,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(128,128,128,0.2)',
    paddingTop:    8,
  },
  resultadoWarn: { flex: 1, fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_700Bold', lineHeight: scaleFont(14) },
  actionRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
    marginTop:      8,
  },
  editRetryBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               6,
    borderRadius:      999,
    paddingVertical:   8,
    paddingHorizontal: 14,
  },
  editRetryBtnText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },
});
