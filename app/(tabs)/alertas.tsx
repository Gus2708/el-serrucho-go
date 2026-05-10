import * as React from 'react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  InteractionManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { useTheme } from '../../src/theme/ThemeContext';
import { useInventarioStore } from '../../src/hooks/useInventarioStore';
import { useAlertas, resolverAnomalia } from '../../src/hooks/useAlertas';
import { StockAlertCard, AnomaliaCard } from '../../src/components/AlertCard';
import { supabase } from '../../src/lib/supabase';
import type { AlertaStockRow, Anomalia } from '../../src/lib/supabase';

type StockFilter = 'todos' | 'sin_stock' | 'stock_negativo' | 'margen_negativo' | 'stock_muerto';

const STOCK_FILTERS: { key: StockFilter; label: string }[] = [
  { key: 'todos',           label: 'Todos'      },
  { key: 'stock_negativo',  label: 'Negativo'   },
  { key: 'sin_stock',       label: 'Sin stock'  },
  { key: 'margen_negativo', label: 'Margen'     },
  { key: 'stock_muerto',    label: 'Muerto'     },
];

type ListItem = 
  | { type: 'header', title: string, count: number }
  | { type: 'anomalia', data: Anomalia }
  | { type: 'empty-anomalias' }
  | { type: 'filters' }
  | { type: 'stock-alert', data: AlertaStockRow }
  | { type: 'empty-stock' }
  | { type: 'spacer', height: number };

export default function Alertas() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const listRef = useRef<FlashList<any>>(null);
  const { scrollOffsetAlertas, setScrollOffsetAlertas } = useInventarioStore();

  const [stockFilter,   setStockFilter]   = useState<StockFilter>('todos');
  const [refreshing,    setRefreshing]    = useState(false);
  const [analyzing,     setAnalyzing]     = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);
  const [isReady,       setIsReady]       = useState(false);

  // Restaurar scroll
  useFocusEffect(
    useCallback(() => {
      if (scrollOffsetAlertas > 0 && listRef.current) {
        const timer = setTimeout(() => {
          listRef.current?.scrollToOffset({ offset: scrollOffsetAlertas, animated: false });
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [scrollOffsetAlertas])
  );

  // Guardar scroll
  const handleScroll = (event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset >= 0) {
      setScrollOffsetAlertas(offset);
    }
  };

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setIsReady(true);
    });
    return () => task.cancel();
  }, []);

  const { stockAlertas, anomalias, isLoading } = useAlertas();

  const listData = useMemo(() => {
    if (!isReady) return [];

    const items: ListItem[] = [];
    
    // ── AI Anomalies ──
    items.push({ type: 'header', title: 'Anomalías IA', count: anomalias.length });
    
    if (isLoading) {
      // Show loading placeholder if initial load
    } else if (anomalias.length === 0) {
      items.push({ type: 'empty-anomalias' });
    } else {
      anomalias.forEach(a => items.push({ type: 'anomalia', data: a }));
    }

    // ── Stock Alerts ──
    items.push({ type: 'header', title: 'Alertas de stock', count: stockAlertas.length });
    items.push({ type: 'filters' });

    const filtered = stockFilter === 'todos'
      ? stockAlertas
      : stockAlertas.filter(a => a.tipo_alerta === stockFilter);

    if (isLoading) {
      // Spinner handled by FlashList footer or similar if needed, 
      // but here we use the isLoading flag globally for simplicity
    } else if (filtered.length === 0) {
      items.push({ type: 'empty-stock' });
    } else {
      filtered.forEach(a => items.push({ type: 'stock-alert', data: a }));
    }

    items.push({ type: 'spacer', height: 110 });
    return items;
  }, [isReady, anomalias, stockAlertas, isLoading, stockFilter]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['alertas-stock'] }),
      queryClient.invalidateQueries({ queryKey: ['anomalias'] }),
    ]);
    setRefreshing(false);
  }

  async function handleResolve(id: number) {
    await resolverAnomalia(id);
    queryClient.invalidateQueries({ queryKey: ['anomalias'] });
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalyzeResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('detect-anomalies');
      if (error) throw error;
      const { checked = 0, flagged = 0 } = data ?? {};
      setAnalyzeResult(`Revisados ${checked} productos · ${flagged} sospechosos detectados`);
      await queryClient.invalidateQueries({ queryKey: ['anomalias'] });
    } catch (e: any) {
      setAnalyzeResult('Error al contactar Gemini · intenta de nuevo');
    } finally {
      setAnalyzing(false);
    }
  }

  const totalCount = stockAlertas.length + anomalias.length;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>Alertas</Text>
        {!isLoading && totalCount > 0 && (
          <View style={[styles.badge, { backgroundColor: colors.danger + '22', borderColor: colors.danger + '55' }]}>
            <Text style={[styles.badgeText, { color: colors.danger }]}>{totalCount}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Pressable
          style={({ pressed }) => [
            styles.analyzeBtn,
            { backgroundColor: analyzing ? colors.surfaceAlt : colors.primaryFaded, borderColor: colors.primary + '55' },
            pressed && { opacity: 0.75 },
          ]}
          onPress={handleAnalyze}
          disabled={analyzing}
        >
          {analyzing
            ? <ActivityIndicator size={13} color={colors.primary} />
            : <Feather name="cpu" size={13} color={colors.primary} />
          }
          <Text style={[styles.analyzeBtnText, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
            {analyzing ? 'Analizando…' : 'Analizar con IA'}
          </Text>
        </Pressable>
      </View>

      {analyzeResult && (
        <View style={[styles.resultBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Feather name="zap" size={12} color={colors.primary} />
          <Text style={[styles.resultText, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>{analyzeResult}</Text>
        </View>
      )}

      {isLoading && isReady && listData.length === 0 && (
        <View style={styles.fullLoading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {!isReady ? (
        <View style={styles.fullLoading}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlashList
          ref={listRef}
          data={listData}
          keyExtractor={(item, index) => {
             if (item.type === 'anomalia') return `anom-${item.data.id}`;
             if (item.type === 'stock-alert') return `stock-${item.data.codigo_interno}`;
             return `item-${item.type}-${index}`;
          }}
          estimatedItemSize={80}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => {
            switch (item.type) {
              case 'header':
                return <SectionHeader title={item.title} count={item.count} />;
              case 'anomalia':
                return <AnomaliaCard anomalia={item.data} onResolve={handleResolve} />;
              case 'empty-anomalias':
                return (
                  <View style={styles.emptyRow}>
                    <Feather name="check-circle" size={16} color={colors.success} />
                    <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                      Sin anomalías activas
                    </Text>
                  </View>
                );
              case 'filters':
                return (
                  <View style={styles.chips}>
                    {STOCK_FILTERS.map(f => {
                      const active = stockFilter === f.key;
                      return (
                        <Pressable
                          key={f.key}
                          style={({ pressed }) => [
                            styles.chip,
                            {
                              backgroundColor: active ? colors.primary : colors.surfaceAlt,
                              borderColor:     active ? colors.primary : colors.border,
                            },
                            pressed && { opacity: 0.75 },
                          ]}
                          onPress={() => setStockFilter(f.key)}
                        >
                          <Text style={[styles.chipText, { color: active ? colors.onPrimary : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                            {f.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              case 'stock-alert':
                return <StockAlertCard alerta={item.data} />;
              case 'empty-stock':
                return (
                  <View style={styles.emptyRow}>
                    <Feather name="check-circle" size={16} color={colors.success} />
                    <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                      Sin alertas de stock
                    </Text>
                  </View>
                );
              case 'spacer':
                return <View style={{ height: item.height }} />;
              default:
                return null;
            }
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sectionHeader]}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
      <View style={[styles.countBadge, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        <Text style={[styles.countText, { color: colors.text }]}>{count}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:  { flex: 1 },

  fullLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            10,
    paddingHorizontal: 16,
    paddingTop:     12,
    paddingBottom:  10,
  },
  title:    { fontSize: 26, fontFamily: 'JetBrainsMono_700Bold' },
  badge:    { borderRadius: 999, borderWidth: 0.5, paddingVertical: 3, paddingHorizontal: 9 },
  badgeText:{ fontSize: 13, fontFamily: 'JetBrainsMono_700Bold' },

  analyzeBtn: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              5,
    borderRadius:     999,
    borderWidth:      0.5,
    paddingVertical:  6,
    paddingHorizontal: 12,
  },
  analyzeBtnText: { fontSize: 11, fontFamily: 'JetBrainsMono_500Medium' },

  resultBanner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    marginHorizontal:  16,
    marginBottom:      8,
    borderRadius:      10,
    borderWidth:       0.5,
    paddingVertical:   8,
    paddingHorizontal: 12,
  },
  resultText: { fontSize: 11, fontFamily: 'JetBrainsMono_400Regular', flex: 1 },

  sectionHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    paddingVertical:   10,
    marginTop:         8,
  },
  sectionTitle: {
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  countBadge: {
    borderRadius:     999,
    borderWidth:      0.5,
    paddingVertical:  2,
    paddingHorizontal: 8,
  },
  countText: { fontSize: 11, fontFamily: 'JetBrainsMono_500Medium' },

  chips: {
    flexDirection:     'row',
    gap:               6,
    paddingHorizontal: 16,
    marginBottom:      10,
    flexWrap:          'wrap',
  },
  chip:     { borderRadius: 999, borderWidth: 0.5, paddingVertical: 5, paddingHorizontal: 12 },
  chipText: { fontSize: 11, fontFamily: 'JetBrainsMono_500Medium' },

  emptyRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    marginHorizontal:  16,
    marginBottom:      8,
    padding:           14,
  },
  emptyText: { fontSize: 13, fontFamily: 'JetBrainsMono_400Regular', flex: 1 },
});
