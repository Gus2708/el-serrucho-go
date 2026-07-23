import { scaleFont } from '../src/theme/responsive';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeContext';
import { useProductos, isPlaceholder, normalizeSearchTerm } from '../src/hooks/useProductos';
import { Producto } from '../src/lib/supabase';
import { usePresupuestoStore } from '../src/hooks/usePresupuestoStore';
import { usePedido } from '../src/hooks/usePedido';
import { usePresupuestoConfig } from '../src/hooks/usePresupuestoConfig';
import { useTazas } from '../src/hooks/useTazas';
import { useDeviceSize } from '../src/hooks/useDeviceSize';
import { BarcodeScannerModal } from '../src/components/BarcodeScannerModal';
import { useUserRole, canMakePedidos } from '../src/hooks/useUserRole';
import { useResolverSolicitud } from '../src/hooks/useResolverSolicitud';
import { confirm, notify } from '../src/lib/notify';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PressableScale } from '../src/components/PressableScale';
import { pressScale } from '../src/theme/motion';

export default function SeleccionarProductos() {
  const { colors, formatUSD } = useTheme();
  const { isDesktop } = useDeviceSize();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);

  const { target = 'presupuesto', solicitudId } = useLocalSearchParams<{ target?: 'presupuesto' | 'pedido'; solicitudId?: string }>();
  const isPresupuesto = target === 'presupuesto';

  const presupuestoStore = usePresupuestoStore();
  const pedidoStore      = usePedido();

  const { data: config } = usePresupuestoConfig();
  const { data: tasa }   = useTazas();
  const markupPct        = config?.markup_porcentaje ?? 30;
  const bcv              = tasa?.bcv_usd ?? 0;

  const enBs = isPresupuesto ? presupuestoStore.enBs : pedidoStore.enBs;

  const { data: userAuth } = useUserRole();
  const allowedToOrder = canMakePedidos(userAuth);
  const { resolverSolicitud, isResolving, marcarNoDisponible, isMarcandoNoDisponible } = useResolverSolicitud();
  const insets = useSafeAreaInsets();

  function toggleCurrency(toBs: boolean) {
    if (isPresupuesto) {
      if (toBs) {
        presupuestoStore.setEnBs(true, bcv, markupPct);
      } else {
        presupuestoStore.setEnBs(false, null, null);
      }
    } else {
      pedidoStore.setEnBs(toBs);
    }
  }

  const handleBack = () => {
    if (solicitudId && presupuestoStore.items.length > 0) {
      confirm({
        title: 'Cancelar selección',
        message: '¿Estás seguro de que quieres salir? Se perderán los productos seleccionados.',
        confirmText: 'Salir',
        cancelText: 'Continuar',
        destructive: true,
        onConfirm: () => {
          usePresupuestoStore.getState().reset();
          router.replace('/(tabs)/notificaciones' as any);
        }
      });
    } else if (solicitudId) {
      usePresupuestoStore.getState().reset();
      router.replace('/(tabs)/notificaciones' as any);
    } else if (target === 'pedido') {
      // El armador de pedido es un Modal montado en el Dashboard (PedidoFab),
      // no una ruta. router.back() es frágil: según el historial puede caer en
      // otra pantalla (p. ej. si el pedido se abrió al convertir un presupuesto).
      // Reaseguramos el modal abierto y volvemos explícitamente al Dashboard.
      pedidoStore.setModalOpen(true, true);
      router.replace('/(tabs)');
    } else {
      router.replace({ pathname: '/(tabs)/ordenes', params: { tab: 'presupuesto' } });
    }
  };

  const handleSendToClient = async () => {
    if (!solicitudId) return;

    if (!userAuth || !userAuth.is_active) {
      notify('Acceso Restringido', 'Debes tener un usuario activo para resolver solicitudes.');
      return;
    }

    const empleadoId = userAuth.profile?.id;
    if (!empleadoId) {
      notify('Error', 'No se pudo obtener el identificador del empleado.');
      return;
    }

    try {
      await resolverSolicitud(parseInt(solicitudId, 10), empleadoId, presupuestoStore.items);
      usePresupuestoStore.getState().reset();
      notify('Éxito', 'La solicitud ha sido resuelta y los productos enviados al cliente.');
      router.replace('/(tabs)/notificaciones' as any);
    } catch (e: any) {
      notify('Error al enviar', e.message || 'Ocurrió un error al enviar.');
    }
  };

  const handleNoDisponible = () => {
    if (!solicitudId) return;

    if (!userAuth || !userAuth.is_active) {
      notify('Acceso Restringido', 'Debes tener un usuario activo para resolver solicitudes.');
      return;
    }

    const empleadoId = userAuth.profile?.id;
    if (!empleadoId) {
      notify('Error', 'No se pudo obtener el identificador del empleado.');
      return;
    }

    confirm({
      title: 'Avisar que no lo hay',
      message: 'Se le notificará al cliente que el producto no está disponible. ¿Continuar?',
      confirmText: 'Sí, no lo hay',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        try {
          await marcarNoDisponible(parseInt(solicitudId, 10), empleadoId);
          usePresupuestoStore.getState().reset();
          notify('Listo', 'Se le avisó al cliente que el producto no está disponible.');
          router.replace('/(tabs)/notificaciones' as any);
        } catch (e: any) {
          notify('Error', e.message || 'No se pudo procesar la solicitud.');
        }
      },
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const { productos, isLoading, fetchMore, hasMore, isFetchingMore } = useProductos(debouncedSearch, 'todos');

  const getItemQuantity = React.useCallback((codigo_interno: string) => {
    if (isPresupuesto) {
      const item = presupuestoStore.items.find(i => i.producto.codigo_interno === codigo_interno);
      return item ? item.cantidad : 0;
    } else {
      const item = pedidoStore.items.find(i => i.codigo_producto === codigo_interno);
      return item ? item.cantidad : 0;
    }
  }, [isPresupuesto, presupuestoStore.items, pedidoStore.items]);

  const handleIncrement = React.useCallback((producto: Producto) => {
    if (!isPresupuesto && !allowedToOrder) {
      notify('Acceso Restringido', 'No tienes permiso para realizar pedidos.');
      return;
    }
    const qty = getItemQuantity(producto.codigo_interno);
    if (isPresupuesto) {
      if (qty === 0) {
        presupuestoStore.addItem(producto, 1);
      } else {
        presupuestoStore.updateItemQuantity(producto.codigo_interno, qty + 1);
      }
    } else {
      const basePrice = Number(producto.precio_venta || 0);
      if (qty === 0) {
        pedidoStore.addItem({
          codigo_producto: producto.codigo_interno,
          descripcion:     producto.descripcion,
          cantidad:        1,
          precio_base_usd: basePrice,
          precio_unitario: basePrice,
        });
      } else {
        pedidoStore.updateItem(producto.codigo_interno, { cantidad: qty + 1 });
      }
    }
  }, [getItemQuantity, isPresupuesto, presupuestoStore, pedidoStore, allowedToOrder]);

  const handleDecrement = React.useCallback((producto: Producto) => {
    if (!isPresupuesto && !allowedToOrder) {
      notify('Acceso Restringido', 'No tienes permiso para realizar pedidos.');
      return;
    }
    const qty = getItemQuantity(producto.codigo_interno);
    if (isPresupuesto) {
      if (qty > 1) {
        presupuestoStore.updateItemQuantity(producto.codigo_interno, qty - 1);
      } else if (qty === 1) {
        presupuestoStore.removeItem(producto.codigo_interno);
      }
    } else {
      if (qty > 1) {
        pedidoStore.updateItem(producto.codigo_interno, { cantidad: qty - 1 });
      } else if (qty === 1) {
        pedidoStore.removeItem(producto.codigo_interno);
      }
    }
  }, [getItemQuantity, isPresupuesto, presupuestoStore, pedidoStore, allowedToOrder]);

  const handleSetQuantity = React.useCallback((producto: Producto, val: string) => {
    if (!isPresupuesto && !allowedToOrder) {
      notify('Acceso Restringido', 'No tienes permiso para realizar pedidos.');
      return;
    }
    if (val === '') {
      if (isPresupuesto) presupuestoStore.removeItem(producto.codigo_interno);
      else pedidoStore.removeItem(producto.codigo_interno);
      return;
    }
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 0) {
      if (num === 0) {
        if (isPresupuesto) presupuestoStore.removeItem(producto.codigo_interno);
        else pedidoStore.removeItem(producto.codigo_interno);
      } else {
        const qty = getItemQuantity(producto.codigo_interno);
        if (isPresupuesto) {
          if (qty === 0) presupuestoStore.addItem(producto, num);
          else presupuestoStore.updateItemQuantity(producto.codigo_interno, num);
        } else {
          const basePrice = Number(producto.precio_venta || 0);
          if (qty === 0) {
            pedidoStore.addItem({
              codigo_producto: producto.codigo_interno,
              descripcion:     producto.descripcion,
              cantidad:        num,
              precio_base_usd: basePrice,
              precio_unitario: basePrice,
            });
          } else {
            pedidoStore.updateItem(producto.codigo_interno, { cantidad: num });
          }
        }
      }
    }
  }, [getItemQuantity, isPresupuesto, presupuestoStore, pedidoStore, allowedToOrder]);

  const totalAdded = isPresupuesto
    ? presupuestoStore.items.reduce((acc, item) => acc + item.cantidad, 0)
    : pedidoStore.items.reduce((acc, item) => acc + item.cantidad, 0);

  const totalBaseUsd = isPresupuesto
    ? presupuestoStore.items.reduce((acc, item) => acc + (item.cantidad * item.producto.precio_venta), 0)
    : pedidoStore.items.reduce((acc, item) => acc + (item.cantidad * (item.precio_base_usd ?? item.precio_unitario ?? 0)), 0);

  const totalMarkupUsd = parseFloat((totalBaseUsd * (1 + markupPct / 100)).toFixed(2));
  const totalBs = totalMarkupUsd * bcv;

  const renderProducto = React.useCallback(({ item, index }: { item: Producto; index: number }) => {
    if (isPlaceholder(item)) return null;

    const quantity = getItemQuantity(item.codigo_interno);
    const basePriceUsd = item.precio_venta;
    const precioMarkupUsd = parseFloat((basePriceUsd * (1 + markupPct / 100)).toFixed(2));
    const precioBs = bcv > 0 ? precioMarkupUsd * bcv : 0;
    const isSelected = quantity > 0;

    return (
      <Animated.View
        entering={FadeInDown.duration(160).delay(Math.min(index * 25, 200))}
        style={[
          styles.productCard,
          {
            backgroundColor: isSelected ? colors.primary + '0A' : colors.surface,
            borderColor:     isSelected ? colors.primary + '60' : colors.border,
          },
          isDesktop && styles.productCardDesktop
        ]}
      >
        <View style={styles.productInfo}>
          <Text style={[styles.productCode, { color: colors.textDim }]} numberOfLines={1} adjustsFontSizeToFit>
            {item.codigo_interno}{item.referencia ? `  ·  Ref: ${item.referencia}` : ''}
          </Text>
          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
            {item.descripcion}
          </Text>
          <Text style={[styles.productPrice, { color: colors.primary }]}>
            {formatUSD(enBs ? precioMarkupUsd : basePriceUsd)}
          </Text>
          {bcv > 0 && (
            <Text style={[styles.productPriceSub, { color: colors.textMuted }]} numberOfLines={1}>
              {enBs ? (
                `Bs ${precioBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}  ·  Base: ${formatUSD(basePriceUsd)}`
              ) : (
                `+${markupPct}% (${formatUSD(precioMarkupUsd)}) · Bs ${precioBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              )}
            </Text>
          )}
          <Text style={[styles.productStock, { color: item.existencia <= 0 ? colors.danger : colors.success, marginTop: 2 }]}>
            Stock: {item.existencia} {item.unidad}
          </Text>
        </View>

        <View style={styles.quantityControl}>
          <PressableScale
            style={[styles.btnAction, { backgroundColor: colors.surface, borderColor: colors.border }]}
            activeScale={pressScale.icon}
            onPress={() => handleDecrement(item)}
          >
            <Feather name="minus" size={18} color={colors.text} />
          </PressableScale>

          <TextInput
            style={[
              styles.quantityInput,
              {
                color:           colors.text,
                backgroundColor: Platform.OS === 'ios' ? colors.bg : colors.surface,
                borderColor:     isSelected ? colors.primary : colors.border
              }
            ]}
            keyboardType="numeric"
            value={String(quantity)}
            onChangeText={(val) => handleSetQuantity(item, val)}
            selectTextOnFocus
          />

          <PressableScale
            style={[styles.btnAction, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}
            activeScale={pressScale.icon}
            onPress={() => handleIncrement(item)}
          >
            <Feather name="plus" size={18} color={colors.primary} />
          </PressableScale>
        </View>
      </Animated.View>
    );
  }, [colors, isDesktop, getItemQuantity, handleDecrement, handleIncrement, handleSetQuantity, formatUSD, enBs, markupPct, bcv]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <PressableScale onPress={handleBack} style={styles.btnBack} activeScale={pressScale.icon}>
          <Feather name="chevron-down" size={28} color={colors.text} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {solicitudId ? 'Seleccionar Productos' : target === 'pedido' ? 'Añadir a Pedido' : 'Añadir Productos'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Currency Toggle */}
      <View style={[styles.currencyToggleContainer, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
        <Text style={[styles.currencyLabel, { color: colors.textMuted }]}>
          MONEDA DE REFERENCIA
        </Text>
        <View style={[styles.segmentedControl, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <PressableScale
            style={[
              styles.segmentedBtn,
              !enBs && { backgroundColor: colors.primary },
            ]}
            onPress={() => toggleCurrency(false)}
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
            onPress={() => toggleCurrency(true)}
          >
            <Text style={[styles.segmentedText, { color: enBs ? colors.onPrimary : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
              Bs. {bcv > 0 ? `(@ ${bcv.toFixed(2)})` : ''}
            </Text>
          </PressableScale>
        </View>
      </View>

      {/* Summary Cards */}
      <View style={[styles.summaryContainer, isDesktop && styles.summaryContainerDesktop]}>
        <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.summaryLabel, { color: colors.textDim }]}>Items Agregados</Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>{totalAdded}</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.summaryLabel, { color: colors.textDim }]}>Monto Total</Text>
          <Text style={[styles.summaryValue, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {enBs && bcv > 0 ? (
              `Bs ${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ) : (
              formatUSD(totalBaseUsd)
            )}
          </Text>
          {enBs && bcv > 0 && totalBaseUsd > 0 && (
            <Text style={{ fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_400Regular', color: colors.textMuted, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              Base: {formatUSD(totalBaseUsd)} · +{markupPct}%
            </Text>
          )}
        </View>
      </View>

      {/* Search */}
      <View style={[styles.searchContainer, { backgroundColor: colors.surface }, isDesktop && styles.searchContainerDesktop]}>
        <Feather name="search" size={20} color={colors.textDim} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Buscar producto por nombre o código..."
          placeholderTextColor={colors.textDim}
          value={search}
          onChangeText={v => setSearch(normalizeSearchTerm(v))}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect={false}
          spellCheck={false}
          clearButtonMode="always"
        />
        {search.length > 0 && Platform.OS !== 'ios' && (
          <Pressable onPress={() => setSearch('')} style={{ marginRight: 8 }}>
            <Feather name="x-circle" size={20} color={colors.textDim} />
          </Pressable>
        )}
        <PressableScale onPress={() => setScannerVisible(true)} hitSlop={8} activeScale={pressScale.icon}>
          <Feather name="camera" size={20} color={colors.primary} />
        </PressableScale>
      </View>

      {/* List */}
      <FlashList
        data={productos}
        extraData={[presupuestoStore.items, pedidoStore.items, enBs, bcv, markupPct]}
        keyExtractor={(item) => item.codigo_interno}
        renderItem={renderProducto}
        estimatedItemSize={110}
        contentContainerStyle={{
          paddingTop: 10,
          paddingBottom: solicitudId ? 140 : 60,
          ...(isDesktop ? styles.listContainerDesktop : {}),
        }}
        onEndReached={() => {
          if (hasMore && !isFetchingMore) fetchMore();
        }}
        onEndReachedThreshold={0.1}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 50 }} />
          ) : (
            <Text style={[styles.emptyText, { color: colors.textDim }]}>
              {search ? 'No se encontraron productos.' : 'Escribe para buscar...'}
            </Text>
          )
        }
        ListFooterComponent={
          isFetchingMore ? <ActivityIndicator size="small" color={colors.primary} style={{ padding: 20 }} /> : null
        }
      />
      <BarcodeScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={(data) => {
          setSearch(data);
          setScannerVisible(false);
        }}
      />

      {/* "No lo hay": resolver sin productos cuando no se eligió ninguno */}
      {solicitudId && presupuestoStore.items.length === 0 && (
        <View style={[
          styles.submitBar,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            bottom: isDesktop ? undefined : (Platform.OS === 'web' ? 0 : insets.bottom),
            position: isDesktop ? 'relative' : 'absolute',
          },
          isDesktop && styles.submitBarWeb,
        ]}>
          <Text style={[styles.noDispHint, { color: colors.textMuted }]} numberOfLines={2}>
            ¿No encontraste el producto? Avísale al cliente.
          </Text>
          <PressableScale
            style={[
              styles.submitBtn,
              { backgroundColor: colors.danger + '15', borderWidth: 0.5, borderColor: colors.danger + '40' },
            ]}
            onPress={handleNoDisponible}
            disabled={isMarcandoNoDisponible}
            dimmed={isMarcandoNoDisponible}
          >
            {isMarcandoNoDisponible ? (
              <ActivityIndicator color={colors.danger} size="small" />
            ) : (
              <>
                <Feather name="slash" size={16} color={colors.danger} />
                <Text style={[styles.submitBtnText, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
                  NO LO HAY
                </Text>
              </>
            )}
          </PressableScale>
        </View>
      )}

      {/* Submit bar if solicitudId is present */}
      {solicitudId && presupuestoStore.items.length > 0 && (
        <View style={[
          styles.submitBar,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            bottom: isDesktop ? undefined : (Platform.OS === 'web' ? 0 : insets.bottom),
            position: isDesktop ? 'relative' : 'absolute',
          },
          isDesktop && styles.submitBarWeb
        ]}>
          <View style={styles.submitInfo}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.submitCount, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                {presupuestoStore.items.length} ítem{presupuestoStore.items.length > 1 ? 's' : ''}
              </Text>
              <Text style={[styles.submitTotal, { color: colors.primary }]} numberOfLines={1}>
                {enBs && bcv > 0 ? (
                  `Bs ${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                ) : (
                  formatUSD(totalBaseUsd)
                )}
              </Text>
            </View>
            <PressableScale onPress={() => usePresupuestoStore.getState().reset()}>
              <Text style={[styles.clearText, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>Limpiar</Text>
            </PressableScale>
          </View>
          <PressableScale
            style={[
              styles.submitBtn,
              { backgroundColor: colors.primary },
            ]}
            onPress={handleSendToClient}
            disabled={isResolving}
            dimmed={isResolving}
          >
            {isResolving ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <>
                <Feather name="send" size={16} color={colors.onPrimary} />
                <Text style={[styles.submitBtnText, { color: colors.onPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                  ENVIAR A CLIENTE
                </Text>
              </>
            )}
          </PressableScale>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
  btnBack: {
    padding: 5,
  },
  headerTitle: {
    fontSize: scaleFont(20),
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  currencyToggleContainer: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    marginHorizontal:  15,
    marginTop:         12,
    paddingVertical:   8,
    paddingHorizontal: 12,
    borderRadius:      12,
    borderWidth:       0.5,
  },
  currencyLabel: {
    fontSize:      scaleFont(10),
    fontFamily:    'JetBrainsMono_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  segmentedControl: {
    flexDirection: 'row',
    borderRadius:  8,
    borderWidth:   0.5,
    padding:       2,
    gap:           2,
  },
  segmentedBtn: {
    paddingVertical:   5,
    paddingHorizontal: 12,
    borderRadius:      6,
    alignItems:        'center',
    justifyContent:    'center',
  },
  segmentedText: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  summaryContainer: {
    flexDirection: 'row',
    padding: 15,
    gap: 10,
  },
  summaryContainerDesktop: {
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  summaryCard: {
    flex: 1,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: scaleFont(12),
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: 5,
  },
  summaryValue: {
    fontSize: scaleFont(20),
    fontWeight: '800',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 15,
    marginBottom: 15,
    paddingHorizontal: 15,
    height: 50,
    borderRadius: 12,
  },
  searchContainerDesktop: {
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: scaleFont(16),
  },
  listContainer: {
    paddingTop: 10,
    paddingBottom: 60,
  },
  listContainerDesktop: {
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  productCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    marginBottom: 12,
    marginHorizontal: 16,
  },
  productCardDesktop: {
    padding: 24,
    marginBottom: 20,
    marginHorizontal: 0,
  },
  productInfo: {
    flex: 1,
    marginRight: 10,
  },
  productCode: {
    fontSize: scaleFont(12),
    fontWeight: '600',
    marginBottom: 2,
  },
  productName: {
    fontSize: scaleFont(15),
    fontWeight: '700',
    marginBottom: 4,
  },
  productPrice: {
    fontSize: scaleFont(16),
    fontWeight: '800',
    marginBottom: 1,
  },
  productPriceSub: {
    fontSize: scaleFont(11),
    fontWeight: '500',
    marginBottom: 3,
  },
  productStock: {
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  btnAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
  },
  quantityText: {
    width: 30,
    textAlign: 'center',
    fontSize: scaleFont(16),
    fontWeight: '700',
  },
  quantityInput: {
    width: 50,
    height: 40,
    textAlign: 'center',
    fontSize: scaleFont(16),
    fontWeight: '700',
    borderRadius: 8,
    borderWidth: 1,
    padding: 0,
    marginHorizontal: 4,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 50,
    fontSize: scaleFont(16),
  },
  submitBar: {
    padding: 16,
    borderTopWidth: 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    left: 0,
    right: 0,
  },
  submitBarWeb: {
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
    borderRadius: 20,
    borderWidth: 0.5,
    marginBottom: 16,
  },
  submitInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  noDispHint: {
    flex: 1,
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_500Medium',
    lineHeight: scaleFont(16),
  },
  submitCount: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  submitTotal: {
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  clearText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
    textDecorationLine: 'underline',
  },
  submitBtn: {
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  submitBtnText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
});
