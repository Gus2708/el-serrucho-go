import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/theme/ThemeContext';
import { useAlertas, resolverAnomalia } from '../../src/hooks/useAlertas';
import { StockAlertCard, AnomaliaCard } from '../../src/components/AlertCard';
import { supabase } from '../../src/lib/supabase';
import type { AlertaStockRow } from '../../src/lib/supabase';

type StockFilter = 'todos' | 'sin_stock' | 'stock_negativo' | 'margen_negativo' | 'stock_muerto';

const STOCK_FILTERS: { key: StockFilter; label: string }[] = [
  { key: 'todos',           label: 'Todos'      },
  { key: 'stock_negativo',  label: 'Negativo'   },
  { key: 'sin_stock',       label: 'Sin stock'  },
  { key: 'margen_negativo', label: 'Margen'     },
  { key: 'stock_muerto',    label: 'Muerto'     },
];

export default function AlertasScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const [stockFilter,   setStockFilter]   = useState<StockFilter>('todos');
  const [refreshing,    setRefreshing]    = useState(false);
  const [analyzing,     setAnalyzing]     = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);

  const { stockAlertas, anomalias, isLoading } = useAlertas();

  const filteredStock: AlertaStockRow[] = stockFilter === 'todos'
    ? stockAlertas
    : stockAlertas.filter(a => a.tipo_alerta === stockFilter);

  async function handleRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['alertas-stock'] });
    await queryClient.invalidateQueries({ queryKey: ['anomalias'] });
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
        <Text style={[styles.title, { color: colors.text }]}>Alertas</Text>
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
          <Text style={[styles.analyzeBtnText, { color: colors.primary }]}>
            {analyzing ? 'Analizando…' : 'Analizar con IA'}
          </Text>
        </Pressable>
      </View>

      {analyzeResult && (
        <View style={[styles.resultBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Feather name="zap" size={12} color={colors.primary} />
          <Text style={[styles.resultText, { color: colors.textMuted }]}>{analyzeResult}</Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* ── AI Anomalies ── */}
          <SectionHeader title="Anomalías IA" count={anomalias.length} />

          {anomalias.length === 0 ? (
            <View style={styles.emptyRow}>
              <Feather name="check-circle" size={16} color={colors.success} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                Sin anomalías activas · Gemini no detectó nada sospechoso
              </Text>
            </View>
          ) : (
            anomalias.map(a => (
              <AnomaliaCard key={a.id} anomalia={a} onResolve={handleResolve} />
            ))
          )}

          {/* ── Stock Alerts ── */}
          <SectionHeader title="Alertas de stock" count={stockAlertas.length} />

          {/* Filter chips */}
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
                  <Text style={[styles.chipText, { color: active ? colors.onPrimary : colors.textMuted }]}>
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {filteredStock.length === 0 ? (
            <View style={styles.emptyRow}>
              <Feather name="check-circle" size={16} color={colors.success} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                Sin alertas para este filtro
              </Text>
            </View>
          ) : (
            filteredStock.map(a => (
              <StockAlertCard key={a.codigo_interno} alerta={a} />
            ))
          )}

          <View style={styles.bottomPad} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sectionHeader]}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{title}</Text>
      <View style={[styles.countBadge, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        <Text style={[styles.countText, { color: colors.text }]}>{count}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:  { flex: 1 },

  header: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            10,
    paddingHorizontal: 16,
    paddingTop:     12,
    paddingBottom:  10,
  },
  title:    { fontSize: 26, fontWeight: '700' },
  badge:    { borderRadius: 999, borderWidth: 0.5, paddingVertical: 3, paddingHorizontal: 9 },
  badgeText:{ fontSize: 13, fontWeight: '700' },

  analyzeBtn: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              5,
    borderRadius:     999,
    borderWidth:      0.5,
    paddingVertical:  6,
    paddingHorizontal: 12,
  },
  analyzeBtnText: { fontSize: 11, fontWeight: '600' },

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
  resultText: { fontSize: 11, flex: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingBottom: 0 },

  sectionHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    paddingVertical:   10,
    marginTop:         8,
  },
  sectionTitle: {
    fontSize:      11,
    fontWeight:    '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  countBadge: {
    borderRadius:     999,
    borderWidth:      0.5,
    paddingVertical:  2,
    paddingHorizontal: 8,
  },
  countText: { fontSize: 11, fontWeight: '600' },

  chips: {
    flexDirection:     'row',
    gap:               6,
    paddingHorizontal: 16,
    marginBottom:      10,
    flexWrap:          'wrap',
  },
  chip:     { borderRadius: 999, borderWidth: 0.5, paddingVertical: 5, paddingHorizontal: 12 },
  chipText: { fontSize: 11, fontWeight: '500' },

  emptyRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    marginHorizontal:  16,
    marginBottom:      8,
    padding:           14,
  },
  emptyText: { fontSize: 13, flex: 1 },

  bottomPad: { height: 110 },
});
