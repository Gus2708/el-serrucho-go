import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeContext';
import { useProductos, StockFilter } from '../../src/hooks/useProductos';
import { ProductRow } from '../../src/components/ProductRow';
import type { Producto } from '../../src/lib/supabase';

const FILTERS: { key: StockFilter; label: string }[] = [
  { key: 'todos',           label: 'Todos'           },
  { key: 'sin_stock',       label: 'Sin stock'       },
  { key: 'stock_bajo',      label: 'Stock bajo'      },
  { key: 'margen_negativo', label: 'Margen negativo' },
];

export default function Inventario() {
  const { colors } = useTheme();
  const router = useRouter();

  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState<StockFilter>('todos');

  const { productos, isLoading, isFetchingMore, hasMore, fetchMore, error } = useProductos(search, filter);

  // Dispatcher pattern: stable callback that takes scalar id (no closure over item)
  const handlePress = useCallback((codigo: string) => {
    router.push(`/producto/${codigo}`);
  }, [router]);

  // Stable renderItem — extracted out of JSX so reference doesn't change per render
  const renderItem = useCallback(
    ({ item }: { item: Producto }) => (
      <ProductRow producto={item} onPress={handlePress} />
    ),
    [handlePress]
  );

  const keyExtractor = useCallback((p: Producto) => p.codigo_interno, []);

  const handleEndReached = useCallback(() => {
    if (hasMore && !isFetchingMore) fetchMore();
  }, [hasMore, isFetchingMore, fetchMore]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Inventario</Text>
      </View>

      {/* Search bar */}
      <View style={[styles.searchWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Buscar por nombre o código…"
          placeholderTextColor={colors.textDim}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8} style={({ pressed }) => pressed && { opacity: 0.6 }}>
            <Feather name="x" size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Filter chips */}
      <View style={styles.chipsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          {FILTERS.map(f => {
            const active = filter === f.key;
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
                onPress={() => setFilter(f.key)}
              >
                <Text style={[
                  styles.chipText,
                  { color: active ? colors.onPrimary : colors.textMuted },
                ]} numberOfLines={1} adjustsFontSizeToFit>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={24} color={colors.danger} />
          <Text style={[styles.emptyText, { color: colors.danger }]}>
            Error al cargar productos
          </Text>
        </View>
      ) : productos.length === 0 ? (
        <View style={styles.center}>
          <Feather name="package" size={32} color={colors.textDim} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            Sin resultados
          </Text>
        </View>
      ) : (
        <FlashList
          data={productos}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={84}
          contentContainerStyle={styles.list}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            isFetchingMore
              ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} />
              : null
          }
        />
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1 },

  header: {
    flexDirection:  'row',
    alignItems:     'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop:     12,
    paddingBottom:  10,
  },
  title: { fontSize: 26, fontFamily: 'JetBrainsMono_700Bold' },
  count: { fontSize: 13, fontFamily: 'JetBrainsMono_400Regular' },

  searchWrap: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    marginHorizontal:  16,
    marginBottom:      10,
    paddingHorizontal: 14,
    height:            44,
    borderRadius:      12,
    borderWidth:       0.5,
  },
  searchInput: {
    flex:     1,
    fontSize: 14,
    fontFamily: 'JetBrainsMono_400Regular',
  },

  chipsContainer: {
    marginBottom: 12,
  },
  chipsContent: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    borderRadius:     999,
    borderWidth:      0.5,
    paddingVertical:  6,
    paddingHorizontal: 14,
  },
  chipText: { fontSize: 12, fontFamily: 'JetBrainsMono_500Medium' },

  list: {
    paddingTop:    4,
    paddingBottom: 120,
  },

  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            12,
    paddingBottom:  80,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_400Regular',
  },
});
