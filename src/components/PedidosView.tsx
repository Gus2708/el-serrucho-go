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
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { useDeviceSize } from '../hooks/useDeviceSize';
import { notify, confirm } from '../lib/notify';
import { supabase, Producto } from '../lib/supabase';
import { usePedido, PedidoDraftItem } from '../hooks/usePedido';
import { useProductos } from '../hooks/useProductos';
import { PressableScale } from './PressableScale';
import { pressScale } from '../theme/motion';

interface ClienteRow {
  codigo_cliente: string;
  nombre:         string;
  rif:            string | null;
}

interface PedidosViewProps {
  router:     any;
  onEmitted?: () => void;
}

export default function PedidosView({ router, onEmitted }: PedidosViewProps): React.JSX.Element {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useDeviceSize();
  const {
    clienteCodigo,
    clienteNombre,
    items,
    nota,
    isLoading,
    editingPedidoId,
    setCliente,
    addItem,
    removeItem,
    updateItem,
    setNota,
    clear,
    submit,
  } = usePedido();

  const [clienteModalVisible, setClienteModalVisible] = useState(false);
  const [productoModalVisible, setProductoModalVisible] = useState(false);

  const totalUnidades = items.reduce((sum, item) => sum + item.cantidad, 0);

  function handleSelectCliente(cliente: ClienteRow): void {
    setCliente(cliente.codigo_cliente, cliente.nombre);
    setClienteModalVisible(false);
  }

  function handleSelectProducto(producto: Producto): void {
    addItem({
      codigo_producto: producto.codigo_interno,
      descripcion:     producto.descripcion,
      cantidad:        1,
    });
    setProductoModalVisible(false);
  }

  function primerItemInvalido(): string | null {
    for (const it of items) {
      if (!(it.cantidad > 0)) return `${it.descripcion}: la cantidad debe ser mayor a 0.`;
    }
    return null;
  }

  async function getUserId(): Promise<string> {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? '';
  }

  async function performSubmit(): Promise<void> {
    const wasEditing = editingPedidoId !== null;
    try {
      const userId = await getUserId();
      const { pedidoId } = await submit(userId);
      clear();
      notify(
        wasEditing ? 'Pedido reencolado' : 'Pedido emitido',
        `PED-${String(pedidoId).padStart(4, '0')} en cola para registrarse en Hybrid y pasar a caja.`
      );
      onEmitted?.();
    } catch (e: any) {
      notify('Error', e.message ?? (wasEditing ? 'No se pudo reintentar el pedido' : 'No se pudo emitir el pedido'));
    }
  }

  function handleSubmit(): void {
    if (!clienteCodigo || items.length === 0) return;
    const problema = primerItemInvalido();
    if (problema) {
      notify('Falta información', problema);
      return;
    }
    const isEditing = editingPedidoId !== null;
    confirm({
      title:       isEditing ? 'Reintentar pedido' : 'Emitir pedido',
      message:     isEditing
        ? `Se reencolará PED-${String(editingPedidoId).padStart(4, '0')} de ${clienteNombre} con ${items.length} ítem${items.length > 1 ? 's' : ''}.`
        : `Se registrará un pedido de ${clienteNombre} con ${items.length} ítem${items.length > 1 ? 's' : ''} y quedará pendiente en caja para facturar.`,
      confirmText: isEditing ? 'Reintentar' : 'Emitir',
      onConfirm:   performSubmit,
    });
  }

  const canSubmit = Boolean(clienteCodigo) && items.length > 0 && !isLoading;

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {editingPedidoId !== null ? (
          <View style={[styles.infoBanner, { backgroundColor: colors.warning + '10', borderColor: colors.warning + '30' }]}>
            <Feather name="rotate-cw" size={15} color={colors.warning} style={styles.infoBannerIcon} />
            <View style={styles.infoBannerTextContainer}>
              <Text style={[styles.infoBannerTitle, { color: colors.warning }]}>
                Editando PED-{String(editingPedidoId).padStart(4, '0')} para reintentar
              </Text>
              <Text style={[styles.infoBannerSub, { color: colors.textMuted }]}>
                Corrige lo que causó el error y reintenta. No se creará un pedido nuevo.
              </Text>
            </View>
            <PressableScale onPress={clear} hitSlop={8} activeScale={pressScale.icon}>
              <Feather name="x" size={18} color={colors.textMuted} />
            </PressableScale>
          </View>
        ) : null}

        {/* Banner educativo */}
        <View style={[styles.infoBanner, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
          <Feather name="clipboard" size={15} color={colors.primary} style={styles.infoBannerIcon} />
          <View style={styles.infoBannerTextContainer}>
            <Text style={[styles.infoBannerTitle, { color: colors.primary }]}>
              Pedido → Caja automático
            </Text>
            <Text style={[styles.infoBannerSub, { color: colors.textMuted }]}>
              El pedido se registrará solo en el POS Hybrid y quedará pendiente en caja para facturar. Usa el precio actual del producto.
            </Text>
          </View>
        </View>

        {/* Selector de cliente */}
        <PressableScale
          style={[styles.clienteBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
          activeScale={pressScale.row}
          onPress={() => setClienteModalVisible(true)}
        >
          <Feather name="user" size={16} color={clienteCodigo ? colors.primary : colors.textDim} />
          <View style={styles.clienteBtnText}>
            <Text style={[styles.clienteLabel, { color: colors.textMuted }]}>CLIENTE</Text>
            <Text
              style={[styles.clienteValue, { color: clienteCodigo ? colors.text : colors.textDim }]}
              numberOfLines={1}
            >
              {clienteNombre ?? 'Elegir cliente…'}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textDim} />
        </PressableScale>

        {/* Agregar producto */}
        <PressableScale
          style={[styles.addProductBtn, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]}
          onPress={() => setProductoModalVisible(true)}
        >
          <Feather name="search" size={16} color={colors.primary} />
          <Text style={[styles.addProductText, { color: colors.primary }]}>Agregar producto</Text>
        </PressableScale>

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="clipboard" size={36} color={colors.textDim} />
            <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Pedido vacío</Text>
            <Text style={[styles.emptySub, { color: colors.textDim }]}>
              Toca "Agregar producto" para{'\n'}empezar a armar el pedido
            </Text>
          </View>
        ) : (
          <>
            {items.map(item => (
              <PedidoItemCard
                key={item.codigo_producto}
                item={item}
                onRemove={() => removeItem(item.codigo_producto)}
                onUpdate={updates => updateItem(item.codigo_producto, updates)}
              />
            ))}

            {/* Nota */}
            <View style={[styles.notaCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.notaLabel, { color: colors.textMuted }]}>Nota del pedido</Text>
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
              bottom:          isDesktop ? undefined : (Platform.OS === 'web' ? 16 : insets.bottom + 16),
              position:        isDesktop ? 'relative' : 'absolute',
            },
            isDesktop && styles.submitBarWeb,
          ]}
        >
          <View style={styles.submitInfo}>
            <Text style={[styles.submitCount, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              {items.length} ítem{items.length > 1 ? 's' : ''} · {totalUnidades} und
            </Text>
            <PressableScale onPress={() => confirm({ title: 'Limpiar pedido', message: 'Se perderán los ítems agregados.', confirmText: 'Limpiar', destructive: true, onConfirm: clear })} style={{ marginTop: 4 }}>
              <Text style={[styles.clearText, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
                Limpiar pedido
              </Text>
            </PressableScale>
          </View>
          <PressableScale
            style={[styles.submitBtn, { backgroundColor: colors.primary }]}
            dimmed={!canSubmit}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <>
                <Feather name={editingPedidoId !== null ? 'rotate-cw' : 'send'} size={16} color={colors.onPrimary} />
                <Text style={[styles.submitBtnText, { color: colors.onPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                  {editingPedidoId !== null ? 'Reintentar pedido' : 'Emitir pedido'}
                </Text>
              </>
            )}
          </PressableScale>
        </View>
      )}

      <ClientePickerModal
        visible={clienteModalVisible}
        onClose={() => setClienteModalVisible(false)}
        onSelect={handleSelectCliente}
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

interface PedidoItemCardProps {
  item:     PedidoDraftItem;
  onRemove: () => void;
  onUpdate: (updates: Partial<PedidoDraftItem>) => void;
}

function PedidoItemCard({ item, onRemove, onUpdate }: PedidoItemCardProps): React.JSX.Element {
  const { colors } = useTheme();
  const [cantidadInput, setCantidadInput] = useState<string>(String(item.cantidad));
  const decimalKeyboard = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad';

  function handleCantidadChange(v: string): void {
    const val = v.replace(',', '.');
    setCantidadInput(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 0) onUpdate({ cantidad: n });
  }

  function step(delta: number): void {
    const next = Math.max(0, item.cantidad + delta);
    setCantidadInput(String(next));
    onUpdate({ cantidad: next });
  }

  return (
    <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.itemTop}>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={2}>
            {item.descripcion}
          </Text>
          <Text style={[styles.itemCode, { color: colors.textMuted }]}>{item.codigo_producto}</Text>
        </View>
        <PressableScale onPress={onRemove} hitSlop={8} style={styles.removeBtn} activeScale={pressScale.icon}>
          <Feather name="x" size={16} color={colors.textDim} />
        </PressableScale>
      </View>

      <View style={styles.qtyRow}>
        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>CANTIDAD</Text>
        <View style={styles.qtyControls}>
          <PressableScale
            onPress={() => step(-1)}
            style={[styles.qtyBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            activeScale={pressScale.icon}
          >
            <Feather name="minus" size={14} color={colors.text} />
          </PressableScale>
          <TextInput
            style={[styles.qtyInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
            keyboardType={decimalKeyboard}
            value={cantidadInput}
            onChangeText={handleCantidadChange}
            selectTextOnFocus
          />
          <PressableScale
            onPress={() => step(1)}
            style={[styles.qtyBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            activeScale={pressScale.icon}
          >
            <Feather name="plus" size={14} color={colors.text} />
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

// ── Modal: selector de cliente ───────────────────────────────────────────────

interface ClientePickerModalProps {
  visible:  boolean;
  onClose:  () => void;
  onSelect: (cliente: ClienteRow) => void;
}

function ClientePickerModal({ visible, onClose, onSelect }: ClientePickerModalProps): React.JSX.Element {
  const { colors } = useTheme();
  const [search, setSearch] = useState<string>('');

  const { data: clientes = [], isLoading } = useQuery<ClienteRow[]>({
    queryKey:  ['clientes-picker', search.trim()],
    queryFn:   async () => {
      let q = supabase
        .from('clientes')
        .select('codigo_cliente, nombre, rif')
        .order('nombre', { ascending: true })
        .limit(40);
      const term = search.trim();
      if (term) q = q.or(`nombre.ilike.%${term}%,rif.ilike.%${term}%,codigo_cliente.ilike.%${term}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ClienteRow[];
    },
    enabled:   visible,
    staleTime: 30_000,
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Elegir cliente</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Feather name="search" size={16} color={colors.textDim} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Buscar por nombre, RIF o código…"
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
              data={clientes}
              keyExtractor={c => c.codigo_cliente}
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
                  <Text style={[styles.pickerRowSub, { color: colors.textMuted }]} numberOfLines={1}>
                    {item.codigo_cliente}{item.rif ? `  ·  ${item.rif}` : ''}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Feather name="users" size={28} color={colors.textDim} />
                  <Text style={[styles.emptySub, { color: colors.textDim }]}>Sin clientes</Text>
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
  scroll: { paddingTop: 12, paddingBottom: 24, gap: 12 },

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

  clienteBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    marginHorizontal:  16,
    paddingVertical:   12,
    paddingHorizontal: 14,
    borderRadius:      12,
    borderWidth:       0.5,
  },
  clienteBtnText: { flex: 1 },
  clienteLabel: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom:  2,
  },
  clienteValue: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  addProductBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    marginHorizontal:  16,
    marginTop:         4,
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
  itemCode:  { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', marginTop: 2 },
  removeBtn: { padding: 4, marginLeft: 8 },

  qtyRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginTop:      4,
  },
  fieldLabel: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width:          36,
    height:         36,
    borderRadius:   8,
    borderWidth:    1,
    alignItems:     'center',
    justifyContent: 'center',
  },
  qtyInput: {
    fontSize:           scaleFont(15),
    fontFamily:         'JetBrainsMono_700Bold',
    textAlign:          'center',
    textAlignVertical:  'center',
    borderWidth:        1,
    borderRadius:       8,
    paddingHorizontal:  4,
    paddingVertical:    0,
    includeFontPadding: false,
    height:             36,
    width:              64,
    fontVariant:        ['tabular-nums'],
  } as any,

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
