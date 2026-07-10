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
import { useDeviceSize } from '../../src/hooks/useDeviceSize';
import { useInventarioStore } from '../../src/hooks/useInventarioStore';
import { useOrdenCambio } from '../../src/hooks/useOrdenCambio';
import { useOrdenesHistory, BackendResumen } from '../../src/hooks/useOrdenesHistory';
import { useUserRole } from '../../src/hooks/useUserRole';
import { supabase } from '../../src/lib/supabase';
import { buildPdfHtml, buildPresupuestoPdfHtml, printHtml, getPresupuestoFilename } from '../../src/utils/pdfGenerator';
import PresupuestoView from '../../src/components/PresupuestoView';
import FallasView from '../../src/components/FallasView';
import { usePresupuestosHistory } from '../../src/hooks/usePresupuestosHistory';
import { OrdenCambioDetailModal } from '../../src/components/OrdenCambioDetailModal';
import { PresupuestoEditModal } from '../../src/components/PresupuestoEditModal';
import { DraftRestoreBanner } from '../../src/components/DraftRestoreBanner';

type Tab = 'ajuste' | 'presupuesto' | 'historial' | 'fallas';

export default function Ordenes() {
  const { colors, formatUSD } = useTheme();
  const router       = useRouter();
  const queryClient  = useQueryClient();
  const params       = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>('ajuste');

  useEffect(() => {
    if (params.tab === 'ajuste' || params.tab === 'presupuesto' || params.tab === 'historial' || params.tab === 'fallas') {
      setTab(params.tab as Tab);
    }
  }, [params.tab]);

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
          <TabBtn label="Presupuesto" active={tab === 'presupuesto'} onPress={() => setTab('presupuesto')} />
          <TabBtn label="Fallas" active={tab === 'fallas'} onPress={() => setTab('fallas')} />
          <TabBtn label="Historial" active={tab === 'historial'} onPress={() => setTab('historial')} />
        </ScrollView>
      </View>

      {tab === 'ajuste' && <BorradorView router={router} />}
      {tab === 'presupuesto' && <PresupuestoView router={router} />}
      {tab === 'fallas' && <FallasView />}
      {tab === 'historial' && <HistorialView queryClient={queryClient} />}
    </SafeAreaView>
  );
}

// ── Borrador (draft order builder) ───────────────────────────────────────────

function BorradorView({ router }: { router: any }) {
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
            <Pressable onPress={handleClear} style={({ pressed }) => pressed && { opacity: 0.7 }}>
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

function HistorialView({ queryClient }: { queryClient: any }) {
  const { colors } = useTheme();
  // Solo seleccionamos el setter (referencia estable). Suscribirse al valor
  // `scrollOffsetOrdenes` re-renderizaba el historial en cada frame de
  // scroll (~60 fps). El valor solo se necesita al recuperar foco, así que
  // se lee con getState() sin suscripción.
  const setScrollOffsetOrdenes = useInventarioStore(s => s.setScrollOffsetOrdenes);
  const scrollRef = useRef<ScrollView>(null);

  const [subTab, setSubTab] = useState<'ajuste' | 'presupuesto'>('ajuste');
  const [selectedOrden, setSelectedOrden] = useState<any | null>(null);
  const [editPresupuestoId, setEditPresupuestoId] = useState<number | null>(null);
  const { data: userAuth } = useUserRole();
  const isAdmin = userAuth?.role === 'admin';
  const currentUserId = userAuth?.profile?.id;

  // Realtime subscription to refresh lists automatically
  useEffect(() => {
    console.log('Suscrito a cambios en historial (Realtime)');
    
    const channel = supabase
      .channel('historial-changes-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'presupuestos' }, (payload) => {
        console.log('Cambio detectado en presupuestos:', payload.eventType);
        queryClient.refetchQueries({ queryKey: ['presupuestos-history'], type: 'all' });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes_cambio' }, (payload) => {
        console.log('Cambio detectado en ordenes_cambio:', payload.eventType);
        queryClient.refetchQueries({ queryKey: ['ordenes-history'], type: 'all' });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log('Canal Realtime activo: historial-changes-sync');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
  
  const { data: ordenes = [], isLoading: isLoadingOrdenes, refetch: refetchOrdenes } = useOrdenesHistory();
  const { data: presupuestosData, isLoading: isLoadingPresupuestos, refetch: refetchPresupuestos } = usePresupuestosHistory();
  
  const presupuestos = presupuestosData?.pages.flat() || [];

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (subTab === 'ajuste') {
      await refetchOrdenes();
    } else {
      await refetchPresupuestos();
    }
    setRefreshing(false);
  }, [subTab, refetchOrdenes, refetchPresupuestos]);

  
  const isLoading = subTab === 'ajuste' ? isLoadingOrdenes : isLoadingPresupuestos;
  const listData = subTab === 'ajuste' ? ordenes : presupuestos;

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

  const handleViewPDF = async (o: any) => {
    if (o.pdf_url) {
      if (Platform.OS === 'web') {
        Linking.openURL(o.pdf_url);
      } else {
        setIsGeneratingPdf(o.id);
        try {
          let friendlyName = 'Documento.pdf';
          if (subTab === 'ajuste') {
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
      if (subTab === 'ajuste') {
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
      <View style={[styles.subTabContainer, { backgroundColor: '#0A0A0A', borderColor: colors.border }]}>
        <Pressable 
          style={({ pressed }) => [
            styles.subTabBtn, 
            subTab === 'ajuste' && { backgroundColor: colors.surface, borderColor: '#333' },
            pressed && { opacity: 0.8 }
          ]} 
          onPress={() => setSubTab('ajuste')}
        >
          <Text style={[styles.subTabText, { color: subTab === 'ajuste' ? colors.primary : colors.textMuted }]}>Ajustes</Text>
        </Pressable>
        <Pressable 
          style={({ pressed }) => [
            styles.subTabBtn, 
            subTab === 'presupuesto' && { backgroundColor: colors.surface, borderColor: '#333' },
            pressed && { opacity: 0.8 }
          ]} 
          onPress={() => setSubTab('presupuesto')}
        >
          <Text style={[styles.subTabText, { color: subTab === 'presupuesto' ? colors.primary : colors.textMuted }]}>Presupuestos</Text>
        </Pressable>
      </View>

      {listData.length === 0 ? (
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
              <Pressable
                key={o.id}
                style={({ pressed }) => [
                  styles.histCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                  pressed && { opacity: 0.75 }
                ]}
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

                <View style={styles.histFooter}>
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
                          {Platform.OS === 'web'
                            ? (o.pdf_url ? 'Ver PDF' : 'Imprimir PDF')
                            : 'Compartir PDF'}
                        </Text>
                      </>
                    )}
                  </Pressable>

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
              </Pressable>
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

  if (resumen.errores > 0) {
    const label = resumen.errores > 1 ? 'errores' : 'error';
    return (
      <View style={[styles.backendBadge, { backgroundColor: colors.danger + '18', borderColor: colors.danger + '40' }]}>
        <Feather name="alert-triangle" size={10} color={colors.danger} />
        <Text style={[styles.backendBadgeText, { color: colors.danger }]} numberOfLines={1}>
          {resumen.errores} {label}
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
          {resumen.pendientes} en cola
        </Text>
      </View>
    );
  }

  if (resumen.completados === resumen.total && resumen.total > 0) {
    return (
      <View style={[styles.backendBadge, { backgroundColor: colors.success + '18', borderColor: colors.success + '40' }]}>
        <Feather name="check" size={10} color={colors.success} />
        <Text style={[styles.backendBadgeText, { color: colors.success }]} numberOfLines={1}>
          Aplicado
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
});
