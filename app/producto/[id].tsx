import { scaleFont } from '../../src/theme/responsive';
import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, Animated, PanResponder, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { notify } from '../../src/lib/notify';

const screenHeight = Dimensions.get('window').height;

import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeContext';
import { CurrencyText } from '../../src/components/CurrencyText';
import { supabase, Producto } from '../../src/lib/supabase';
import { useMovimientosProducto, MovimientoProducto } from '../../src/hooks/useMovimientosProducto';
import { VentaDetailModal } from '../../src/components/VentaDetailModal';
import { VentaHoy } from '../../src/hooks/useVentasHoy';
import { buildPdfHtml, printHtml, DraftItem } from '../../src/utils/pdfGenerator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { uploadPdfAndGetUrl } from '../../src/lib/pdfStorage';
import { useOrdenCambio } from '../../src/hooks/useOrdenCambio';

export default function ProductoDetail() {
  const { colors, tokens, formatUSD } = useTheme();
  const router  = useRouter();
  const { id }  = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [showPriceSheet, setShowPriceSheet] = useState(false);
  const [newPrice, setNewPrice] = useState('');
  const [newCost, setNewCost] = useState('');
  const [isSavingPrice, setIsSavingPrice] = useState(false);

  const { data: movimientos, isLoading: isLoadingMovs } = useMovimientosProducto(id);
  const hasPendingSync = movimientos?.some(m => m.backend_status === 'pendiente' || m.backend_status === 'aplicando');
  const pendingDelta = movimientos?.find(m => m.backend_status === 'pendiente' || m.backend_status === 'aplicando')?.cantidad ?? 0;

  const [selectedVentaId, setSelectedVentaId] = useState<number | null>(null);

  const { data: selectedVenta, isLoading: isLoadingVenta } = useQuery({
    queryKey: ['venta-hoy-single', selectedVentaId],
    queryFn: async () => {
      if (!selectedVentaId) return null;
      const { data, error } = await supabase
        .from('vw_ventas_usd')
        .select('*')
        .eq('venta_id', selectedVentaId)
        .single();

      if (error) throw error;

      return {
        ...data,
        id:                          data.venta_id,
        total_usd:                   Number(data.total_usd   ?? 0),
        ganancia_total_usd:          Number(data.ganancia_total_usd ?? 0),
        items_count:                 Number(data.lines_count ?? data.items_count ?? 0),
        total_neto_usd:              Number(data.total_neto_usd     ?? 0),
        total_bruto_usd:             Number(data.total_bruto_usd    ?? 0),
        total_impuesto_usd:          Number(data.total_impuesto_usd ?? 0),
        original_total_neto_ves:     Number(data.original_total_neto_ves     ?? 0),
        original_total_impuesto_ves: Number(data.original_total_impuesto_ves ?? 0),
        nombre_cliente:              data.nombre_cliente ?? 'Cliente Genérico',
        metodo_pago:                 data.metodo_pago ?? null,
        id_unico:                    data.id_unico ?? null,
      } as VentaHoy;
    },
    enabled: !!selectedVentaId,
    staleTime: 60_000,
  });

  const [showAddSheet, setShowAddSheet] = useState(false);
  const [newQty,       setNewQty]       = useState('');
  const [adjMode,      setAdjMode]      = useState<'fixed' | 'relative'>('fixed');
  const [adjOp,        setAdjOp]        = useState<'+' | '-'>('+');
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);

  const panY = useRef(new Animated.Value(screenHeight)).current;

  const closeSheet = () => {
    Animated.timing(panY, {
      toValue: screenHeight,
      duration: 200,
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      setShowAddSheet(false);
      setShowPriceSheet(false);
    });
  };

  // Reset animation when sheet opens
  useEffect(() => {
    if (showAddSheet || showPriceSheet) {
      Animated.spring(panY, {
        toValue: 0,
        useNativeDriver: Platform.OS !== 'web',
        tension: 40,
        friction: 8,
      }).start();
    } else {
      panY.setValue(screenHeight);
    }
  }, [showAddSheet, showPriceSheet]);

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
            useNativeDriver: Platform.OS !== 'web',
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
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7, transform: [{ scale: 0.94 }] }]}
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
              <Text style={[styles.code, { color: colors.primary, flex: 1, textAlign: 'right', marginLeft: 16 }]} numberOfLines={1} adjustsFontSizeToFit>{producto.codigo_interno}</Text>
            </View>
            {producto.codigo_barras ? (
              <View style={styles.codeRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Código de barras</Text>
                <Text style={[styles.code, { color: colors.textMuted, flex: 1, textAlign: 'right', marginLeft: 16 }]} numberOfLines={1} adjustsFontSizeToFit>{producto.codigo_barras}</Text>
              </View>
            ) : null}
            {producto.referencia ? (
              <View style={styles.codeRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Referencia</Text>
                <Text style={[styles.code, { color: colors.textMuted, flex: 1, textAlign: 'right', marginLeft: 16 }]} numberOfLines={1} adjustsFontSizeToFit>{producto.referencia}</Text>
              </View>
            ) : null}
            {producto.unidad ? (
              <View style={styles.codeRow}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Unidad</Text>
                <Text style={[styles.value, { color: colors.text, flex: 1, textAlign: 'right', marginLeft: 16 }]} numberOfLines={1} adjustsFontSizeToFit>{producto.unidad}</Text>
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
            {hasPendingSync && (
              <View style={[styles.stockPendingBanner, { backgroundColor: colors.warning + '12', borderColor: colors.warning + '40', marginTop: 12 }]}>
                <Feather name="clock" size={12} color={colors.warning} />
                <Text style={[styles.stockPendingText, { color: colors.textMuted }]} numberOfLines={2}>
                  Sincronización pendiente: Ajuste de {pendingDelta > 0 ? '+' : ''}{pendingDelta} uds en cola para aplicarse en el POS.
                </Text>
              </View>
            )}
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

          {/* Adjust Existence CTA */}
          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              { backgroundColor: colors.primaryFaded, borderColor: colors.primary },
              pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }
            ]}
            onPress={() => {
              setNewQty('');
              setAdjustmentNote('');
              setErrorMsg(null);
              setShowAddSheet(true);
            }}
          >
            <Feather name="sliders" size={16} color={colors.primary} />
            <Text style={[styles.addBtnText, { color: colors.primary }]}>
              Ajustar existencia
            </Text>
          </Pressable>

          {/* Adjust Price CTA */}
          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              { backgroundColor: colors.primaryFaded, borderColor: colors.primary, marginTop: 8 },
              pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }
            ]}
            onPress={() => {
              setNewPrice('');
              setAdjustmentNote('');
              setErrorMsg(null);
              setShowPriceSheet(true);
            }}
          >
            <Feather name="dollar-sign" size={16} color={colors.primary} />
            <Text style={[styles.addBtnText, { color: colors.primary }]}>
              Ajustar precio
            </Text>
          </Pressable>

          {/* Historial de movimientos */}
          <HistorialMovimientos 
            movimientos={movimientos} 
            isLoading={isLoadingMovs} 
            colors={colors} 
            onSelectVenta={setSelectedVentaId}
          />
        </ScrollView>

        {/* Modal de Detalle de Venta */}
        <VentaDetailModal 
          venta={selectedVenta ?? null} 
          onClose={() => setSelectedVentaId(null)} 
        />

        {/* Indicador de carga para VentaDetailModal */}
        <Modal 
          visible={!!selectedVentaId && isLoadingVenta} 
          transparent 
          animationType="fade"
          onRequestClose={() => setSelectedVentaId(null)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </Modal>

        {/* Add to order sheet (Stock Adjustment) */}
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
              <Text style={[styles.sheetSub, { color: colors.textMuted, marginBottom: 8 }]} numberOfLines={1}>
                {producto.descripcion}
              </Text>

              {/* Banner de writeback automático */}
              <View style={[styles.sheetBanner, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30', marginBottom: 12 }]}>
                <Feather name="zap" size={13} color={colors.primary} style={{ marginRight: 6, marginTop: 1 }} />
                <Text style={[styles.sheetBannerText, { color: colors.textMuted }]}>
                  Este stock se encolará y actualizará automáticamente en el POS Hybrid.
                </Text>
              </View>

              {/* Mode Selector */}
              <View style={[styles.modeSelector, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Pressable 
                  onPress={() => {
                    setAdjMode('fixed');
                    setNewQty('');
                  }}
                  style={({ pressed }) => [
                    styles.modeBtn, 
                    adjMode === 'fixed' && { backgroundColor: colors.primaryFaded, borderColor: colors.primary },
                    pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }
                  ]}
                >
                  <Text style={[styles.modeBtnText, { color: adjMode === 'fixed' ? colors.primary : colors.textMuted }]}>Nueva Total</Text>
                </Pressable>
                <Pressable 
                  onPress={() => {
                    setAdjMode('relative');
                    setNewQty('');
                  }}
                  style={({ pressed }) => [
                    styles.modeBtn, 
                    adjMode === 'relative' && { backgroundColor: colors.primaryFaded, borderColor: colors.primary },
                    pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }
                  ]}
                >
                  <Text style={[styles.modeBtnText, { color: adjMode === 'relative' ? colors.primary : colors.textMuted }]}>Sumar/Restar</Text>
                </Pressable>
              </View>

              {errorMsg && (
                <View style={{ backgroundColor: colors.danger + '22', padding: 8, borderRadius: 8, marginBottom: 8 }}>
                  <Text style={{ color: colors.danger, fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center' }}>
                    {errorMsg}
                  </Text>
                </View>
              )}

              <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>
                {adjMode === 'fixed' ? 'Actual: ' + producto.existencia + ' uds  ·  Nueva existencia:' : 'Ingresa la cantidad a ajustar:'}
              </Text>

              <View style={styles.inputContainer}>
                {adjMode === 'relative' && (
                  <Pressable 
                    onPress={() => setAdjOp(adjOp === '+' ? '-' : '+')}
                    style={({ pressed }) => [
                      styles.opBtn,
                      { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                      pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] }
                    ]}
                  >
                    <Text style={[styles.opText, { color: adjOp === '+' ? colors.success : colors.danger }]}>{adjOp}</Text>
                  </Pressable>
                )}
                
                <View style={[styles.qtyWrap, { flex: 1, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.qtyInput, { color: colors.text }]}
                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                    value={newQty}
                    onChangeText={v => setNewQty(v.replace(',', '.'))}
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

              <Text style={[styles.sheetLabel, { color: colors.textMuted, marginTop: 12 }]}>
                Nota / Observación (opcional):
              </Text>
              <TextInput
                style={[styles.noteInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                placeholder="Ej. Entrada de proveedor, producto roto..."
                placeholderTextColor={colors.textDim}
                value={adjustmentNote}
                onChangeText={setAdjustmentNote}
                maxLength={100}
                returnKeyType="done"
              />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                {/* Agregar al Borrador */}
                <Pressable
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 14,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: colors.primary,
                      backgroundColor: colors.surfaceAlt,
                    },
                    pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] }
                  ]}
                  onPress={() => {
                    const inputVal = parseFloat(newQty);
                    if (isNaN(inputVal)) {
                      setErrorMsg('Ingresa un número válido');
                      return;
                    }
                    let finalQty = inputVal;
                    if (adjMode === 'relative') {
                      finalQty = adjOp === '+' ? producto.existencia + inputVal : producto.existencia - inputVal;
                    }
                    if (finalQty < 0) {
                      setErrorMsg('La existencia no puede ser negativa');
                      return;
                    }
                    setErrorMsg(null);

                    useOrdenCambio.getState().addItem({
                      codigo_producto: producto.codigo_interno,
                      descripcion: producto.descripcion,
                      existencia_actual: producto.existencia,
                      nueva_existencia: finalQty,
                      precio_actual: producto.precio_venta,
                      nota: adjustmentNote.trim() || 'Ajuste de stock',
                      costo: producto.costo,
                    });

                    notify('Éxito', 'Agregado al borrador de Ajustes');
                    setAdjustmentNote('');
                    setNewQty('');
                    setShowAddSheet(false);
                  }}
                >
                  <Text style={{ fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold', color: colors.primary }}>
                    Al Borrador
                  </Text>
                </Pressable>

                {/* Aplicar Ahora (Quick Submit) */}
                <Pressable
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 14,
                      borderRadius: 14,
                      backgroundColor: colors.primary,
                    },
                    (isSaving || pressed) && { opacity: 0.75, transform: [{ scale: isSaving ? 1.0 : 0.97 }] }
                  ]}
                  disabled={isSaving}
                  onPress={async () => {
                    if (isSaving) return;

                    const inputVal = parseFloat(newQty);
                    if (isNaN(inputVal)) {
                      setErrorMsg('Ingresa un número válido');
                      return;
                    }

                    let finalQty = inputVal;
                    if (adjMode === 'relative') {
                      finalQty = adjOp === '+' ? producto.existencia + inputVal : producto.existencia - inputVal;
                    }

                    if (finalQty < 0) {
                      setErrorMsg('La existencia no puede ser negativa');
                      return;
                    }

                    setErrorMsg(null);
                    setIsSaving(true);

                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) throw new Error('Usuario no autenticado');

                      const noteText = adjustmentNote.trim() || 'Ajuste rápido';

                      const { data: orden, error: ordenError } = await supabase
                        .from('ordenes_cambio')
                        .insert({ creado_por: user.id, nota: noteText, status: 'borrador' })
                        .select('id')
                        .single();

                      if (ordenError || !orden) throw ordenError ?? new Error('Error al crear orden');

                      const { error: itemError } = await supabase
                        .from('ordenes_cambio_items')
                        .insert({
                          orden_id: orden.id,
                          codigo_producto: producto.codigo_interno,
                          descripcion: producto.descripcion,
                          existencia_actual: producto.existencia,
                          nueva_existencia: finalQty,
                          precio_actual: producto.precio_venta,
                          costo: producto.costo,
                          nota: noteText,
                        });

                      if (itemError) throw itemError;

                      const { data: profileData } = await supabase
                        .from('profiles')
                        .select('display_name')
                        .eq('id', user.id)
                        .single();
                      const creadoPor = profileData?.display_name || undefined;

                      const draftItem: DraftItem = {
                        codigo_producto: producto.codigo_interno,
                        descripcion: producto.descripcion,
                        existencia_actual: producto.existencia,
                        nueva_existencia: finalQty,
                        nota: noteText,
                      };
                      const html = buildPdfHtml([draftItem], noteText, orden.id, creadoPor);

                      if (Platform.OS === 'web') {
                        await printHtml(html);
                        await supabase.from('ordenes_cambio').update({ status: 'emitido' }).eq('id', orden.id);
                      } else {
                        const { uri } = await Print.printToFileAsync({ html });
                        const fileName = `orden-${orden.id}-${Date.now()}.pdf`;
                        try {
                          const pdfUrl = await uploadPdfAndGetUrl(uri, fileName);
                          await supabase.from('ordenes_cambio').update({ status: 'emitido', pdf_url: pdfUrl }).eq('id', orden.id);
                        } catch (err) {
                          console.error(err);
                          await supabase.from('ordenes_cambio').update({ status: 'emitido' }).eq('id', orden.id);
                        }
                        const canShare = await Sharing.isAvailableAsync();
                        if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
                      }

                      await supabase.from('comandos_remotos').insert([{ comando: 'sync_inventory', status: 'pendiente' }]);

                      notify('Éxito', 'Ajuste guardado. Sincronizando stock...');
                      queryClient.invalidateQueries({ queryKey: ['producto', id] });
                      queryClient.invalidateQueries({ queryKey: ['movimientos-producto', id] });
                      queryClient.invalidateQueries({ queryKey: ['sync-status'] });

                      setAdjustmentNote('');
                      setNewQty('');
                      setShowAddSheet(false);
                    } catch (e: any) {
                      console.error(e);
                      setErrorMsg(e.message ?? 'Error al guardar el ajuste');
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                >
                  {isSaving ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text style={{ fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold', color: colors.onPrimary }}>
                      Aplicar y Encolar
                    </Text>
                  )}
                </Pressable>
              </View>
              </ScrollView>
            </Animated.View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Add to order sheet (Price/Cost Adjustment) */}
        <Modal
          visible={showPriceSheet}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPriceSheet(false)}
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
              onPress={() => setShowPriceSheet(false)}
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

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontSize: scaleFont(20), fontFamily: 'JetBrainsMono_700Bold', color: colors.text }}>
                  Ajustar precio y costo
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    {
                      padding: 8,
                      borderRadius: 10,
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 0.5,
                      borderColor: colors.border
                    },
                    pressed && { opacity: 0.7, transform: [{ scale: 0.94 }] }
                  ]}
                  onPress={() => {
                    setNewPrice('');
                    setNewCost('');
                    setAdjustmentNote('');
                    setErrorMsg(null);
                    notify('Restablecido', 'Valores devueltos al original');
                  }}
                >
                  <Feather name="refresh-cw" size={14} color={colors.primary} />
                </Pressable>
              </View>

              <Text style={{ fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium', color: colors.textMuted, marginBottom: 8 }} numberOfLines={1}>
                {producto.descripcion}
              </Text>

              {/* Banner de writeback automático */}
              <View style={[styles.sheetBanner, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30', marginBottom: 12 }]}>
                <Feather name="zap" size={13} color={colors.primary} style={{ marginRight: 6, marginTop: 1 }} />
                <Text style={[styles.sheetBannerText, { color: colors.textMuted }]}>
                  Los precios y costos se encolarán y actualizarán automáticamente.
                </Text>
              </View>

              {errorMsg && (
                <View style={{ backgroundColor: colors.danger + '22', padding: 8, borderRadius: 8, marginVertical: 8 }}>
                  <Text style={{ color: colors.danger, fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center' }}>
                    {errorMsg}
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                {/* Price Input Column */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', color: colors.textMuted, marginBottom: 6 }}>
                    Nuevo precio ($ con IVA)
                  </Text>
                  <View style={[styles.qtyWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, height: 48 }]}>
                    <TextInput
                      style={[styles.qtyInput, { color: colors.text, fontSize: scaleFont(15) }]}
                      keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                      value={newPrice}
                      onChangeText={v => setNewPrice(v.replace(',', '.'))}
                      placeholder={producto.precio_venta !== undefined && producto.precio_venta !== null ? producto.precio_venta.toFixed(2) : '0.00'}
                      placeholderTextColor={colors.textDim}
                      selectTextOnFocus
                    />
                  </View>
                </View>

                {/* Cost Input Column */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', color: colors.textMuted, marginBottom: 6 }}>
                    Nuevo costo ($)
                  </Text>
                  <View style={[styles.qtyWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, height: 48 }]}>
                    <TextInput
                      style={[styles.qtyInput, { color: colors.text, fontSize: scaleFont(15) }]}
                      keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                      value={newCost}
                      onChangeText={v => setNewCost(v.replace(',', '.'))}
                      placeholder={producto.costo !== undefined && producto.costo !== null ? producto.costo.toFixed(2) : '0.00'}
                      placeholderTextColor={colors.textDim}
                      selectTextOnFocus
                    />
                  </View>
                </View>
              </View>

              {/* Margin preview calculation */}
              {(() => {
                const parsedPrice = parseFloat(newPrice);
                const priceToUse = isNaN(parsedPrice) ? producto.precio_venta : parsedPrice;
                
                const parsedCost = parseFloat(newCost);
                const costToUse = isNaN(parsedCost) ? producto.costo : parsedCost;

                const precioSinIva = priceToUse / 1.16;
                const pct = precioSinIva > 0 ? ((precioSinIva - costToUse) / precioSinIva) * 100 : 0;
                const isNeg = pct < 0;
                const barColor = isNeg ? colors.danger : pct < 20 ? colors.warning : colors.success;

                return (
                  <View style={[styles.previewContainer, { marginTop: 12, paddingVertical: 10 }]}>
                    <Text style={{ fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium', color: colors.textMuted }}>Margen estimado: </Text>
                    <Text style={{ fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold', color: barColor }}>
                      {isNeg ? '-' : ''}{Math.abs(pct).toFixed(1)}%
                    </Text>
                  </View>
                );
              })()}

              <Text style={{ fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', color: colors.textMuted, marginTop: 12, marginBottom: 6 }}>
                Nota / Observación (opcional):
              </Text>
              <TextInput
                style={[styles.noteInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt, fontSize: scaleFont(13), paddingVertical: 10 }]}
                placeholder="Ej. Cambio de tarifa, actualización..."
                placeholderTextColor={colors.textDim}
                value={adjustmentNote}
                onChangeText={setAdjustmentNote}
                maxLength={100}
                returnKeyType="done"
              />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                {/* Agregar al Borrador */}
                <Pressable
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 14,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: colors.primary,
                      backgroundColor: colors.surfaceAlt,
                    },
                    pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] }
                  ]}
                  onPress={() => {
                    const finalPrice = newPrice === '' ? producto.precio_venta : parseFloat(newPrice);
                    const finalCost = newCost === '' ? producto.costo : parseFloat(newCost);

                    if (isNaN(finalPrice) || finalPrice < 0) {
                      setErrorMsg('Ingresa un precio válido');
                      return;
                    }
                    if (isNaN(finalCost) || finalCost < 0) {
                      setErrorMsg('Ingresa un costo válido');
                      return;
                    }
                    setErrorMsg(null);

                    useOrdenCambio.getState().addItem({
                      codigo_producto: producto.codigo_interno,
                      descripcion: producto.descripcion,
                      existencia_actual: producto.existencia,
                      nueva_existencia: producto.existencia, // default: keep same
                      precio_actual: producto.precio_venta,
                      nuevo_precio: finalPrice,
                      costo: finalCost,
                      nota: adjustmentNote.trim() || 'Ajuste de precio/costo',
                    });

                    notify('Éxito', 'Agregado al borrador de Ajustes');
                    setAdjustmentNote('');
                    setNewPrice('');
                    setNewCost('');
                    setShowPriceSheet(false);
                  }}
                >
                  <Text style={{ fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold', color: colors.primary }}>
                    Al Borrador
                  </Text>
                </Pressable>

                {/* Aplicar Ahora (Quick Submit) */}
                <Pressable
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 14,
                      borderRadius: 14,
                      backgroundColor: colors.primary,
                    },
                    (isSavingPrice || pressed) && { opacity: 0.75, transform: [{ scale: isSavingPrice ? 1.0 : 0.97 }] }
                  ]}
                  disabled={isSavingPrice}
                  onPress={async () => {
                    if (isSavingPrice) return;

                    const finalPrice = newPrice === '' ? producto.precio_venta : parseFloat(newPrice);
                    const finalCost = newCost === '' ? producto.costo : parseFloat(newCost);

                    if (isNaN(finalPrice) || finalPrice < 0) {
                      setErrorMsg('Ingresa un precio válido');
                      return;
                    }
                    if (isNaN(finalCost) || finalCost < 0) {
                      setErrorMsg('Ingresa un costo válido');
                      return;
                    }

                    setErrorMsg(null);
                    setIsSavingPrice(true);

                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) throw new Error('Usuario no autenticado');

                      const noteText = adjustmentNote.trim() || 'Ajuste precio/costo rápido';

                      const { data: orden, error: ordenError } = await supabase
                        .from('ordenes_cambio')
                        .insert({ creado_por: user.id, nota: noteText, status: 'borrador' })
                        .select('id')
                        .single();

                      if (ordenError || !orden) throw ordenError ?? new Error('Error al crear orden');

                      const { error: itemError } = await supabase
                        .from('ordenes_cambio_items')
                        .insert({
                          orden_id: orden.id,
                          codigo_producto: producto.codigo_interno,
                          descripcion: producto.descripcion,
                          existencia_actual: producto.existencia,
                          nueva_existencia: producto.existencia, // Keep same
                          precio_actual: producto.precio_venta,
                          nuevo_precio: finalPrice,
                          costo: finalCost,
                          nota: noteText,
                        });

                      if (itemError) throw itemError;

                      const { data: profileData } = await supabase
                        .from('profiles')
                        .select('display_name')
                        .eq('id', user.id)
                        .single();
                      const creadoPor = profileData?.display_name || undefined;

                      const draftItem: DraftItem = {
                        codigo_producto: producto.codigo_interno,
                        descripcion: producto.descripcion,
                        existencia_actual: producto.existencia,
                        nueva_existencia: producto.existencia,
                        precio_actual: producto.precio_venta,
                        nuevo_precio: finalPrice,
                        costo: finalCost,
                        nota: noteText,
                      };
                      const html = buildPdfHtml([draftItem], noteText, orden.id, creadoPor);

                      if (Platform.OS === 'web') {
                        await printHtml(html);
                        await supabase.from('ordenes_cambio').update({ status: 'emitido' }).eq('id', orden.id);
                      } else {
                        const { uri } = await Print.printToFileAsync({ html });
                        const fileName = `orden-${orden.id}-${Date.now()}.pdf`;
                        try {
                          const pdfUrl = await uploadPdfAndGetUrl(uri, fileName);
                          await supabase.from('ordenes_cambio').update({ status: 'emitido', pdf_url: pdfUrl }).eq('id', orden.id);
                        } catch (err) {
                          console.error(err);
                          await supabase.from('ordenes_cambio').update({ status: 'emitido' }).eq('id', orden.id);
                        }
                        const canShare = await Sharing.isAvailableAsync();
                        if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
                      }

                      await supabase.from('comandos_remotos').insert([{ comando: 'sync_inventory', status: 'pendiente' }]);

                      notify('Éxito', 'Ajuste de precio/costo guardado.');
                      queryClient.invalidateQueries({ queryKey: ['producto', id] });
                      queryClient.invalidateQueries({ queryKey: ['movimientos-producto', id] });
                      queryClient.invalidateQueries({ queryKey: ['sync-status'] });

                      setAdjustmentNote('');
                      setNewPrice('');
                      setNewCost('');
                      setShowPriceSheet(false);
                    } catch (e: any) {
                      console.error(e);
                      setErrorMsg(e.message ?? 'Error al guardar el ajuste de precio/costo');
                    } finally {
                      setIsSavingPrice(false);
                    }
                  }}
                >
                  {isSavingPrice ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text style={{ fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold', color: colors.onPrimary }}>
                      Aplicar y Encolar
                    </Text>
                  )}
                </Pressable>
              </View>
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

interface HistorialMovimientosProps {
  movimientos?:   MovimientoProducto[];
  isLoading:      boolean;
  colors:         any;
  onSelectVenta:  (ventaId: number) => void;
}

function HistorialMovimientos({
  movimientos,
  isLoading,
  colors,
  onSelectVenta,
}: HistorialMovimientosProps): React.JSX.Element {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 10, paddingBottom: 6 }]}>
      <Text style={[styles.sectionLabel, { color: colors.textMuted, marginBottom: 12 }]}>
        Historial de movimientos
      </Text>

      {isLoading ? (
        <View style={styles.movCenter}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : !movimientos || movimientos.length === 0 ? (
        <View style={styles.movCenter}>
          <Text style={[styles.emptyText, { color: colors.textDim }]}>
            Sin movimientos registrados
          </Text>
        </View>
      ) : (
        <View style={styles.movementsList}>
          {movimientos.map((mov, index) => {
            const isVenta = mov.tipo === 'venta';
            const isIngreso = mov.tipo === 'ingreso';
            
            let iconName: any = 'sliders';
            let iconColor = colors.textMuted; 
            let badgeBg = iconColor + '12';
            let qtyColor = colors.text;
            let labelText = '';

            if (isVenta) {
              iconName = 'arrow-down-right';
              iconColor = colors.danger;
              badgeBg = iconColor + '12';
              qtyColor = colors.danger;
              labelText = `${mov.cantidad}`;
            } else if (isIngreso) {
              iconName = 'plus';
              iconColor = colors.success;
              badgeBg = iconColor + '12';
              qtyColor = colors.success;
              labelText = `+${mov.cantidad}`;
            } else {
              iconName = 'sliders';
              iconColor = mov.cantidad > 0 ? colors.success : colors.danger;
              badgeBg = iconColor + '12';
              qtyColor = iconColor;
              labelText = mov.cantidad > 0 ? `+${mov.cantidad}` : `${mov.cantidad}`;
            }

            const rowContent = (
              <>
                <View style={[styles.movIconContainer, { backgroundColor: badgeBg }]}>
                  <Feather name={iconName} size={14} color={iconColor} />
                </View>

                <View style={styles.movInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.movText, { color: colors.text, flexShrink: 1, flexGrow: 0, flexBasis: 'auto', marginRight: 0 }]} numberOfLines={1}>
                      {mov.referencia}
                    </Text>
                    {mov.backend_status && mov.backend_status !== 'completado' && (
                      <View style={[
                        styles.miniStatusBadge,
                        { 
                          backgroundColor: mov.backend_status === 'error' ? colors.danger + '18' : colors.warning + '18',
                          borderColor: mov.backend_status === 'error' ? colors.danger + '40' : colors.warning + '40'
                        }
                      ]}>
                        <Text style={[
                          styles.miniStatusBadgeText, 
                          { color: mov.backend_status === 'error' ? colors.danger : colors.warning }
                        ]}>
                          {mov.backend_status === 'error' ? 'Error' : mov.backend_status === 'aplicando' ? 'Aplicando' : 'En cola'}
                        </Text>
                      </View>
                    )}
                  </View>
                  {mov.nota ? (
                    <Text style={[styles.movNota, { color: colors.textMuted }]} numberOfLines={1}>
                      {mov.nota}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.movRightCol}>
                  <Text style={[styles.movQtyText, { color: qtyColor }]}>
                    {labelText}
                  </Text>
                  <Text style={[styles.movDateText, { color: colors.textDim }]}>
                    {mov.fechaFormateada}
                  </Text>
                </View>
              </>
            );

            if (isVenta) {
              return (
                <Pressable
                  key={mov.id}
                  onPress={() => {
                    if (mov.ventaId) onSelectVenta(mov.ventaId);
                  }}
                  style={({ pressed }) => [
                    styles.movRow,
                    pressed && { opacity: 0.6, backgroundColor: colors.border + '18' },
                    index < movimientos.length - 1 && { borderBottomWidth: 0.5, borderColor: colors.border }
                  ]}
                >
                  {rowContent}
                </Pressable>
              );
            }

            return (
              <View 
                key={mov.id} 
                style={[
                  styles.movRow, 
                  index < movimientos.length - 1 && { borderBottomWidth: 0.5, borderColor: colors.border }
                ]}
              >
                {rowContent}
              </View>
            );
          })}
        </View>
      )}
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
  navTitle:       { flex: 1, fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center' },
  navPlaceholder: { width: 30 },

  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            12,
  },
  errorText: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_400Regular' },

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
    fontSize:     scaleFont(20),
    fontFamily:   'JetBrainsMono_700Bold',
    lineHeight:   scaleFont(27),
    marginBottom: 10,
  },
  codeRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingVertical: 6,
  },
  label: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular' },
  code:  { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  value: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium' },

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
  statLabel: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },
  statValue: { fontSize: scaleFont(22), fontFamily: 'JetBrainsMono_700Bold' },

  sectionLabel: { fontSize: scaleFont(12), marginBottom: 10, fontFamily: 'JetBrainsMono_400Regular' },

  marginHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   8,
  },
  marginPct: { fontSize: scaleFont(18), fontFamily: 'JetBrainsMono_700Bold' },
  barBg:     { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill:   { height: 6, borderRadius: 3 },

  stockRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
  },
  stockQty:       { fontSize: scaleFont(36), fontFamily: 'JetBrainsMono_700Bold' },
  stockBadge:     { borderRadius: 999, borderWidth: 0.5, paddingVertical: 4, paddingHorizontal: 12 },
  stockBadgeText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium' },

  syncNote: { fontSize: scaleFont(11), textAlign: 'center', marginTop: 4, fontFamily: 'JetBrainsMono_400Regular' },

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
  addBtnText: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },

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
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
      },
      android: {
        elevation: 24,
      },
      web: {
        boxShadow: '0px -10px 20px rgba(0,0,0,0.3)',
      } as any,
    }),
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
  sheetTitle:   { fontSize: scaleFont(18), fontFamily: 'JetBrainsMono_700Bold' },
  sheetSub:     { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular' },
  sheetLabel:   { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular' },
  qtyWrap: {
    borderRadius: 12,
    borderWidth:  0.5,
    paddingHorizontal: 16,
    height:       56,
    justifyContent: 'center',
  },
  qtyInput: { fontSize: scaleFont(28), fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center' },
  sheetBtn: {
    height:         52,
    borderRadius:   12,
    alignItems:     'center',
    justifyContent: 'center',
    marginTop:      12,
  },
  sheetBtnText: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },

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
    fontSize: scaleFont(13),
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
    fontSize: scaleFont(28),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  previewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  previewLabel: {
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  previewValue: {
    fontSize: scaleFont(16),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  movCenter: {
    paddingVertical: 20,
    alignItems:      'center',
    justifyContent:  'center',
  },
  emptyText: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  movementsList: {
    gap: 0,
  },
  movRow: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingVertical: 10,
  },
  movIconContainer: {
    width:          32,
    height:         32,
    borderRadius:   16,
    alignItems:     'center',
    justifyContent: 'center',
    marginRight:    12,
  },
  movInfo: {
    flex: 1,
  },
  movText: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_500Medium',
    flex: 1,
    marginRight: 8,
  },
  movNota: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop:  2,
  },
  movRightCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 8,
  },
  movQtyText: {
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: scaleFont(14),
    textAlign: 'right',
  },
  movDateText: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: scaleFont(10),
    marginTop: 2,
    textAlign: 'right',
  },
  noteInput: {
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop: 6,
  },
  stockPendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: 0.5,
    padding: 10,
  },
  stockPendingText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_500Medium',
    flex: 1,
    lineHeight: scaleFont(15),
  },
  sheetBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: 0.5,
    padding: 10,
  },
  sheetBannerText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    flex: 1,
    lineHeight: scaleFont(15),
  },
  miniStatusBadge: {
    borderRadius: 4,
    borderWidth: 0.5,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStatusBadgeText: {
    fontSize: scaleFont(9),
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
