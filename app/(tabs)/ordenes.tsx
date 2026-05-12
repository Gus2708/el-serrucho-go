import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { notify, confirm } from '../../src/lib/notify';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../../src/theme/ThemeContext';
import { useInventarioStore } from '../../src/hooks/useInventarioStore';
import { useOrdenCambio } from '../../src/hooks/useOrdenCambio';
import { useOrdenesHistory } from '../../src/hooks/useOrdenesHistory';
import { supabase } from '../../src/lib/supabase';
import { buildPdfHtml } from '../../src/utils/pdfGenerator';

type Tab = 'borrador' | 'historial';

export default function Ordenes() {
  const { colors, formatUSD } = useTheme();
  const router       = useRouter();
  const queryClient  = useQueryClient();
  const [tab, setTab] = useState<Tab>('borrador');

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Órdenes</Text>
        <View style={[styles.tabRow]}>
          <TabBtn label="Borrador" active={tab === 'borrador'} onPress={() => setTab('borrador')} />
          <TabBtn label="Historial" active={tab === 'historial'} onPress={() => setTab('historial')} />
        </View>
      </View>

      {tab === 'borrador'
        ? <BorradorView router={router} />
        : <HistorialView queryClient={queryClient} />
      }
    </SafeAreaView>
  );
}

// ── Borrador (draft order builder) ───────────────────────────────────────────

function BorradorView({ router }: { router: any }) {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const { items, nota, isLoading, removeItem, updateItem, setNota, clear, submit } = useOrdenCambio();

  const [session, setSession] = useState<string | null>(null);

  // Lazy-load userId once
  async function getUserId(): Promise<string> {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? '';
  }

  async function performSubmit() {
    try {
      const userId = await getUserId();
      const { orderId, html } = await submit(userId);
      clear();
      
      const msg = `OC-${String(orderId).padStart(4, '0')} generada.`;
      
      if (Platform.OS === 'web' && html) {
        notify('✓ Orden emitida', msg);
        try {
          // Manual iframe print for Web to guarantee ONLY the HTML is printed
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
            
            // Wait for styles/fonts to load
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
      } else {
        notify('✓ Orden emitida', msg + ' PDF enviado a compartir.');
      }
    } catch (e: any) {
      notify('Error', e.message ?? 'No se pudo emitir la orden');
    }
  }

  function handleSubmit() {
    if (items.length === 0) return;
    confirm({
      title:       'Emitir orden',
      message:     `Se creará una orden con ${items.length} ítem${items.length > 1 ? 's' : ''} y se generará el PDF.`,
      confirmText: 'Emitir',
      onConfirm:   performSubmit,
    });
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Add products CTA */}
        <Pressable
          style={({ pressed }) => [styles.addProductBtn, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }, pressed && { opacity: 0.75 }]}
          onPress={() => router.push('/(tabs)/inventario')}
        >
          <Feather name="plus" size={18} color={colors.primary} />
          <Text style={[styles.addProductText, { color: colors.primary }]}>
            Agregar productos desde Inventario
          </Text>
        </Pressable>

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="file-text" size={36} color={colors.textDim} />
            <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Borrador vacío</Text>
            <Text style={[styles.emptySub, { color: colors.textDim }]}>
              Abre un producto en Inventario y toca{'\n'}"Agregar al borrador"
            </Text>
          </View>
        ) : (
          <>
            {items.map(item => {
              const delta = item.nueva_existencia - item.existencia_actual;
              const isNeg = delta < 0;
              const deltaColor = isNeg ? colors.danger : colors.success;
              return (
                <View
                  key={item.codigo_producto}
                  style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={styles.itemTop}>
                    <View style={styles.itemInfo}>
                      <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                        {item.descripcion}
                      </Text>
                      <Text style={[styles.itemCode, { color: colors.textMuted }]}>
                        {item.codigo_producto}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removeItem(item.codigo_producto)}
                      hitSlop={8}
                      style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}
                    >
                      <Feather name="x" size={16} color={colors.textDim} />
                    </Pressable>
                  </View>

                  <View style={styles.itemBottom}>
                    <View style={styles.qtyColumn}>
                      <Text style={[styles.qtyLabel, { color: colors.textMuted }]}>ACTUAL</Text>
                      <View style={styles.qtyValueWrapper}>
                        <Text style={[styles.qtyVal, { color: colors.text }]}>{item.existencia_actual}</Text>
                      </View>
                    </View>

                    <View style={styles.qtySeparator}>
                      <Feather name="arrow-right" size={14} color={colors.textDim} />
                    </View>

                    <View style={[styles.qtyColumn, { flex: 1 }]}>
                      <Text style={[styles.qtyLabel, { color: colors.textMuted }]}>NUEVA</Text>
                      <View style={styles.qtyValueWrapper}>
                        <Pressable 
                          onPress={() => updateItem(item.codigo_producto, { nueva_existencia: Math.max(0, item.nueva_existencia - 1) })}
                          style={({ pressed }) => [styles.qtyBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
                        >
                          <Feather name="minus" size={14} color={colors.text} />
                        </Pressable>
                        
                        <TextInput
                          style={[styles.qtyEdit, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                          keyboardType="numeric"
                          value={String(item.nueva_existencia)}
                          onChangeText={v => {
                            const n = parseFloat(v);
                            if (!isNaN(n) && n >= 0) {
                              updateItem(item.codigo_producto, { nueva_existencia: n });
                            }
                          }}
                          selectTextOnFocus
                        />

                        <Pressable 
                          onPress={() => updateItem(item.codigo_producto, { nueva_existencia: item.nueva_existencia + 1 })}
                          style={({ pressed }) => [styles.qtyBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
                        >
                          <Feather name="plus" size={14} color={colors.text} />
                        </Pressable>
                      </View>
                    </View>

                    <View style={styles.qtyColumn}>
                      <Text style={[styles.qtyLabel, { color: colors.textMuted, textAlign: 'right' }]}>AJUSTE</Text>
                      <View style={[styles.qtyValueWrapper, { justifyContent: 'flex-end' }]}>
                        <View style={[styles.deltaBadge, { backgroundColor: deltaColor + '22', borderColor: deltaColor + '55' }]}>
                          <Text style={[styles.deltaText, { color: deltaColor }]} numberOfLines={1} adjustsFontSizeToFit>
                            {isNeg ? '' : '+'}{delta}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <TextInput
                    style={[styles.notaInput, { color: colors.text, borderColor: colors.border }]}
                    placeholder="Nota (opcional)…"
                    placeholderTextColor={colors.textDim}
                    value={item.nota}
                    onChangeText={v => updateItem(item.codigo_producto, { nota: v })}
                  />
                </View>
              );
            })}

            {/* Order note */}
            <View style={[styles.ordenNota, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.ordenNotaLabel, { color: colors.textMuted }]}>Nota de la orden</Text>
              <TextInput
                style={[styles.ordenNotaInput, { color: colors.text }]}
                placeholder="Motivo del ajuste, observaciones…"
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
            bottom: Platform.OS === 'web' ? 0 : insets.bottom + 82 
          },
          Platform.OS === 'web' && styles.submitBarWeb
        ]}>
          <View style={styles.submitInfo}>
            <Text style={[styles.submitCount, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              {items.length} ítem{items.length > 1 ? 's' : ''}
            </Text>
            <Pressable onPress={clear} style={({ pressed }) => pressed && { opacity: 0.7 }}>
              <Text style={[styles.clearText, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>Limpiar borrador</Text>
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

// ── Historial ─────────────────────────────────────────────────────────────────

function HistorialView({ queryClient }: { queryClient: any }) {
  const { colors } = useTheme();
  const { scrollOffsetOrdenes, setScrollOffsetOrdenes } = useInventarioStore();
  const scrollRef = useRef<ScrollView>(null);
  const { data: ordenes = [], isLoading } = useOrdenesHistory();
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<number | null>(null);

  // Restaurar scroll
  useFocusEffect(
    useCallback(() => {
      if (scrollOffsetOrdenes > 0 && scrollRef.current) {
        const timer = setTimeout(() => {
          scrollRef.current?.scrollTo({ y: scrollOffsetOrdenes, animated: false });
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [scrollOffsetOrdenes])
  );

  const handleViewPDF = async (o: any) => {
    if (o.pdf_url) {
      Linking.openURL(o.pdf_url);
      return;
    }

    // No PDF URL, re-generate it
    setIsGeneratingPdf(o.id);
    try {
      const { data: items, error } = await supabase
        .from('ordenes_cambio_items')
        .select('*')
        .eq('orden_id', o.id);

      if (error) throw error;

      const html = buildPdfHtml(items as any[], o.nota, o.id);
      
      if (Platform.OS === 'web') {
        try {
          const iframe = document.createElement('iframe');
          iframe.style.position = 'fixed'; iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0';
          document.body.appendChild(iframe);
          const doc = iframe.contentWindow?.document;
          if (doc) {
            doc.open(); doc.write(html); doc.close();
            setTimeout(() => {
              iframe.contentWindow?.focus(); iframe.contentWindow?.print();
              setTimeout(() => document.body.removeChild(iframe), 1000);
            }, 500);
          }
        } catch (e) {
          const blob = new Blob([html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
      }
    } catch (err: any) {
      notify('Error', 'No se pudo generar el PDF: ' + err.message);
    } finally {
      setIsGeneratingPdf(null);
    }
  };

  // Guardar scroll
  const handleScroll = (event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset >= 0) {
      setScrollOffsetOrdenes(offset);
    }
  };

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  if (ordenes.length === 0) {
    return (
      <View style={styles.center}>
        <Feather name="inbox" size={32} color={colors.textDim} />
        <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Sin órdenes emitidas</Text>
      </View>
    );
  }

  return (
    <ScrollView 
      ref={scrollRef}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      contentContainerStyle={styles.scroll} 
      showsVerticalScrollIndicator={false}
    >
      {ordenes.map(o => (
        <View
          key={o.id}
          style={[styles.histCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.histTop}>
            <Text style={[styles.histId, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
              OC-{String(o.id).padStart(4, '0')}
            </Text>
            <View style={[
              styles.statusBadge,
              { backgroundColor: o.status === 'emitido' ? colors.success + '22' : colors.warning + '22',
                borderColor:     o.status === 'emitido' ? colors.success + '55' : colors.warning + '55' },
            ]}>
              <Text style={[styles.statusText, { color: o.status === 'emitido' ? colors.success : colors.warning }]} numberOfLines={1} adjustsFontSizeToFit>
                {o.status}
              </Text>
            </View>
          </View>

          <Text style={[styles.histMeta, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
            {new Date(o.creado_en).toLocaleString('es-VE', {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
            {'  ·  '}{o.item_count} ítem{o.item_count !== 1 ? 's' : ''}
          </Text>

          {o.nota ? (
            <Text style={[styles.histNota, { color: colors.textMuted }]} numberOfLines={1}>
              {o.nota}
            </Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.pdfBtn, 
              { borderColor: colors.primary }, 
              (pressed || isGeneratingPdf === o.id) && { opacity: 0.7 }
            ]}
            onPress={() => handleViewPDF(o)}
            disabled={isGeneratingPdf !== null}
          >
            {isGeneratingPdf === o.id ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Feather name="file-text" size={14} color={colors.primary} />
                <Text style={[styles.pdfBtnText, { color: colors.primary }]}>
                  {o.pdf_url ? 'Ver PDF' : 'Imprimir PDF'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      ))}
      <View style={{ height: 150 }} />
    </ScrollView>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.tabBtn, active && { borderBottomColor: colors.primary, borderBottomWidth: 2 }, pressed && { opacity: 0.7 }]}
      onPress={onPress}
    >
      <Text style={[styles.tabText, { color: active ? colors.primary : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingTop:        12,
  },
  title: { fontSize: 26, fontFamily: 'JetBrainsMono_700Bold', marginBottom: 12 },

  tabRow: {
    flexDirection: 'row',
    gap:           24,
    borderBottomWidth: 0.5,
  },
  tabBtn: {
    paddingBottom: 10,
  },
  tabText: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },

  scroll: { paddingTop: 12, gap: 8 },

  addProductBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    marginHorizontal:  16,
    paddingVertical:   14,
    borderRadius:      12,
    borderWidth:       1,
    borderStyle:       'dashed',
  },
  addProductText: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },

  empty: {
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap:            12,
  },
  emptyTitle: { fontSize: 16, fontFamily: 'JetBrainsMono_700Bold' },
  emptySub:   { fontSize: 13, fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: 20 },

  itemCard: {
    marginHorizontal: 16,
    borderRadius:     12,
    borderWidth:      0.5,
    padding:          12,
    gap:              8,
  },
  itemTop: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
  },
  itemInfo:  { flex: 1 },
  itemName:  { fontSize: 13, fontFamily: 'JetBrainsMono_700Bold' },
  itemCode:  { fontSize: 11, fontFamily: 'JetBrainsMono_400Regular', marginTop: 1 },
  removeBtn: { padding: 4, marginLeft: 8 },

  itemBottom: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           10,
    marginTop:     4,
  },
  qtyColumn: {
    gap: 4,
  },
  qtyValueWrapper: {
    height:         36,
    flexDirection:  'row',
    alignItems:     'center',
    gap:            8,
  },
  qtySeparator: {
    height:         36,
    justifyContent: 'center',
    marginTop:      13, // qtyLabel(9) + gap(4)
  },
  qtyLabel:  { fontSize: 9, fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.3 },
  qtyVal:    { fontSize: 16, fontFamily: 'JetBrainsMono_700Bold' },
  qtyEdit: {
    fontSize:   15,
    fontFamily: 'JetBrainsMono_700Bold',
    textAlign:  'center',
    borderWidth: 0.5,
    borderRadius: 8,
    paddingHorizontal: 4,
    height:      36,
    width:       50,
    fontVariant: ['tabular-nums'],
  },
  qtyBtn: {
    width:          36,
    height:         36,
    borderRadius:   8,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
  },
  deltaBadge: {
    borderRadius: 999,
    borderWidth:  0.5,
    paddingVertical:  2,
    paddingHorizontal: 8,
  },
  deltaText: { 
    fontSize: 12, 
    fontFamily: 'JetBrainsMono_700Bold', 
    fontVariant: ['tabular-nums'] 
  },

  notaInput: {
    fontSize:   16,
    fontFamily: 'JetBrainsMono_400Regular',
    borderBottomWidth: 0.5,
    paddingVertical:   6,
  },

  ordenNota: {
    marginHorizontal: 16,
    borderRadius:     12,
    borderWidth:      0.5,
    padding:          14,
    gap:              6,
  },
  ordenNotaLabel: { fontSize: 11, fontFamily: 'JetBrainsMono_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  ordenNotaInput: { fontSize: 16, fontFamily: 'JetBrainsMono_400Regular', lineHeight: 22, minHeight: 44 },

  submitBar: {
    position:          'absolute',
    bottom:            100,
    left:              16,
    right:             16,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    borderRadius:      16,
    borderWidth:       0.5,
    padding:           16,
    gap:               12,
  },
  submitInfo:    { flex: 1, gap: 2 },
  submitCount:   { fontSize: 15, fontFamily: 'JetBrainsMono_700Bold' },
  clearText:     { fontSize: 12, marginTop: 2, fontFamily: 'JetBrainsMono_400Regular' },
  submitBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            8,
    borderRadius:   12,
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

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

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
  histId:   { fontSize: 15, fontFamily: 'JetBrainsMono_700Bold' },
  statusBadge: { borderRadius: 999, borderWidth: 0.5, paddingVertical: 3, paddingHorizontal: 10 },
  statusText:  { fontSize: 11, fontFamily: 'JetBrainsMono_700Bold' },
  histMeta:    { fontSize: 12, fontFamily: 'JetBrainsMono_400Regular' },
  histNota:    { fontSize: 12, fontFamily: 'JetBrainsMono_400Regular' },
  pdfBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            6,
    alignSelf:      'flex-start',
    borderWidth:    0.5,
    borderRadius:   999,
    paddingVertical:   5,
    paddingHorizontal: 12,
    marginTop:         2,
  },
  pdfBtnText: { fontSize: 12, fontFamily: 'JetBrainsMono_700Bold' },

  tabBorder: {},
});
