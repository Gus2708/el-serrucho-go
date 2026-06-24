import { scaleFont } from '../src/theme/responsive';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, FlatList, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../src/theme/ThemeContext';
import { usePresupuestoStore, Cliente } from '../src/hooks/usePresupuestoStore';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';

function useClientesSearch(search: string) {
  return useQuery({
    queryKey: ['clientes', search],
    queryFn: async () => {
      let query = supabase
        .from('clientes')
        .select('*')
        .limit(30)
        .order('nombre');

      const trimmed = search.trim();
      if (trimmed.length > 0) {
        const term = `%${trimmed}%`;
        query = query.or(`nombre.ilike.${term},rif.ilike.${term},codigo_cliente.ilike.${term}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Cliente[];
    },
    staleTime: 60_000,
  });
}

export default function SeleccionarCliente() {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  const { cliente: selectedCliente, setCliente } = usePresupuestoStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: clientes, isLoading } = useClientesSearch(debouncedSearch);

  const handleSelect = (cliente: Cliente | null) => {
    setCliente(cliente);
    router.replace({ pathname: '/(tabs)/ordenes', params: { tab: 'presupuesto' } });
  };

  const renderCliente = ({ item }: { item: Cliente }) => {
    const isSelected = selectedCliente?.codigo_cliente === item.codigo_cliente;
    return (
      <Pressable 
        style={[styles.clienteCard, { backgroundColor: colors.surface, borderColor: isSelected ? colors.primary : 'transparent', borderWidth: 2 }]}
        onPress={() => handleSelect(item)}
      >
        <View style={styles.clienteInfo}>
          <Text style={[styles.clienteName, { color: colors.text }]}>{item.nombre}</Text>
          <Text style={[styles.clienteCode, { color: colors.textDim }]}>RIF/CI: {item.rif || 'N/A'}</Text>
          {item.telefono && <Text style={[styles.clienteCode, { color: colors.textDim }]}>Tel: {item.telefono}</Text>}
        </View>
        {isSelected && <Feather name="check-circle" size={24} color={colors.primary} />}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.replace({ pathname: '/(tabs)/ordenes', params: { tab: 'presupuesto' } })} style={styles.btnBack}>
          <Feather name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Seleccionar Cliente</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search */}
      <View style={[styles.searchContainer, { backgroundColor: colors.surface }]}>
        <Feather name="search" size={20} color={colors.textDim} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Buscar cliente por nombre o RIF..."
          placeholderTextColor={colors.textDim}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="always"
        />
        {search.length > 0 && Platform.OS !== 'ios' && (
          <Pressable onPress={() => setSearch('')}>
            <Feather name="x-circle" size={20} color={colors.textDim} />
          </Pressable>
        )}
      </View>

      {/* List */}
      <FlatList
        data={clientes}
        keyExtractor={(item) => item.codigo_cliente}
        renderItem={renderCliente}
        contentContainerStyle={styles.listContainer}
        ListHeaderComponent={
          <Pressable 
            style={[styles.clienteCard, { backgroundColor: colors.surface, borderColor: !selectedCliente ? colors.primary : 'transparent', borderWidth: 2, marginBottom: 15 }]}
            onPress={() => handleSelect(null)}
          >
            <View style={styles.clienteInfo}>
              <Text style={[styles.clienteName, { color: colors.text }]}>Cliente Casual (Sin asignar)</Text>
              <Text style={[styles.clienteCode, { color: colors.textDim }]}>Para ventas o presupuestos rápidos</Text>
            </View>
            {!selectedCliente && <Feather name="check-circle" size={24} color={colors.primary} />}
          </Pressable>
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 50 }} />
          ) : (
            <Text style={[styles.emptyText, { color: colors.textDim }]}>
              {search ? 'No se encontraron clientes.' : 'Escribe para buscar...'}
            </Text>
          )
        }
      />
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 15,
    marginVertical: 15,
    paddingHorizontal: 15,
    height: 50,
    borderRadius: 12,
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
    paddingHorizontal: 15,
    paddingBottom: 40,
    gap: 10,
  },
  clienteCard: {
    flexDirection: 'row',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clienteInfo: {
    flex: 1,
    marginRight: 10,
  },
  clienteName: {
    fontSize: scaleFont(16),
    fontWeight: '700',
    marginBottom: 4,
  },
  clienteCode: {
    fontSize: scaleFont(13),
    fontWeight: '500',
    marginBottom: 2,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 50,
    fontSize: scaleFont(16),
  },
});
