import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useDeviceSize } from '../hooks/useDeviceSize';
import { usePresupuestoStore } from '../hooks/usePresupuestoStore';
import { supabase } from '../lib/supabase';
import { notify, confirm } from '../lib/notify';

export default function PresupuestoView({ router }: { router: any }) {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useDeviceSize();
  const { items, cliente, nota, removeItem, updateItemQuantity, setNota, reset, submit } = usePresupuestoStore();
  const [isLoading, setIsLoading] = useState(false);

  const [session, setSession] = useState<string | null>(null);

  // Lazy-load userId once
  async function getUserId(): Promise<string> {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? '';
  }

  const total = items.reduce((acc, item) => acc + item.cantidad * item.precio_unitario, 0);

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
      
      const msg = `P-${String(presupuestoId).padStart(4, '0')} generado.`;
      
      if (Platform.OS === 'web' && html) {
        try {
          const iframe = document.createElement('iframe');
          iframe.style.position = 'fixed';
          iframe.style.right = '0';
          iframe.style.bottom = '0';
          iframe.style.width = '0';
          iframe.style.height = '0';
          iframe.style.border = '0';
          document.body.appendChild(iframe);
          
          const doc = iframe.contentWindow?.document;
          if (doc) {
            doc.open();
            doc.write(html);
            doc.close();
            
            setTimeout(() => {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
              setTimeout(() => document.body.removeChild(iframe), 1000);
            }, 500);
          }
        } catch (e) {
          console.error('Error printing PDF:', e);
          const blob = new Blob([html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
        }
      }
    } catch (e: any) {
      notify('Error', e.message ?? 'No se pudo emitir el presupuesto');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit() {
    if (items.length === 0) return;
    confirm({
      title:       'Emitir presupuesto',
      message:     `Se creará un presupuesto por ${formatUSD(total)} con ${items.length} ítem${items.length > 1 ? 's' : ''}.`,
      confirmText: 'Emitir',
      onConfirm:   performSubmit,
    });
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Top Actions */}
        <View style={{ marginBottom: 8 }}>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionsRow}
          >
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn, 
                { borderColor: colors.primary, backgroundColor: colors.primaryFaded }, 
                pressed && { backgroundColor: colors.primary + '20', opacity: 0.85 }
              ]}
              onPress={() => router.push('/seleccionar-cliente')}
              hitSlop={8}
            >
              <Feather name={cliente ? 'user-check' : 'user-plus'} size={18} color={colors.primary} />
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>
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
              <Feather name="plus" size={18} color={colors.primary} />
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>
                Agregar Productos
              </Text>
            </Pressable>
          </ScrollView>
        </View>

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
              const subtotal = item.cantidad * item.precio_unitario;
              return (
                <View
                  key={item.producto.codigo_interno}
                  style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={styles.itemTop}>
                    <View style={styles.itemInfo}>
                      <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                        {item.producto.descripcion}
                      </Text>
                      <Text style={[styles.itemCode, { color: colors.textMuted }]}>
                        {item.producto.codigo_interno} · {formatUSD(item.precio_unitario)} c/u
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removeItem(item.producto.codigo_interno)}
                      hitSlop={12}
                      style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.5, backgroundColor: colors.border + '33', borderRadius: 4 }]}
                    >
                      <Feather name="x" size={16} color={colors.textDim} />
                    </Pressable>
                  </View>

                  <View style={styles.itemBottom}>
                    <View style={[styles.qtyColumn, { flex: 1 }]}>
                      <Text style={[styles.qtyLabel, { color: colors.textMuted }]}>CANTIDAD</Text>
                      <View style={styles.qtyValueWrapper}>
                        <Pressable 
                          onPress={() => updateItemQuantity(item.producto.codigo_interno, Math.max(1, item.cantidad - 1))}
                          style={({ pressed }) => [
                            styles.qtyBtn, 
                            { backgroundColor: colors.surfaceAlt, borderColor: colors.border }, 
                            pressed && { backgroundColor: colors.border + '44' }
                          ]}
                          hitSlop={6}
                        >
                          <Feather name="minus" size={14} color={colors.text} />
                        </Pressable>
                        
                        <TextInput
                          style={[styles.qtyEdit, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                          keyboardType="numeric"
                          value={String(item.cantidad)}
                          onChangeText={v => {
                            const n = parseFloat(v);
                            if (!isNaN(n) && n > 0) {
                              updateItemQuantity(item.producto.codigo_interno, n);
                            }
                          }}
                          selectTextOnFocus
                        />

                        <Pressable 
                          onPress={() => updateItemQuantity(item.producto.codigo_interno, item.cantidad + 1)}
                          style={({ pressed }) => [
                            styles.qtyBtn, 
                            { backgroundColor: colors.surfaceAlt, borderColor: colors.border }, 
                            pressed && { backgroundColor: colors.border + '44' }
                          ]}
                          hitSlop={6}
                        >
                          <Feather name="plus" size={14} color={colors.text} />
                        </Pressable>
                      </View>
                    </View>

                    <View style={styles.qtyColumn}>
                      <Text style={[styles.qtyLabel, { color: colors.textMuted, textAlign: 'right' }]}>SUBTOTAL</Text>
                      <View style={[styles.qtyValueWrapper, { justifyContent: 'flex-end' }]}>
                        <Text style={[styles.qtyVal, { color: colors.text }]}>{formatUSD(subtotal)}</Text>
                      </View>
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
            bottom: isDesktop ? undefined : (Platform.OS === 'web' ? 82 : insets.bottom + 82),
            position: isDesktop ? 'relative' : 'absolute',
          },
          isDesktop && styles.submitBarWeb
        ]}>
          <View style={styles.submitInfo}>
            <Text style={[styles.submitCount, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              Total: {formatUSD(total)}
            </Text>
            <Pressable onPress={reset} style={({ pressed }) => pressed && { opacity: 0.7 }}>
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
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  actionBtn: {
    minWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  actionBtnText: { fontSize: 13, fontFamily: 'JetBrainsMono_700Bold' },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: { fontSize: 16, fontFamily: 'JetBrainsMono_700Bold' },
  emptySub: { fontSize: 13, fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: 20 },

  itemCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 12,
    gap: 8,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 13, fontFamily: 'JetBrainsMono_700Bold' },
  itemCode: { fontSize: 11, fontFamily: 'JetBrainsMono_400Regular', marginTop: 1 },
  removeBtn: { padding: 4, marginLeft: 8 },

  itemBottom: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
  },
  qtyColumn: { gap: 4 },
  qtyValueWrapper: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyLabel: { fontSize: 9, fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.3 },
  qtyVal: { fontSize: 16, fontFamily: 'JetBrainsMono_700Bold' },
  qtyEdit: {
    fontSize: 15,
    fontFamily: 'JetBrainsMono_700Bold',
    textAlign: 'center',
    borderWidth: 0.5,
    borderRadius: 8,
    paddingHorizontal: 4,
    height: 36,
    width: 50,
    fontVariant: ['tabular-nums'],
  },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ordenNota: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 14,
    gap: 6,
  },
  ordenNotaLabel: { fontSize: 11, fontFamily: 'JetBrainsMono_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  ordenNotaInput: { fontSize: 16, fontFamily: 'JetBrainsMono_400Regular', lineHeight: 22, minHeight: 44 },

  submitBar: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 16,
    gap: 12,
  },
  submitInfo: { flex: 1, gap: 2 },
  submitCount: { fontSize: 15, fontFamily: 'JetBrainsMono_700Bold' },
  clearText: { fontSize: 12, marginTop: 2, fontFamily: 'JetBrainsMono_400Regular' },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  submitBtnText: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },

  submitBarWeb: {
    position: 'relative',
    bottom: 0,
    left: 0,
    right: 0,
    marginHorizontal: 16,
    marginBottom: 16,
    marginTop: 8,
  },
});
