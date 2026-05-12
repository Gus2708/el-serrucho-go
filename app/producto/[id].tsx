import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, Animated, PanResponder, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { notify } from '../../src/lib/notify';

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
  const [adjMode,      setAdjMode]      = useState<'fixed' | 'relative'>('fixed');
  const [adjOp,        setAdjOp]        = useState<'+' | '-'>('+');

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
        <Pressable 
          onPress={() => {
            // Navegamos explícitamente al inventario para asegurar el destino.
            // La pantalla de Inventario se encargará de restaurar el scroll manualmente
            // usando la posición guardada en el Store (Zustand).
            router.navigate('/inventario');
          }} 
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
        >
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

          {/* Add to draft order / Edit */}
          {items.some(i => i.codigo_producto === producto.codigo_interno) ? (
            <View style={{ gap: 10, marginHorizontal: 16, marginTop: 8 }}>
              <Pressable
                style={({ pressed }) => [styles.addBtn, { marginHorizontal: 0, marginTop: 0, backgroundColor: colors.primaryFaded, borderColor: colors.primary }, pressed && { opacity: 0.75 }]}
                onPress={() => {
                const existingItem = items.find(i => i.codigo_producto === producto.codigo_interno);
                  setNewQty(existingItem ? String(existingItem.nueva_existencia) : '');
                  setShowAddSheet(true);
                }}
              >
                <Feather name="edit-2" size={16} color={colors.primary} />
                <Text style={[styles.addBtnText, { color: colors.primary }]}>
                  Editar cantidad en borrador
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.addBtn, { marginHorizontal: 0, marginTop: 0, backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.75 }]}
                onPress={() => router.navigate('/ordenes')}
              >
                <Feather name="file-text" size={16} color={colors.textMuted} />
                <Text style={[styles.addBtnText, { color: colors.textMuted }]}>
                  Ir al borrador
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primaryFaded, borderColor: colors.primary }, pressed && { opacity: 0.75 }]}
              onPress={() => {
                setNewQty('');
                setShowAddSheet(true);
              }}
            >
              <Feather name="plus" size={16} color={colors.primary} />
              <Text style={[styles.addBtnText, { color: colors.primary }]}>
                Agregar al borrador
              </Text>
            </Pressable>
          )}
        </ScrollView>

        {/* Add to order sheet */}
        <Modal
          visible={showAddSheet}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAddSheet(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[
              styles.sheetOverlay,
              Platform.OS === 'web' && { justifyContent: 'center', padding: 16 }
            ]}
          >
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
              <ScrollView 
                bounces={false} 
                contentContainerStyle={{ paddingBottom: 24 }}
                showsVerticalScrollIndicator={false}
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

              {/* Mode Selector */}
              <View style={[styles.modeSelector, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Pressable 
                  onPress={() => {
                    setAdjMode('fixed');
                    setNewQty('');
                  }}
                  style={[styles.modeBtn, adjMode === 'fixed' && { backgroundColor: colors.primaryFaded, borderColor: colors.primary }]}
                >
                  <Text style={[styles.modeBtnText, { color: adjMode === 'fixed' ? colors.primary : colors.textMuted }]}>Nueva Total</Text>
                </Pressable>
                <Pressable 
                  onPress={() => {
                    setAdjMode('relative');
                    setNewQty('');
                  }}
                  style={[styles.modeBtn, adjMode === 'relative' && { backgroundColor: colors.primaryFaded, borderColor: colors.primary }]}
                >
                  <Text style={[styles.modeBtnText, { color: adjMode === 'relative' ? colors.primary : colors.textMuted }]}>Sumar/Restar</Text>
                </Pressable>
              </View>

              <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>
                {adjMode === 'fixed' ? 'Actual: ' + producto.existencia + ' uds  ·  Nueva existencia:' : 'Ingresa la cantidad a ajustar:'}
              </Text>

              <View style={styles.inputContainer}>
                {adjMode === 'relative' && (
                  <Pressable 
                    onPress={() => setAdjOp(adjOp === '+' ? '-' : '+')}
                    style={[styles.opBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                  >
                    <Text style={[styles.opText, { color: adjOp === '+' ? colors.success : colors.danger }]}>{adjOp}</Text>
                  </Pressable>
                )}
                
                <View style={[styles.qtyWrap, { flex: 1, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.qtyInput, { color: colors.text }]}
                    keyboardType="numeric"
                    value={newQty}
                    onChangeText={setNewQty}
                    placeholder="0"
                    placeholderTextColor={colors.textDim}
                    selectTextOnFocus
                    autoFocus
                  />
                </View>
              </View>

              {adjMode === 'relative' && (
                <View style={styles.previewContainer}>
                  <Text style={[styles.previewLabel, { color: colors.textMuted }]}>Resultado final: </Text>
                  <Text style={[styles.previewValue, { color: colors.primary }]}>
                    {adjOp === '+' 
                      ? (producto.existencia + (parseFloat(newQty) || 0)) 
                      : (producto.existencia - (parseFloat(newQty) || 0))
                    } uds
                  </Text>
                </View>
              )}

              <Pressable
                style={({ pressed }) => [styles.sheetBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.75 }]}
                onPress={() => {
                  const inputVal = parseFloat(newQty);
                  if (isNaN(inputVal)) {
                    notify('Cantidad inválida', 'Ingresa un número válido');
                    return;
                  }

                  let finalQty = inputVal;
                  if (adjMode === 'relative') {
                    finalQty = adjOp === '+' ? producto.existencia + inputVal : producto.existencia - inputVal;
                  }

                  if (finalQty < 0) {
                    notify('Error', 'La existencia no puede ser negativa');
                    return;
                  }

                  addItem({
                    codigo_producto:   producto.codigo_interno,
                    descripcion:       producto.descripcion,
                    existencia_actual: producto.existencia,
                    nueva_existencia:  finalQty,
                    nota:              '',
                  });
                  setShowAddSheet(false);
                }}
              >
                <Text style={[styles.sheetBtnText, { color: colors.onPrimary }]}>
                  Confirmar
                </Text>
              </Pressable>
              </ScrollView>
            </Animated.View>
          </KeyboardAvoidingView>
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
    borderRadius: Platform.OS === 'web' ? 24 : undefined,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 500 : '100%',
    alignSelf: 'center',
    overflow: 'hidden',
    paddingHorizontal: 24,
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
    marginTop:      12,
  },
  sheetBtnText: { fontSize: 15, fontFamily: 'JetBrainsMono_700Bold' },

  modeSelector: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
    marginBottom: 8,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modeBtnText: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  inputContainer: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  opBtn: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opText: {
    fontSize: 28,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  previewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  previewLabel: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  previewValue: {
    fontSize: 16,
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
