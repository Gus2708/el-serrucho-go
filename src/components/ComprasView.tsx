import * as React from 'react';
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  FlatList,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { HIDE_ON_KEYBOARD } from '../web/keyboardMarkers';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { useDeviceSize } from '../hooks/useDeviceSize';
import { notify, confirm } from '../lib/notify';
import { supabase, Producto } from '../lib/supabase';
import { useProveedores, Proveedor } from '../hooks/useProveedores';
import { useCompra, CompraDraftItem } from '../hooks/useCompra';
import { borradoresQueryKey } from '../hooks/useBorradores';
import { useProductos, normalizeSearchTerm, buildBarcodeSearchVariants } from '../hooks/useProductos';
import { useExistencias, faltantePorNegativo } from '../hooks/useExistencias';
import { useColisionesCodigo, describirColision, ColisionCodigo } from '../hooks/useColisionesCodigo';
import { useUserRole, isPrivilegedRole } from '../hooks/useUserRole';
import { PressableScale } from './PressableScale';
import { pressScale } from '../theme/motion';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import RegistroProveedorModal from './RegistroProveedorModal';
import GuardarBorradorModal from './GuardarBorradorModal';
import FacturasProveedorModal from './FacturasProveedorModal';
import FacturaBorradoresBadge from './FacturaBorradoresBadge';
import { CascadeDiscountInput } from './CascadeDiscountInput';
import {
  calcularCostoConDescuento,
  calcularPorcentajeEfectivo,
  formatearCascada,
  resolverDescuentosEfectivos,
} from '../lib/compraDescuentos';
import { isDemoActive } from '../demo/useDemoStore';

// Ficha de Inventario de HybridLite trunca la descripción a los 60 caracteres
// (confirmado en compras.log 2026-07-17: "PUERTA MULTILOCK...QUINTE" != "...QUINTERO",
// 63 chars -> mismatch -> alta cancelada -> compra entera marcada 'error').
const DESCRIPCION_MAX = 60;

export function parseCantidadConAjuste(raw: string): {
  display: string;
  cantidad: number;
  esAjuste: boolean;
} {
  const normalized = raw
    .replace(/\u2026/g, '...')
    .replace(/,/g, '.')
    .replace(/\.{3,}$/, '...');
  const numericPart = normalized.replace(/\.+$/, '');
  const cantidad = parseFloat(numericPart);
  const esAjuste = normalized.endsWith('...') && !isNaN(cantidad);
  return { display: normalized, cantidad, esAjuste };
}

export function formatCantidadConAjuste(cantidad: number, esAjuste?: boolean): string {
  return esAjuste ? `${cantidad}...` : String(cantidad);
}

interface ComprasViewProps {
  router:        any;
  onEmitted?:    () => void;
  onSavedDraft?: () => void;   // navega a Borradores tras guardar la lista
}

export default function ComprasView({ router, onEmitted, onSavedDraft }: ComprasViewProps): React.JSX.Element {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { isDesktop } = useDeviceSize();
  const {
    proveedorCodigo,
    proveedorNombre,
    items,
    descuentosGenerales,
    nota,
    titulo,
    numeroDocumento,
    isLoading,
    isAutoSaving,
    lastSavedAt,
    editingCompraId,
    borradorId,
    facturaVinculada,
    setProveedor,
    setDescuentosGenerales,
    addItem,
    removeItem,
    updateItem,
    setNota,
    setNumeroDocumento,
    clear,
    saveDraft,
    autoSaveDraft,
    deleteActiveDraft,
    submit,
  } = useCompra();

  const { data: userAuth } = useUserRole();
  const isPrivileged = isPrivilegedRole(userAuth?.role);

  const [proveedorModalVisible, setProveedorModalVisible] = useState(false);
  const [proveedorNuevoModalVisible, setProveedorNuevoModalVisible] = useState(false);
  const [productoModalVisible, setProductoModalVisible] = useState(false);
  const [productoNuevoModalVisible, setProductoNuevoModalVisible] = useState(false);
  const [borradorModalVisible, setBorradorModalVisible] = useState(false);
  const [facturasModalVisible, setFacturasModalVisible] = useState(false);
  const [generalDiscountInvalid, setGeneralDiscountInvalid] = useState(false);
  const [invalidItemDiscounts, setInvalidItemDiscounts] = useState<Record<string, boolean>>({});

  const handleItemDiscountValidity = React.useCallback((codigo: string, invalid: boolean) => {
    setInvalidItemDiscounts(prev => (prev[codigo] === invalid ? prev : { ...prev, [codigo]: invalid }));
  }, []);

  // Existencia fresca de los ítems ya existentes: los que están en negativo se
  // cargan con unidades extra al emitir (ver compensarExistenciasNegativas en
  // useCompra), así que el armador muestra y cobra esas unidades reales.
  const codigosExistentes = React.useMemo(
    () => items.filter(item => !item.es_nuevo).map(item => item.codigo_producto),
    [items],
  );
  const { data: existencias } = useExistencias(codigosExistentes);

  // Códigos que HybridLite resolvería a OTRO producto (el número es el código de
  // barras de un tercero). Se revisan también los productos nuevos: darle de alta
  // un código ya usado como barras ajeno arrastra el mismo choque.
  const codigosDeItems = React.useMemo(
    () => items.map(item => item.codigo_producto),
    [items],
  );
  const { data: colisiones } = useColisionesCodigo(codigosDeItems);

  function faltanteDe(item: CompraDraftItem): number {
    if (item.es_nuevo || item.es_ajuste) return 0;
    return faltantePorNegativo(existencias?.[item.codigo_producto]);
  }

  const totalLista = items.reduce(
    (sum, item) => sum + (item.cantidad + faltanteDe(item)) * (item.costo_lista ?? item.costo),
    0,
  );
  const total = items.reduce((sum, item) => sum + (item.cantidad + faltanteDe(item)) * item.costo, 0);
  const ahorroTotal = Math.max(0, totalLista - total);
  const itemsConDescuento = items.filter(
    item => resolverDescuentosEfectivos(item.descuentos, descuentosGenerales, item.excluir_descuento_general).length > 0,
  ).length;
  const itemsCompensados = items.filter(item => faltanteDe(item) > 0).length;
  const itemsConAjuste = items.filter(item => Boolean(item.es_ajuste)).length;

  // Lo último agregado se muestra de PRIMERO: el ítem recién añadido queda justo
  // debajo de los botones de agregar y se edita sin scroll. Es solo
  // presentación — el orden que se guarda sigue siendo el de agregado.
  const itemsRecienteArriba = React.useMemo(() => [...items].reverse(), [items]);

  // Al agregar un producto nuevo, subir para que se vea.
  const scrollRef = React.useRef<ScrollView>(null);
  const itemCountRef = React.useRef(items.length);
  useEffect(() => {
    if (items.length > itemCountRef.current) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
    itemCountRef.current = items.length;
  }, [items.length]);

  // Autoguardado continuo en segundo plano (debounce de 1.5s)
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Solo autoguardar si hay ítems y no estamos en modo reintento de compra fallida
    if (items.length === 0 || editingCompraId !== null) {
      return;
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        const userId = await getUserId();
        if (!userId) return;
        const newDraftId = await autoSaveDraft(userId);
        if (newDraftId) {
          await queryClient.invalidateQueries({ queryKey: borradoresQueryKey('compra') });
        }
      } catch (err) {
        console.warn('[ComprasView] Auto-save error:', err);
      }
    }, 1500);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [items, descuentosGenerales, proveedorCodigo, proveedorNombre, nota, numeroDocumento, editingCompraId]);

  function handleSelectProveedor(proveedor: Proveedor): void {
    setProveedor(proveedor.codigo, proveedor.nombre);
    setProveedorModalVisible(false);
  }

  function handleSelectProducto(producto: Producto): void {
    // Pre-llenar costo y precio con los valores ACTUALES de la DB: el comprador
    // solo ajusta lo que cambió, y si los deja igual el backend salta la
    // reescritura ("skip si es igual"). costo = ex-IVA, precio_venta = con IVA,
    // igual que lo que el flujo escribe en Hybrid.
    addItem({
      codigo_producto: producto.codigo_interno,
      descripcion:     producto.descripcion,
      cantidad:        1,
      costo:           producto.costo ?? 0,
      precio:          producto.precio_venta ?? 0,
      referencia:      producto.referencia ?? null,
      es_nuevo:        false,
      es_ajuste:       false,
    });
    setProductoModalVisible(false);
  }

  /** Devuelve el primer problema que impide emitir, o null si todo está listo. */
  function primerItemInvalido(): string | null {
    if (generalDiscountInvalid) {
      return 'El descuento general tiene un valor inválido (debe ser menor a 100%).';
    }
    for (const it of items) {
      if (!(it.cantidad > 0)) return `${it.descripcion}: la cantidad debe ser mayor a 0.`;
      if (invalidItemDiscounts[it.codigo_producto]) {
        return `${it.descripcion}: el descuento debe ser menor a 100%.`;
      }
      const costoLista = it.costo_lista ?? it.costo;
      if (!(costoLista > 0)) return `${it.descripcion}: falta el costo.`;
      if (!(it.costo > 0)) {
        return `${it.descripcion}: el costo neto después del descuento queda en $0.00.`;
      }
      if (!(it.precio > 0))   return `${it.descripcion}: falta el precio.`;
      if (it.es_nuevo && it.descripcion.length > DESCRIPCION_MAX) {
        return `${it.descripcion}: la descripción supera los ${DESCRIPCION_MAX} caracteres.`;
      }
    }
    return null;
  }

  async function getUserId(): Promise<string> {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? '';
  }

  async function performSubmit(): Promise<void> {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    const wasEditing = editingCompraId !== null;
    try {
      const userId = await getUserId();
      const { compraId } = await submit(userId);
      clear();
      await queryClient.invalidateQueries({ queryKey: borradoresQueryKey('compra') });
      notify(
        wasEditing ? 'Compra reencolada' : 'Compra emitida',
        `C-${String(compraId).padStart(4, '0')} en cola para registrarse en Hybrid.`
      );
      onEmitted?.();   // saltar a Historial para ver el estado del write-back
    } catch (e: any) {
      notify('Error', e.message ?? (wasEditing ? 'No se pudo reintentar la compra' : 'No se pudo emitir la compra'));
    }
  }

  // Guardar sin emitir: la lista queda como status='borrador' (invisible para
  // el backend) y el armador se libera. Se retoma desde la pestaña Borradores.
  async function handleSaveDraft(nombre: string): Promise<void> {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    try {
      const userId = await getUserId();
      await saveDraft(userId, nombre);
      setBorradorModalVisible(false);
      clear();
      await queryClient.invalidateQueries({ queryKey: borradoresQueryKey('compra') });
      notify('Borrador guardado', `"${nombre.trim()}" quedó en Borradores. No se registró nada en Hybrid.`);
      onSavedDraft?.();
    } catch (e: any) {
      notify('Error', e.message ?? 'No se pudo guardar el borrador.');
    }
  }

  function handleSubmit(): void {
    if (!isPrivileged) {
      notify('No autorizado', 'Solo un administrador o superempleado puede registrar compras.');
      return;
    }
    if (!proveedorCodigo || items.length === 0) return;
    const problema = primerItemInvalido();
    if (problema) {
      notify('Falta información', problema);
      return;
    }
    // Emitir un ítem colisionado deja un documento permanente en el kardex con
    // el producto equivocado, así que se corta acá. submit() lo vuelve a chequear
    // por si el aviso todavía no había cargado.
    const itemChocado = items.find(item => colisiones?.[item.codigo_producto]);
    const choque = itemChocado ? colisiones?.[itemChocado.codigo_producto] : undefined;
    if (itemChocado && choque) {
      notify('Código en conflicto', describirColision(
        itemChocado.codigo_producto,
        itemChocado.descripcion,
        choque,
      ));
      return;
    }
    const isEditing = editingCompraId !== null;
    const avisoNegativos = itemsCompensados > 0
      ? `\n\n${itemsCompensados} ítem${itemsCompensados > 1 ? 's están' : ' está'} en negativo: se cargarán las unidades faltantes además de lo comprado, para que el stock quede en la cantidad que escribiste.`
      : '';
    const avisoAjustes = itemsConAjuste > 0
      ? `\n\n${itemsConAjuste} ítem${itemsConAjuste > 1 ? 's tienen' : ' tiene'} ajuste fijo (...): se ajustará su existencia a la cantidad indicada mediante Ajustes de Inventario en vez de sumarse.`
      : '';
    const avisoDescuentos = itemsConDescuento > 0
      ? `\n\nDescuentos aplicados en ${itemsConDescuento} ítem${itemsConDescuento > 1 ? 's' : ''} (ahorro ${formatUSD(ahorroTotal)}): los costos ya viajan rebajados a Hybrid.`
      : '';
    confirm({
      title:       isEditing ? 'Reintentar compra' : 'Emitir compra',
      message:     (isEditing
        ? `Se reencolará C-${String(editingCompraId).padStart(4, '0')} a ${proveedorNombre} con ${items.length} ítem${items.length > 1 ? 's' : ''}.`
        : `Se registrará una compra a ${proveedorNombre} con ${items.length} ítem${items.length > 1 ? 's' : ''}.`) + avisoNegativos + avisoAjustes + avisoDescuentos,
      confirmText: isEditing ? 'Reintentar' : 'Emitir',
      onConfirm:   performSubmit,
    });
  }

  const canSubmit = isPrivileged && Boolean(proveedorCodigo) && items.length > 0 && !isLoading && !facturaVinculada;

  useEffect(() => {
    if (facturaVinculada && borradorId !== null) setFacturasModalVisible(false);
  }, [facturaVinculada, borradorId]);

  function handleDismissEditing(): void {
    if (items.length === 0) {
      clear();
      return;
    }
    confirm({
      title: '¿Cancelar edición?',
      message: `Tienes ${items.length} producto${items.length > 1 ? 's' : ''} en la compra. Si cancelas, se limpiará la pantalla actual.`,
      confirmText: 'Cancelar y limpiar',
      cancelText: 'Continuar editando',
      destructive: true,
      onConfirm: () => {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
        clear();
      },
    });
  }

  function handleDismissBorrador(): void {
    if (items.length === 0) {
      clear();
      return;
    }
    confirm({
      title: '¿Salir del borrador?',
      message: `Tienes ${items.length} producto${items.length > 1 ? 's' : ''} en la lista. Tu progreso está guardado automáticamente en Borradores.\n\n¿Deseas salir y limpiar la pantalla? Podrás retomarlo en cualquier momento desde la pestaña Borradores.`,
      confirmText: 'Salir y limpiar',
      cancelText: 'Continuar editando',
      destructive: false,
      onConfirm: () => {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
        clear();
      },
    });
  }

  function handleClear(): void {
    if (items.length === 0) {
      clear();
      return;
    }
    const hasDraft = borradorId !== null;
    confirm({
      title: hasDraft ? '¿Eliminar borrador y limpiar?' : '¿Limpiar compra?',
      message: hasDraft
        ? `Tienes ${items.length} producto${items.length > 1 ? 's' : ''} en la lista. Se eliminará el borrador guardado y se limpiará la pantalla.`
        : 'Se perderán los ítems agregados.',
      confirmText: hasDraft ? 'Eliminar y limpiar' : 'Limpiar',
      destructive: true,
      onConfirm: async () => {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
        if (hasDraft) {
          await deleteActiveDraft();
          await queryClient.invalidateQueries({ queryKey: borradoresQueryKey('compra') });
        }
        clear();
      },
    });
  }

  return (
    <View style={styles.flex}>
      {/* stickyHeaderIndices apunta al índice 1 — los hijos del ScrollView son
          4 grupos fijos (nunca condicionales) para que el índice no se corra. */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        <View style={styles.headerGroup}>

        {editingCompraId !== null ? (
          <View style={[styles.infoBanner, { backgroundColor: colors.warning + '10', borderColor: colors.warning + '30' }]}>
            <Feather name="rotate-cw" size={15} color={colors.warning} style={styles.infoBannerIcon} />
            <View style={styles.infoBannerTextContainer}>
              <Text style={[styles.infoBannerTitle, { color: colors.warning }]}>
                Editando C-{String(editingCompraId).padStart(4, '0')} para reintentar
              </Text>
              <Text style={[styles.infoBannerSub, { color: colors.textMuted }]}>
                Corrige lo que causó el error y reintenta. No se creará una compra nueva.
              </Text>
            </View>
            <PressableScale
              onPress={handleDismissEditing}
              hitSlop={8}
              activeScale={pressScale.icon}
              accessibilityRole="button"
              accessibilityLabel="Cancelar edición"
            >
              <Feather name="x" size={18} color={colors.textMuted} />
            </PressableScale>
          </View>
        ) : null}

        {borradorId !== null ? (
          <View style={[styles.infoBanner, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Feather name="bookmark" size={15} color={colors.primary} style={styles.infoBannerIcon} />
            <View style={styles.infoBannerTextContainer}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.infoBannerTitle, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
                  Borrador autoguardado{titulo ? `: ${titulo}` : ''}
                </Text>
                {isAutoSaving ? <ActivityIndicator size="small" color={colors.primary} /> : null}
              </View>
              <Text style={[styles.infoBannerSub, { color: colors.textMuted }]}>
                {isAutoSaving
                  ? 'Guardando cambios en segundo plano…'
                  : lastSavedAt
                    ? `Guardado a las ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Al emitir se registrará en Hybrid.`
                    : 'Los cambios se guardan automáticamente. Al emitir se registrará en Hybrid.'}
              </Text>
            </View>
            <PressableScale
              onPress={handleDismissBorrador}
              hitSlop={8}
              activeScale={pressScale.icon}
              accessibilityRole="button"
              accessibilityLabel="Salir del borrador"
            >
              <Feather name="x" size={18} color={colors.textMuted} />
            </PressableScale>
          </View>
        ) : null}

        {/* Banner educativo */}
        <View style={[styles.infoBanner, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
          <Feather name="truck" size={15} color={colors.primary} style={styles.infoBannerIcon} />
          <View style={styles.infoBannerTextContainer}>
            <Text style={[styles.infoBannerTitle, { color: colors.primary }]}>
              Registro Automático en Hybrid
            </Text>
            <Text style={[styles.infoBannerSub, { color: colors.textMuted }]}>
              La compra se registrará sola como documento de mercancías en el POS Hybrid, sin intervención manual.
            </Text>
          </View>
        </View>

        {/* Selector de proveedor */}
        <PressableScale
          style={[
            styles.proveedorBtn,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          activeScale={pressScale.row}
          onPress={() => setProveedorModalVisible(true)}
        >
          <Feather name="user" size={16} color={proveedorCodigo ? colors.primary : colors.textDim} />
          <View style={styles.proveedorBtnText}>
            <Text style={[styles.proveedorLabel, { color: colors.textMuted }]}>PROVEEDOR</Text>
            <Text
              style={[styles.proveedorValue, { color: proveedorCodigo ? colors.text : colors.textDim }]}
              numberOfLines={1}
            >
              {proveedorNombre ?? 'Elegir proveedor…'}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textDim} />
        </PressableScale>

        {isPrivileged && !isDemoActive() ? (
          <PressableScale
            style={[
              styles.proveedorBtn,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
            activeScale={pressScale.row}
            onPress={() => setFacturasModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Facturas de proveedor"
          >
            <Feather name="paperclip" size={16} color={colors.primary} />
            <View style={styles.proveedorBtnText}>
              <Text style={[styles.proveedorLabel, { color: colors.textMuted }]}>FACTURAS DE PROVEEDOR</Text>
              <Text style={[styles.proveedorValue, { color: colors.text }]} numberOfLines={1}>
                Foto o carga manual
              </Text>
            </View>
            <FacturaBorradoresBadge />
            <Feather name="chevron-right" size={18} color={colors.textDim} />
          </PressableScale>
        ) : null}

        <DescuentoGeneralCard
          descuentos={descuentosGenerales}
          itemCount={items.length}
          affectedCount={items.filter(it => !it.excluir_descuento_general).length}
          onChange={setDescuentosGenerales}
          onValidationChange={setGeneralDiscountInvalid}
        />

        </View>

        {/* Agregar producto CTAs — quedan fijos arriba al hacer scroll, así se
            puede seguir agregando sin volver al tope de la lista. */}
        <View style={[styles.stickyAddGroup, { backgroundColor: colors.bg }]}>
          <View style={styles.addProductRow}>
            <PressableScale
              style={[
                styles.addProductBtn,
                { borderColor: colors.primary, backgroundColor: colors.primaryFaded },
              ]}
              onPress={() => setProductoModalVisible(true)}
            >
              <Feather name="search" size={16} color={colors.primary} />
              <Text style={[styles.addProductText, { color: colors.primary }]}>Buscar existente</Text>
            </PressableScale>

            <PressableScale
              style={[
                styles.addProductBtn,
                { borderColor: colors.primary, backgroundColor: colors.primaryFaded },
              ]}
              onPress={() => setProductoNuevoModalVisible(true)}
            >
              <Feather name="plus" size={16} color={colors.primary} />
              <Text style={[styles.addProductText, { color: colors.primary }]}>Producto nuevo</Text>
            </PressableScale>
          </View>
        </View>

        <View style={styles.bodyGroup}>

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="shopping-cart" size={36} color={colors.textDim} />
            <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Compra vacía</Text>
            <Text style={[styles.emptySub, { color: colors.textDim }]}>
              Toca "Agregar producto" para{'\n'}empezar a armar la compra
            </Text>
          </View>
        ) : (
          <>
            {itemsRecienteArriba.map(item => (
              <CompraItemCard
                key={item.codigo_producto}
                item={item}
                descuentosGenerales={descuentosGenerales}
                existencia={item.es_nuevo ? null : existencias?.[item.codigo_producto] ?? null}
                colision={colisiones?.[item.codigo_producto] ?? null}
                onRemove={() => removeItem(item.codigo_producto)}
                onUpdate={updates => updateItem(item.codigo_producto, updates)}
                onDiscountValidityChange={invalid => handleItemDiscountValidity(item.codigo_producto, invalid)}
              />
            ))}

            {/* Total */}
            <View
              testID="compra-total-card"
              style={[styles.totalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {ahorroTotal > 0 ? (
                <View style={styles.totalBreakdown}>
                  <View style={styles.totalRow}>
                    <Text style={[styles.totalSubLabel, { color: colors.textMuted }]}>Subtotal lista</Text>
                    <Text style={[styles.totalSubValue, { color: colors.textMuted }]}>{formatUSD(totalLista)}</Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={[styles.totalSubLabel, { color: colors.success }]}>Ahorro descuentos</Text>
                    <Text style={[styles.totalSubValue, { color: colors.success }]}>-{formatUSD(ahorroTotal)}</Text>
                  </View>
                  <View style={[styles.totalDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.totalRow}>
                    <Text style={[styles.totalLabel, { color: colors.textMuted }]}>TOTAL NETO (HYBRID)</Text>
                    <Text style={[styles.totalValue, { color: colors.primary }]}>{formatUSD(total)}</Text>
                  </View>
                </View>
              ) : (
                <>
                  <Text style={[styles.totalLabel, { color: colors.textMuted }]}>TOTAL COMPRA</Text>
                  <Text style={[styles.totalValue, { color: colors.primary }]}>{formatUSD(total)}</Text>
                </>
              )}
            </View>

            {/* Número de orden/factura */}
            <View style={[styles.notaCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.notaLabel, { color: colors.textMuted }]}>Número de orden / factura (opcional)</Text>
              <TextInput
                style={[styles.numeroDocInput, { color: colors.text }]}
                placeholder="En blanco = número automático"
                placeholderTextColor={colors.textDim}
                value={numeroDocumento}
                onChangeText={v => setNumeroDocumento(v.replace(/\D/g, ''))}
                keyboardType="number-pad"
              />
            </View>

            {/* Nota */}
            <View style={[styles.notaCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.notaLabel, { color: colors.textMuted }]}>Nota de la compra</Text>
              <TextInput
                style={[styles.notaInput, { color: colors.text }]}
                placeholder="Observaciones…"
                placeholderTextColor={colors.textDim}
                value={nota}
                onChangeText={setNota}
                multiline
                numberOfLines={2}
              />
            </View>
          </>
        )}

        </View>

        <View style={{ height: items.length > 0 ? 220 : 40 }} />
      </ScrollView>

      {/* Submit bar */}
      {items.length > 0 && (
        <View
          dataSet={HIDE_ON_KEYBOARD}
          style={[
            styles.submitBar,
            {
              backgroundColor: colors.surface,
              borderColor:     colors.border,
              bottom:          isDesktop ? undefined : (Platform.OS === 'web' ? 82 : insets.bottom + 82),
              position:        isDesktop ? 'relative' : 'absolute',
            },
            isDesktop && styles.submitBarWeb,
          ]}
        >
          <View style={styles.submitTopRow}>
            <View style={styles.submitInfo}>
              <Text
                style={[styles.submitCount, { color: colors.text }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {items.length} ítem{items.length > 1 ? 's' : ''} · {formatUSD(total)}
              </Text>
            </View>
            {facturaVinculada ? (
              <View testID="factura-submit-block" style={styles.infoBanner}>
                <Text style={{ color: colors.text }}>Esta compra vinculada sigue como borrador editable. La emisión está bloqueada hasta resolver la regla de inventario.</Text>
              </View>
            ) : null}
            <PressableScale
              testID="compra-submit"
              style={[
                styles.submitBtn,
                { backgroundColor: colors.primary },
              ]}
              dimmed={!canSubmit}
              onPress={handleSubmit}
              disabled={!canSubmit}
              accessibilityState={{ disabled: !canSubmit }}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <>
                  <Feather name={editingCompraId !== null ? 'rotate-cw' : 'send'} size={16} color={colors.onPrimary} />
                  <Text style={[styles.submitBtnText, { color: colors.onPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                    {editingCompraId !== null ? 'Reintentar compra' : 'Emitir compra'}
                  </Text>
                </>
              )}
            </PressableScale>
          </View>

          {/* Acciones secundarias en su propia fila: separadas y protegidas contra desbordamiento */}
          <View style={[styles.secondaryActions, { borderTopColor: colors.border }]}>
            <PressableScale onPress={() => setBorradorModalVisible(true)} hitSlop={10} style={styles.secondaryBtn}>
              <Feather name="bookmark" size={12} color={colors.primary} />
              <Text style={[styles.saveDraftText, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
                {borradorId !== null ? 'Actualizar borrador' : 'Guardar borrador'}
              </Text>
            </PressableScale>
            <PressableScale
              onPress={() => confirm({ title: 'Limpiar compra', message: 'Se perderán los ítems agregados.', confirmText: 'Limpiar', destructive: true, onConfirm: clear })}
              hitSlop={10}
              style={styles.secondaryBtn}
            >
              <Feather name="trash-2" size={12} color={colors.danger} />
              <Text style={[styles.clearText, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
                Limpiar
              </Text>
            </PressableScale>
          </View>
        </View>
      )}

      <ProveedorPickerModal
        visible={proveedorModalVisible}
        canCreate={isPrivileged}
        onClose={() => setProveedorModalVisible(false)}
        onSelect={handleSelectProveedor}
        onCreate={() => {
          setProveedorModalVisible(false);
          setProveedorNuevoModalVisible(true);
        }}
      />
      <RegistroProveedorModal
        visible={proveedorNuevoModalVisible}
        onClose={() => setProveedorNuevoModalVisible(false)}
        proceedLabel="Usar en Compra"
        onRegistered={(_id, data) => {
          if (data) {
            setProveedor(data.codigo, data.nombre);
          }
        }}
      />
      <ProductoPickerModal
        visible={productoModalVisible}
        onClose={() => setProductoModalVisible(false)}
        onSelect={handleSelectProducto}
      />
      <ProductoNuevoModal
        visible={productoNuevoModalVisible}
        existingCodes={items.map(i => i.codigo_producto)}
        descuentosGenerales={descuentosGenerales}
        onClose={() => setProductoNuevoModalVisible(false)}
        onAdd={addItem}
      />
      <GuardarBorradorModal
        visible={borradorModalVisible}
        defaultTitulo={titulo}
        placeholder={proveedorNombre ? `Compra ${proveedorNombre}` : 'Ej: Reposición tornillería'}
        itemCount={items.length}
        isSaving={isLoading}
        onClose={() => setBorradorModalVisible(false)}
        onSave={handleSaveDraft}
      />
      <FacturasProveedorModal
        visible={facturasModalVisible}
        proveedorCodigo={proveedorCodigo}
        proveedorNombre={proveedorNombre}
        onClose={() => setFacturasModalVisible(false)}
      />
    </View>
  );
}

// ── Descuento general ─────────────────────────────────────────────────────────

interface DescuentoGeneralCardProps {
  descuentos:         number[];
  itemCount:          number;
  affectedCount:      number;
  onChange:           (descuentos: number[]) => void;
  onValidationChange: (invalid: boolean) => void;
}

function DescuentoGeneralCard({
  descuentos,
  itemCount,
  affectedCount,
  onChange,
  onValidationChange,
}: DescuentoGeneralCardProps): React.JSX.Element {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState<boolean>(() => descuentos.length > 0);
  const isOpen = expanded || descuentos.length > 0;
  const { porcentajeEfectivoStr } = calcularPorcentajeEfectivo(descuentos);
  const sumaLineal = descuentos.reduce((acc, d) => acc + d, 0);

  if (!isOpen) {
    return (
      <PressableScale
        testID="compra-desc-general-toggle"
        style={[
          styles.proveedorBtn,
          { borderColor: colors.border, backgroundColor: colors.surface },
        ]}
        activeScale={pressScale.row}
        onPress={() => setExpanded(true)}
        accessibilityRole="button"
        accessibilityLabel="Agregar descuento general"
      >
        <Feather name="percent" size={16} color={colors.textDim} />
        <View style={styles.proveedorBtnText}>
          <Text style={[styles.proveedorLabel, { color: colors.textMuted }]}>DESCUENTO GENERAL (OPCIONAL)</Text>
          <Text style={[styles.proveedorValue, { color: colors.textDim }]} numberOfLines={1}>
            Sin descuento general
          </Text>
        </View>
        <Text style={[styles.descAddHint, { color: colors.primary }]}>+ Agregar</Text>
      </PressableScale>
    );
  }

  return (
    <View
      testID="compra-desc-general-panel"
      style={[
        styles.descGeneralCard,
        {
          borderColor:     descuentos.length > 0 ? colors.primary + '55' : colors.border,
          backgroundColor: colors.surface,
        },
      ]}
    >
      <View style={styles.descGeneralHeader}>
        <View style={styles.descGeneralTitleRow}>
          <Feather name="percent" size={14} color={colors.primary} />
          <Text style={[styles.descGeneralTitle, { color: colors.textMuted }]}>DESCUENTO GENERAL</Text>
          {descuentos.length > 0 ? (
            <View
              testID="compra-desc-general-badge"
              style={[styles.descBadge, { backgroundColor: colors.primaryFaded, borderColor: colors.primary + '55' }]}
            >
              <Text style={[styles.descBadgeText, { color: colors.primary }]}>
                -{porcentajeEfectivoStr}%{descuentos.length > 1 ? ' REAL' : ''}
              </Text>
            </View>
          ) : null}
        </View>
        <PressableScale
          testID="compra-desc-general-clear"
          onPress={() => {
            onChange([]);
            onValidationChange(false);
            setExpanded(false);
          }}
          hitSlop={8}
          activeScale={pressScale.icon}
          accessibilityRole="button"
          accessibilityLabel={descuentos.length > 0 ? 'Quitar descuento general' : 'Cerrar descuento general'}
        >
          <Text style={[styles.descClearBtnText, { color: colors.textMuted }]}>
            {descuentos.length > 0 ? 'Quitar' : 'Cerrar'}
          </Text>
        </PressableScale>
      </View>

      <CascadeDiscountInput
        value={descuentos}
        onChange={onChange}
        onValidationChange={onValidationChange}
        placeholder="Ej: 10 o 20 + 5"
        autoFocus={expanded && descuentos.length === 0}
        testIDPrefix="compra-desc-general"
        accessibilityLabel="Descuento general de la compra"
      />

      <Text testID="compra-desc-general-helper" style={[styles.descHelperText, { color: colors.textMuted }]}>
        {descuentos.length > 1
          ? `Cascada: ${formatearCascada(descuentos)} = -${porcentajeEfectivoStr}% real (no ${sumaLineal}%).`
          : 'Aplica a toda la compra; usa + para encadenar otro %.'}
        {itemCount > 0
          ? ` Aplica a ${affectedCount} de ${itemCount} ítem${itemCount > 1 ? 's' : ''}.`
          : ''}
      </Text>
    </View>
  );
}

// ── Item card ─────────────────────────────────────────────────────────────────

interface CompraItemCardProps {
  item:                     CompraDraftItem;
  descuentosGenerales:      number[];
  existencia:               number | null;          // saldo actual; null para productos nuevos o aún sin cargar
  colision:                 ColisionCodigo | null;  // producto que HybridLite cargaría en su lugar
  onRemove:                 () => void;
  onUpdate:                 (updates: Partial<CompraDraftItem>) => void;
  onDiscountValidityChange: (invalid: boolean) => void;
}

function CompraItemCard({
  item,
  descuentosGenerales,
  existencia,
  colision,
  onRemove,
  onUpdate,
  onDiscountValidityChange,
}: CompraItemCardProps): React.JSX.Element {
  const { colors, formatUSD } = useTheme();
  const costoLista = item.costo_lista !== undefined ? item.costo_lista : item.costo;
  const [cantidadInput, setCantidadInput] = useState<string>(() =>
    formatCantidadConAjuste(item.cantidad, item.es_ajuste)
  );
  const [costoInput, setCostoInput] = useState<string>(String(costoLista));
  const [precioInput, setPrecioInput] = useState<string>(String(item.precio));

  const descuentosEfectivos = resolverDescuentosEfectivos(
    item.descuentos,
    descuentosGenerales,
    item.excluir_descuento_general,
  );
  const resultadoDescuento = calcularCostoConDescuento(costoLista, descuentosEfectivos);
  const generalEfectivo = calcularPorcentajeEfectivo(descuentosGenerales);

  // Producto en negativo: al emitir se cargan también las unidades faltantes
  // para que el saldo final sea la cantidad escrita, no cantidad + negativo.
  const faltante = item.es_ajuste ? 0 : faltantePorNegativo(existencia);
  const cantidadACargar = item.cantidad + faltante;
  const subtotal = cantidadACargar * item.costo;
  const decimalKeyboard = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad';

  // Estos valores pueden cambiar por fuera de la tarjeta: volver a agregar el
  // mismo producto lo reemplaza con los valores frescos de la DB. Sin esto los
  // inputs se quedan con lo viejo. Se compara el número y el modo ajuste para
  // no pisar lo que el usuario está tecleando (incluidos los puntos intermedios).
  useEffect(() => {
    setCantidadInput(prev => {
      const parsed = parseCantidadConAjuste(prev);
      const targetAjuste = Boolean(item.es_ajuste);
      if (parsed.cantidad === item.cantidad && parsed.esAjuste === targetAjuste) {
        return prev;
      }
      return formatCantidadConAjuste(item.cantidad, targetAjuste);
    });
  }, [item.cantidad, item.es_ajuste]);

  useEffect(() => {
    setCostoInput(prev => (parseFloat(prev) === costoLista ? prev : String(costoLista)));
  }, [costoLista]);

  useEffect(() => {
    setPrecioInput(prev => (parseFloat(prev) === item.precio ? prev : String(item.precio)));
  }, [item.precio]);

  // Margen IVA-aware: precio incluye IVA 16%, costo no. Misma fórmula que
  // getMarginPct en ProductRow. null hasta que haya costo y precio.
  const precioSinIva = item.precio / 1.16;
  const margin =
    item.precio > 0 && item.costo > 0
      ? ((precioSinIva - item.costo) / precioSinIva) * 100
      : null;
  const marginColor =
    margin === null ? colors.textDim
    : margin < 0    ? colors.danger
    : margin < 15   ? colors.warning
    : colors.success;

  function handleCantidadChange(v: string): void {
    const { display, cantidad, esAjuste } = parseCantidadConAjuste(v);
    setCantidadInput(display);
    if (!isNaN(cantidad) && cantidad >= 0) {
      onUpdate({ cantidad, es_ajuste: esAjuste });
    } else if (esAjuste !== Boolean(item.es_ajuste)) {
      onUpdate({ es_ajuste: esAjuste });
    }
  }

  function handleCostoChange(v: string): void {
    const val = v.replace(',', '.');
    setCostoInput(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 0) onUpdate({ costo_lista: n });
  }

  function handlePrecioChange(v: string): void {
    const val = v.replace(',', '.');
    setPrecioInput(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 0) onUpdate({ precio: n });
  }

  return (
    <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.itemTop}>
        <View style={styles.itemInfo}>
          <View style={styles.itemNameRow}>
            {item.es_nuevo ? (
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextInput
                  style={[styles.itemNameInput, { color: colors.text }]}
                  value={item.descripcion}
                  onChangeText={v => onUpdate({ descripcion: v.toUpperCase() })}
                  autoCapitalize="characters"
                  maxLength={DESCRIPCION_MAX}
                />
                {item.descripcion.length > DESCRIPCION_MAX - 10 ? (
                  <Text style={[styles.itemDescCounter, { color: item.descripcion.length > DESCRIPCION_MAX ? colors.danger : colors.textDim }]}>
                    {item.descripcion.length}/{DESCRIPCION_MAX}
                  </Text>
                ) : null}
              </View>
            ) : (
              <ScrollView
                testID="compra-item-name-scroll"
                horizontal
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                style={styles.itemNameScroll}
              >
                <Text
                  style={[styles.itemName, { color: colors.text }]}
                  numberOfLines={Platform.OS === 'web' ? undefined : 1}
                >
                  {item.descripcion}
                </Text>
              </ScrollView>
            )}
            {item.es_nuevo ? (
              <View style={[styles.nuevoBadge, { backgroundColor: colors.primary + '20', borderColor: colors.primary + '40' }]}>
                <Text style={[styles.nuevoBadgeText, { color: colors.primary }]}>NUEVO</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.itemCode, { color: colors.textMuted }]}>{item.codigo_producto}</Text>
          {item.referencia ? (
            <Text style={[styles.itemRef, { color: colors.textMuted }]} numberOfLines={1}>
              Ref: {item.referencia}
            </Text>
          ) : null}
        </View>
        <PressableScale onPress={onRemove} hitSlop={8} style={styles.removeBtn} activeScale={pressScale.icon}>
          <Feather name="x" size={16} color={colors.textDim} />
        </PressableScale>
      </View>

      <View style={styles.itemBottom}>
        <View style={styles.fieldColumn}>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>CANTIDAD</Text>
          <TextInput
            testID="compra-item-cantidad-input"
            style={[styles.fieldInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
            keyboardType={decimalKeyboard}
            value={cantidadInput}
            onChangeText={handleCantidadChange}
            selectTextOnFocus
          />
        </View>

        <View style={styles.fieldColumn}>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
            {resultadoDescuento.tieneDescuento ? 'COSTO LISTA ($)' : 'COSTO ($)'}
          </Text>
          <TextInput
            testID={`compra-item-costo-input-${item.codigo_producto}`}
            style={[styles.fieldInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
            keyboardType={decimalKeyboard}
            value={costoInput}
            onChangeText={handleCostoChange}
            selectTextOnFocus
          />
        </View>

        <View style={styles.fieldColumn}>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>PRECIO ($)</Text>
          <TextInput
            style={[styles.fieldInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
            keyboardType={decimalKeyboard}
            value={precioInput}
            onChangeText={handlePrecioChange}
            selectTextOnFocus
          />
        </View>
      </View>

      {/* Descuento por producto + herencia de descuento general */}
      <View style={styles.discountStrip}>
        <CascadeDiscountInput
          compact
          placeholder="Desc %"
          value={item.descuentos ?? []}
          onChange={descuentos => onUpdate({ descuentos })}
          onValidationChange={onDiscountValidityChange}
          testIDPrefix={`compra-item-desc-${item.codigo_producto}`}
          accessibilityLabel={`Descuento para ${item.descripcion}`}
        />
        {descuentosGenerales.length > 0 ? (
          <PressableScale
            testID={`compra-item-toggle-general-${item.codigo_producto}`}
            onPress={() => onUpdate({ excluir_descuento_general: !item.excluir_descuento_general })}
            hitSlop={6}
            activeScale={pressScale.button}
            accessibilityRole="button"
            accessibilityLabel={item.excluir_descuento_general ? 'Incluir descuento general' : 'Excluir descuento general'}
            style={[
              styles.generalTogglePill,
              item.excluir_descuento_general
                ? { borderColor: colors.border, backgroundColor: colors.surfaceAlt }
                : { borderColor: colors.primary + '55', backgroundColor: colors.primaryFaded },
            ]}
          >
            <Feather
              name={item.excluir_descuento_general ? 'slash' : 'check'}
              size={11}
              color={item.excluir_descuento_general ? colors.textMuted : colors.primary}
            />
            <Text
              style={[
                styles.generalToggleText,
                { color: item.excluir_descuento_general ? colors.textMuted : colors.primary },
              ]}
              numberOfLines={1}
            >
              {item.excluir_descuento_general ? 'Sin gral' : `Gral -${generalEfectivo.porcentajeEfectivoStr}%`}
            </Text>
          </PressableScale>
        ) : null}
      </View>

      {resultadoDescuento.tieneDescuento ? (
        <View
          testID={`compra-item-costo-neto-${item.codigo_producto}`}
          style={[
            styles.netCostBox,
            {
              backgroundColor: resultadoDescuento.costoNeto <= 0 ? colors.danger + '12' : colors.surfaceAlt,
              borderColor:     resultadoDescuento.costoNeto <= 0 ? colors.danger + '40' : colors.border,
            },
          ]}
        >
          <View style={styles.netCostTopRow}>
            <Text style={[styles.netCostLabel, { color: colors.textMuted }]}>NETO HYBRID</Text>
            <View style={styles.netCostValuesRow}>
              <Text style={[styles.netCostStrike, { color: colors.textDim }]}>
                {formatUSD(costoLista)}
              </Text>
              <Feather name="arrow-right" size={11} color={colors.textMuted} />
              <Text
                style={[
                  styles.netCostFinal,
                  { color: resultadoDescuento.costoNeto <= 0 ? colors.danger : colors.primary },
                ]}
              >
                {formatUSD(resultadoDescuento.costoNeto)}
              </Text>
              <View
                style={[
                  styles.netCostPctPill,
                  {
                    backgroundColor: (resultadoDescuento.costoNeto <= 0 ? colors.danger : colors.success) + '1A',
                    borderColor:     (resultadoDescuento.costoNeto <= 0 ? colors.danger : colors.success) + '45',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.netCostPctText,
                    { color: resultadoDescuento.costoNeto <= 0 ? colors.danger : colors.success },
                  ]}
                >
                  -{resultadoDescuento.porcentajeEfectivoStr}%
                </Text>
              </View>
            </View>
          </View>
          {resultadoDescuento.costoNeto <= 0 ? (
            <Text style={[styles.netCostNote, { color: colors.danger }]}>
              El costo neto queda en $0.00 — revisa el costo o descuento.
            </Text>
          ) : resultadoDescuento.fueRedondeado ? (
            <Text testID={`compra-item-redondeo-${item.codigo_producto}`} style={[styles.netCostNote, { color: colors.textMuted }]}>
              Redondeado a 2 dec. para Hybrid (exacto ${resultadoDescuento.costoNetoExactoStr})
            </Text>
          ) : null}
        </View>
      ) : null}

      {item.es_ajuste ? (
        <View
          testID="compra-item-ajuste-aviso"
          style={[styles.negativoAviso, { backgroundColor: colors.primary + '14', borderColor: colors.primary + '35' }]}
        >
          <Feather name="sliders" size={12} color={colors.primary} />
          <Text style={[styles.negativoAvisoText, { color: colors.primary }]}>
            {existencia !== null && !item.es_nuevo
              ? `En ${existencia} · no se suma: se ajustará la existencia a ${item.cantidad}`
              : `Ajuste fijo (...) · no se suma: la existencia quedará en ${item.cantidad}`}
          </Text>
        </View>
      ) : faltante > 0 ? (
        <View style={[styles.negativoAviso, { backgroundColor: colors.warning + '14', borderColor: colors.warning + '30' }]}>
          <Feather name="corner-down-right" size={12} color={colors.warning} />
          <Text style={[styles.negativoAvisoText, { color: colors.warning }]}>
            En {existencia} · se cargarán {cantidadACargar} para que quede en {item.cantidad}
          </Text>
        </View>
      ) : null}

      {colision ? (
        <View style={[styles.negativoAviso, { backgroundColor: colors.danger + '14', borderColor: colors.danger + '30' }]}>
          <Feather name="alert-triangle" size={12} color={colors.danger} />
          <Text style={[styles.negativoAvisoText, { color: colors.danger }]}>
            Código en conflicto · Hybrid cargaría {colision.codigoInterceptor} · {colision.descripcion}
          </Text>
        </View>
      ) : null}

      <View style={styles.subtotalRow}>
        {margin !== null ? (
          <View style={[styles.marginPill, { backgroundColor: marginColor + '18', borderColor: marginColor + '38' }]}>
            <Feather name={margin < 0 ? 'trending-down' : 'trending-up'} size={11} color={marginColor} />
            <Text style={[styles.marginText, { color: marginColor }]}>{margin.toFixed(0)}% margen</Text>
          </View>
        ) : (
          <View style={[styles.marginPill, { backgroundColor: colors.warning + '14', borderColor: colors.warning + '30' }]}>
            <Feather name="alert-circle" size={11} color={colors.warning} />
            <Text style={[styles.marginText, { color: colors.warning }]}>falta costo/precio</Text>
          </View>
        )}
        <View style={styles.subtotalRight}>
          <Text style={[styles.subtotalLabel, { color: colors.textMuted }]}>Subtotal </Text>
          <Text style={[styles.subtotalValue, { color: colors.text }]}>{formatUSD(subtotal)}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Modal: selector de proveedor ─────────────────────────────────────────────

interface ProveedorPickerModalProps {
  visible:   boolean;
  canCreate: boolean;
  onClose:   () => void;
  onSelect:  (proveedor: Proveedor) => void;
  onCreate:  () => void;
}

function ProveedorPickerModal({ visible, canCreate, onClose, onSelect, onCreate }: ProveedorPickerModalProps): React.JSX.Element {
  const { colors } = useTheme();
  const { data: proveedores, isLoading } = useProveedores();
  const [search, setSearch] = useState<string>('');

  const filtered = (proveedores ?? []).filter(p => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return p.nombre.toLowerCase().includes(term) || (p.rif ?? '').toLowerCase().includes(term);
  });

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'android' ? 'height' : undefined}>
        <View style={[styles.modalContent, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Elegir proveedor</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Feather name="search" size={16} color={colors.textDim} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Buscar por nombre o RIF…"
              placeholderTextColor={colors.textDim}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>

          {canCreate ? (
            <PressableScale
              style={[styles.nuevoProveedorBtn, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]}
              onPress={onCreate}
            >
              <Feather name="plus" size={16} color={colors.primary} />
              <Text style={[styles.addProductText, { color: colors.primary }]}>Nuevo proveedor</Text>
            </PressableScale>
          ) : null}

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={p => p.codigo}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [
                    styles.pickerRow,
                    { borderColor: colors.border },
                    pressed && { backgroundColor: colors.primaryFaded },
                  ]}
                  onPress={() => onSelect(item)}
                >
                  <Text style={[styles.pickerRowTitle, { color: colors.text }]} numberOfLines={1}>
                    {item.nombre}
                  </Text>
                  {item.rif ? (
                    <Text style={[styles.pickerRowSub, { color: colors.textMuted }]} numberOfLines={1}>
                      {item.rif}
                    </Text>
                  ) : null}
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Feather name="users" size={28} color={colors.textDim} />
                  <Text style={[styles.emptySub, { color: colors.textDim }]}>Sin proveedores</Text>
                </View>
              }
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Modal: selector de producto ──────────────────────────────────────────────

interface ProductoPickerModalProps {
  visible:        boolean;
  initialSearch?: string;
  onClose:        () => void;
  onSelect:       (producto: Producto) => void;
}

function ProductoPickerModal({ visible, initialSearch = '', onClose, onSelect }: ProductoPickerModalProps): React.JSX.Element {
  const { colors } = useTheme();
  const [search, setSearch] = useState<string>('');
  const [scannerVisible, setScannerVisible] = useState<boolean>(false);
  const { productos, isLoading } = useProductos(search);

  useEffect(() => {
    if (visible) {
      setSearch(initialSearch ? normalizeSearchTerm(initialSearch) : '');
      setScannerVisible(false);
    }
  }, [visible, initialSearch]);

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'android' ? 'height' : undefined}>
        <View style={[styles.modalContent, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Agregar producto</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Feather name="search" size={16} color={colors.textDim} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Buscar por código, descripción o barras…"
              placeholderTextColor={colors.textDim}
              value={search}
              onChangeText={v => setSearch(normalizeSearchTerm(v))}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect={false}
              spellCheck={false}
              autoFocus
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8} style={{ padding: 4, marginRight: 2 }}>
                <Feather name="x-circle" size={16} color={colors.textDim} />
              </Pressable>
            )}
            <PressableScale
              style={[styles.scanBtn, { backgroundColor: colors.primaryFaded, borderColor: colors.primary + '40' }]}
              onPress={() => setScannerVisible(true)}
              hitSlop={4}
            >
              <Feather name="camera" size={16} color={colors.primary} />
            </PressableScale>
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : (
            <FlatList
              data={productos}
              keyExtractor={p => p.codigo_interno}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isOut = item.existencia <= 0;
                const badgeBg = isOut ? colors.danger + '1A' : colors.surface;
                const badgeBorder = isOut ? colors.danger + '40' : colors.border;
                const badgeTextColor = isOut ? colors.danger : colors.textMuted;

                return (
                  <PressableScale
                    activeScale={pressScale.row}
                    style={[
                      styles.pickerRow,
                      { borderColor: colors.border },
                    ]}
                    onPress={() => onSelect(item)}
                  >
                    <View style={styles.pickerRowLeft}>
                      <Text style={[styles.pickerRowTitle, { color: colors.text }]} numberOfLines={1}>
                        {item.descripcion}
                      </Text>
                      <Text style={[styles.pickerRowSub, { color: colors.textMuted }]} numberOfLines={1}>
                        {item.codigo_interno}
                        {item.referencia ? `  ·  Ref: ${item.referencia}` : ''}
                        {item.codigo_barras ? `  ·  CB: ${item.codigo_barras}` : ''}
                      </Text>
                    </View>
                    <View style={[styles.pickerStockBadge, { backgroundColor: badgeBg, borderColor: badgeBorder }]}>
                      <Text style={[styles.pickerStockText, { color: badgeTextColor }]}>
                        {item.existencia} {item.unidad || 'uds'}
                      </Text>
                    </View>
                  </PressableScale>
                );
              }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Feather name="package" size={28} color={colors.textDim} />
                  <Text style={[styles.emptySub, { color: colors.textDim }]}>Sin resultados</Text>
                </View>
              }
            />
          )}
        </View>
      </KeyboardAvoidingView>
      <BarcodeScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={(data) => {
          setSearch(normalizeSearchTerm(data));
          setScannerVisible(false);
        }}
      />
    </Modal>
  );
}

// ── Modal: producto nuevo ────────────────────────────────────────────────────

interface ProductoNuevoModalProps {
  visible:             boolean;
  existingCodes:       string[];
  descuentosGenerales: number[];
  onClose:             () => void;
  onAdd:               (item: CompraDraftItem) => void;
}

function ProductoNuevoModal({
  visible,
  existingCodes,
  descuentosGenerales,
  onClose,
  onAdd,
}: ProductoNuevoModalProps): React.JSX.Element {
  const { colors, formatUSD } = useTheme();
  const [codigo, setCodigo] = useState<string>('');
  const [descripcion, setDescripcion] = useState<string>('');
  const [referencia, setReferencia] = useState<string>('');
  const [cantidadInput, setCantidadInput] = useState<string>('1');
  const [costoInput, setCostoInput] = useState<string>('');
  const [precioInput, setPrecioInput] = useState<string>('');
  const [descuentos, setDescuentos] = useState<number[]>([]);
  const [excluirGeneral, setExcluirGeneral] = useState<boolean>(false);
  const [discountInvalid, setDiscountInvalid] = useState<boolean>(false);
  const [scannerTarget, setScannerTarget] = useState<'codigo' | 'referencia' | null>(null);

  const [checkingCode, setCheckingCode] = useState<boolean>(false);
  const [existingProductInDb, setExistingProductInDb] = useState<{ codigo_interno: string; descripcion: string } | null>(null);

  const decimalKeyboard = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad';

  useEffect(() => {
    const trimmed = codigo.trim().toUpperCase();
    if (!trimmed) {
      setExistingProductInDb(null);
      setCheckingCode(false);
      return;
    }

    let isMounted = true;
    setCheckingCode(true);

    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('productos')
          .select('codigo_interno, descripcion')
          .or(buildBarcodeSearchVariants(trimmed).flatMap(v => [`codigo_interno.ilike.${v}`, `codigo_barras.ilike.${v}`]).join(','))
          .limit(1)
          .maybeSingle();

        if (isMounted) {
          if (!error && data) {
            setExistingProductInDb(data);
          } else {
            setExistingProductInDb(null);
          }
          setCheckingCode(false);
        }
      } catch {
        if (isMounted) {
          setExistingProductInDb(null);
          setCheckingCode(false);
        }
      }
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [codigo]);

  function resetForm(): void {
    setCodigo('');
    setDescripcion('');
    setReferencia('');
    setCantidadInput('1');
    setCostoInput('');
    setPrecioInput('');
    setDescuentos([]);
    setExcluirGeneral(false);
    setDiscountInvalid(false);
    setExistingProductInDb(null);
    setCheckingCode(false);
  }

  function handleClose(): void {
    resetForm();
    onClose();
  }

  const parsedCostoPreview = parseFloat(costoInput.replace(',', '.'));
  const parsedPrecioPreview = parseFloat(precioInput.replace(',', '.'));
  const descuentosEfectivosPreview = resolverDescuentosEfectivos(descuentos, descuentosGenerales, excluirGeneral);
  const previewResultado = calcularCostoConDescuento(
    !isNaN(parsedCostoPreview) && parsedCostoPreview > 0 ? parsedCostoPreview : 0,
    descuentosEfectivosPreview,
  );
  const generalEfectivoModal = calcularPorcentajeEfectivo(descuentosGenerales);
  const previewMargin =
    !isNaN(parsedPrecioPreview) && parsedPrecioPreview > 0 && previewResultado.costoNeto > 0
      ? (((parsedPrecioPreview / 1.16) - previewResultado.costoNeto) / (parsedPrecioPreview / 1.16)) * 100
      : null;

  async function handleAdd(): Promise<void> {
    const codigoTrim = codigo.trim().toUpperCase();
    const descripcionTrim = descripcion.trim();
    const { cantidad, esAjuste } = parseCantidadConAjuste(cantidadInput);
    const costoLista = parseFloat(costoInput.replace(',', '.'));
    const precio = parseFloat(precioInput.replace(',', '.'));

    if (!codigoTrim) {
      notify('Error', 'El código es obligatorio');
      return;
    }
    if (checkingCode) {
      notify('Verificando', 'Por favor espera a que finalice la verificación del código.');
      return;
    }
    if (existingProductInDb) {
      notify(
        'Código ya registrado',
        `El código "${codigoTrim}" ya pertenece al producto "${existingProductInDb.descripcion}" en el sistema. No se puede crear como producto nuevo.`
      );
      return;
    }
    if (existingCodes.includes(codigoTrim)) {
      notify('Error', 'Ya agregaste ese código a la compra actual');
      return;
    }

    // Verificación final sincrónica con la base de datos por seguridad
    const { data: existingCheck } = await supabase
      .from('productos')
      .select('codigo_interno, descripcion')
      .or(buildBarcodeSearchVariants(codigoTrim).flatMap(v => [`codigo_interno.ilike.${v}`, `codigo_barras.ilike.${v}`]).join(','))
      .limit(1)
      .maybeSingle();

    if (existingCheck) {
      setExistingProductInDb(existingCheck);
      notify(
        'Código ya registrado',
        `El producto "${existingCheck.descripcion}" (${existingCheck.codigo_interno}) ya existe en el sistema. Selecciónalo desde la lista de productos.`
      );
      return;
    }

    if (!descripcionTrim) {
      notify('Error', 'La descripción es obligatoria');
      return;
    }
    if (descripcionTrim.length > DESCRIPCION_MAX) {
      notify('Error', `La descripción no puede superar los ${DESCRIPCION_MAX} caracteres (el campo de Hybrid la trunca y la compra se cancela).`);
      return;
    }
    if (isNaN(cantidad) || cantidad <= 0) {
      notify('Error', 'La cantidad debe ser mayor a 0');
      return;
    }
    if (isNaN(costoLista) || costoLista <= 0) {
      notify('Error', 'El costo es obligatorio');
      return;
    }
    if (discountInvalid) {
      notify('Error', 'El descuento debe ser menor a 100%');
      return;
    }
    const resultado = calcularCostoConDescuento(
      costoLista,
      resolverDescuentosEfectivos(descuentos, descuentosGenerales, excluirGeneral),
    );
    if (!(resultado.costoNeto > 0)) {
      notify('Error', 'El costo neto después del descuento debe ser mayor a $0.00');
      return;
    }
    if (isNaN(precio) || precio < 0) {
      notify('Error', 'El precio es obligatorio');
      return;
    }

    onAdd({
      codigo_producto:           codigoTrim,
      descripcion:               descripcionTrim,
      referencia:                referencia.trim() || null,
      cantidad,
      costo:                     resultado.costoNeto,
      costo_lista:               costoLista,
      descuentos,
      excluir_descuento_general: excluirGeneral,
      precio,
      es_nuevo:                  true,
      es_ajuste:                 esAjuste,
    });
    resetForm();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={handleClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'android' ? 'height' : undefined}>
        <View style={[styles.modalContent, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Producto nuevo</Text>
            <Pressable onPress={handleClose} hitSlop={8}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: colors.textMuted }]}>CÓDIGO</Text>
              <View style={[
                styles.inputWrap,
                {
                  borderColor: existingProductInDb ? colors.danger : colors.border,
                  backgroundColor: colors.surface,
                }
              ]}>
                <TextInput
                  style={[styles.inputWithIcon, { color: colors.text }]}
                  placeholder="Código del producto"
                  placeholderTextColor={colors.textDim}
                  value={codigo}
                  onChangeText={v => setCodigo(normalizeSearchTerm(v))}
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect={false}
                  spellCheck={false}
                />
                <PressableScale onPress={() => setScannerTarget('codigo')} hitSlop={8} activeScale={pressScale.icon}>
                  <Feather name="camera" size={18} color={colors.primary} />
                </PressableScale>
              </View>

              {codigo.trim().length > 0 ? (
                checkingCode ? (
                  <View style={styles.codeStatusRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.codeStatusText, { color: colors.textMuted }]}>
                      Verificando disponibilidad de código en el sistema...
                    </Text>
                  </View>
                ) : existingProductInDb ? (
                  <View style={[styles.codeBanner, { backgroundColor: colors.danger + '15', borderColor: colors.danger + '40' }]}>
                    <Feather name="alert-triangle" size={15} color={colors.danger} style={{ marginTop: 2 }} />
                    <Text style={[styles.codeBannerText, { color: colors.danger }]}>
                      ¡Este código ya existe en el sistema!{'\n'}
                      <Text style={{ fontWeight: '700' }}>{existingProductInDb.descripcion}</Text> ({existingProductInDb.codigo_interno}){'\n'}
                      No puedes crearlo como producto nuevo. Selecciónalo en la lista existente.
                    </Text>
                  </View>
                ) : existingCodes.includes(codigo.trim().toUpperCase()) ? (
                  <View style={[styles.codeBanner, { backgroundColor: colors.warning + '15', borderColor: colors.warning + '40' }]}>
                    <Feather name="alert-circle" size={15} color={colors.warning} />
                    <Text style={[styles.codeBannerText, { color: colors.warning }]}>
                      Este código ya fue agregado a la compra actual.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.codeStatusRow}>
                    <Feather name="check-circle" size={14} color={colors.success ?? '#10b981'} />
                    <Text style={[styles.codeStatusText, { color: colors.success ?? '#10b981' }]}>
                      Código disponible (no existe en inventario)
                    </Text>
                  </View>
                )
              ) : null}
            </View>

            <View style={styles.formField}>
              <View style={styles.formLabelRow}>
                <Text style={[styles.formLabel, { color: colors.textMuted }]}>DESCRIPCIÓN</Text>
                <Text style={[styles.formLabel, { color: descripcion.length > DESCRIPCION_MAX ? colors.danger : colors.textDim }]}>
                  {descripcion.length}/{DESCRIPCION_MAX}
                </Text>
              </View>
              <TextInput
                style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="Descripción del producto"
                placeholderTextColor={colors.textDim}
                value={descripcion}
                onChangeText={v => setDescripcion(normalizeSearchTerm(v))}
                autoCapitalize="characters"
                maxLength={DESCRIPCION_MAX}
                autoComplete="off"
                autoCorrect={false}
                spellCheck={false}
              />
            </View>

            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: colors.textMuted }]}>REFERENCIA (OPCIONAL)</Text>
              <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <TextInput
                  style={[styles.inputWithIcon, { color: colors.text }]}
                  placeholder="Referencia del proveedor"
                  placeholderTextColor={colors.textDim}
                  value={referencia}
                  onChangeText={v => setReferencia(normalizeSearchTerm(v))}
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect={false}
                  spellCheck={false}
                />
                <PressableScale onPress={() => setScannerTarget('referencia')} hitSlop={8} activeScale={pressScale.icon}>
                  <Feather name="camera" size={18} color={colors.primary} />
                </PressableScale>
              </View>
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formField, styles.formFieldFlex]}>
                <Text style={[styles.formLabel, { color: colors.textMuted }]}>CANTIDAD</Text>
                <TextInput
                  testID="producto-nuevo-cantidad-input"
                  style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                  keyboardType={decimalKeyboard}
                  value={cantidadInput}
                  onChangeText={v => setCantidadInput(parseCantidadConAjuste(v).display)}
                  selectTextOnFocus
                />
              </View>

              <View style={[styles.formField, styles.formFieldFlex]}>
                <Text style={[styles.formLabel, { color: colors.textMuted }]}>
                  {previewResultado.tieneDescuento ? 'COSTO LISTA ($)' : 'COSTO ($)'}
                </Text>
                <TextInput
                  testID="producto-nuevo-costo-input"
                  style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                  keyboardType={decimalKeyboard}
                  placeholder="0.00"
                  placeholderTextColor={colors.textDim}
                  value={costoInput}
                  onChangeText={v => setCostoInput(v.replace(',', '.'))}
                  selectTextOnFocus
                />
              </View>

              <View style={[styles.formField, styles.formFieldFlex]}>
                <Text style={[styles.formLabel, { color: colors.textMuted }]}>PRECIO ($)</Text>
                <TextInput
                  testID="producto-nuevo-precio-input"
                  style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                  keyboardType={decimalKeyboard}
                  placeholder="0.00"
                  placeholderTextColor={colors.textDim}
                  value={precioInput}
                  onChangeText={v => setPrecioInput(v.replace(',', '.'))}
                  selectTextOnFocus
                />
              </View>
            </View>

            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: colors.textMuted }]}>DESCUENTO (OPCIONAL)</Text>
              <View style={styles.discountStrip}>
                <CascadeDiscountInput
                  value={descuentos}
                  onChange={setDescuentos}
                  onValidationChange={setDiscountInvalid}
                  placeholder="Ej: 15 o 20 + 5"
                  testIDPrefix="producto-nuevo-desc"
                  accessibilityLabel="Descuento para producto nuevo"
                />
                {descuentosGenerales.length > 0 ? (
                  <PressableScale
                    testID="producto-nuevo-toggle-general"
                    onPress={() => setExcluirGeneral(prev => !prev)}
                    hitSlop={6}
                    activeScale={pressScale.button}
                    accessibilityRole="button"
                    accessibilityLabel={excluirGeneral ? 'Incluir descuento general' : 'Excluir descuento general'}
                    style={[
                      styles.generalTogglePill,
                      excluirGeneral
                        ? { borderColor: colors.border, backgroundColor: colors.surfaceAlt }
                        : { borderColor: colors.primary + '55', backgroundColor: colors.primaryFaded },
                    ]}
                  >
                    <Feather
                      name={excluirGeneral ? 'slash' : 'check'}
                      size={11}
                      color={excluirGeneral ? colors.textMuted : colors.primary}
                    />
                    <Text
                      style={[
                        styles.generalToggleText,
                        { color: excluirGeneral ? colors.textMuted : colors.primary },
                      ]}
                      numberOfLines={1}
                    >
                      {excluirGeneral ? 'Sin gral' : `Gral -${generalEfectivoModal.porcentajeEfectivoStr}%`}
                    </Text>
                  </PressableScale>
                ) : null}
              </View>

              {previewResultado.tieneDescuento ? (
                <View
                  testID="producto-nuevo-costo-neto"
                  style={[styles.netCostBox, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 8 }]}
                >
                  <View style={styles.netCostTopRow}>
                    <Text style={[styles.netCostLabel, { color: colors.textMuted }]}>NETO HYBRID</Text>
                    <View style={styles.netCostValuesRow}>
                      <Text style={[styles.netCostStrike, { color: colors.textDim }]}>
                        {formatUSD(parsedCostoPreview)}
                      </Text>
                      <Feather name="arrow-right" size={11} color={colors.textMuted} />
                      <Text style={[styles.netCostFinal, { color: colors.primary }]}>
                        {formatUSD(previewResultado.costoNeto)}
                      </Text>
                      <View
                        style={[
                          styles.netCostPctPill,
                          { backgroundColor: colors.success + '1A', borderColor: colors.success + '45' },
                        ]}
                      >
                        <Text style={[styles.netCostPctText, { color: colors.success }]}>
                          -{previewResultado.porcentajeEfectivoStr}%
                        </Text>
                      </View>
                    </View>
                  </View>
                  {previewMargin !== null ? (
                    <Text style={[styles.netCostNote, { color: colors.textMuted }]}>
                      Margen estimado: {previewMargin.toFixed(0)}%
                      {previewResultado.fueRedondeado ? ` · Exacto $${previewResultado.costoNetoExactoStr}` : ''}
                    </Text>
                  ) : previewResultado.fueRedondeado ? (
                    <Text style={[styles.netCostNote, { color: colors.textMuted }]}>
                      Redondeado a 2 dec. para Hybrid (exacto ${previewResultado.costoNetoExactoStr})
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            {parseCantidadConAjuste(cantidadInput).esAjuste ? (
              <View
                testID="producto-nuevo-ajuste-aviso"
                style={[styles.negativoAviso, { backgroundColor: colors.primary + '14', borderColor: colors.primary + '35', marginBottom: 12 }]}
              >
                <Feather name="sliders" size={12} color={colors.primary} />
                <Text style={[styles.negativoAvisoText, { color: colors.primary }]}>
                  Ajuste fijo (...) · no se sumará: la existencia se ajustará a {parseCantidadConAjuste(cantidadInput).cantidad}
                </Text>
              </View>
            ) : null}

            <PressableScale
              style={[
                styles.formSubmitBtn,
                { backgroundColor: existingProductInDb ? colors.textDim : colors.primary },
              ]}
              onPress={handleAdd}
              disabled={!!existingProductInDb}
            >
              <Feather name="plus" size={16} color={colors.onPrimary} />
              <Text style={[styles.formSubmitText, { color: colors.onPrimary }]}>Agregar a la compra</Text>
            </PressableScale>

            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <BarcodeScannerModal
        visible={scannerTarget !== null}
        onClose={() => setScannerTarget(null)}
        onScan={(data) => {
          if (scannerTarget === 'codigo') setCodigo(data);
          else if (scannerTarget === 'referencia') setReferencia(data);
          setScannerTarget(null);
        }}
      />
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: 24 },

  headerGroup:    { paddingTop: 12, gap: 12 },
  stickyAddGroup: { paddingVertical: 12 },
  bodyGroup:      { gap: 12 },

  infoBanner: {
    flexDirection:    'row',
    alignItems:       'flex-start',
    marginHorizontal: 16,
    padding:          12,
    borderRadius:     12,
    borderWidth:      0.5,
  },
  infoBannerIcon: { marginTop: 2, marginRight: 10 },
  infoBannerTextContainer: { flex: 1 },
  infoBannerTitle: {
    fontSize:       scaleFont(12),
    fontFamily:     'JetBrainsMono_700Bold',
    textTransform:  'uppercase',
    letterSpacing:  0.5,
    marginBottom:   2,
  },
  infoBannerSub: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(15),
  },

  proveedorBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    marginHorizontal:  16,
    paddingVertical:   12,
    paddingHorizontal: 14,
    borderRadius:      12,
    borderWidth:       0.5,
  },
  proveedorBtnText: { flex: 1 },
  proveedorLabel: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom:  2,
  },
  proveedorValue: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  addProductRow: {
    flexDirection:    'row',
    gap:              8,
    marginHorizontal: 16,
  },
  addProductBtn: {
    flex:              1,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    paddingVertical:   14,
    borderRadius:      12,
    borderWidth:       1,
    borderStyle:       'dashed',
  },
  addProductText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  nuevoProveedorBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
    paddingVertical: 12,
    borderRadius:    12,
    borderWidth:     1,
    borderStyle:     'dashed',
  },

  empty: {
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: 60,
    gap:             12,
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
  itemInfo:  { flex: 1, minWidth: 0 },
  itemNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  itemNameScroll: { flex: 1, minWidth: 0 },
  itemName: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
    ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' as any } : {}),
  },
  itemNameInput: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold', padding: 0 },
  itemDescCounter: { fontSize: scaleFont(9), fontFamily: 'JetBrainsMono_400Regular', marginTop: 2 },
  itemCode:  { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', marginTop: 1 },
  itemRef:   { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_400Regular', marginTop: 1 },
  removeBtn: { padding: 4, marginLeft: 8 },
  nuevoBadge: {
    paddingHorizontal: 6,
    paddingVertical:   2,
    borderRadius:      6,
    borderWidth:       0.5,
  },
  nuevoBadgeText: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_700Bold',
    letterSpacing: 0.3,
  },

  itemBottom: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           10,
    marginTop:     4,
  },
  fieldColumn: { flex: 1, gap: 4 },
  fieldLabel: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fieldInput: {
    fontSize:           scaleFont(14),
    fontFamily:         'JetBrainsMono_700Bold',
    textAlign:          'center',
    textAlignVertical:  'center',
    borderWidth:        1,
    borderRadius:       8,
    paddingHorizontal:  4,
    paddingVertical:    0,
    includeFontPadding: false,
    height:             36,
    fontVariant:        ['tabular-nums'],
  } as any,

  subtotalRow: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    marginTop:         6,
    paddingTop:        8,
    borderTopWidth:    0.5,
    borderTopColor:    'rgba(128,128,128,0.2)',
  },
  marginPill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   2,
    paddingHorizontal: 8,
  },
  marginText:    { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_700Bold' },
  negativoAviso: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    marginTop:         8,
    borderRadius:      8,
    borderWidth:       0.5,
    paddingVertical:   5,
    paddingHorizontal: 8,
  },
  negativoAvisoText: { flex: 1, fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_500Medium' },
  subtotalRight: { flexDirection: 'row', alignItems: 'baseline' },
  subtotalLabel: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular' },
  subtotalValue: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },

  totalCard: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    marginHorizontal:  16,
    borderRadius:      12,
    borderWidth:       0.5,
    padding:           14,
  },
  totalBreakdown: {
    flex: 1,
    gap:  6,
  },
  totalRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  totalSubLabel: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular' },
  totalSubValue: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', fontVariant: ['tabular-nums'] } as any,
  totalDivider:  { height: 0.5, marginVertical: 2 },
  totalLabel: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  totalValue: { fontSize: scaleFont(18), fontFamily: 'JetBrainsMono_700Bold', fontVariant: ['tabular-nums'] } as any,

  descAddHint: {
    fontSize:   scaleFont(12),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  descGeneralCard: {
    marginHorizontal: 16,
    borderRadius:     12,
    borderWidth:      0.5,
    padding:          12,
    gap:              8,
  },
  descGeneralHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  descGeneralTitleRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    flex:          1,
  },
  descGeneralTitle: {
    fontSize:      scaleFont(10),
    fontFamily:    'JetBrainsMono_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  descBadge: {
    paddingHorizontal: 6,
    paddingVertical:   2,
    borderRadius:      6,
    borderWidth:       0.5,
  },
  descBadgeText: {
    fontSize:    scaleFont(10),
    fontFamily:  'JetBrainsMono_700Bold',
    fontVariant: ['tabular-nums'],
  } as any,
  descClearBtnText: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  descHelperText: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(14),
  },

  discountStrip: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           8,
  },
  generalTogglePill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    height:            34,
    paddingHorizontal: 9,
    borderRadius:      8,
    borderWidth:       0.5,
  },
  generalToggleText: {
    fontSize:    scaleFont(10),
    fontFamily:  'JetBrainsMono_700Bold',
    fontVariant: ['tabular-nums'],
  } as any,

  netCostBox: {
    borderRadius:      8,
    borderWidth:       0.5,
    paddingHorizontal: 10,
    paddingVertical:   7,
    gap:               3,
  },
  netCostTopRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
    flexWrap:       'wrap',
  },
  netCostLabel: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  netCostValuesRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  netCostStrike: {
    fontSize:           scaleFont(11),
    fontFamily:         'JetBrainsMono_400Regular',
    textDecorationLine: 'line-through',
    fontVariant:        ['tabular-nums'],
  } as any,
  netCostFinal: {
    fontSize:    scaleFont(13),
    fontFamily:  'JetBrainsMono_700Bold',
    fontVariant: ['tabular-nums'],
  } as any,
  netCostPctPill: {
    borderRadius:      999,
    borderWidth:       0.5,
    paddingHorizontal: 6,
    paddingVertical:   1,
  },
  netCostPctText: {
    fontSize:    scaleFont(10),
    fontFamily:  'JetBrainsMono_700Bold',
    fontVariant: ['tabular-nums'],
  } as any,
  netCostNote: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
  },

  notaCard: {
    marginHorizontal: 16,
    borderRadius:     12,
    borderWidth:      0.5,
    padding:          14,
    gap:              6,
  },
  notaLabel: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  notaInput: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(22), minHeight: 44 },
  numeroDocInput: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold', minHeight: 28 },

  submitBar: {
    position:          'absolute',
    bottom:            100,
    left:              16,
    right:             16,
    borderRadius:      16,
    borderWidth:       0.5,
    paddingHorizontal: 16,
    paddingTop:        14,
    paddingBottom:     4,
  },
  submitBarWeb: {
    position:         'relative',
    bottom:           0,
    left:             0,
    right:            0,
    marginHorizontal: 16,
    marginBottom:     16,
    marginTop:        8,
  },
  submitTopRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            12,
  },
  submitInfo:  { flex: 1, minWidth: 0, gap: 2 },
  submitCount: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  secondaryActions: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    marginTop:      10,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    height:        40,
    paddingRight:  4,
  },
  saveDraftText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },
  clearText:   { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },
  submitBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    borderRadius:      12,
    height:            48,
    paddingHorizontal: 18,
    minWidth:          112,
  },
  submitBtnText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  modalOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent:  'flex-end',
  },
  modalContent: {
    height:            '80%',
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    borderWidth:       0.5,
    padding:           16,
    gap:               12,
  },
  modalHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontSize: scaleFont(17), fontFamily: 'JetBrainsMono_700Bold' },

  searchBox: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    borderRadius:      10,
    borderWidth:       0.5,
    paddingHorizontal: 12,
    paddingVertical:   Platform.OS === 'ios' ? 10 : 4,
  },
  searchInput: { flex: 1, fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_400Regular' },
  scanBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 8,
    paddingVertical:   6,
    borderRadius:      8,
    borderWidth:       0.5,
  },

  pickerRow: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    gap:               10,
    paddingVertical:   12,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
  },
  pickerRowLeft:  { flex: 1 },
  pickerRowTitle: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  pickerRowSub:   { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', marginTop: 2 },
  pickerStockBadge: {
    paddingHorizontal: 8,
    paddingVertical:   4,
    borderRadius:      6,
    borderWidth:       0.5,
    alignItems:        'center',
    justifyContent:    'center',
  },
  pickerStockText: {
    fontSize:    scaleFont(11),
    fontFamily:  'JetBrainsMono_700Bold',
    fontVariant: ['tabular-nums'],
  },

  formField:     { marginBottom: 14 },
  formLabelRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  formFieldFlex: { flex: 1, marginBottom: 0 },
  formRow:       { flexDirection: 'row', gap: 10, marginBottom: 14 },
  formLabel: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom:  6,
  },
  formInput: {
    fontSize:          scaleFont(14),
    fontFamily:        'JetBrainsMono_400Regular',
    borderWidth:       0.5,
    borderRadius:      10,
    paddingHorizontal: 12,
    paddingVertical:   10,
  },
  inputWrap: {
    flexDirection:     'row',
    alignItems:        'center',
    borderWidth:       0.5,
    borderRadius:      10,
    paddingHorizontal: 12,
    gap:               8,
  },
  inputWithIcon: {
    flex:              1,
    fontSize:          scaleFont(14),
    fontFamily:        'JetBrainsMono_400Regular',
    paddingVertical:   10,
  },
  formSubmitBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    borderRadius:      12,
    paddingVertical:   14,
    marginTop:         4,
  },
  formSubmitText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  codeStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  codeStatusText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  codeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 0.5,
  },
  codeBannerText: {
    flex: 1,
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(16),
  },
});
