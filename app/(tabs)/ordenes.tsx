import { scaleFont } from '../../src/theme/responsive';
import * as React from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
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
  RefreshControl,
} from 'react-native';
import { notify, confirm } from '../../src/lib/notify';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../../src/theme/ThemeContext';
import { pressScale } from '../../src/theme/motion';
import { PressableScale } from '../../src/components/PressableScale';
import { useDeviceSize } from '../../src/hooks/useDeviceSize';
import { useInventarioStore } from '../../src/hooks/useInventarioStore';
import { useOrdenCambio } from '../../src/hooks/useOrdenCambio';
import { useOrdenesHistory, BackendResumen } from '../../src/hooks/useOrdenesHistory';
import { useUserRole, isPrivilegedRole, canMakePedidos } from '../../src/hooks/useUserRole';
import { usePedido } from '../../src/hooks/usePedido';
import { supabase } from '../../src/lib/supabase';
import { buildPdfHtml, buildPresupuestoPdfHtml, printHtml, getPresupuestoFilename } from '../../src/utils/pdfGenerator';
import PresupuestoView from '../../src/components/PresupuestoView';
import FallasView from '../../src/components/FallasView';
import { usePresupuestosHistory, fetchPresupuestoItemsForPedido } from '../../src/hooks/usePresupuestosHistory';
import { OrdenCambioDetailModal } from '../../src/components/OrdenCambioDetailModal';
import { PresupuestoEditModal } from '../../src/components/PresupuestoEditModal';
import { DraftRestoreBanner } from '../../src/components/DraftRestoreBanner';
import ComprasView from '../../src/components/ComprasView';
import ComprasHistorialView from '../../src/components/ComprasHistorialView';
import AprobacionesView from '../../src/components/AprobacionesView';
import DirectorioView from '../../src/components/DirectorioView';
import { useComprasHistory } from '../../src/hooks/useComprasHistory';
import { usePedidosHistory } from '../../src/hooks/usePedidosHistory';
import PedidosHistorialView from '../../src/components/PedidosHistorialView';
import PedidoStatusModal from '../../src/components/PedidoStatusModal';

type Tab = 'ajuste' | 'presupuesto' | 'historial' | 'fallas' | 'compras' | 'aprobaciones' | 'directorio';

export default function Ordenes() {
  const { colors, formatUSD } = useTheme();
  const router       = useRouter();
  const queryClient  = useQueryClient();
  const params       = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>('ajuste');

  const { data: userAuth } = useUserRole();
  const isPrivileged = isPrivilegedRole(userAuth?.role);

  useEffect(() => {
    const valid: Tab[] = ['ajuste', 'presupuesto', 'historial', 'fallas', 'compras', 'aprobaciones', 'directorio'];
    if (params.tab && valid.includes(params.tab as Tab)) {
      // Compras/Aprobaciones son solo para privilegiados: no dejar caer un empleado ahí.
      if ((params.tab === 'compras' || params.tab === 'aprobaciones') && !isPrivileged) return;
      setTab(params.tab as Tab);
    }
  }, [params.tab, isPrivileged]);

  // Si un empleado estaba en una pestaña privilegiada y pierde el privilegio, regresa a Ajuste.
  useEffect(() => {
    if (!isPrivileged && (tab === 'compras' || tab === 'aprobaciones')) {
      setTab('ajuste');
    }
  }, [isPrivileged, tab]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Órdenes y Presupuestos</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRow}
          style={styles.tabRowWrapper}
        >
          <TabBtn label="Ajuste" active={tab === 'ajuste'} onPress={() => setTab('ajuste')} />
          {isPrivileged && <TabBtn label="Aprobaciones" active={tab === 'aprobaciones'} onPress={() => setTab('aprobaciones')} />}
          <TabBtn label="Presupuesto" active={tab === 'presupuesto'} onPress={() => setTab('presupuesto')} />
          {isPrivileged && <TabBtn label="Compras" active={tab === 'compras'} onPress={() => setTab('compras')} />}
          <TabBtn label="Directorio" active={tab === 'directorio'} onPress={() => setTab('directorio')} />
          <TabBtn label="Fallas" active={tab === 'fallas'} onPress={() => setTab('fallas')} />
          <TabBtn label="Historial" active={tab === 'historial'} onPress={() => setTab('historial')} />
        </ScrollView>
      </View>

      {tab === 'ajuste' && <AjustesTab router={router} isPrivileged={isPrivileged} queryClient={queryClient} />}
      {tab === 'aprobaciones' && isPrivileged && <AprobacionesView />}
      {tab === 'presupuesto' && <PresupuestoTab router={router} queryClient={queryClient} />}
      {tab === 'compras' && isPrivileged && <ComprasTab router={router} />}
      {tab === 'directorio' && <DirectorioView />}
      {tab === 'fallas' && <FallasView />}
      {tab === 'historial' && <HistorialView queryClient={queryClient} initialSubTab="todo" />}
    </SafeAreaView>
  );
}

// ── Presupuesto (armar presupuesto + historial en sub-toggle) ────────────────

function PresupuestoTab({ router, queryClient }: { router: any; queryClient: any }) {
  const { colors } = useTheme();
  const [subTab, setSubTab] = useState<'armar' | 'historial'>('armar');

  return (
    <View style={styles.flex}>
      <View style={[styles.subTabContainer, { backgroundColor: '#0A0A0A', borderColor: colors.border }]}>
        <PressableScale
          activeScale={pressScale.row}
          style={[styles.subTabBtn, subTab === 'armar' && { backgroundColor: colors.surface, borderColor: '#333' }]}
          onPress={() => setSubTab('armar')}
        >
          <Text style={[styles.subTabText, { color: subTab === 'armar' ? colors.primary : colors.textMuted }]}>Nuevo presupuesto</Text>
        </PressableScale>
        <PressableScale
          activeScale={pressScale.row}
          style={[styles.subTabBtn, subTab === 'historial' && { backgroundColor: colors.surface, borderColor: '#333' }]}
          onPress={() => setSubTab('historial')}
        >
          <Text style={[styles.subTabText, { color: subTab === 'historial' ? colors.primary : colors.textMuted }]}>Historial</Text>
        </PressableScale>
      </View>

      {subTab === 'armar' && <PresupuestoView router={router} onEmitted={() => setSubTab('historial')} />}
      {subTab === 'historial' && <HistorialView queryClient={queryClient} initialSubTab="presupuesto" hideSubTabs={true} />}
    </View>
  );
}

// ── Compras (armar compra + historial en sub-toggle) ─────────────────────────

function ComprasTab({ router }: { router: any }) {
  const { colors } = useTheme();
  const [subTab, setSubTab] = useState<'armar' | 'historial'>('armar');

  return (
    <View style={styles.flex}>
      <View style={[styles.subTabContainer, { backgroundColor: '#0A0A0A', borderColor: colors.border }]}>
        <Pressable
          style={[styles.subTabBtn, subTab === 'armar' && { backgroundColor: colors.surface, borderColor: '#333' }]}
          onPress={() => setSubTab('armar')}
        >
          <Text style={[styles.subTabText, { color: subTab === 'armar' ? colors.primary : colors.textMuted }]}>Nueva compra</Text>
        </Pressable>
        <Pressable
          style={[styles.subTabBtn, subTab === 'historial' && { backgroundColor: colors.surface, borderColor: '#333' }]}
          onPress={() => setSubTab('historial')}
        >
          <Text style={[styles.subTabText, { color: subTab === 'historial' ? colors.primary : colors.textMuted }]}>Historial</Text>
        </Pressable>
      </View>

      {subTab === 'armar' && <ComprasView router={router} onEmitted={() => setSubTab('historial')} />}
      {subTab === 'historial' && <ComprasHistorialView onEditRetry={() => setSubTab('armar')} />}
    </View>
  );
}

// ── Ajustes (armar ajuste + historial en sub-toggle) ─────────────────────────

function AjustesTab({ router, isPrivileged, queryClient }: { router: any; isPrivileged: boolean; queryClient: any }) {
  const { colors } = useTheme();
  const [subTab, setSubTab] = useState<'armar' | 'historial'>('armar');

  return (
    <View style={styles.flex}>
      <View style={[styles.subTabContainer, { backgroundColor: '#0A0A0A', borderColor: colors.border }]}>
        <PressableScale
          activeScale={pressScale.row}
          style={[styles.subTabBtn, subTab === 'armar' && { backgroundColor: colors.surface, borderColor: '#333' }]}
          onPress={() => setSubTab('armar')}
        >
          <Text style={[styles.subTabText, { color: subTab === 'armar' ? colors.primary : colors.textMuted }]}>Nuevo ajuste</Text>
        </PressableScale>
        <PressableScale
          activeScale={pressScale.row}
          style={[styles.subTabBtn, subTab === 'historial' && { backgroundColor: colors.surface, borderColor: '#333' }]}
          onPress={() => setSubTab('historial')}
        >
          <Text style={[styles.subTabText, { color: subTab === 'historial' ? colors.primary : colors.textMuted }]}>Historial</Text>
        </PressableScale>
      </View>

      {subTab === 'armar' && <BorradorView router={router} isPrivileged={isPrivileged} onEmitted={() => setSubTab('historial')} />}
      {subTab === 'historial' && <HistorialView queryClient={queryClient} initialSubTab="ajuste" hideSubTabs={true} />}
    </View>
  );
}

// ── Borrador (draft order builder) ───────────────────────────────────────────

function BorradorView({ router, isPrivileged, onEmitted }: { router: any; isPrivileged: boolean; onEmitted?: () => void }) {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useDeviceSize();
  const { items, nota, isLoading, removeItem, updateItem, setNota, clear, submit } = useOrdenCambio();

  const [session, setSession] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [costInputs, setCostInputs] = useState<Record<string, string>>({});

  const showBanner = items.length > 0 && !bannerDismissed;

  function handleClear() {
    clear();
    setPriceInputs({});
    setCostInputs({});
  }

  // Lazy-load userId once
  async function getUserId(): Promise<string> {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? '';
  }

  async function performSubmit() {
    try {
      const userId = await getUserId();
      const { orderId, html } = await submit(userId);
      handleClear();
      
      const msg = `OC-${String(orderId).padStart(4, '0')} generada.`;
      
      if (Platform.OS === 'web' && html) {
        await printHtml(html);
      }
      onEmitted?.();
    } catch (e: any) {
      notify('Error', e.message ?? 'No se pudo emitir la orden');
    }
  }

  function handleSubmit() {
    if (items.length === 0) return;
    confirm({
      title:       'Emitir orden',
      message:     isPrivileged
        ? `Se creará una orden con ${items.length} ítem${items.length > 1 ? 's' : ''} y se generará el PDF.`
        : `Se creará una orden con ${items.length} ítem${items.length > 1 ? 's' : ''} y quedará en espera de aprobación.`,
      confirmText: isPrivileged ? 'Emitir' : 'Enviar',
      onConfirm:   performSubmit,
    });
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Banner educativo de Writeback — varía según privilegio */}
        {isPrivileged ? (
          <View style={[styles.infoBanner, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
            <Feather name="zap" size={15} color={colors.primary} style={styles.infoBannerIcon} />
            <View style={styles.infoBannerTextContainer}>
              <Text style={[styles.infoBannerTitle, { color: colors.primary }]}>
                Sincronización de Stock en Cola (Writeback)
              </Text>
              <Text style={[styles.infoBannerSub, { color: colors.textMuted }]}>
                Los cambios de existencia se registrarán como órdenes relativas (deltas) y el backend los aplicará automáticamente en el POS Hybrid.
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.infoBanner, { backgroundColor: colors.warning + '10', borderColor: colors.warning + '30' }]}>
            <Feather name="clock" size={15} color={colors.warning} style={styles.infoBannerIcon} />
            <View style={styles.infoBannerTextContainer}>
              <Text style={[styles.infoBannerTitle, { color: colors.warning }]}>
                Requiere aprobación
              </Text>
              <Text style={[styles.infoBannerSub, { color: colors.textMuted }]}>
                Tu ajuste quedará en espera hasta que un administrador o superempleado lo apruebe. Solo entonces se aplicará en el POS Hybrid.
              </Text>
            </View>
          </View>
        )}

        {/* Add products CTA */}
        <PressableScale
          style={[styles.addProductBtn, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]}
          onPress={() => router.push('/(tabs)/inventario')}
        >
          <Feather name="plus" size={18} color={colors.primary} />
          <Text style={[styles.addProductText, { color: colors.primary }]}>
            Agregar productos desde Inventario
          </Text>
        </PressableScale>

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
                    <PressableScale
                      onPress={() => removeItem(item.codigo_producto)}
                      hitSlop={8}
                      style={styles.removeBtn}
                      activeScale={pressScale.icon}
                    >
                      <Feather name="x" size={16} color={colors.textDim} />
                    </PressableScale>
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
                        <PressableScale
                          onPress={() => updateItem(item.codigo_producto, { nueva_existencia: Math.max(0, item.nueva_existencia - 1) })}
                          style={[styles.qtyBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                          activeScale={pressScale.icon}
                        >
                          <Feather name="minus" size={14} color={colors.text} />
                        </PressableScale>
                        
                        <TextInput
                          style={[styles.qtyEdit, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                          value={String(item.nueva_existencia)}
                          onChangeText={v => {
                            const val = v.replace(',', '.');
                            const n = parseFloat(val);
                            if (!isNaN(n) && n >= 0) {
                              updateItem(item.codigo_producto, { nueva_existencia: n });
                            }
                          }}
                          selectTextOnFocus
                        />

                        <PressableScale
                          onPress={() => updateItem(item.codigo_producto, { nueva_existencia: item.nueva_existencia + 1 })}
                          style={[styles.qtyBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                          activeScale={pressScale.icon}
                        >
                          <Feather name="plus" size={14} color={colors.text} />
                        </PressableScale>
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

                  {/* Note / Adjustment Title */}
                  <TextInput
                    style={[
                      styles.notaInput,
                      {
                        color: colors.text,
                        borderColor: colors.border,
                        borderBottomWidth: 0,
                        borderTopWidth: 0.5,
                        marginTop: 10,
                        paddingTop: 10,
                      }
                    ]}
                    placeholder="Nota (opcional)…"
                    placeholderTextColor={colors.textDim}
                    value={item.nota}
                    onChangeText={v => updateItem(item.codigo_producto, { nota: v })}
                  />

                  {/* Price and Cost adjustment row */}
                  <View style={[styles.itemBottom, { marginTop: 8 }]}>
                    {/* Price Column */}
                    <View style={{ flex: 1.2, marginRight: 8 }}>
                      <Text style={[styles.qtyLabel, { color: colors.textMuted }]}>PRECIO ($)</Text>
                      <View style={[styles.qtyValueWrapper, { justifyContent: 'flex-start', marginTop: 4 }]}>
                        <TextInput
                          style={[
                            styles.qtyEdit, 
                            { 
                              color: colors.text, 
                              borderColor: colors.border, 
                              backgroundColor: colors.surfaceAlt,
                              width: 80,
                              flex: 1,
                              textAlign: 'center',
                              paddingVertical: 4
                            }
                          ]}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                          value={priceInputs[item.codigo_producto] !== undefined ? priceInputs[item.codigo_producto] : (item.nuevo_precio !== undefined && item.nuevo_precio !== null ? String(item.nuevo_precio) : '')}
                          placeholder={item.precio_actual !== undefined && item.precio_actual !== null ? String(item.precio_actual) : '0.00'}
                          placeholderTextColor={colors.textDim}
                          onChangeText={v => {
                            const val = v.replace(',', '.');
                            setPriceInputs(prev => ({ ...prev, [item.codigo_producto]: val }));
                            const n = parseFloat(val);
                            if (!isNaN(n) && n >= 0) {
                              updateItem(item.codigo_producto, { nuevo_precio: n });
                            } else if (val === '') {
                              updateItem(item.codigo_producto, { nuevo_precio: null });
                            }
                          }}
                          selectTextOnFocus
                        />
                      </View>
                    </View>

                    {/* Cost Column */}
                    <View style={{ flex: 1.2, marginRight: 8 }}>
                      <Text style={[styles.qtyLabel, { color: colors.textMuted }]}>COSTO ($)</Text>
                      <View style={[styles.qtyValueWrapper, { justifyContent: 'flex-start', marginTop: 4 }]}>
                        <TextInput
                          style={[
                            styles.qtyEdit, 
                            { 
                              color: colors.text, 
                              borderColor: colors.border, 
                              backgroundColor: colors.surfaceAlt,
                              width: 80,
                              flex: 1,
                              textAlign: 'center',
                              paddingVertical: 4
                            }
                          ]}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                          value={costInputs[item.codigo_producto] !== undefined ? costInputs[item.codigo_producto] : (item.costo !== undefined && item.costo !== null ? String(item.costo) : '')}
                          placeholder="0.00"
                          placeholderTextColor={colors.textDim}
                          onChangeText={v => {
                            const val = v.replace(',', '.');
                            setCostInputs(prev => ({ ...prev, [item.codigo_producto]: val }));
                            const n = parseFloat(val);
                            if (!isNaN(n) && n >= 0) {
                              updateItem(item.codigo_producto, { costo: n });
                            } else if (val === '') {
                              updateItem(item.codigo_producto, { costo: null });
                            }
                          }}
                          selectTextOnFocus
                        />
                      </View>
                    </View>

                    {/* Margin Column */}
                    <View style={[styles.qtyColumn, { justifyContent: 'center' }]}>
                      <Text style={[styles.qtyLabel, { color: colors.textMuted, textAlign: 'right' }]}>MARGEN</Text>
                      <View style={[styles.qtyValueWrapper, { justifyContent: 'flex-end', marginTop: 4 }]}>
                        {(() => {
                          const priceToUse = item.nuevo_precio !== undefined && item.nuevo_precio !== null ? item.nuevo_precio : item.precio_actual;
                          const precioSinIva = (priceToUse ?? 0) / 1.16;
                          const currentCosto = item.costo ?? 0;
                          const pct = precioSinIva > 0 ? ((precioSinIva - currentCosto) / precioSinIva) * 100 : 0;
                          const isNegMargin = pct < 0;
                          const marginColor = isNegMargin ? colors.danger : pct < 20 ? colors.warning : colors.success;

                          return (
                            <View style={[styles.deltaBadge, { backgroundColor: marginColor + '22', borderColor: marginColor + '55' }]}>
                              <Text style={[styles.deltaText, { color: marginColor }]} numberOfLines={1} adjustsFontSizeToFit>
                                {isNegMargin ? '' : '+'}{pct.toFixed(1)}%
                              </Text>
                            </View>
                          );
                        })()}
                      </View>
                    </View>
                  </View>
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
            bottom: isDesktop ? undefined : (Platform.OS === 'web' ? 82 : insets.bottom + 82),
            position: isDesktop ? 'relative' : 'absolute',
          },
          isDesktop && styles.submitBarWeb
        ]}>
          <View style={styles.submitInfo}>
            <Text style={[styles.submitCount, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              {items.length} ítem{items.length > 1 ? 's' : ''}
            </Text>
            <Text style={{ fontSize: scaleFont(10), color: colors.textMuted, fontFamily: 'JetBrainsMono_400Regular' }}>
              {isPrivileged ? 'Sincronización POS en cola' : 'Se enviará para aprobación'}
            </Text>
            <PressableScale onPress={handleClear} style={{ marginTop: 4 }}>
              <Text style={[styles.clearText, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>Limpiar borrador</Text>
            </PressableScale>
          </View>
          <PressableScale
            style={[styles.submitBtn, { backgroundColor: colors.primary }]}
            onPress={handleSubmit}
            disabled={isLoading}
            dimmed={isLoading}
          >
            {isLoading
              ? <ActivityIndicator color={colors.onPrimary} />
              : <>
                  <Feather name="send" size={16} color={colors.onPrimary} />
                  <Text style={[styles.submitBtnText, { color: colors.onPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                    {isPrivileged ? 'Emitir y Encolar POS' : 'Enviar para aprobación'}
                  </Text>
                </>
            }
          </PressableScale>
        </View>
      )}

      {showBanner && (
        <DraftRestoreBanner
          itemCount={items.length}
          nota={nota || undefined}
          onRestore={() => setBannerDismissed(true)}
          onDiscard={() => {
            handleClear();
            setBannerDismissed(true);
          }}
        />
      )}
    </View>
  );
}

// ── Historial ─────────────────────────────────────────────────────────────────

type SubTabHistorial = 'todo' | 'ajuste' | 'presupuesto' | 'compras' | 'pedidos';

function HistorialView({
  queryClient,
  initialSubTab = 'todo',
  hideSubTabs = false,
}: {
  queryClient: any;
  initialSubTab?: SubTabHistorial;
  hideSubTabs?: boolean;
}) {
  const { colors } = useTheme();
  const setScrollOffsetOrdenes = useInventarioStore(s => s.setScrollOffsetOrdenes);
  const scrollRef = useRef<ScrollView>(null);

  const router = useRouter();
  const [subTab, setSubTab] = useState<SubTabHistorial>(initialSubTab);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const [selectedOrden, setSelectedOrden] = useState<any | null>(null);
  const [editPresupuestoId, setEditPresupuestoId] = useState<number | null>(null);
  const [selectedPedidoModal, setSelectedPedidoModal] = useState<any | null>(null);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const { data: userAuth } = useUserRole();
  const isAdmin = userAuth?.role === 'admin';
  const currentUserId = userAuth?.profile?.id;
  const allowedToOrder = canMakePedidos(userAuth);

  // Realtime subscription to refresh all lists automatically
  useEffect(() => {
    console.log('Suscrito a cambios en historial unificado (Realtime)');
    
    const channel = supabase
      .channel('historial-all-changes-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'presupuestos' }, () => {
        queryClient.refetchQueries({ queryKey: ['presupuestos-history'], type: 'all' });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes_cambio' }, () => {
        queryClient.refetchQueries({ queryKey: ['ordenes-history'], type: 'all' });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compras_app' }, () => {
        queryClient.refetchQueries({ queryKey: ['compras-history'], type: 'all' });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_app' }, () => {
        queryClient.refetchQueries({ queryKey: ['pedidos-history'], type: 'all' });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
  
  const { data: ordenes = [], isLoading: isLoadingOrdenes, refetch: refetchOrdenes } = useOrdenesHistory();
  const { data: presupuestosData, isLoading: isLoadingPresupuestos, refetch: refetchPresupuestos } = usePresupuestosHistory();
  const { data: compras = [], isLoading: isLoadingCompras, refetch: refetchCompras } = useComprasHistory();
  const { data: pedidos = [], isLoading: isLoadingPedidos, refetch: refetchPedidos } = usePedidosHistory();
  
  const presupuestos = presupuestosData?.pages.flat() || [];

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      refetchOrdenes(),
      refetchPresupuestos(),
      refetchCompras(),
      refetchPedidos(),
    ]);
    setRefreshing(false);
  }, [refetchOrdenes, refetchPresupuestos, refetchCompras, refetchPedidos]);

  const isLoading = subTab === 'todo'
    ? (isLoadingOrdenes || isLoadingPresupuestos || isLoadingCompras || isLoadingPedidos)
    : subTab === 'ajuste'
    ? isLoadingOrdenes
    : subTab === 'presupuesto'
    ? isLoadingPresupuestos
    : subTab === 'compras'
    ? isLoadingCompras
    : isLoadingPedidos;

  const listData = subTab === 'ajuste' ? ordenes : presupuestos;

  // Build unified items feed for 'todo'
  const unifiedList = React.useMemo(() => {
    const ajustesMapped = ordenes.map(o => ({
      id: `ajuste-${o.id}`,
      originalId: o.id,
      type: 'ajuste' as const,
      typeLabel: 'Ajuste',
      typeColor: colors.primary,
      code: `OC-${String(o.id).padStart(4, '0')}`,
      date: o.creado_en,
      itemCount: o.item_count || 0,
      creadoPorNombre: o.creado_por_nombre,
      entityName: undefined,
      nota: o.nota,
      status: o.status || 'emitido',
      rawItem: o,
    }));

    const presupuestosMapped = presupuestos.map((p: any) => ({
      id: `presupuesto-${p.id}`,
      originalId: p.id,
      type: 'presupuesto' as const,
      typeLabel: 'Presupuesto',
      typeColor: '#8B5CF6',
      code: `P-${String(p.id).padStart(4, '0')}`,
      date: p.creado_en,
      itemCount: p.items_count || p.item_count || 0,
      creadoPorNombre: p.creado_por_nombre,
      entityName: p.cliente_nombre,
      nota: p.nota,
      status: p.status || 'emitido',
      rawItem: p,
    }));

    const comprasMapped = compras.map((c: any) => ({
      id: `compra-${c.id}`,
      originalId: c.id,
      type: 'compra' as const,
      typeLabel: 'Compra',
      typeColor: '#10B981',
      code: `COM-${String(c.id).padStart(4, '0')}`,
      date: c.creado_en,
      itemCount: c.item_count || 0,
      creadoPorNombre: c.creado_por_nombre,
      entityName: c.proveedor_nombre,
      nota: c.nota,
      status: c.status || 'emitido',
      rawItem: c,
    }));

    const pedidosMapped = pedidos.map((pd: any) => ({
      id: `pedido-${pd.id}`,
      originalId: pd.id,
      type: 'pedido' as const,
      typeLabel: 'Pedido',
      typeColor: '#F59E0B',
      code: `PED-${String(pd.id).padStart(4, '0')}`,
      date: pd.creado_en,
      itemCount: pd.item_count || 0,
      creadoPorNombre: pd.creado_por_nombre,
      entityName: pd.cliente_nombre,
      nota: pd.nota,
      status: pd.status || 'emitido',
      rawItem: pd,
    }));

    return [...ajustesMapped, ...presupuestosMapped, ...comprasMapped, ...pedidosMapped].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [ordenes, presupuestos, compras, pedidos, colors.primary]);

  const [isGeneratingPdf, setIsGeneratingPdf] = useState<number | null>(null);

  // Restaurar scroll — leemos el offset guardado una sola vez al recuperar foco.
  useFocusEffect(
    useCallback(() => {
      const saved = useInventarioStore.getState().scrollOffsetOrdenes;
      if (saved > 0 && scrollRef.current) {
        const timer = setTimeout(() => {
          scrollRef.current?.scrollTo({ y: saved, animated: false });
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [])
  );

  const handleViewPDF = async (o: any, forcedType?: string) => {
    const isAjuste = forcedType ? forcedType === 'ajuste' : subTab === 'ajuste';
    if (o.pdf_url) {
      if (Platform.OS === 'web') {
        Linking.openURL(o.pdf_url);
      } else {
        setIsGeneratingPdf(o.id);
        try {
          let friendlyName = 'Documento.pdf';
          if (isAjuste) {
            friendlyName = `Ajuste_No_${o.id}.pdf`;
          } else {
            const { data: header } = await supabase
              .from('presupuestos')
              .select(`*, clientes ( nombre, rif, telefono, direccion )`)
              .eq('id', o.id)
              .single();
            const clienteObj = header ? (Array.isArray(header.clientes) ? header.clientes[0] : header.clientes) : null;
            friendlyName = getPresupuestoFilename(clienteObj as any, o.id);
          }
          const localDestUri = `${FileSystem.cacheDirectory}${friendlyName}`;
          await FileSystem.downloadAsync(o.pdf_url, localDestUri);
          await Sharing.shareAsync(localDestUri, { mimeType: 'application/pdf' });
        } catch (downloadErr: any) {
          notify('Error', 'No se pudo descargar el PDF para compartir: ' + downloadErr.message);
        } finally {
          setIsGeneratingPdf(null);
        }
      }
      return;
    }

    // No PDF URL, re-generate it
    setIsGeneratingPdf(o.id);
    try {
      let html = '';
      let friendlyName = 'Documento.pdf';
      if (isAjuste) {
        const { data: items, error } = await supabase
          .from('ordenes_cambio_items')
          .select('*')
          .eq('orden_id', o.id);

        if (error) throw error;
        // Fetch creator name
        const { data: profileData } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', o.creado_por)
          .single();
        const creadoPor = profileData?.display_name || undefined;
        html = buildPdfHtml(items as any[], o.nota, o.id, creadoPor);
        friendlyName = `Ajuste_No_${o.id}.pdf`;
      } else {
        const { data: header, error: headerErr } = await supabase
          .from('presupuestos')
          .select(`*, clientes ( nombre, rif, telefono, direccion )`)
          .eq('id', o.id)
          .single();
          
        if (headerErr) throw headerErr;

        const { data: items, error: detailErr } = await supabase
          .from('presupuestos_detalle')
          .select('*')
          .eq('presupuesto_id', o.id);
          
        if (detailErr) throw detailErr;

        const clienteObj = Array.isArray(header.clientes) ? header.clientes[0] : header.clientes;
        // Fetch creator name
        let creadoPorNombre: string | undefined;
        if (header.creado_por) {
          const { data: pData } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', header.creado_por)
            .single();
          creadoPorNombre = pData?.display_name || undefined;
        }
        html = buildPresupuestoPdfHtml(
          clienteObj as any, 
          items as any[], 
          header.nota || '', 
          header.id, 
          creadoPorNombre,
          header.en_bs,
          header.tasa_cambio ? Number(header.tasa_cambio) : undefined,
          header.porcentaje_recargo ? Number(header.porcentaje_recargo) : undefined
        );
        friendlyName = getPresupuestoFilename(clienteObj as any, header.id);
      }
      
      if (Platform.OS === 'web') {
        await printHtml(html);
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        const localDestUri = `${FileSystem.cacheDirectory}${friendlyName}`;
        await FileSystem.copyAsync({
          from: uri,
          to: localDestUri,
        });
        await Sharing.shareAsync(localDestUri, { mimeType: 'application/pdf' });
        
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch (cleanupError) {
          console.warn('[handleViewPDF] failed to clean up temp file:', cleanupError);
        }
      }
    } catch (err: any) {
      notify('Error', 'No se pudo generar el PDF: ' + err.message);
    } finally {
      setIsGeneratingPdf(null);
    }
  };

  const handleDelete = async (o: any) => {
    confirm({
      title: 'Eliminar registro',
      message: `¿Estás seguro de que deseas eliminar este ${subTab === 'ajuste' ? 'ajuste' : 'presupuesto'}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      destructive: true,
      onConfirm: async () => {
        try {
          if (subTab === 'ajuste') {
            // Delete child items first
            const { error: itemsError, count: itemsCount } = await supabase
              .from('ordenes_cambio_items')
              .delete({ count: 'exact' })
              .eq('orden_id', o.id);
            if (itemsError) throw itemsError;
            console.log(`Deleted ${itemsCount} items for orden ${o.id}`);

            // Delete parent header
            const { error: headerError, count: headerCount } = await supabase
              .from('ordenes_cambio')
              .delete({ count: 'exact' })
              .eq('id', o.id);
            if (headerError) throw headerError;

            if (headerCount === 0) {
              throw new Error('No se pudo eliminar: sin permisos para este registro.');
            }

            // Force immediate refetch
            await queryClient.refetchQueries({ queryKey: ['ordenes-history'], type: 'all' });
          } else {
            // Delete child details first
            const { error: itemsError, count: itemsCount } = await supabase
              .from('presupuestos_detalle')
              .delete({ count: 'exact' })
              .eq('presupuesto_id', o.id);
            if (itemsError) throw itemsError;
            console.log(`Deleted ${itemsCount} detail rows for presupuesto ${o.id}`);

            // Delete parent header
            const { error: headerError, count: headerCount } = await supabase
              .from('presupuestos')
              .delete({ count: 'exact' })
              .eq('id', o.id);
            if (headerError) throw headerError;

            if (headerCount === 0) {
              throw new Error('No se pudo eliminar: sin permisos para este registro.');
            }

            // Force total reset for infinite query then refetch
            queryClient.removeQueries({ queryKey: ['presupuestos-history'] });
            await refetchPresupuestos();
          }
            // notify('Éxito', 'Registro eliminado correctamente');
        } catch (err: any) {
          console.error('Error eliminando registro:', err);
          notify('Error', err.message || 'No se pudo eliminar el registro');
        }
      },
    });
  };

  // Convertir un presupuesto en un pedido: precarga cliente + ítems en el store
  // de pedido y abre su modal (montado en el Dashboard vía PedidoFab) para que
  // el usuario revise y emita a caja. No modifica el presupuesto.
  const handleConvertToPedido = async (o: any) => {
    const doLoad = async () => {
      setConvertingId(o.id);
      try {
        const items = await fetchPresupuestoItemsForPedido(o.id);
        if (items.length === 0) {
          notify('Sin ítems', 'Este presupuesto no tiene productos para convertir.');
          return;
        }
        usePedido.getState().loadFromPresupuesto({
          presupuestoId: o.id,
          clienteCodigo: o.cliente_id ?? null,
          clienteNombre: o.cliente_nombre ?? null,
          nota:          o.nota ?? '',
          items,
        });
        // El armador de pedido vive en el Dashboard (PedidoFab); navegamos allí
        // para que el modal ya abierto (modalOpen) quede sobre una pantalla coherente.
        router.push('/(tabs)');
      } catch (err: any) {
        notify('Error', err?.message ?? 'No se pudo convertir el presupuesto en pedido.');
      } finally {
        setConvertingId(null);
      }
    };

    // Si ya hay un pedido en construcción, confirmamos antes de reemplazarlo.
    const enCurso = usePedido.getState().items.length;
    if (enCurso > 0) {
      confirm({
        title:       'Reemplazar pedido en curso',
        message:     `Tienes un pedido a medio armar con ${enCurso} ítem${enCurso > 1 ? 's' : ''}. Convertir este presupuesto lo reemplazará.`,
        confirmText: 'Reemplazar',
        destructive: true,
        onConfirm:   doLoad,
      });
      return;
    }
    await doLoad();
  };

  // Guardar scroll (el setter de Zustand es estable, no provoca re-render aquí)
  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset >= 0) {
      setScrollOffsetOrdenes(offset);
    }
  }, [setScrollOffsetOrdenes]);

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <View style={styles.flex}>
      {/* Sub-tabs for Historial */}
      {!hideSubTabs && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 4 }}
          style={{ marginBottom: 12, maxHeight: 46 }}
        >
          {(['todo', 'ajuste', 'presupuesto', 'compras', 'pedidos'] as const).map(key => {
            const labels: Record<string, string> = {
              todo: 'Todo',
              ajuste: 'Ajustes',
              presupuesto: 'Presupuestos',
              compras: 'Compras',
              pedidos: 'Pedidos',
            };
            const active = subTab === key;
            return (
              <PressableScale
                key={key}
                activeScale={pressScale.row}
                style={[
                  styles.subTabBtn,
                  {
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: 12,
                    backgroundColor: active ? colors.surface : 'transparent',
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSubTab(key)}
              >
                <Text style={[styles.subTabText, { color: active ? colors.primary : colors.textMuted }]}>
                  {labels[key]}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      )}

      {subTab === 'compras' ? (
        <ComprasHistorialView />
      ) : subTab === 'pedidos' ? (
        <PedidosHistorialView />
      ) : subTab === 'todo' ? (
        unifiedList.length === 0 ? (
          <View style={styles.center}>
            <Feather name="inbox" size={32} color={colors.textDim} />
            <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Sin historial registrado</Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
          >
            {unifiedList.map(item => {
              const dateStr = new Date(item.date).toLocaleString('es-VE', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              });

              return (
                <PressableScale
                  key={item.id}
                  style={[
                    styles.histCard,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  activeScale={pressScale.row}
                  onPress={() => {
                    if (item.type === 'ajuste') {
                      setSelectedOrden(item.rawItem);
                    } else if (item.type === 'presupuesto') {
                      if (isAdmin || currentUserId === item.rawItem.creado_por) {
                        setEditPresupuestoId(item.originalId);
                      }
                    } else if (item.type === 'pedido') {
                      setSelectedPedidoModal(item.rawItem);
                    }
                  }}
                >
                  <View style={styles.histTop}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[styles.histId, { color: colors.primary }]} numberOfLines={1}>
                        {item.code}
                      </Text>
                      <View style={[styles.statusBadge, { backgroundColor: item.typeColor + '22', borderColor: item.typeColor + '55' }]}>
                        <Text style={[styles.statusText, { color: item.typeColor }]} numberOfLines={1}>
                          {item.typeLabel}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.histBadgeGroup}>
                      {item.type === 'ajuste' && <BackendBadge resumen={(item.rawItem as any).backend_resumen} />}
                      <View style={[
                        styles.statusBadge,
                        { backgroundColor: item.status === 'emitido' ? colors.success + '22' : colors.warning + '22',
                          borderColor:     item.status === 'emitido' ? colors.success + '55' : colors.warning + '55' },
                      ]}>
                        <Text style={[styles.statusText, { color: item.status === 'emitido' ? colors.success : colors.warning }]} numberOfLines={1}>
                          {item.status}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {item.entityName ? (
                    <Text style={[styles.histClient, { color: colors.text }]} numberOfLines={1}>
                      <Feather name={item.type === 'compra' ? "truck" : "user"} size={12} /> {item.entityName}
                    </Text>
                  ) : null}

                  <Text style={[styles.histMeta, { color: colors.textMuted }]} numberOfLines={1}>
                    {dateStr}
                    {'  ·  '}{item.itemCount} ítem{item.itemCount !== 1 ? 's' : ''}
                    {item.creadoPorNombre ? `  ·  ${item.creadoPorNombre}` : ''}
                  </Text>

                  {item.nota ? (
                    <Text style={[styles.histNota, { color: colors.textMuted }]} numberOfLines={1}>
                      {item.nota}
                    </Text>
                  ) : null}

                  {(item.type === 'ajuste' || item.type === 'presupuesto') && (
                    <View style={styles.histFooter}>
                      <PressableScale
                        style={[styles.pdfBtn, { borderColor: colors.primary }]}
                        onPress={() => handleViewPDF(item.rawItem, item.type)}
                        disabled={isGeneratingPdf !== null}
                        dimmed={isGeneratingPdf === item.originalId}
                      >
                        {isGeneratingPdf === item.originalId ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <>
                            <Feather name="file-text" size={14} color={colors.primary} />
                            <Text style={[styles.pdfBtnText, { color: colors.primary }]}>
                              {Platform.OS === 'web'
                                ? (item.rawItem.pdf_url ? 'Ver PDF' : 'Imprimir PDF')
                                : 'Compartir PDF'}
                            </Text>
                          </>
                        )}
                      </PressableScale>
                    </View>
                  )}
                </PressableScale>
              );
            })}
            <View style={{ height: 150 }} />
          </ScrollView>
        )
      ) : listData.length === 0 ? (
        <View style={styles.center}>
          <Feather name="inbox" size={32} color={colors.textDim} />
          <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Sin historial</Text>
        </View>
      ) : (
        <ScrollView 
          ref={scrollRef}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.scroll} 
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {listData.map(o => {
            const isPresupuesto = subTab === 'presupuesto';
            const prefix = isPresupuesto ? 'P-' : 'OC-';
            const dateStr = new Date(o.creado_en).toLocaleString('es-VE', {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            });
            const itemCount = isPresupuesto ? (o as any).items_count || 0 : (o as any).item_count || 0;
            const status = o.status || 'emitido';
            const canEdit = isAdmin || currentUserId === o.creado_por;

            return (
              <PressableScale
                key={o.id}
                style={[
                  styles.histCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                activeScale={pressScale.row}
                onPress={() => {
                  if (isPresupuesto) {
                    if (canEdit) setEditPresupuestoId(o.id);
                  } else {
                    setSelectedOrden(o);
                  }
                }}
              >
                <View style={styles.histTop}>
                  <Text style={[styles.histId, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
                    {prefix}{String(o.id).padStart(4, '0')}
                  </Text>
                  <View style={styles.histBadgeGroup}>
                    {!isPresupuesto ? <BackendBadge resumen={(o as any).backend_resumen} /> : null}
                    <View style={[
                      styles.statusBadge,
                      { backgroundColor: status === 'emitido' ? colors.success + '22' : colors.warning + '22',
                        borderColor:     status === 'emitido' ? colors.success + '55' : colors.warning + '55' },
                    ]}>
                      <Text style={[styles.statusText, { color: status === 'emitido' ? colors.success : colors.warning }]} numberOfLines={1} adjustsFontSizeToFit>
                        {status}
                      </Text>
                    </View>
                  </View>
                </View>

                {isPresupuesto && (o as any).cliente_nombre ? (
                  <Text style={[styles.histClient, { color: colors.text }]} numberOfLines={1}>
                    <Feather name="user" size={12} /> {(o as any).cliente_nombre}
                  </Text>
                ) : null}

                <Text style={[styles.histMeta, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                  {dateStr}
                  {'  ·  '}{itemCount} ítem{itemCount !== 1 ? 's' : ''}
                  {(o as any).creado_por_nombre ? `  ·  ${(o as any).creado_por_nombre}` : ''}
                </Text>

                {o.nota ? (
                  <Text style={[styles.histNota, { color: colors.textMuted }]} numberOfLines={1}>
                    {o.nota}
                  </Text>
                ) : null}

                {isPresupuesto && (o as any).pedido_id ? (
                  <View style={[styles.convertedBadge, { borderColor: colors.success + '55', backgroundColor: colors.success + '18' }]}>
                    <Feather name="check-circle" size={13} color={colors.success} />
                    <Text style={[styles.convertedText, { color: colors.success }]} numberOfLines={1} adjustsFontSizeToFit>
                      Convertido a PED-{String((o as any).pedido_id).padStart(4, '0')}
                    </Text>
                  </View>
                ) : isPresupuesto && allowedToOrder ? (
                  <PressableScale
                    style={[styles.convertBtn, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]}
                    activeScale={pressScale.row}
                    onPress={() => handleConvertToPedido(o)}
                    disabled={convertingId !== null}
                    dimmed={convertingId === o.id}
                  >
                    {convertingId === o.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <>
                        <Feather name="shopping-cart" size={14} color={colors.primary} />
                        <Text style={[styles.convertBtnText, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
                          Convertir a pedido
                        </Text>
                      </>
                    )}
                  </PressableScale>
                ) : null}

                <View style={styles.histFooter}>
                  <PressableScale
                    style={[styles.pdfBtn, { borderColor: colors.primary }]}
                    onPress={() => handleViewPDF(o)}
                    disabled={isGeneratingPdf !== null}
                    dimmed={isGeneratingPdf === o.id}
                  >
                    {isGeneratingPdf === o.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <>
                        <Feather name="file-text" size={14} color={colors.primary} />
                        <Text style={[styles.pdfBtnText, { color: colors.primary }]}>
                          {Platform.OS === 'web'
                            ? (o.pdf_url ? 'Ver PDF' : 'Imprimir PDF')
                            : 'Compartir PDF'}
                        </Text>
                      </>
                    )}
                  </PressableScale>

                  {/* Right-side actions — admin: all, employee: own items only */}
                  <View style={styles.histActions}>
                    {isPresupuesto && canEdit && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.deleteBtn,
                          { borderColor: colors.border },
                          pressed && { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }
                        ]}
                        onPress={() => setEditPresupuestoId(o.id)}
                      >
                        {({ pressed }) => (
                          <Feather name="edit-2" size={14} color={pressed ? colors.primary : colors.textMuted} />
                        )}
                      </Pressable>
                    )}

                    {canEdit && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.deleteBtn,
                          { borderColor: colors.border },
                          pressed && { backgroundColor: colors.danger + '15', borderColor: colors.danger + '40' }
                        ]}
                        onPress={() => handleDelete(o)}
                      >
                        {({ pressed }) => (
                          <Feather
                            name="trash-2"
                            size={14}
                            color={pressed ? colors.danger : colors.textMuted}
                          />
                        )}
                      </Pressable>
                    )}
                  </View>
                </View>
              </PressableScale>
            );
          })}
          <View style={{ height: 150 }} />
        </ScrollView>
      )}
      <OrdenCambioDetailModal
        orden={selectedOrden}
        onClose={() => setSelectedOrden(null)}
      />
      <PresupuestoEditModal
        presupuestoId={editPresupuestoId}
        onClose={() => setEditPresupuestoId(null)}
      />
      <PedidoStatusModal
        visible={selectedPedidoModal !== null}
        pedidoId={selectedPedidoModal?.id ?? null}
        initialCliente={selectedPedidoModal?.cliente_nombre}
        initialItemCount={selectedPedidoModal?.item_count ?? 0}
        onClose={() => setSelectedPedidoModal(null)}
      />
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.tabBtn,
        active && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
        pressed && { backgroundColor: colors.primary + '10' }
      ]}
      onPress={onPress}
      hitSlop={8}
    >
      <Text style={[styles.tabText, { color: active ? colors.primary : colors.textMuted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function BackendBadge({ resumen }: { resumen?: BackendResumen }): React.JSX.Element | null {
  const { colors } = useTheme();
  if (!resumen) return null;

  if (resumen.espera_aprobacion > 0) {
    return (
      <View style={[styles.backendBadge, { backgroundColor: colors.warning + '18', borderColor: colors.warning + '40' }]}>
        <Feather name="clock" size={10} color={colors.warning} />
        <Text style={[styles.backendBadgeText, { color: colors.warning }]} numberOfLines={1}>
          Espera aprobación
        </Text>
      </View>
    );
  }

  if (resumen.rechazados > 0 && resumen.rechazados === resumen.total) {
    return (
      <View style={[styles.backendBadge, { backgroundColor: colors.danger + '18', borderColor: colors.danger + '40' }]}>
        <Feather name="slash" size={10} color={colors.danger} />
        <Text style={[styles.backendBadgeText, { color: colors.danger }]} numberOfLines={1}>
          Rechazado
        </Text>
      </View>
    );
  }

  if (resumen.errores > 0) {
    return (
      <View style={[styles.backendBadge, { backgroundColor: colors.danger + '18', borderColor: colors.danger + '40' }]}>
        <Feather name="alert-triangle" size={10} color={colors.danger} />
        <Text style={[styles.backendBadgeText, { color: colors.danger }]} numberOfLines={1}>
          Error ({resumen.errores})
        </Text>
      </View>
    );
  }

  if (resumen.aplicando > 0) {
    return (
      <View style={[styles.backendBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '40' }]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.backendBadgeText, { color: colors.primary }]} numberOfLines={1}>
          Aplicando…
        </Text>
      </View>
    );
  }

  if (resumen.pendientes > 0) {
    return (
      <View style={[styles.backendBadge, { backgroundColor: colors.warning + '18', borderColor: colors.warning + '40' }]}>
        <Feather name="clock" size={10} color={colors.warning} />
        <Text style={[styles.backendBadgeText, { color: colors.warning }]} numberOfLines={1}>
          En cola ({resumen.pendientes})
        </Text>
      </View>
    );
  }

  if (resumen.completados === resumen.total && resumen.total > 0) {
    return (
      <View style={[styles.backendBadge, { backgroundColor: colors.success + '18', borderColor: colors.success + '40' }]}>
        <Feather name="check" size={10} color={colors.success} />
        <Text style={[styles.backendBadgeText, { color: colors.success }]} numberOfLines={1}>
          Sincronizado POS
        </Text>
      </View>
    );
  }

  return null;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingTop:        12,
  },
  title: { fontSize: scaleFont(26), fontFamily: 'JetBrainsMono_700Bold', marginBottom: 20 },

  tabRowWrapper: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  tabRow: {
    flexDirection: 'row',
    gap:           20,
    paddingHorizontal: 16,
  },
  tabBtn: {
    paddingBottom: 10,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  tabText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

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
  addProductText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  empty: {
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap:            12,
  },
  emptyTitle: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  emptySub:   { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(20) },

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
  itemName:  { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  itemCode:  { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', marginTop: 1 },
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
  qtyLabel:  { fontSize: scaleFont(9), fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.3 },
  qtyVal:    { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  qtyEdit: {
    fontSize:   scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
    textAlign:  'center',
    textAlignVertical: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 0,
    includeFontPadding: false,
    height:      36,
    width:       50,
    fontVariant: ['tabular-nums'],
  } as any,
  qtyBtn: {
    width:          36,
    height:         36,
    borderRadius:   8,
    borderWidth:    1,
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
    fontSize: scaleFont(12), 
    fontFamily: 'JetBrainsMono_700Bold', 
    fontVariant: ['tabular-nums'] 
  },

  notaInput: {
    fontSize:   scaleFont(16),
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
  ordenNotaLabel: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  ordenNotaInput: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(22), minHeight: 44 },

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
  submitCount:   { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  clearText:     { fontSize: scaleFont(12), marginTop: 2, fontFamily: 'JetBrainsMono_400Regular' },
  submitBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            8,
    borderRadius:   12,
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
  histId:   { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  histBadgeGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusBadge: { borderRadius: 999, borderWidth: 0.5, paddingVertical: 3, paddingHorizontal: 10 },
  statusText:  { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },
  backendBadge: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   3,
    paddingHorizontal: 10,
  },
  backendBadgeText: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  histMeta:    { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },
  histNota:    { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },
  pdfBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            6,
    alignSelf:      'flex-start',
    borderWidth:    0.5,
    borderRadius:   999,
    paddingVertical:   6,
    paddingHorizontal: 14,
    marginTop:         4,
  },
  pdfBtnText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },
  convertBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             6,
    marginTop:       10,
    paddingVertical: 10,
    borderRadius:    10,
    borderWidth:     1,
    borderStyle:     'dashed',
  },
  convertBtnText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },
  convertedBadge: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               6,
    marginTop:         10,
    paddingVertical:   9,
    paddingHorizontal: 12,
    borderRadius:      10,
    borderWidth:       0.5,
  },
  convertedText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },
  histFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  histActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteBtn: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  subTabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 12,
    padding: 4,
    borderRadius: 14,
    gap: 4,
    borderWidth: 0.5,
  },
  subTabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subTabText: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  histClient: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
    marginTop: 4,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  infoBannerIcon: {
    marginTop: 2,
    marginRight: 10,
  },
  infoBannerTextContainer: {
    flex: 1,
  },
  infoBannerTitle: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoBannerSub: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(15),
  },
});
