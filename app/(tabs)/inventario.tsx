import { scaleFont } from '../../src/theme/responsive';
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeContext';
import { useProductos, StockFilter, normalizeSearchTerm } from '../../src/hooks/useProductos';
import { useInventarioStore } from '../../src/hooks/useInventarioStore';
import { useDeviceSize } from '../../src/hooks/useDeviceSize';
import { useTazas } from '../../src/hooks/useTazas';
import { usePresupuestoConfig } from '../../src/hooks/usePresupuestoConfig';
import { ProductRow } from '../../src/components/ProductRow';
import { BarcodeScannerModal } from '../../src/components/BarcodeScannerModal';
import { PressableScale } from '../../src/components/PressableScale';
import { pressScale } from '../../src/theme/motion';
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
  const listRef = useRef<FlashList<Producto>>(null);
  const { isDesktop } = useDeviceSize();
  const [scannerVisible, setScannerVisible] = useState(false);
  const { search, filter, scrollOffset, setSearch, setFilter, setScrollOffset } = useInventarioStore();

  const { data: tasa } = useTazas();
  const { data: presupConfig } = usePresupuestoConfig();
  const bcv = tasa?.bcv_usd ?? 0;
  const markupPct = presupConfig?.markup_porcentaje ?? 30;

  const { productos, isLoading, isFetchingMore, hasMore, fetchMore, error } = useProductos(search, filter);

  // Restaurar scroll al entrar
  useFocusEffect(
    useCallback(() => {
      if (scrollOffset > 0 && listRef.current) {
        // Un pequeño delay asegura que el FlashList esté listo para scrollear
        const timer = setTimeout(() => {
          listRef.current?.scrollToOffset({ offset: scrollOffset, animated: false });
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [scrollOffset])
  );

  // Guardar scroll al mover
  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    // Solo guardamos si es positivo para evitar rebotes raros
    if (offset >= 0) {
      setScrollOffset(offset);
    }
  }, [setScrollOffset]);

  // Dispatcher pattern: stable callback that takes scalar id (no closure over item)
  const handlePress = useCallback((codigo: string) => {
    router.push(`/producto/${codigo}`);
  }, [router]);

  // Stable renderItem — extracted out of JSX so reference doesn't change per render
  const renderItem = useCallback(
    ({ item }: { item: Producto }) => (
      <ProductRow producto={item} onPress={handlePress} bcv={bcv} markupPct={markupPct} />
    ),
    [handlePress, bcv, markupPct]
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
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>Inventario</Text>
      </View>

      {/* Toolbar: search + filter chips. Stacked on mobile, side-by-side on desktop */}
      <View style={isDesktop ? styles.toolbarDesktop : undefined}>
        {/* Search bar */}
        <View style={[
          styles.searchWrap,
          isDesktop && styles.searchWrapDesktop,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}>
          <Feather name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Buscar por nombre o código…"
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={v => setSearch(normalizeSearchTerm(v))}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {search.length > 0 && (
            <PressableScale onPress={() => setSearch('')} hitSlop={8} style={{ marginRight: 6 }} activeScale={pressScale.icon}>
              <Feather name="x" size={16} color={colors.textMuted} />
            </PressableScale>
          )}
          <PressableScale onPress={() => setScannerVisible(true)} hitSlop={8} activeScale={pressScale.icon}>
            <Feather name="camera" size={18} color={colors.primary} />
          </PressableScale>
        </View>

        {/* Filter chips */}
        <View style={[styles.chipsContainer, isDesktop && styles.chipsContainerDesktop]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
          >
            {FILTERS.map(f => {
              const active = filter === f.key;
              return (
                <PressableScale
                  key={f.key}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary : colors.surfaceAlt,
                      borderColor:     active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text style={[
                    styles.chipText,
                    { color: active ? colors.onPrimary : colors.textMuted },
                  ]} numberOfLines={1} adjustsFontSizeToFit>
                    {f.label}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>
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
          ref={listRef}
          data={productos}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={84}
          contentContainerStyle={styles.list}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          ListFooterComponent={
            isFetchingMore
              ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} />
              : null
          }
        />
      )}
      <BarcodeScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={(data) => {
          setSearch(data);
          setScannerVisible(false);
        }}
      />
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
  },
  title: { fontSize: scaleFont(26), fontFamily: 'JetBrainsMono_700Bold', marginBottom: 20 },
  count: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular' },

  toolbarDesktop: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              16,
    paddingHorizontal: 16,
    marginBottom:     14,
  },
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
  searchWrapDesktop: {
    marginHorizontal: 0,
    marginBottom:     0,
    flex:             1,
    maxWidth:         480,
  },
  searchInput: {
    flex:     1,
    fontSize: scaleFont(16), // Prevents auto-zoom on mobile web
    fontFamily: 'JetBrainsMono_400Regular',
  },

  chipsContainer: {
    marginBottom: 12,
  },
  chipsContainerDesktop: {
    flex:         1,
    marginBottom: 0,
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
  chipText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium' },

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
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_400Regular',
  },
});
