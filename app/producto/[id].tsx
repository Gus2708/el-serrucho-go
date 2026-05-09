import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Modal, TextInput, Animated, PanResponder, Dimensions } from 'react-native';

const screenHeight = Dimensions.get('window').height;

import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeContext';
import { CurrencyText } from '../../src/components/CurrencyText';
import { supabase, Producto } from '../../src/lib/supabase';
import { useOrdenCambio } from '../../src/hooks/useOrdenCambio';

export default function ProductoDetail() {
  const { colors, tokens, formatUSD } = useTheme();
  const router  = useRouter();
  const { id }  = useLocalSearchParams<{ id: string }>();
  const addItem = useOrdenCambio(s => s.addItem);
  const items   = useOrdenCambio(s => s.items);

  const [showAddSheet, setShowAddSheet] = useState(false);
  const [newQty,       setNewQty]       = useState('');

  const panY = useRef(new Animated.Value(screenHeight)).current;

  const closeSheet = () => {
    Animated.timing(panY, {
      toValue: screenHeight,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setShowAddSheet(false));
  };

  // Reset animation when sheet opens
  useEffect(() => {
    if (showAddSheet) {
      Animated.spring(panY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 40,
        friction: 8,
      }).start();
    }
  }, [showAddSheet]);

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
        if (gestureState.dy > 100 || gestureState.vy > 0.5) {
          closeSheet();
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

  const { data: producto, isLoading, error } = useQuery({
    queryKey:  ['producto', id],
    queryFn:   () => fetchProducto(id),
    staleTime: 30_000,
  });

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      {/* Nav bar */}
      <View style={[styles.nav, { borderColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
          Detalle de producto
        </Text>
        <View style={styles.navPlaceholder} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error || !producto ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={28} color={colors.danger} />
          <Text style={[styles.errorText, { color: colors.danger }]}>
            Producto no encontrado
          </Text>
        </View>
      ) : (
        <>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Product name + code */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2} adjustsFontSizeToFit>
              {producto.descripcion}
            </Text>
            <View style={styles.codeRow}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Código interno</Text>
              <Text style={[styles.code, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>{producto.codigo_interno}</Text>
            </View>
            {producto.codigo_barras ? (
              <View style={styles.codeRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Código de barras</Text>
                <Text style={[styles.code, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>{producto.codigo_barras}</Text>
              </View>
            ) : null}
            {producto.unidad ? (
              <View style={styles.codeRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Unidad</Text>
                <Text style={[styles.value, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{producto.unidad}</Text>
              </View>
            ) : null}
          </View>

          {/* Pricing + margin */}
          <View style={styles.row2}>
            <StatCard
              label="Precio venta"
              value={formatUSD(producto.precio_venta)}
              valueColor={colors.primary}
              bg={colors.surface}
              border={colors.border}
            />
            <StatCard
              label="Costo"
              value={formatUSD(producto.costo)}
              bg={colors.surface}
              border={colors.border}
            />
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <MarginBar producto={producto} colors={colors} />
          </View>

          {/* Stock */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Existencia actual</Text>
            <StockDisplay producto={producto} colors={colors} />
          </View>

          {/* Last sync */}
          <Text style={[styles.syncNote, { color: colors.textDim }]}>
            Última sincronización:{' '}
            {new Date(producto.actualizado_en).toLocaleString('es-VE', {
              day:    '2-digit',
              month:  'short',
              hour:   '2-digit',
              minute: '2-digit',
            })}
          </Text>

          {/* Add to draft order */}
          <Pressable
            style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primaryFaded, borderColor: colors.primary }, pressed && { opacity: 0.75 }]}
            onPress={() => {
              setNewQty(String(producto.existencia));
              setShowAddSheet(true);
            }}
          >
            <Feather name={items.some(i => i.codigo_producto === producto.codigo_interno) ? 'check' : 'plus'} size={16} color={colors.primary} />
            <Text style={[styles.addBtnText, { color: colors.primary }]}>
              {items.some(i => i.codigo_producto === producto.codigo_interno)
                ? 'En el borrador · editar'
                : 'Agregar al borrador'}
            </Text>
          </Pressable>
        </ScrollView>

        {/* Add to order sheet */}
        <Modal
          visible={showAddSheet}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAddSheet(false)}
        >
          <View style={styles.sheetOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setShowAddSheet(false)}
            />
            <Animated.View 
              style={[
                styles.sheet, 
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
              </View>




              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                Ajustar existencia
              </Text>
              <Text style={[styles.sheetSub, { color: colors.textMuted }]} numberOfLines={1}>
                {producto.descripcion}
              </Text>
              <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>
                Actual: {producto.existencia} uds  ·  Nueva existencia:
              </Text>
              <View style={[styles.qtyWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.qtyInput, { color: colors.text }]}
                  keyboardType="numeric"
                  value={newQty}
                  onChangeText={setNewQty}
                  selectTextOnFocus
                  autoFocus
                />
              </View>
              <Pressable
                style={({ pressed }) => [styles.sheetBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.75 }]}
                onPress={() => {
                  const qty = parseFloat(newQty);
                  if (isNaN(qty) || qty < 0) {
                    Alert.alert('Cantidad inválida', 'Ingresa un número mayor o igual a 0');
                    return;
                  }
                  addItem({
                    codigo_producto:   producto.codigo_interno,
                    descripcion:       producto.descripcion,
                    existencia_actual: producto.existencia,
                    nueva_existencia:  qty,
                    nota:              '',
                  });
                  setShowAddSheet(false);
                }}
              >
                <Text style={[styles.sheetBtnText, { color: colors.onPrimary }]}>
                  Confirmar
                </Text>
              </Pressable>
            </Animated.View>
          </View>
        </Modal>
        </>
      )}
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label, value, valueColor, bg, border,
}: {
  label: string; value: string; valueColor?: string;
  bg: string; border: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: valueColor ?? colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function MarginBar({ producto, colors }: { producto: Producto; colors: any }) {
  if (!producto.precio_venta || producto.precio_venta === 0) return null;
  // precio_venta includes IVA 16% — compare against costo (which is ex-IVA)
  const precioSinIva = producto.precio_venta / 1.16;
  const pct    = ((precioSinIva - producto.costo) / precioSinIva) * 100;
  const isNeg  = pct < 0;
  const barPct = Math.min(Math.abs(pct), 100);
  const barColor = isNeg ? colors.danger : pct < 20 ? colors.warning : colors.success;

  return (
    <View>
      <View style={styles.marginHeader}>
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Margen</Text>
        <Text style={[styles.marginPct, { color: barColor }]} numberOfLines={1} adjustsFontSizeToFit>
          {isNeg ? '-' : ''}{Math.abs(pct).toFixed(1)}%
        </Text>
      </View>
      <View style={[styles.barBg, { backgroundColor: colors.border }]}>
        <View style={[styles.barFill, { width: `${barPct}%` as any, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

function StockDisplay({ producto, colors }: { producto: Producto; colors: any }) {
  const qty     = producto.existencia;
  const isEmpty = qty <= 0;
  const isLow   = qty > 0 && qty <= 5;
  const color   = isEmpty ? colors.danger : isLow ? colors.warning : colors.success;

  return (
    <View style={styles.stockRow}>
      <Text style={[styles.stockQty, { color }]}>{qty}</Text>
      <View style={[styles.stockBadge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
        <Text style={[styles.stockBadgeText, { color }]} numberOfLines={1} adjustsFontSizeToFit>
          {isEmpty ? 'Sin stock' : isLow ? 'Stock bajo' : 'En stock'}
        </Text>
      </View>
    </View>
  );
}

// ── Data fetcher ────────────────────────────────────────────────────────────

async function fetchProducto(id: string): Promise<Producto> {
  const { data, error } = await supabase
    .from('productos')
    .select('*')
    .eq('codigo_interno', id)
    .single();

  if (error) throw error;
  return data as Producto;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:  { flex: 1 },

  nav: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  backBtn:        { padding: 4, marginRight: 4 },
  navTitle:       { flex: 1, fontSize: 16, fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center' },
  navPlaceholder: { width: 30 },

  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            12,
  },
  errorText: { fontSize: 15, fontFamily: 'JetBrainsMono_400Regular' },

  scroll: {
    paddingTop:    16,
    paddingBottom: 40,
    gap:           10,
  },

  card: {
    marginHorizontal: 16,
    borderRadius:     14,
    borderWidth:      0.5,
    padding:          16,
  },

  productName: {
    fontSize:     20,
    fontFamily:   'JetBrainsMono_700Bold',
    lineHeight:   27,
    marginBottom: 10,
  },
  codeRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingVertical: 6,
  },
  label: { fontSize: 13, fontFamily: 'JetBrainsMono_400Regular' },
  code:  { fontSize: 13, fontFamily: 'JetBrainsMono_700Bold' },
  value: { fontSize: 13, fontFamily: 'JetBrainsMono_500Medium' },

  row2: {
    flexDirection:  'row',
    gap:            10,
    marginHorizontal: 16,
  },
  statCard: {
    flex:         1,
    borderRadius: 14,
    borderWidth:  0.5,
    padding:      16,
    alignItems:   'center',
    gap:          6,
  },
  statLabel: { fontSize: 12, fontFamily: 'JetBrainsMono_400Regular' },
  statValue: { fontSize: 22, fontFamily: 'JetBrainsMono_700Bold' },

  sectionLabel: { fontSize: 12, marginBottom: 10, fontFamily: 'JetBrainsMono_400Regular' },

  marginHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   8,
  },
  marginPct: { fontSize: 18, fontFamily: 'JetBrainsMono_700Bold' },
  barBg:     { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill:   { height: 6, borderRadius: 3 },

  stockRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
  },
  stockQty:       { fontSize: 36, fontFamily: 'JetBrainsMono_700Bold' },
  stockBadge:     { borderRadius: 999, borderWidth: 0.5, paddingVertical: 4, paddingHorizontal: 12 },
  stockBadgeText: { fontSize: 13, fontFamily: 'JetBrainsMono_500Medium' },

  syncNote: { fontSize: 11, textAlign: 'center', marginTop: 4, fontFamily: 'JetBrainsMono_400Regular' },

  addBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    marginHorizontal:  16,
    marginTop:         8,
    paddingVertical:   14,
    borderRadius:      14,
    borderWidth:       1,
  },
  addBtnText: { fontSize: 15, fontFamily: 'JetBrainsMono_700Bold' },

  sheetOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    width: '100%',
    overflow: 'hidden',
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 24,
  },
  modalHandleArea: {
    paddingTop: 12,
    paddingBottom: 16,
    alignItems: 'center',
    width: '100%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },
  sheetTitle:   { fontSize: 18, fontFamily: 'JetBrainsMono_700Bold' },
  sheetSub:     { fontSize: 13, fontFamily: 'JetBrainsMono_400Regular' },
  sheetLabel:   { fontSize: 13, fontFamily: 'JetBrainsMono_400Regular' },
  qtyWrap: {
    borderRadius: 12,
    borderWidth:  0.5,
    paddingHorizontal: 16,
    height:       56,
    justifyContent: 'center',
  },
  qtyInput: { fontSize: 28, fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center' },
  sheetBtn: {
    height:         52,
    borderRadius:   12,
    alignItems:     'center',
    justifyContent: 'center',
    marginTop:      4,
  },
  sheetBtnText: { fontSize: 15, fontFamily: 'JetBrainsMono_700Bold' },
});
