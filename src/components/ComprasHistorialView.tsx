import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { useComprasHistory, CompraConItems } from '../hooks/useComprasHistory';

export default function ComprasHistorialView(): React.JSX.Element {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { data: compras = [], isLoading, refetch } = useComprasHistory();
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
}

function CompraHistCard({ compra, expanded, onToggleExpand }: CompraHistCardProps): React.JSX.Element {
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
      </Text>

      {compra.nota ? (
        <Text style={[styles.histNota, { color: colors.textMuted }]} numberOfLines={1}>
          {compra.nota}
        </Text>
      ) : null}

      {expanded && showResultado ? (
        <View style={[styles.resultadoBox, { backgroundColor: colors.danger + '12', borderColor: colors.danger + '30' }]}>
          <Text style={[styles.resultadoText, { color: colors.danger }]}>{compra.backend_resultado}</Text>
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
  },
  resultadoText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(16) },
});
