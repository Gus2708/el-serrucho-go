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

export default function ProductoDetail() {
  const { colors, tokens, formatUSD } = useTheme();
  const router  = useRouter();
  const { id }  = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [adjustmentNote, setAdjustmentNote] = useState('');

  const { data: movimientos, isLoading: isLoadingMovs } = useMovimientosProducto(id);

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
    }).start(() => setShowAddSheet(false));
  };

  // Reset animation when sheet opens
  useEffect(() => {
    if (showAddSheet) {
      Animated.spring(panY, {
        toValue: 0,
        useNativeDriver: Platform.OS !== 'web',
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
              pressed && { opacity: 0.75 }
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

              {errorMsg && (
                <View style={{ backgroundColor: colors.danger + '22', padding: 8, borderRadius: 8, marginBottom: 8 }}>
                  <Text style={{ color: colors.danger, fontSize: 12, fontFamily: 'JetBrainsMono_700Bold', textAlign: 'center' }}>
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

              <Pressable
                style={({ pressed }) => [styles.sheetBtn, { backgroundColor: colors.primary }, (isSaving || pressed) && { opacity: 0.75 }]}
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
                    // 1. Get authenticated user ID
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) {
                      throw new Error('Usuario no autenticado');
                    }

                    const noteText = adjustmentNote.trim() || 'Ajuste rápido';

                    // 2. Create the change order header (initially draft/borrador)
                    const { data: orden, error: ordenError } = await supabase
                      .from('ordenes_cambio')
                      .insert({
                        creado_por: user.id,
                        nota: noteText,
                        status: 'borrador',
                      })
                      .select('id')
                      .single();

                    if (ordenError || !orden) {
                      throw ordenError ?? new Error('No se pudo crear la orden de cambio');
                    }

                    // 3. Create the change order item
                    const { error: itemError } = await supabase
                      .from('ordenes_cambio_items')
                      .insert({
                        orden_id: orden.id,
                        codigo_producto: producto.codigo_interno,
                        descripcion: producto.descripcion,
                        existencia_actual: producto.existencia,
                        nueva_existencia: finalQty,
                        nota: noteText,
                      });

                    if (itemError) {
                      throw itemError;
                    }

                    // 4. Retrieve creator's display name
                    const { data: profileData } = await supabase
                      .from('profiles')
                      .select('display_name')
                      .eq('id', user.id)
                      .single();
                    const creadoPor = profileData?.display_name || undefined;

                    // 5. Generate HTML
                    const draftItem: DraftItem = {
                      codigo_producto: producto.codigo_interno,
                      descripcion: producto.descripcion,
                      existencia_actual: producto.existencia,
                      nueva_existencia: finalQty,
                      nota: noteText,
                    };
                    const html = buildPdfHtml([draftItem], noteText, orden.id, creadoPor);

                    // 6. Handle print/share depending on platform
                    if (Platform.OS === 'web') {
                      // Trigger clean isolated print
                      await printHtml(html);

                      // Update order status to emitted
                      await supabase
                        .from('ordenes_cambio')
                        .update({ status: 'emitido' })
                        .eq('id', orden.id);
                    } else {
                      // Native: Print to file and upload to Supabase storage
                      const { uri } = await Print.printToFileAsync({ html });
                      const fileName = `orden-${orden.id}-${Date.now()}.pdf`;
                      const fileData = await fetch(uri).then(r => r.blob());

                      const { error: uploadError } = await supabase.storage
                        .from('change-orders')
                        .upload(fileName, fileData, { contentType: 'application/pdf' });

                      if (!uploadError) {
                        const { data: signedData } = await supabase.storage
                          .from('change-orders')
                          .createSignedUrl(fileName, 60 * 60 * 24 * 365);

                        await supabase
                          .from('ordenes_cambio')
                          .update({ status: 'emitido', pdf_url: signedData?.signedUrl ?? null })
                          .eq('id', orden.id);
                      } else {
                        // Fallback: update status even if upload failed
                        await supabase
                          .from('ordenes_cambio')
                          .update({ status: 'emitido' })
                          .eq('id', orden.id);
                      }

                      // Open Native Share sheet
                      const canShare = await Sharing.isAvailableAsync();
                      if (canShare) {
                        await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
                      }
                    }

                    // 7. Enqueue a remote sync command to tell POS to update the stock
                    await supabase
                      .from('comandos_remotos')
                      .insert([{
                        comando: 'sync_inventory',
                        status: 'pendiente',
                      }]);

                    notify('Éxito', 'Ajuste guardado. Sincronizando stock...');
                    
                    // 8. Invalidate queries to reload details, history & sync badge
                    queryClient.invalidateQueries({ queryKey: ['producto', id] });
                    queryClient.invalidateQueries({ queryKey: ['movimientos-producto', id] });
                    queryClient.invalidateQueries({ queryKey: ['sync-status'] });

                    // 9. Reset and close modal
                    setAdjustmentNote('');
                    setNewQty('');
                    closeSheet();
                  } catch (e: any) {
                    console.error('Error al emitir ajuste:', e);
                    setErrorMsg(e.message ?? 'Error inesperado al guardar el ajuste');
                  } finally {
                    setIsSaving(false);
                  }
                }}
              >
                {isSaving ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={[styles.sheetBtnText, { color: colors.onPrimary }]}>
                    Confirmar
                  </Text>
                )}
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
                  <Text style={[styles.movText, { color: colors.text }]} numberOfLines={1}>
                    {mov.referencia}
                  </Text>
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
  movCenter: {
    paddingVertical: 20,
    alignItems:      'center',
    justifyContent:  'center',
  },
  emptyText: {
    fontSize:   13,
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
    fontSize:   13,
    fontFamily: 'JetBrainsMono_500Medium',
    flex: 1,
    marginRight: 8,
  },
  movNota: {
    fontSize:   11,
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
    fontSize: 14,
    textAlign: 'right',
  },
  movDateText: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 10,
    marginTop: 2,
    textAlign: 'right',
  },
  noteInput: {
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop: 6,
  },
});
