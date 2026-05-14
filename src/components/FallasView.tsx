import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  Keyboard,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useProductos, isPlaceholder } from '../hooks/useProductos';
import { useFallas } from '../hooks/useFallas';
import { useUserRole } from '../hooks/useUserRole';
import { notify, confirm } from '../lib/notify';

export default function FallasView() {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const { data: userAuth } = useUserRole();
  const currentUserId = userAuth?.profile?.id;

  const { fallas, isLoading: isLoadingFallas, addFalla, togglePedido, deleteFalla } = useFallas();
  const { productos, isLoading: isLoadingProductos } = useProductos(search, 'todos');

  // Filter out placeholders
  const searchResults = useMemo(() => {
    return productos.filter(p => !isPlaceholder(p)).slice(0, 50); // allow more results to scroll
  }, [productos]);

  const handleAddCustom = async () => {
    const trimmed = search.trim();
    if (!trimmed) return;
    if (!currentUserId) {
      notify('Error', 'No estás autenticado');
      return;
    }
    try {
      await addFalla({ texto: trimmed, creado_por: currentUserId });
      setSearch('');
      Keyboard.dismiss();
    } catch (err: any) {
      notify('Error', 'No se pudo agregar: ' + err.message);
    }
  };

  const handleAddProduct = async (producto: any) => {
    if (!currentUserId) {
      notify('Error', 'No estás autenticado');
      return;
    }
    try {
      await addFalla({ 
        texto: producto.descripcion, 
        codigo_producto: producto.codigo_interno, 
        creado_por: currentUserId 
      });
      setSearch('');
      Keyboard.dismiss();
    } catch (err: any) {
      notify('Error', 'No se pudo agregar: ' + err.message);
    }
  };

  const handleDelete = (id: string) => {
    confirm({
      title: 'Eliminar fila',
      message: '¿Borrar esta anotación del cuaderno?',
      confirmText: 'Borrar',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteFalla(id);
        } catch (err: any) {
          notify('Error', err.message);
        }
      }
    });
  };

  const showDropdown = isFocused && search.trim().length > 0 && searchResults.length > 0;

  if (isLoadingFallas) {
    return (
      <View style={[styles.flex, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {/* Search / Add Bar */}
      <View style={[styles.searchContainer, { backgroundColor: 'transparent' }]}>
        <View style={[styles.inputWrapper, { borderColor: isFocused ? colors.primary : colors.border }]}>
          <Feather name="search" size={16} color={colors.textDim} style={styles.searchIcon} />
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Buscar producto o escribir falla..."
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            onSubmitEditing={handleAddCustom}
          />
          {search.length > 0 && (
            <Pressable
              style={({ pressed }) => [
                styles.addBtn,
                { backgroundColor: colors.primary },
                pressed && { opacity: 0.7 }
              ]}
              onPress={handleAddCustom}
            >
              <Feather name="plus" size={16} color={colors.onPrimary} />
            </Pressable>
          )}
        </View>

        {/* Dropdown Results */}
        {showDropdown && (
          <View style={[styles.dropdown, { backgroundColor: colors.surface, borderColor: colors.border, shadowColor: colors.text }]}>
            <ScrollView style={{ maxHeight: 312 }} keyboardShouldPersistTaps="handled">
              {searchResults.map((prod) => (
                <Pressable
                  key={prod.codigo_interno}
                  style={({ pressed }) => [
                    styles.dropdownItem,
                    { borderBottomColor: colors.border },
                    pressed && { backgroundColor: colors.bg }
                  ]}
                  onPress={() => handleAddProduct(prod)}
                >
                  <Feather name="box" size={14} color={colors.textDim} />
                  <View style={styles.dropdownTextWrapper}>
                    <Text style={[styles.dropdownName, { color: colors.text }]} numberOfLines={1}>
                      {prod.descripcion}
                    </Text>
                    <Text style={[styles.dropdownCode, { color: colors.textMuted }]}>
                      {prod.codigo_interno}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* Notebook List */}
      <ScrollView 
        contentContainerStyle={[styles.listContent, { paddingBottom: 150 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {fallas.map((falla) => (
          <View 
            key={falla.id} 
            style={[
              styles.row, 
              { borderBottomColor: colors.border }
            ]}
          >
            <Pressable 
              hitSlop={8}
              style={styles.checkBtn}
              onPress={() => togglePedido({ id: falla.id, currentStatus: falla.pedido })}
            >
              <Feather 
                name={falla.pedido ? "check-square" : "square"} 
                size={20} 
                color={falla.pedido ? colors.primary : colors.textDim} 
              />
            </Pressable>
            
              <View style={styles.rowTextContainer}>
              <Text 
                style={[
                  styles.rowText, 
                  { color: falla.pedido ? colors.textMuted : colors.text },
                  falla.pedido && { textDecorationLine: 'line-through' }
                ]}
              >
                {falla.texto}
              </Text>
              <Text style={[styles.rowAuthor, { color: colors.textMuted }]}>
                {falla.perfil?.display_name || 'Desconocido'} • {new Date(falla.creado_en).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '')}
              </Text>
            </View>

            <Pressable
              hitSlop={8}
              style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.5 }]}
              onPress={() => handleDelete(falla.id)}
            >
              <Feather name="trash-2" size={16} color={colors.danger + 'AA'} />
            </Pressable>
          </View>
        ))}

        {/* Líneas de cuaderno vacías al final */}
        <View style={styles.emptyNotebook}>
          {Array.from({ length: 15 }).map((_, i) => (
            <View 
              key={`empty-${i}`} 
              style={[styles.emptyRow, { borderBottomColor: colors.border }]} 
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  searchContainer: {
    padding: 16,
    zIndex: 10,
    ...(Platform.OS === 'web' ? { position: 'relative' } : {})
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'JetBrainsMono_400Regular',
    height: '100%',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {})
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  dropdown: {
    position: 'absolute',
    top: 68,
    left: 16,
    right: 16,
    borderWidth: 1,
    borderRadius: 12,
    zIndex: 100,
    elevation: 5,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  dropdownTextWrapper: {
    flex: 1,
  },
  dropdownName: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_500Medium',
  },
  dropdownCode: {
    fontSize: 11,
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    gap: 12,
  },
  checkBtn: {
    padding: 4,
  },
  rowTextContainer: {
    flex: 1,
  },
  rowText: {
    fontSize: 15,
    fontFamily: 'JetBrainsMono_500Medium',
    lineHeight: 22,
  },
  rowAuthor: {
    fontSize: 10,
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop: 4,
  },
  deleteBtn: {
    padding: 8,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  emptyNotebook: {
    paddingTop: 8,
  },
  emptyRow: {
    height: 60,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
  }
});
