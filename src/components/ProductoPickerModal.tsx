import * as React from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { pressScale } from '../theme/motion';
import { isPlaceholder, normalizeSearchTerm, useProductos } from '../hooks/useProductos';
import type { Producto } from '../lib/producto';
import { PressableScale } from './PressableScale';
import { BarcodeScannerModal } from './BarcodeScannerModal';

export interface ProductoPickerModalProps {
  visible: boolean;
  titulo: string;
  busquedaInicial?: string;
  onClose: () => void;
  /** Receives the full current inventory row; the caller decides what that choice means. */
  onSelect: (producto: Producto) => void;
  testID?: string;
}

/**
 * Inventory search shared by Compras and the invoice review: name, internal code or barcode over the paged
 * `productos_view` query. Loading, failure, empty and partial pages stay distinct; a missing row never proves that a
 * product does not exist. POS placeholders are shown but cannot be chosen; any stock level can be (purchases restock).
 */
export default function ProductoPickerModal(props: ProductoPickerModalProps): React.JSX.Element {
  const { visible, titulo, busquedaInicial = '', onClose, onSelect, testID = 'producto-picker' } = props;
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState<string>(() => normalizeSearchTerm(busquedaInicial));
  const [scannerVisible, setScannerVisible] = useState<boolean>(false);
  const { productos = [], isLoading, isFetchingMore, hasMore, fetchMore, error } = useProductos(search);

  useEffect(() => {
    if (visible) {
      setSearch(busquedaInicial ? normalizeSearchTerm(busquedaInicial) : '');
      setScannerVisible(false);
    }
  }, [visible, busquedaInicial]);

  function reintentar(): void {
    void queryClient.invalidateQueries({ queryKey: ['productos', search] });
  }

  function textoPie(fallo: boolean): string {
    if (fallo) return 'No se pudo cargar más. Reintentar';
    return isFetchingMore ? 'Cargando más…' : 'Cargar más productos';
  }

  function renderPie(): React.JSX.Element | null {
    if (!hasMore) return null;
    const fallo = error !== null && error !== undefined;
    return (
      <Pressable
        testID={`${testID}-mas`}
        accessibilityRole="button"
        accessibilityState={{ disabled: isFetchingMore, busy: isFetchingMore }}
        disabled={isFetchingMore}
        onPress={() => void fetchMore?.()}
        style={({ pressed }) => [styles.pie, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
      >
        {isFetchingMore ? <ActivityIndicator color={colors.primary} /> : null}
        <Text style={[styles.pieTexto, { color: fallo ? colors.danger : colors.text }]}>
          {textoPie(fallo)}
        </Text>
      </Pressable>
    );
  }

  function renderCuerpo(): React.JSX.Element {
    if (isLoading) {
      return (
        <View testID={`${testID}-cargando`} style={styles.estado}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.estadoTexto, { color: colors.textMuted }]}>Buscando en el inventario…</Text>
        </View>
      );
    }
    if (error && productos.length === 0) {
      return (
        <View testID={`${testID}-error`} style={styles.estado}>
          <Feather name="alert-triangle" size={24} color={colors.danger} />
          <Text style={[styles.estadoTexto, { color: colors.danger }]}>No se pudo leer el inventario. Revisa la conexión o tus permisos.</Text>
          <Pressable
            testID={`${testID}-reintentar`}
            accessibilityRole="button"
            onPress={reintentar}
            style={({ pressed }) => [styles.boton, { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[styles.botonTexto, { color: colors.text }]}>Reintentar</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <FlatList
        data={productos}
        keyExtractor={p => p.codigo_interno}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const marcador = isPlaceholder(item);
          const agotado = item.existencia <= 0;
          return (
            <PressableScale
              testID={`${testID}-fila-${item.codigo_interno}`}
              accessibilityRole="button"
              accessibilityLabel={marcador ? `${item.descripcion}: marcador del punto de venta, no se puede elegir` : `Elegir ${item.descripcion}, código ${item.codigo_interno}`}
              accessibilityState={{ disabled: marcador }}
              disabled={marcador}
              activeScale={pressScale.row}
              dimmed={marcador}
              style={[styles.fila, { borderColor: colors.border }]}
              onPress={() => onSelect(item)}
            >
              <View style={styles.filaTexto}>
                <Text style={[styles.filaTitulo, { color: colors.text }]} numberOfLines={1}>{item.descripcion}</Text>
                <Text style={[styles.filaSub, { color: colors.textMuted }]} numberOfLines={1}>
                  {item.codigo_interno}
                  {item.referencia ? `  ·  Ref: ${item.referencia}` : ''}
                  {item.codigo_barras ? `  ·  CB: ${item.codigo_barras}` : ''}
                </Text>
              </View>
              <View style={[styles.stock, { borderColor: agotado ? colors.danger : colors.border }]}>
                <Text style={[styles.stockTexto, { color: agotado ? colors.danger : colors.textMuted }]}>{`${item.existencia} ${item.unidad || 'uds'}`}</Text>
              </View>
            </PressableScale>
          );
        }}
        ListEmptyComponent={
          <View testID={`${testID}-vacio`} style={styles.estado}>
            <Text style={[styles.estadoTexto, { color: colors.textMuted }]}>Sin resultados. Prueba con otra palabra o con el código. Que no aparezca aquí no prueba que el producto no exista.</Text>
          </View>
        }
        ListFooterComponent={renderPie()}
      />
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'android' ? 'height' : undefined}>
        <View testID={testID} style={[styles.contenido, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <View style={styles.cabecera}>
            <Text style={[styles.titulo, { color: colors.text }]}>{titulo}</Text>
            <Pressable testID={`${testID}-cerrar`} accessibilityRole="button" accessibilityLabel="Cerrar sin elegir" onPress={onClose} style={styles.icono}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.filaBusqueda}>
            <View testID={`${testID}-busqueda`} style={[styles.busqueda, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Feather name="search" size={16} color={colors.textDim} />
              <TextInput
                testID={`${testID}-buscar`}
                accessibilityLabel="Buscar por nombre, código o código de barras"
                style={[styles.entrada, { color: colors.text }]}
                placeholder="Nombre, código o barras"
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={v => setSearch(normalizeSearchTerm(v))}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect={false}
                spellCheck={false}
                autoFocus
              />
              {search.length > 0 ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Borrar búsqueda" onPress={() => setSearch('')} style={styles.icono}>
                  <Feather name="x-circle" size={16} color={colors.textDim} />
                </Pressable>
              ) : null}
            </View>
            {/* The scanner is its own target beside the field, so it never crowds the field's border. */}
            <PressableScale
              testID={`${testID}-escanear`}
              accessibilityRole="button"
              accessibilityLabel="Escanear código de barras"
              style={[styles.icono, styles.escanear, { backgroundColor: colors.primaryFaded, borderColor: colors.primary }]}
              onPress={() => setScannerVisible(true)}
            >
              <Feather name="camera" size={18} color={colors.primary} />
            </PressableScale>
          </View>

          {renderCuerpo()}
        </View>
      </KeyboardAvoidingView>
      <BarcodeScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={data => {
          setSearch(normalizeSearchTerm(data));
          setScannerVisible(false);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  contenido: { height: '80%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, padding: 16, gap: 12 },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titulo: { fontSize: scaleFont(17), fontFamily: 'JetBrainsMono_700Bold', flexShrink: 1 },
  icono: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  filaBusqueda: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  busqueda: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 0.5, paddingLeft: 12, paddingRight: 4 },
  entrada: { flex: 1, minHeight: 44, fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_400Regular' },
  escanear: { borderRadius: 10, borderWidth: 0.5 },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 56, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 0.5 },
  filaTexto: { flex: 1, gap: 2 },
  filaTitulo: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  filaSub: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular' },
  stock: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 0.5 },
  stockTexto: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', fontVariant: ['tabular-nums'] },
  estado: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 8, gap: 12 },
  estadoTexto: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(20) },
  boton: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  botonTexto: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },
  pie: { flexDirection: 'row', gap: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderTopWidth: 0.5, marginTop: 4 },
  pieTexto: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },
});
