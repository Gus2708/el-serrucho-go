import { scaleFont } from '../theme/responsive';
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useDeviceSize } from '../hooks/useDeviceSize';
import { usePresupuestoWithDetails } from '../hooks/usePresupuestosHistory';
import { useActualizarPresupuesto } from '../hooks/useActualizarPresupuesto';
import { useProductos, isPlaceholder } from '../hooks/useProductos';
import { supabase, Producto } from '../lib/supabase';
import { notify } from '../lib/notify';
import { MarginWarningBadge } from './MarginWarningBadge';
import { PressableScale } from './PressableScale';
import { pressScale } from '../theme/motion';

import { usePresupuestoConfig } from '../hooks/usePresupuestoConfig';
import { useTazas } from '../hooks/useTazas';

/** Editable budget line held in local modal state. */
type EditItem = {
  rowId?: number;            // existing presupuestos_detalle.id (absent for new lines)
  codigo_producto: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  costo: number;             // for margin warning
  precioVentaOriginal: number; // current product price — reference for +40%
};

export interface PresupuestoEditModalProps {
  presupuestoId: number | null;
  onClose: () => void;
}

/** The header's joined `clientes` may arrive as an object or a single-element array. */
function getClienteNombre(header: any): string | undefined {
  if (!header?.clientes) return undefined;
  const cliente = Array.isArray(header.clientes) ? header.clientes[0] : header.clientes;
  return cliente?.nombre;
}

export function PresupuestoEditModal({ presupuestoId, onClose }: PresupuestoEditModalProps): React.JSX.Element {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useDeviceSize();

  const { data, isLoading } = usePresupuestoWithDetails(presupuestoId);
  const { mutateAsync, isPending } = useActualizarPresupuesto();

  const { data: config } = usePresupuestoConfig();
  const { data: tasa } = useTazas();
  const markup_porcentaje = config?.markup_porcentaje ?? 30;
  const bcv = tasa?.bcv_usd ?? 0;

  const [items, setItems] = useState<EditItem[]>([]);
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [nota, setNota] = useState('');
  const [priceWarnings, setPriceWarnings] = useState<Record<string, string | null>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [enBs, setEnBs] = useState(false);
  const [tasaCambio, setTasaCambio] = useState<number | null>(null);
  const [porcentajeRecargo, setPorcentajeRecargo] = useState<number | null>(null);
  const initedForId = useRef<number | null>(null);

  useEffect(() => {
    if (!data || !presupuestoId) return;
    if (data.header.id !== presupuestoId) return;
    if (initedForId.current === presupuestoId) return;

    let cancelled = false;
    (async () => {
      const detail = data.detail ?? [];
      const codigos = [...new Set(detail.map((d) => d.codigo_producto))];

      let prodMap: Record<string, { costo: number; precio_venta: number }> = {};
      if (codigos.length > 0) {
        const { data: prods } = await supabase
          .from('productos')
          .select('codigo_interno, costo, precio_venta')
          .in('codigo_interno', codigos);
        if (prods) {
          prodMap = Object.fromEntries(
            prods.map((p: any) => [
              p.codigo_interno,
              { costo: Number(p.costo) || 0, precio_venta: Number(p.precio_venta) || 0 },
            ]),
          );
        }
      }
      if (cancelled) return;

      const savedEnBs = !!data.header.en_bs;
      const savedRecargo = Number(data.header.porcentaje_recargo || 30);

      const mapped: EditItem[] = detail.map((d) => {
        const precio = Number(d.precio_unitario) || 0;
        const basePrecio = savedEnBs 
          ? Number((precio / (1 + savedRecargo / 100)).toFixed(2))
          : precio;
        return {
          rowId: d.id,
          codigo_producto: d.codigo_producto,
          descripcion: d.descripcion,
          cantidad: Number(d.cantidad) || 0,
          precio_unitario: basePrecio,
          costo: prodMap[d.codigo_producto]?.costo ?? 0,
          precioVentaOriginal: prodMap[d.codigo_producto]?.precio_venta ?? basePrecio,
        };
      });

      setItems(mapped);
      setNota(data.header.nota ?? '');
      setRemovedIds([]);
      setPriceWarnings({});
      setEnBs(savedEnBs);
      setTasaCambio(data.header.tasa_cambio ? Number(data.header.tasa_cambio) : null);
      setPorcentajeRecargo(data.header.porcentaje_recargo ? Number(data.header.porcentaje_recargo) : null);
      initedForId.current = presupuestoId;
    })();

    return () => {
      cancelled = true;
    };
  }, [data, presupuestoId]);

  function handleClose(): void {
    initedForId.current = null;
    setItems([]);
    setRemovedIds([]);
    setPriceWarnings({});
    setAddOpen(false);
    setEnBs(false);
    setTasaCambio(null);
    setPorcentajeRecargo(null);
    setPriceInputs({});
    onClose();
  }

  // ── Item mutations ──────────────────────────────────────────────────────────
  function setQuantity(codigo: string, cantidad: number): void {
    if (cantidad <= 0) return;
    setItems((prev) =>
      prev.map((it) => (it.codigo_producto === codigo ? { ...it, cantidad } : it)),
    );
  }

  function setPrice(codigo: string, precio: number): void {
    setItems((prev) =>
      prev.map((it) => (it.codigo_producto === codigo ? { ...it, precio_unitario: precio } : it)),
    );
    const item = items.find((it) => it.codigo_producto === codigo);
    const costo = item?.costo ?? 0;
    setPriceWarnings((prev) => ({
      ...prev,
      [codigo]: item && costo > 0 && precio < costo ? `Precio por debajo del costo ($${costo.toFixed(2)})` : null,
    }));
  }

  function toggleMarkup(item: EditItem): void {
    const isApplied = item.precio_unitario !== item.precioVentaOriginal;
    const newPrice = isApplied
      ? item.precioVentaOriginal
      : parseFloat((item.precioVentaOriginal * (1 + markup_porcentaje / 100)).toFixed(2));
    setPrice(item.codigo_producto, newPrice);
    setPriceInputs(prev => ({ ...prev, [item.codigo_producto]: String(newPrice) }));
  }

  function removeLine(codigo: string): void {
    setItems((prev) => {
      const target = prev.find((it) => it.codigo_producto === codigo);
      if (target?.rowId != null) {
        setRemovedIds((ids) => [...ids, target.rowId as number]);
      }
      return prev.filter((it) => it.codigo_producto !== codigo);
    });
    setPriceWarnings((prev) => {
      const next = { ...prev };
      delete next[codigo];
      return next;
    });
  }

  function addProducto(producto: Producto): void {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.codigo_producto === producto.codigo_interno);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], cantidad: next[idx].cantidad + 1 };
        return next;
      }
      return [
        ...prev,
        {
          codigo_producto: producto.codigo_interno,
          descripcion: producto.descripcion,
          cantidad: 1,
          precio_unitario: producto.precio_venta,
          costo: producto.costo,
          precioVentaOriginal: producto.precio_venta,
        },
      ];
    });
  }

  function decrementProducto(codigo: string): void {
    setItems((prev) => {
      const target = prev.find((it) => it.codigo_producto === codigo);
      if (!target) return prev;
      if (target.cantidad <= 1) {
        if (target.rowId != null) setRemovedIds((ids) => [...ids, target.rowId as number]);
        return prev.filter((it) => it.codigo_producto !== codigo);
      }
      return prev.map((it) =>
        it.codigo_producto === codigo ? { ...it, cantidad: it.cantidad - 1 } : it,
      );
    });
  }

  /** Al cambiar a Bs: aplica markup a todos los items de golpe.
   *  Al volver a USD: revierte cada item a su precio_venta original. */
  function handleToggleBs(toBs: boolean): void {
    if (toBs) {
      items.forEach(item => {
        const isAlreadyMarked = item.precio_unitario !== item.precioVentaOriginal;
        if (!isAlreadyMarked) {
          const newPrice = parseFloat((item.precioVentaOriginal * (1 + markup_porcentaje / 100)).toFixed(2));
          setPrice(item.codigo_producto, newPrice);
          setPriceInputs(prev => ({ ...prev, [item.codigo_producto]: String(newPrice) }));
        }
      });
      setEnBs(true);
      setTasaCambio(bcv);
      setPorcentajeRecargo(markup_porcentaje);
    } else {
      items.forEach(item => {
        setPrice(item.codigo_producto, item.precioVentaOriginal);
        setPriceInputs(prev => ({ ...prev, [item.codigo_producto]: String(item.precioVentaOriginal) }));
      });
      setEnBs(false);
      setTasaCambio(null);
      setPorcentajeRecargo(null);
    }
    setPriceWarnings({});
  }

  const total = items.reduce((acc, it) => acc + it.cantidad * it.precio_unitario, 0);
  const clienteNombre = getClienteNombre(data?.header);

  async function handleSave(): Promise<void> {
    if (!presupuestoId) return;
    if (items.length === 0) {
      notify('Presupuesto vacío', 'Agrega al menos un producto antes de guardar.');
      return;
    }
    try {
      // Markup is now applied directly to precio_unitario when Bs mode is toggled.
      const getFinalPrice = (it: EditItem) => it.precio_unitario;

      await mutateAsync({
        presupuestoId,
        items: items.map((it) => ({
          rowId: it.rowId,
          codigo_producto: it.codigo_producto,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          precio_unitario: getFinalPrice(it),
        })),
        removedIds,
        nota,
        enBs,
        tasaCambio,
        porcentajeRecargo,
      });
      notify('Guardado', 'El presupuesto se actualizó correctamente.');
      handleClose();
    } catch (e: any) {
      notify('Error', e?.message ?? 'No se pudo actualizar el presupuesto.');
    }
  }

  const qtyByCodigo: Record<string, number> = {};
  for (const it of items) qtyByCodigo[it.codigo_producto] = it.cantidad;

  return (
    <Modal
      visible={presupuestoId !== null}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      onRequestClose={handleClose}
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={handleClose} style={styles.btnBack} hitSlop={8}>
            <Feather name="chevron-down" size={28} color={colors.text} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              Editar {presupuestoId ? `P-${String(presupuestoId).padStart(4, '0')}` : ''}
            </Text>
            {clienteNombre ? (
              <Text style={[styles.headerSub, { color: colors.textMuted }]} numberOfLines={1}>
                {clienteNombre}
              </Text>
            ) : null}
          </View>
          <View style={{ width: 40 }} />
        </View>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {/* Add products CTA */}
              <PressableScale
                style={[
                  styles.addBtn,
                  { borderColor: colors.primary, backgroundColor: colors.primaryFaded },
                ]}
                activeScale={pressScale.row}
                onPress={() => setAddOpen(true)}
                hitSlop={8}
              >
                <Feather name="plus" size={16} color={colors.primary} />
                <Text style={[styles.addBtnText, { color: colors.primary }]}>Agregar productos</Text>
              </PressableScale>

              {items.length > 0 && (
                <View style={[styles.currencyToggleContainer, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
                  <Text style={[styles.currencyLabel, { color: colors.textMuted }]}>
                    MONEDA
                  </Text>
                  <View style={[styles.segmentedControl, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <PressableScale
                      style={[
                        styles.segmentedBtn,
                        !enBs && { backgroundColor: colors.primary },
                      ]}
                      onPress={() => {
                        if (enBs) handleToggleBs(false);
                      }}
                    >
                      <Text style={[styles.segmentedText, { color: !enBs ? colors.onPrimary : colors.textMuted }]}>
                        USD ($)
                      </Text>
                    </PressableScale>
                    <PressableScale
                      style={[
                        styles.segmentedBtn,
                        enBs && { backgroundColor: colors.primary },
                      ]}
                      onPress={() => {
                        if (!enBs) handleToggleBs(true);
                      }}
                    >
                      <Text style={[styles.segmentedText, { color: enBs ? colors.onPrimary : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                        Bs. (@ {bcv.toFixed(2)})
                      </Text>
                    </PressableScale>
                  </View>
                </View>
              )}

              {items.length === 0 ? (
                <View style={styles.empty}>
                  <Feather name="file-text" size={36} color={colors.textDim} />
                  <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Sin productos</Text>
                  <Text style={[styles.emptySub, { color: colors.textDim }]}>
                    Agrega productos para no dejar el presupuesto vacío
                  </Text>
                </View>
              ) : (
                items.map((item) => {
                  const displaySubtotalUsd = item.cantidad * item.precio_unitario;
                  const displaySubtotalBs = displaySubtotalUsd * bcv;
                  const isMarkup = item.precio_unitario !== item.precioVentaOriginal;
                  return (
                    <View
                      key={item.codigo_producto}
                      style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    >
                      {/* Header: name + remove */}
                      <View style={styles.itemTop}>
                        <View style={styles.itemInfo}>
                          <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                            {item.descripcion}
                          </Text>
                          <Text style={[styles.itemCode, { color: colors.textMuted }]}>{item.codigo_producto}</Text>
                        </View>
                        <PressableScale
                          onPress={() => removeLine(item.codigo_producto)}
                          hitSlop={12}
                          activeScale={pressScale.icon}
                          style={styles.removeBtn}
                        >
                          <Feather name="x" size={16} color={colors.textDim} />
                        </PressableScale>
                      </View>

                      {/* Quantity + Price */}
                      <View style={styles.controlsRow}>
                        <View style={styles.controlGroup}>
                          <Text style={[styles.controlLabel, { color: colors.textMuted }]}>CANTIDAD</Text>
                          <View style={styles.controlRow}>
                            <PressableScale
                              onPress={() => setQuantity(item.codigo_producto, Math.max(1, item.cantidad - 1))}
                              activeScale={pressScale.icon}
                              style={[
                                styles.ctrlBtn,
                                { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                              ]}
                            >
                              <Feather name="minus" size={14} color={colors.text} />
                            </PressableScale>

                            <TextInput
                              style={[styles.ctrlInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }] as any}
                              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                              value={String(item.cantidad)}
                              onChangeText={(v) => {
                                const val = v.replace(',', '.');
                                const n = parseFloat(val);
                                if (!isNaN(n) && n > 0) setQuantity(item.codigo_producto, n);
                              }}
                              selectTextOnFocus
                            />

                            <PressableScale
                              onPress={() => setQuantity(item.codigo_producto, item.cantidad + 1)}
                              activeScale={pressScale.icon}
                              style={[
                                styles.ctrlBtn,
                                { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                              ]}
                            >
                              <Feather name="plus" size={14} color={colors.text} />
                            </PressableScale>
                          </View>
                        </View>

                        <View style={[styles.controlGroup, { flex: 1 }]}>
                          <Text style={[styles.controlLabel, { color: colors.textMuted }]}>PRECIO UNIT.</Text>
                          <View style={styles.controlRow}>
                            <View style={[styles.priceField, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
                              <Text style={[styles.priceCurrency, { color: colors.textDim }]}>$</Text>
                              <TextInput
                                style={[styles.priceInput, { color: colors.text }] as any}
                                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                                value={priceInputs[item.codigo_producto] !== undefined ? priceInputs[item.codigo_producto] : String(item.precio_unitario)}
                                onChangeText={(v) => {
                                  const val = v.replace(',', '.');
                                  setPriceInputs(prev => ({ ...prev, [item.codigo_producto]: val }));
                                  if (val === '' || val === '.') {
                                    setPrice(item.codigo_producto, 0);
                                    return;
                                  }
                                  const p = parseFloat(val);
                                  if (!isNaN(p) && p >= 0) setPrice(item.codigo_producto, p);
                                }}
                                selectTextOnFocus
                                placeholder="0.00"
                                placeholderTextColor={colors.textDim}
                              />
                            </View>

                            <PressableScale
                              onPress={() => toggleMarkup(item)}
                              style={[
                                styles.percentBtn,
                                isMarkup
                                  ? { backgroundColor: colors.success + '18', borderColor: colors.success + '40' }
                                  : { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' },
                              ]}
                              hitSlop={4}
                            >
                              <Text
                                style={[
                                  styles.percentBtnText,
                                  { color: isMarkup ? colors.success : colors.primary },
                                  isMarkup && { fontSize: scaleFont(16) },
                                ]}
                              >
                                {isMarkup ? '↺' : `+${markup_porcentaje}%`}
                              </Text>
                            </PressableScale>
                          </View>
                          {enBs && bcv > 0 && (
                            <Text style={{ fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_400Regular', color: colors.textMuted, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>
                              Bs. {(item.precio_unitario * bcv).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Text>
                          )}
                        </View>
                      </View>

                      {priceWarnings[item.codigo_producto] && (
                        <MarginWarningBadge costoMinimo={item.costo} formatUSD={formatUSD} />
                      )}

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
                })
              )}

              {/* Nota */}
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

              <View style={{ height: 120 }} />
            </ScrollView>

            {/* Footer save bar */}
            <View
              style={[
                styles.footer,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  paddingBottom: Math.max(insets.bottom, 12),
                },
                isDesktop && styles.footerDesktop,
              ]}
            >
              <View style={styles.footerInfo}>
                <Text style={[styles.footerLabel, { color: colors.textMuted }]}>TOTAL</Text>
                <Text style={[styles.footerTotal, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                  {formatUSD(total)}
                </Text>
                {enBs && bcv > 0 && (
                  <Text style={{ fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', color: colors.primary, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
                    Bs. {(total * bcv).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                )}
              </View>
              <PressableScale
                style={[styles.saveBtn, { backgroundColor: colors.primary }]}
                dimmed={isPending}
                onPress={handleSave}
                disabled={isPending}
              >
                {isPending ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <>
                    <Feather name="save" size={16} color={colors.onPrimary} />
                    <Text style={[styles.saveBtnText, { color: colors.onPrimary }]}>Guardar cambios</Text>
                  </>
                )}
              </PressableScale>
            </View>
          </>
        )}

        {addOpen && (
          <AddProductsPicker
            onClose={() => setAddOpen(false)}
            quantities={qtyByCodigo}
            onIncrement={addProducto}
            onDecrement={decrementProducto}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ── Nested product picker ──────────────────────────────────────────────────────

interface AddProductsPickerProps {
  onClose: () => void;
  quantities: Record<string, number>;
  onIncrement: (producto: Producto) => void;
  onDecrement: (codigo: string) => void;
}

function AddProductsPicker({
  onClose,
  quantities,
  onIncrement,
  onDecrement,
}: AddProductsPickerProps): React.JSX.Element {
  const { colors, formatUSD } = useTheme();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const { productos, isLoading, fetchMore, hasMore, isFetchingMore } = useProductos(debounced, 'todos');

  const renderProducto = React.useCallback(
    ({ item }: { item: Producto }) => {
      if (isPlaceholder(item)) return null;
      const qty = quantities[item.codigo_interno] ?? 0;
      return (
        <View style={[styles.pickCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.pickInfo}>
            <Text style={[styles.pickCode, { color: colors.textDim }]} numberOfLines={1}>
              {item.codigo_interno}
              {item.referencia ? `  ·  Ref: ${item.referencia}` : ''}
            </Text>
            <Text style={[styles.pickName, { color: colors.text }]} numberOfLines={2}>
              {item.descripcion}
            </Text>
            <Text style={[styles.pickPrice, { color: colors.primary }]}>{formatUSD(item.precio_venta)}</Text>
            <Text style={[styles.pickStock, { color: item.existencia <= 0 ? colors.danger : colors.success }]}>
              Stock: {item.existencia} {item.unidad}
            </Text>
          </View>

          <View style={styles.pickQtyControl}>
            <Pressable
              style={[styles.pickActionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => onDecrement(item.codigo_interno)}
            >
              <Feather name="minus" size={20} color={colors.text} />
            </Pressable>
            <Text style={[styles.pickQtyText, { color: colors.text }]}>{qty}</Text>
            <Pressable
              style={[styles.pickActionBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}
              onPress={() => onIncrement(item)}
            >
              <Feather name="plus" size={20} color={colors.primary} />
            </Pressable>
          </View>
        </View>
      );
    },
    [quantities, colors, formatUSD, onIncrement, onDecrement],
  );

  return (
    <Modal visible animationType="slide" transparent={false} statusBarTranslucent onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} style={styles.btnBack} hitSlop={8}>
            <Feather name="chevron-down" size={28} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Agregar productos</Text>
          <Pressable onPress={onClose} style={styles.doneBtn} hitSlop={8}>
            <Text style={[styles.doneBtnText, { color: colors.primary }]}>Listo</Text>
          </Pressable>
        </View>

        <View style={[styles.searchContainer, { backgroundColor: colors.surface }]}>
          <Feather name="search" size={20} color={colors.textDim} style={{ marginRight: 10 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Buscar producto por nombre o código..."
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Feather name="x-circle" size={20} color={colors.textDim} />
            </Pressable>
          )}
        </View>

        <FlashList
          data={productos}
          extraData={quantities}
          keyExtractor={(item) => item.codigo_interno}
          renderItem={renderProducto}
          estimatedItemSize={110}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: 40 }}
          onEndReached={() => {
            if (hasMore && !isFetchingMore) fetchMore();
          }}
          onEndReachedThreshold={0.1}
          ListEmptyComponent={
            isLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 50 }} />
            ) : (
              <Text style={[styles.pickEmpty, { color: colors.textDim }]}>
                {search ? 'No se encontraron productos.' : 'Escribe para buscar...'}
              </Text>
            )
          }
          ListFooterComponent={
            isFetchingMore ? <ActivityIndicator size="small" color={colors.primary} style={{ padding: 20 }} /> : null
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  btnBack: { padding: 5, width: 40 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: scaleFont(18), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular', marginTop: 2 },
  doneBtn: { width: 50, alignItems: 'flex-end' },
  doneBtnText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 12, gap: 8 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addBtnText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50, gap: 12 },
  emptyTitle: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  emptySub: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(20), paddingHorizontal: 24 },

  itemCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 12,
    gap: 10,
  },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  itemCode: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', marginTop: 1 },
  removeBtn: { padding: 4, marginLeft: 8 },

  controlsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  controlGroup: { gap: 4 },
  controlLabel: { fontSize: scaleFont(9), fontFamily: 'JetBrainsMono_500Medium', textTransform: 'uppercase', letterSpacing: 0.3 },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  ctrlBtn: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
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
  priceCurrency: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
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

  percentBtn: {
    height: 36,
    minWidth: 50,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentBtnText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },

  subtotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  subtotalVal: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold', fontVariant: ['tabular-nums'] },

  ordenNota: { marginHorizontal: 16, borderRadius: 12, borderWidth: 0.5, padding: 14, gap: 6 },
  ordenNotaLabel: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  ordenNotaInput: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(22), minHeight: 44 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 0.5,
  },
  footerDesktop: { maxWidth: 1200, width: '100%', alignSelf: 'center' },
  footerInfo: { flex: 1, gap: 2 },
  footerLabel: { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_500Medium', letterSpacing: 0.3 },
  footerTotal: { fontSize: scaleFont(20), fontFamily: 'JetBrainsMono_700Bold', fontVariant: ['tabular-nums'] },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 22,
  },
  saveBtnText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  /* ── Product picker ─────────────────────────────────────── */
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 15,
    marginVertical: 14,
    paddingHorizontal: 15,
    height: 50,
    borderRadius: 12,
  },
  searchInput: { flex: 1, height: '100%', fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_400Regular' },
  pickCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    marginBottom: 12,
    marginHorizontal: 16,
  },
  pickInfo: { flex: 1, marginRight: 10 },
  pickCode: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium', marginBottom: 2 },
  pickName: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold', marginBottom: 4 },
  pickPrice: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold', marginBottom: 2 },
  pickStock: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium' },
  pickQtyControl: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pickActionBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1 },
  pickQtyText: { width: 30, textAlign: 'center', fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  pickEmpty: { textAlign: 'center', marginTop: 50, fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_400Regular' },

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
