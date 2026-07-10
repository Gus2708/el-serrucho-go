import { scaleFont } from '../theme/responsive';
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useDeviceSize } from '../hooks/useDeviceSize';
import { usePresupuestoStore } from '../hooks/usePresupuestoStore';
import { supabase } from '../lib/supabase';
import { notify, confirm } from '../lib/notify';
import { printHtml } from '../utils/pdfGenerator';
import { MarginWarningBadge } from './MarginWarningBadge';
import { usePresupuestoConfig } from '../hooks/usePresupuestoConfig';
import { useTazas } from '../hooks/useTazas';

export default function PresupuestoView({ router }: { router: any }) {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useDeviceSize();
  const { 
    items, 
    cliente, 
    nota, 
    removeItem, 
    updateItemQuantity, 
    updateItemPrice, 
    setNota, 
    reset, 
    submit,
    enBs,
    tasaCambio,
    porcentajeRecargo,
    setEnBs
  } = usePresupuestoStore();
  const [isLoading, setIsLoading] = useState(false);
  const [priceWarnings, setPriceWarnings] = useState<Record<string, string | null>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});

  const { data: config } = usePresupuestoConfig();
  const { data: tasa } = useTazas();
  const markup_porcentaje = config?.markup_porcentaje ?? 30;
  const bcv = tasa?.bcv_usd ?? 0;

  const [session, setSession] = useState<string | null>(null);

  // Lazy-load userId once
  async function getUserId(): Promise<string> {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? '';
  }

  const getDisplayUsdPrice = (precio: number, originalPrecio: number) => {
    if (!enBs) return precio;
    const isMarkupApplied = precio !== originalPrecio;
    if (isMarkupApplied) return precio;
    return Number((precio * (1 + markup_porcentaje / 100)).toFixed(2));
  };

  const total = items.reduce((acc, item) => acc + item.cantidad * getDisplayUsdPrice(item.precio_unitario, item.producto.precio_venta), 0);

  async function performSubmit() {
    setIsLoading(true);
    try {
      const result = await submit();
      if (!result) {
        setIsLoading(false);
        return;
      }
      const { presupuestoId, html } = result;
      reset();
      setPriceInputs({});
      
      const msg = `P-${String(presupuestoId).padStart(4, '0')} generado.`;
      
      if (Platform.OS === 'web' && html) {
        await printHtml(html);
      }
    } catch (e: any) {
      notify('Error', e.message ?? 'No se pudo emitir el presupuesto');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit() {
    if (items.length === 0) return;
    const totalLabel = enBs && tasaCambio
      ? `${formatUSD(total)} / Bs. ${(total * tasaCambio).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : formatUSD(total);
    confirm({
      title:       'Emitir presupuesto',
      message:     `Se creará un presupuesto por ${totalLabel} con ${items.length} ítem${items.length > 1 ? 's' : ''}.`,
      confirmText: 'Emitir',
      onConfirm:   performSubmit,
    });
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Top Actions */}
        <View style={styles.actionsContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn, 
              { borderColor: colors.primary, backgroundColor: colors.primaryFaded }, 
              pressed && { backgroundColor: colors.primary + '20', opacity: 0.85 }
            ]}
            onPress={() => router.push('/seleccionar-cliente')}
            hitSlop={8}
          >
            <Feather name={cliente ? 'user-check' : 'user-plus'} size={16} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]} numberOfLines={1}>
              {cliente ? cliente.nombre : 'Asignar Cliente'}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionBtn, 
              { borderColor: colors.primary, backgroundColor: colors.primaryFaded }, 
              pressed && { backgroundColor: colors.primary + '20', opacity: 0.85 }
            ]}
            onPress={() => router.push('/seleccionar-productos')}
            hitSlop={8}
          >
            <Feather name="plus" size={16} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]} numberOfLines={1}>
              Agregar Productos
            </Text>
          </Pressable>
        </View>

        {items.length > 0 && (
          <View style={[styles.currencyToggleContainer, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.currencyLabel, { color: colors.textMuted }]}>
              MONEDA
            </Text>
            <View style={[styles.segmentedControl, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable
                style={({ pressed }) => [
                  styles.segmentedBtn,
                  !enBs && { backgroundColor: colors.primary },
                  pressed && { opacity: 0.85 }
                ]}
                onPress={() => {
                  if (enBs) setEnBs(false, null, null);
                }}
              >
                <Text style={[styles.segmentedText, { color: !enBs ? colors.onPrimary : colors.textMuted }]}>
                  USD ($)
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.segmentedBtn,
                  enBs && { backgroundColor: colors.primary },
                  pressed && { opacity: 0.85 }
                ]}
                onPress={() => {
                  if (!enBs) setEnBs(true, bcv, markup_porcentaje);
                }}
              >
                <Text style={[styles.segmentedText, { color: enBs ? colors.onPrimary : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                  Bs. (@ {bcv.toFixed(2)})
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="file-text" size={36} color={colors.textDim} />
            <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Presupuesto vacío</Text>
            <Text style={[styles.emptySub, { color: colors.textDim }]}>
              Asigna un cliente y agrega productos para comenzar
            </Text>
          </View>
        ) : (
          <>
            {items.map(item => {
              const displaySubtotalUsd = item.cantidad * getDisplayUsdPrice(item.precio_unitario, item.producto.precio_venta);
              const displaySubtotalBs = displaySubtotalUsd * bcv;
              return (
                <View
                  key={item.producto.codigo_interno}
                  style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  {/* Header: name + remove */}
                  <View style={styles.itemTop}>
                    <View style={styles.itemInfo}>
                      <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                        {item.producto.descripcion}
                      </Text>
                      <Text style={[styles.itemCode, { color: colors.textMuted }]}>
                        {item.producto.codigo_interno}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        removeItem(item.producto.codigo_interno);
                        setPriceWarnings(prev => {
                          const next = { ...prev };
                          delete next[item.producto.codigo_interno];
                          return next;
                        });
                      }}
                      hitSlop={12}
                      style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.5, backgroundColor: colors.border + '33', borderRadius: 4 }]}
                    >
                      <Feather name="x" size={16} color={colors.textDim} />
                    </Pressable>
                  </View>

                  {/* Row 1: Quantity + Price */}
                  <View style={styles.controlsRow}>
                    {/* CANTIDAD */}
                    <View style={styles.controlGroup}>
                      <Text style={[styles.controlLabel, { color: colors.textMuted }]}>CANTIDAD</Text>
                      <View style={styles.controlRow}>
                        <Pressable 
                          onPress={() => updateItemQuantity(item.producto.codigo_interno, Math.max(1, item.cantidad - 1))}
                          style={({ pressed }) => [
                            styles.ctrlBtn, 
                            { backgroundColor: colors.surfaceAlt, borderColor: colors.border }, 
                            pressed && { opacity: 0.7 }
                          ]}
                        >
                          <Feather name="minus" size={14} color={colors.text} />
                        </Pressable>
                        
                        <TextInput
                          style={[styles.ctrlInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }] as any}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                          value={String(item.cantidad)}
                          onChangeText={v => {
                            const val = v.replace(',', '.');
                            const n = parseFloat(val);
                            if (!isNaN(n) && n > 0) {
                              updateItemQuantity(item.producto.codigo_interno, n);
                            }
                          }}
                          selectTextOnFocus
                        />

                        <Pressable 
                          onPress={() => updateItemQuantity(item.producto.codigo_interno, item.cantidad + 1)}
                          style={({ pressed }) => [
                            styles.ctrlBtn, 
                            { backgroundColor: colors.surfaceAlt, borderColor: colors.border }, 
                            pressed && { opacity: 0.7 }
                          ]}
                        >
                          <Feather name="plus" size={14} color={colors.text} />
                        </Pressable>
                      </View>
                    </View>

                    {/* PRECIO UNIT. */}
                    <View style={[styles.controlGroup, { flex: 1 }]}>
                      <Text style={[styles.controlLabel, { color: colors.textMuted }]}>PRECIO UNIT.</Text>
                      <View style={styles.controlRow}>
                        <View style={[styles.priceField, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
                          <Text style={[styles.priceCurrency, { color: colors.textDim }]}>$</Text>
                          <TextInput
                            style={[styles.priceInput, { color: colors.text }] as any}
                            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                            value={priceInputs[item.producto.codigo_interno] !== undefined ? priceInputs[item.producto.codigo_interno] : String(item.precio_unitario)}
                            onChangeText={v => {
                              const val = v.replace(',', '.');
                              setPriceInputs(prev => ({ ...prev, [item.producto.codigo_interno]: val }));
                              if (val === '' || val === '.') {
                                const w = updateItemPrice(item.producto.codigo_interno, 0);
                                setPriceWarnings(prev => ({ ...prev, [item.producto.codigo_interno]: w }));
                                return;
                              }
                              const p = parseFloat(val);
                              if (!isNaN(p) && p >= 0) {
                                const w = updateItemPrice(item.producto.codigo_interno, p);
                                setPriceWarnings(prev => ({ ...prev, [item.producto.codigo_interno]: w }));
                              }
                            }}
                            selectTextOnFocus
                            placeholder="0.00"
                            placeholderTextColor={colors.textDim}
                          />
                        </View>

                        {(() => {
                          const originalPrice = item.producto.precio_venta;
                          const isMarkupApplied = item.precio_unitario !== originalPrice;
                          return (
                            <Pressable 
                              onPress={() => {
                                if (isMarkupApplied) {
                                  // Reset to original price
                                  const w = updateItemPrice(item.producto.codigo_interno, originalPrice);
                                  setPriceWarnings(prev => ({ ...prev, [item.producto.codigo_interno]: w }));
                                  setPriceInputs(prev => ({ ...prev, [item.producto.codigo_interno]: String(originalPrice) }));
                                } else {
                                  // Apply dynamic markup
                                  const newPrice = parseFloat((originalPrice * (1 + markup_porcentaje / 100)).toFixed(2));
                                  const w = updateItemPrice(item.producto.codigo_interno, newPrice);
                                  setPriceWarnings(prev => ({ ...prev, [item.producto.codigo_interno]: w }));
                                  setPriceInputs(prev => ({ ...prev, [item.producto.codigo_interno]: String(newPrice) }));
                                }
                              }}
                              style={({ pressed }) => [
                                styles.percentBtn,
                                isMarkupApplied
                                  ? { backgroundColor: colors.success + '18', borderColor: colors.success + '40' }
                                  : { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' },
                                pressed && { opacity: 0.7 }
                              ]}
                              hitSlop={4}
                            >
                              <Text style={[
                                styles.percentBtnText, 
                                { color: isMarkupApplied ? colors.success : colors.primary },
                                isMarkupApplied && { fontSize: scaleFont(16) }
                              ]}>
                                {isMarkupApplied ? '↺' : `+${markup_porcentaje}%`}
                              </Text>
                            </Pressable>
                          );
                        })()}
                      </View>
                      {enBs && bcv > 0 && (
                        <Text style={{ fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_400Regular', color: colors.textMuted, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>
                          Final: ${getDisplayUsdPrice(item.precio_unitario, item.producto.precio_venta).toFixed(2)} — Bs. ${(getDisplayUsdPrice(item.precio_unitario, item.producto.precio_venta) * bcv).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Margin warning — shown when quoted price is below cost */}
                  {priceWarnings[item.producto.codigo_interno] && (
                    <MarginWarningBadge
                      costoMinimo={item.producto.costo}
                      formatUSD={formatUSD}
                    />
                  )}

                  {/* Row 2: Subtotal aligned right */}
                  <View style={styles.subtotalRow}>
                    <Text style={[styles.controlLabel, { color: colors.textMuted }]}>SUBTOTAL</Text>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.subtotalVal, { color: colors.text }]}>{formatUSD(displaySubtotalUsd)}</Text>
                      {enBs && bcv > 0 && (
                        <Text style={{ fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', color: colors.textMuted, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
                          Bs. {displaySubtotalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}

            {/* Order note */}
            <View style={[styles.ordenNota, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.ordenNotaLabel, { color: colors.textMuted }]}>Notas del presupuesto</Text>
              <TextInput
                style={[styles.ordenNotaInput, { color: colors.text }]}
                placeholder="Condiciones de pago, validez, observaciones…"
                placeholderTextColor={colors.textDim}
                value={nota}
                onChangeText={setNota}
                multiline
                numberOfLines={2}
              />
            </View>
          </>
        )}

        <View style={{ height: 180 }} />
      </ScrollView>

      {/* Submit bar */}
      {items.length > 0 && (
        <View style={[
          styles.submitBar, 
          { 
            backgroundColor: colors.surface, 
            borderColor: colors.border,
            bottom: isDesktop ? undefined : (Platform.OS === 'web' ? 96 : insets.bottom + 82),
            position: isDesktop ? 'relative' : 'absolute',
          },
          isDesktop && styles.submitBarWeb
        ]}>
          <View style={styles.submitInfo}>
            <Text style={[styles.submitCount, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              Total: {formatUSD(total)}
            </Text>
            {enBs && bcv > 0 && (
              <Text style={{ fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', color: colors.primary, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
                Bs. {(total * bcv).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            )}
            <Pressable onPress={() => { reset(); setPriceInputs({}); }} style={({ pressed }) => [pressed && { opacity: 0.7 }, { marginTop: 4 }]} hitSlop={6}>
              <Text style={[styles.clearText, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>Limpiar presupuesto</Text>
            </Pressable>
          </View>
          <Pressable
            style={({ pressed }) => [styles.submitBtn, { backgroundColor: colors.primary }, (isLoading || pressed) && { opacity: 0.75 }]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {isLoading
              ? <ActivityIndicator color={colors.onPrimary} />
              : <>
                  <Feather name="send" size={16} color={colors.onPrimary} />
                  <Text style={[styles.submitBtnText, { color: colors.onPrimary }]} numberOfLines={1} adjustsFontSizeToFit>Emitir y PDF</Text>
                </>
            }
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingTop: 12, gap: 8 },

  /* ── Action buttons ─────────────────────────────────────── */
  actionsContainer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  actionBtnText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },

  /* ── Empty state ────────────────────────────────────────── */
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  emptySub: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(20) },

  /* ── Item card ──────────────────────────────────────────── */
  itemCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 12,
    gap: 10,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  itemInfo: { flex: 1 },
  itemName: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  itemCode: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', marginTop: 1 },
  removeBtn: { padding: 4, marginLeft: 8 },

  /* ── Controls row (qty + price side by side) ────────────── */
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  controlGroup: {
    gap: 4,
  },
  controlLabel: {
    fontSize: scaleFont(9),
    fontFamily: 'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  /* ── Shared button & input (matches Ajuste card) ─────── */
  ctrlBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlInput: {
    fontSize: scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
    textAlign: 'center',
    textAlignVertical: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 0,
    includeFontPadding: false,
    height: 36,
    width: 50,
    fontVariant: ['tabular-nums'],
  },

  /* ── Price field ─────────────────────────────────────────── */
  priceField: {
    flex: 1,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    gap: 4,
  },
  priceCurrency: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  priceInput: {
    flex: 1,
    fontSize: scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
    textAlignVertical: 'center',
    includeFontPadding: false,
    paddingVertical: 0,
    paddingHorizontal: 2,
    height: 36,
    fontVariant: ['tabular-nums'],
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },

  /* ── Percent button ──────────────────────────────────────── */
  percentBtn: {
    height: 36,
    minWidth: 50,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentBtnText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
  },

  /* ── Subtotal row ────────────────────────────────────────── */
  subtotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  subtotalVal: {
    fontSize: scaleFont(16),
    fontFamily: 'JetBrainsMono_700Bold',
    fontVariant: ['tabular-nums'],
  },

  /* ── Order note ──────────────────────────────────────────── */
  ordenNota: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 14,
    gap: 6,
  },
  ordenNotaLabel: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  ordenNotaInput: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(22), minHeight: 44 },

  /* ── Submit bar ──────────────────────────────────────────── */
  submitBar: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    ...(Platform.OS === 'web' ? { 
      boxShadow: '0 -2px 12px rgba(0,0,0,0.4)',
    } : {}),
  } as any,
  submitInfo: { flex: 1, gap: 2 },
  submitCount: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  clearText: { fontSize: scaleFont(12), marginTop: 2, fontFamily: 'JetBrainsMono_400Regular' },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  submitBtnText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  submitBarWeb: {
    position: 'relative',
    bottom: 0,
    left: 0,
    right: 0,
    marginHorizontal: 16,
    marginBottom: 16,
    marginTop: 8,
  },
  currencyToggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  currencyLabel: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  segmentedControl: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    padding: 2,
    minWidth: 180,
  },
  segmentedBtn: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
