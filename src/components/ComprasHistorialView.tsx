import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notify';
import { useComprasHistory, CompraConItems, fetchCompraItemsForEdit } from '../hooks/useComprasHistory';
import { useCompra } from '../hooks/useCompra';

interface ComprasHistorialViewProps {
  onEditRetry?: () => void;   // navega a "Nueva compra" tras precargar el draft
}

export default function ComprasHistorialView({ onEditRetry }: ComprasHistorialViewProps): React.JSX.Element {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { data: compras = [], isLoading, refetch } = useComprasHistory();
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<number | null>(null);
  const loadForEdit = useCompra(s => s.loadForEdit);

  const handleEditRetry = useCallback(async (compra: CompraConItems) => {
    setLoadingEditId(compra.id);
    try {
      const items = await fetchCompraItemsForEdit(compra.id);
      if (items.length === 0) {
        notify('Sin ítems', 'Esta compra no tiene ítems para editar.');
        return;
      }
      loadForEdit({
        compraId:        compra.id,
        proveedorCodigo: compra.proveedor_codigo,
        proveedorNombre: compra.proveedor_nombre,
        nota:            compra.nota ?? '',
        numeroDocumento: compra.numero_documento ?? '',
        items,
      });
      onEditRetry?.();
    } catch (e: any) {
      notify('Error', e.message ?? 'No se pudieron cargar los ítems de la compra.');
    } finally {
      setLoadingEditId(null);
    }
  }, [loadForEdit, onEditRetry]);

  // Realtime: refresca el historial cuando el backend actualiza el estado de una compra.
  useEffect(() => {
    const channel = supabase
      .channel('compras-history-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compras_app' }, () => {
        queryClient.refetchQueries({ queryKey: ['compras-history'], type: 'all' });
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

  if (compras.length === 0) {
    return (
      <View style={styles.center}>
        <Feather name="inbox" size={32} color={colors.textDim} />
        <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Sin historial de compras</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      {compras.map(compra => (
        <CompraHistCard
          key={compra.id}
          compra={compra}
          expanded={expandedId === compra.id}
          onToggleExpand={() => setExpandedId(prev => (prev === compra.id ? null : compra.id))}
          onEditRetry={() => handleEditRetry(compra)}
          isLoadingEdit={loadingEditId === compra.id}
        />
      ))}
      <View style={{ height: 150 }} />
    </ScrollView>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface CompraHistCardProps {
  compra:         CompraConItems;
  expanded:       boolean;
  onToggleExpand: () => void;
  onEditRetry:    () => void;
  isLoadingEdit:  boolean;
}

function CompraHistCard({ compra, expanded, onToggleExpand, onEditRetry, isLoadingEdit }: CompraHistCardProps): React.JSX.Element {
  const { colors } = useTheme();
  const dateStr = new Date(compra.creado_en).toLocaleString('es-VE', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const showResultado = compra.backend_status === 'error' && Boolean(compra.backend_resultado);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.histCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && showResultado && { opacity: 0.75 },
      ]}
      onPress={showResultado ? onToggleExpand : undefined}
    >
      <View style={styles.histTop}>
        <Text style={[styles.histId, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
          C-{String(compra.id).padStart(4, '0')}
        </Text>
        <BackendChip status={compra.backend_status} aplicadoEn={compra.backend_aplicado_en} />
      </View>

      {compra.proveedor_nombre ? (
        <Text style={[styles.histClient, { color: colors.text }]} numberOfLines={1}>
          <Feather name="truck" size={12} /> {compra.proveedor_nombre}
        </Text>
      ) : null}

      <Text style={[styles.histMeta, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
        {dateStr}
        {'  ·  '}{compra.item_count} ítem{compra.item_count !== 1 ? 's' : ''}
        {compra.creado_por_nombre ? `  ·  ${compra.creado_por_nombre}` : ''}
        {compra.numero_documento ? `  ·  Doc: ${compra.numero_documento}` : ''}
      </Text>

      {compra.nota ? (
        <Text style={[styles.histNota, { color: colors.textMuted }]} numberOfLines={1}>
          {compra.nota}
        </Text>
      ) : null}

      {showResultado ? (
        <View style={styles.expandHintRow}>
          <Text style={[styles.expandHint, { color: colors.danger }]}>
            {expanded ? 'Ocultar detalle' : 'Ver detalle del error'}
          </Text>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.danger} />
        </View>
      ) : null}

      {expanded && showResultado ? (
        <View style={[styles.resultadoBox, { backgroundColor: colors.danger + '12', borderColor: colors.danger + '30' }]}>
          <Text style={[styles.resultadoText, { color: colors.danger }]}>{compra.backend_resultado}</Text>
          <View style={styles.resultadoWarnRow}>
            <Feather name="alert-octagon" size={12} color={colors.warning} style={{ marginTop: 1 }} />
            <Text style={[styles.resultadoWarn, { color: colors.warning }]}>
              Antes de volver a emitirla, verifica en Hybrid si la compra ya se registró: re-emitir duplicaría el ingreso de stock.
            </Text>
          </View>
          <Pressable
            onPress={onEditRetry}
            disabled={isLoadingEdit}
            style={({ pressed }) => [
              styles.editRetryBtn,
              { borderColor: colors.primary },
              (pressed || isLoadingEdit) && { opacity: 0.7 },
            ]}
          >
            {isLoadingEdit ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Feather name="edit-2" size={13} color={colors.primary} />
                <Text style={[styles.editRetryBtnText, { color: colors.primary }]}>Editar y reintentar</Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

// ── Backend status chip ───────────────────────────────────────────────────────

interface BackendChipProps {
  status:     CompraConItems['backend_status'];
  aplicadoEn: string | null;
}

function BackendChip({ status, aplicadoEn }: BackendChipProps): React.JSX.Element {
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
    const dateStr = aplicadoEn
      ? new Date(aplicadoEn).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
      : null;
    return (
      <View style={[styles.chip, { backgroundColor: colors.success + '18', borderColor: colors.success + '40' }]}>
        <Feather name="check" size={10} color={colors.success} />
        <Text style={[styles.chipText, { color: colors.success }]} numberOfLines={1}>
          REGISTRADA EN HYBRID{dateStr ? ` · ${dateStr}` : ''}
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
  editRetryBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               6,
    alignSelf:         'flex-start',
    borderWidth:       1,
    borderRadius:      999,
    paddingVertical:   6,
    paddingHorizontal: 12,
    marginTop:         2,
  },
  editRetryBtnText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },
});
