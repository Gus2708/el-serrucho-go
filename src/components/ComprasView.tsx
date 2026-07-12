import * as React from 'react';
import { useState } from 'react';
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
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { useDeviceSize } from '../hooks/useDeviceSize';
import { notify, confirm } from '../lib/notify';
import { supabase, Producto } from '../lib/supabase';
import { useProveedores, Proveedor } from '../hooks/useProveedores';
import { useCompra, CompraDraftItem } from '../hooks/useCompra';
import { useProductos } from '../hooks/useProductos';

interface ComprasViewProps {
  router: any;
}

export default function ComprasView({ router }: ComprasViewProps): React.JSX.Element {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useDeviceSize();
  const {
    proveedorCodigo,
    proveedorNombre,
    items,
    nota,
    isLoading,
    setProveedor,
    addItem,
    removeItem,
    updateItem,
    setNota,
    clear,
    submit,
  } = useCompra();

  const [proveedorModalVisible, setProveedorModalVisible] = useState(false);
  const [productoModalVisible, setProductoModalVisible] = useState(false);

  const total = items.reduce((sum, item) => sum + item.cantidad * item.costo, 0);

  function handleSelectProveedor(proveedor: Proveedor): void {
    setProveedor(proveedor.codigo, proveedor.nombre);
    setProveedorModalVisible(false);
  }

  function handleSelectProducto(producto: Producto): void {
    addItem({
      codigo_producto: producto.codigo_interno,
      descripcion:     producto.descripcion,
      cantidad:        1,
      costo:           0,
      precio:          0,
    });
    setProductoModalVisible(false);
  }

  async function getUserId(): Promise<string> {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? '';
  }

  async function performSubmit(): Promise<void> {
    try {
      const userId = await getUserId();
      const { compraId } = await submit(userId);
      notify('Éxito', `Compra #${compraId} emitida`);
    } catch (e: any) {
      notify('Error', e.message ?? 'No se pudo emitir la compra');
    }
  }

  function handleSubmit(): void {
    if (!proveedorCodigo || items.length === 0) return;
    confirm({
      title:       'Emitir compra',
      message:     `Se registrará una compra a ${proveedorNombre} con ${items.length} ítem${items.length > 1 ? 's' : ''}.`,
      confirmText: 'Emitir',
      onConfirm:   performSubmit,
    });
  }

  const canSubmit = Boolean(proveedorCodigo) && items.length > 0 && !isLoading;

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

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
        <Pressable
          style={({ pressed }) => [
            styles.proveedorBtn,
            { borderColor: colors.border, backgroundColor: colors.surface },
            pressed && { opacity: 0.75 },
          ]}
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
        </Pressable>

        {/* Agregar producto CTA */}
        <Pressable
          style={({ pressed }) => [
            styles.addProductBtn,
            { borderColor: colors.primary, backgroundColor: colors.primaryFaded },
            pressed && { opacity: 0.75 },
          ]}
          onPress={() => setProductoModalVisible(true)}
        >
          <Feather name="plus" size={18} color={colors.primary} />
          <Text style={[styles.addProductText, { color: colors.primary }]}>Agregar producto</Text>
        </Pressable>

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
            {items.map(item => (
              <CompraItemCard
                key={item.codigo_producto}
                item={item}
                onRemove={() => removeItem(item.codigo_producto)}
                onUpdate={updates => updateItem(item.codigo_producto, updates)}
              />
            ))}

            {/* Total */}
            <View style={[styles.totalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.totalLabel, { color: colors.textMuted }]}>TOTAL COMPRA</Text>
              <Text style={[styles.totalValue, { color: colors.primary }]}>{formatUSD(total)}</Text>
            </View>

            {/* Nota */}
            <View style={[styles.notaCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.notaLabel, { color: colors.textMuted }]}>Nota de la compra</Text>
              <TextInput
                style={[styles.notaInput, { color: colors.text }]}
                placeholder="Observaciones, número de factura…"
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
        <View
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
          <View style={styles.submitInfo}>
            <Text style={[styles.submitCount, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              {items.length} ítem{items.length > 1 ? 's' : ''} · {formatUSD(total)}
            </Text>
            <Pressable onPress={() => confirm({ title: 'Limpiar compra', message: 'Se perderán los ítems agregados.', confirmText: 'Limpiar', destructive: true, onConfirm: clear })} style={({ pressed }) => [pressed && { opacity: 0.7 }, { marginTop: 4 }]}>
              <Text style={[styles.clearText, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
                Limpiar compra
              </Text>
            </Pressable>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              { backgroundColor: colors.primary },
              (!canSubmit || pressed) && { opacity: 0.75 },
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <>
                <Feather name="send" size={16} color={colors.onPrimary} />
                <Text style={[styles.submitBtnText, { color: colors.onPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                  Emitir compra
                </Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      <ProveedorPickerModal
        visible={proveedorModalVisible}
        onClose={() => setProveedorModalVisible(false)}
        onSelect={handleSelectProveedor}
      />
      <ProductoPickerModal
        visible={productoModalVisible}
        onClose={() => setProductoModalVisible(false)}
        onSelect={handleSelectProducto}
      />
    </View>
  );
}

// ── Item card ─────────────────────────────────────────────────────────────────

interface CompraItemCardProps {
  item:     CompraDraftItem;
  onRemove: () => void;
  onUpdate: (updates: Partial<CompraDraftItem>) => void;
}

function CompraItemCard({ item, onRemove, onUpdate }: CompraItemCardProps): React.JSX.Element {
  const { colors, formatUSD } = useTheme();
  const [cantidadInput, setCantidadInput] = useState<string>(String(item.cantidad));
  const [costoInput, setCostoInput] = useState<string>(String(item.costo));
  const [precioInput, setPrecioInput] = useState<string>(String(item.precio));

  const subtotal = item.cantidad * item.costo;
  const decimalKeyboard = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad';

  function handleCantidadChange(v: string): void {
    const val = v.replace(',', '.');
    setCantidadInput(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 0) onUpdate({ cantidad: n });
  }

  function handleCostoChange(v: string): void {
    const val = v.replace(',', '.');
    setCostoInput(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 0) onUpdate({ costo: n });
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
          <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
            {item.descripcion}
          </Text>
          <Text style={[styles.itemCode, { color: colors.textMuted }]}>{item.codigo_producto}</Text>
        </View>
        <Pressable onPress={onRemove} hitSlop={8} style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}>
          <Feather name="x" size={16} color={colors.textDim} />
        </Pressable>
      </View>

      <View style={styles.itemBottom}>
        <View style={styles.fieldColumn}>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>CANTIDAD</Text>
          <TextInput
            style={[styles.fieldInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
            keyboardType={decimalKeyboard}
            value={cantidadInput}
            onChangeText={handleCantidadChange}
            selectTextOnFocus
          />
        </View>

        <View style={styles.fieldColumn}>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>COSTO ($)</Text>
          <TextInput
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

      <View style={styles.subtotalRow}>
        <Text style={[styles.subtotalLabel, { color: colors.textMuted }]}>Subtotal</Text>
        <Text style={[styles.subtotalValue, { color: colors.text }]}>{formatUSD(subtotal)}</Text>
      </View>
    </View>
  );
}

// ── Modal: selector de proveedor ─────────────────────────────────────────────

interface ProveedorPickerModalProps {
  visible:  boolean;
  onClose:  () => void;
  onSelect: (proveedor: Proveedor) => void;
}

function ProveedorPickerModal({ visible, onClose, onSelect }: ProveedorPickerModalProps): React.JSX.Element {
  const { colors } = useTheme();
  const { data: proveedores, isLoading } = useProveedores();
  const [search, setSearch] = useState<string>('');

  const filtered = (proveedores ?? []).filter(p => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return p.nombre.toLowerCase().includes(term) || (p.rif ?? '').toLowerCase().includes(term);
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
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
      </View>
    </Modal>
  );
}

// ── Modal: selector de producto ──────────────────────────────────────────────

interface ProductoPickerModalProps {
  visible:  boolean;
  onClose:  () => void;
  onSelect: (producto: Producto) => void;
}

function ProductoPickerModal({ visible, onClose, onSelect }: ProductoPickerModalProps): React.JSX.Element {
  const { colors } = useTheme();
  const [search, setSearch] = useState<string>('');
  const { productos, isLoading } = useProductos(search);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
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
              placeholder="Buscar por código o descripción…"
              placeholderTextColor={colors.textDim}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : (
            <FlatList
              data={productos}
              keyExtractor={p => p.codigo_interno}
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
                    {item.descripcion}
                  </Text>
                  <Text style={[styles.pickerRowSub, { color: colors.textMuted }]} numberOfLines={1}>
                    {item.codigo_interno}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Feather name="package" size={28} color={colors.textDim} />
                  <Text style={[styles.emptySub, { color: colors.textDim }]}>Sin resultados</Text>
                </View>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingTop: 12, gap: 8 },

  infoBanner: {
    flexDirection:    'row',
    alignItems:       'flex-start',
    marginHorizontal: 16,
    marginTop:        12,
    marginBottom:     8,
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
  totalLabel: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  totalValue: { fontSize: scaleFont(18), fontFamily: 'JetBrainsMono_700Bold' },

  notaCard: {
    marginHorizontal: 16,
    borderRadius:     12,
    borderWidth:      0.5,
    padding:          14,
    gap:              6,
  },
  notaLabel: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  notaInput: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(22), minHeight: 44 },

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
  submitBarWeb: {
    position:         'relative',
    bottom:           0,
    left:             0,
    right:            0,
    marginHorizontal: 16,
    marginBottom:     16,
    marginTop:        8,
  },
  submitInfo:  { flex: 1, gap: 2 },
  submitCount: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  clearText:   { fontSize: scaleFont(12), marginTop: 2, fontFamily: 'JetBrainsMono_400Regular' },
  submitBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    borderRadius:      12,
    paddingVertical:   12,
    paddingHorizontal: 20,
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

  pickerRow: {
    paddingVertical:   12,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
  },
  pickerRowTitle: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  pickerRowSub:   { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', marginTop: 2 },
});
