import { scaleFont } from '../theme/responsive';
import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../theme/ThemeContext';
import { pressScale } from '../theme/motion';
import { PressableScale } from './PressableScale';
import { supabase } from '../lib/supabase';
import { useUserRole, isPrivilegedRole } from '../hooks/useUserRole';
import {
  useRegistrosDirectorio,
  RegistroDirectorio,
  DirectorioTipo,
  DirectorioBackendStatus,
} from '../hooks/useRegistrosDirectorio';
import RegistroClienteModal from './RegistroClienteModal';
import RegistroProveedorModal from './RegistroProveedorModal';

export default function DirectorioView(): React.JSX.Element {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { data: userAuth } = useUserRole();
  const isPrivileged = isPrivilegedRole(userAuth?.role);

  const [subTab, setSubTab] = useState<DirectorioTipo>('cliente');
  const [modalVisible, setModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce búsqueda para optimizar consultas
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset de búsqueda al cambiar sub-tab
  const handleTabChange = (tipo: DirectorioTipo) => {
    setSubTab(tipo);
    setSearch('');
    setDebouncedSearch('');
  };

  // Si un empleado pierde el privilegio estando en Proveedores, volver a Clientes.
  useEffect(() => {
    if (!isPrivileged && subTab === 'proveedor') setSubTab('cliente');
  }, [isPrivileged, subTab]);

  // Realtime: refrescar la cola o tablas al cambiar registros o clientes/proveedores
  useEffect(() => {
    const channel = supabase
      .channel('directorio-realtime-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registro_clientes_app' }, () => {
        queryClient.invalidateQueries({ queryKey: ['registros', 'cliente'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registro_proveedores_app' }, () => {
        queryClient.invalidateQueries({ queryKey: ['registros', 'proveedor'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => {
        queryClient.invalidateQueries({ queryKey: ['registros', 'cliente'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'proveedores' }, () => {
        queryClient.invalidateQueries({ queryKey: ['registros', 'proveedor'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: registros = [], isLoading, refetch } = useRegistrosDirectorio(subTab, debouncedSearch);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const registrarLabel = subTab === 'cliente' ? 'Registrar nuevo cliente' : 'Registrar nuevo proveedor';
  const placeholderSearch = subTab === 'cliente' ? 'Buscar cliente por nombre, RIF o código...' : 'Buscar proveedor por nombre, RIF o código...';

  return (
    <View style={styles.flex}>
      {/* Sub-tabs: Clientes | Proveedores */}
      <View style={[styles.subTabContainer, { backgroundColor: '#0A0A0A', borderColor: colors.border }]}>
        <Pressable
          style={[styles.subTabBtn, subTab === 'cliente' && { backgroundColor: colors.surface, borderColor: '#333' }]}
          onPress={() => handleTabChange('cliente')}
        >
          <Text style={[styles.subTabText, { color: subTab === 'cliente' ? colors.primary : colors.textMuted }]}>Clientes</Text>
        </Pressable>
        {isPrivileged ? (
          <Pressable
            style={[styles.subTabBtn, subTab === 'proveedor' && { backgroundColor: colors.surface, borderColor: '#333' }]}
            onPress={() => handleTabChange('proveedor')}
          >
            <Text style={[styles.subTabText, { color: subTab === 'proveedor' ? colors.primary : colors.textMuted }]}>Proveedores</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Buscador */}
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            placeholder={placeholderSearch}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={[styles.searchInput, { color: colors.text }]}
            selectionColor={colors.primary}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} style={styles.searchClear}>
              <Feather name="x-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <PressableScale
          style={[styles.registrarBtn, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]}
          onPress={() => setModalVisible(true)}
        >
          <Feather name={subTab === 'cliente' ? 'user-plus' : 'plus'} size={18} color={colors.primary} />
          <Text style={[styles.registrarText, { color: colors.primary }]}>{registrarLabel}</Text>
        </PressableScale>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : registros.length === 0 ? (
          <View style={styles.empty}>
            <Feather name={debouncedSearch ? "search" : "users"} size={32} color={colors.textDim} />
            <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>
              {debouncedSearch ? 'Sin resultados' : 'Sin registros'}
            </Text>
            <Text style={[styles.emptySub, { color: colors.textDim }]}>
              {debouncedSearch
                ? `No encontramos nada para "${debouncedSearch}"`
                : `No se encontraron ${subTab === 'cliente' ? 'clientes' : 'proveedores'} registrados.`
              }
            </Text>
          </View>
        ) : (
          registros.map(reg => <RegistroCard key={reg.id} reg={reg} tipo={subTab} />)
        )}

        <View style={{ height: 160 }} />
      </ScrollView>

      <RegistroClienteModal
        visible={modalVisible && subTab === 'cliente'}
        onClose={() => setModalVisible(false)}
        proceedLabel="Entendido"
        onRegistered={() => {
          queryClient.invalidateQueries({ queryKey: ['registros'] });
        }}
      />
      <RegistroProveedorModal
        visible={modalVisible && subTab === 'proveedor'}
        onClose={() => setModalVisible(false)}
        proceedLabel="Entendido"
        onRegistered={() => {
          queryClient.invalidateQueries({ queryKey: ['registros'] });
        }}
      />
    </View>
  );
}

// ── Card de registro ──────────────────────────────────────────────────────────

interface RegistroCardProps {
  reg:  RegistroDirectorio;
  tipo: DirectorioTipo;
}

function RegistroCard({ reg, tipo }: RegistroCardProps): React.JSX.Element {
  const { colors } = useTheme();

  const dateStr = reg.creado_en ? new Date(reg.creado_en).toLocaleString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardTop}>
        <Text style={[styles.cardId, { color: colors.primary }]} numberOfLines={1}>
          {reg.codigo}
        </Text>
        <EstadoChip status={reg.backend_status} codigo={reg.codigo_hybrid ?? null} isOficial={reg.isOficial} />
      </View>

      <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>{reg.nombre}</Text>

      <View style={styles.cardInfoRow}>
        {reg.rif ? (
          <View style={styles.infoBadge}>
            <Feather name="file-text" size={10} color={colors.textMuted} />
            <Text style={[styles.infoBadgeText, { color: colors.textMuted }]}>{reg.rif}</Text>
          </View>
        ) : null}

        {reg.telefono ? (
          <View style={styles.infoBadge}>
            <Feather name="phone" size={10} color={colors.textMuted} />
            <Text style={[styles.infoBadgeText, { color: colors.textMuted }]}>{reg.telefono}</Text>
          </View>
        ) : null}
      </View>

      {tipo === 'cliente' && reg.direccion ? (
        <Text style={[styles.cardSub, { color: colors.textMuted }]} numberOfLines={2}>
          <Feather name="map-pin" size={11} color={colors.textMuted} /> {reg.direccion}
        </Text>
      ) : null}

      {tipo === 'proveedor' && (reg.contacto || reg.email) ? (
        <Text style={[styles.cardSub, { color: colors.textMuted }]} numberOfLines={1}>
          {reg.contacto ? `Contacto: ${reg.contacto}` : ''}
          {reg.contacto && reg.email ? '  ·  ' : ''}
          {reg.email ? `Email: ${reg.email}` : ''}
        </Text>
      ) : null}

      {dateStr || reg.creado_por_nombre ? (
        <Text style={[styles.cardMeta, { color: colors.textDim }]} numberOfLines={1}>
          {dateStr ? `Registrado: ${dateStr}` : ''}
          {dateStr && reg.creado_por_nombre ? '  ·  ' : ''}
          {reg.creado_por_nombre ? `Por: ${reg.creado_por_nombre}` : ''}
        </Text>
      ) : null}

      {reg.backend_status === 'error' && reg.backend_resultado ? (
        <Text style={[styles.cardError, { color: colors.danger }]} numberOfLines={3}>{reg.backend_resultado}</Text>
      ) : null}
    </View>
  );
}

// ── Chip de estado ────────────────────────────────────────────────────────────

interface EstadoChipProps {
  status: DirectorioBackendStatus;
  codigo: string | null;
  isOficial?: boolean;
}

function EstadoChip({ status, codigo, isOficial }: EstadoChipProps): React.JSX.Element {
  const { colors } = useTheme();

  if (isOficial || status === 'oficial') {
    return (
      <View style={[styles.chip, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '40' }]}>
        <Feather name="shield" size={10} color={colors.primary} />
        <Text style={[styles.chipText, { color: colors.primary }]} numberOfLines={1}>
          Oficial
        </Text>
      </View>
    );
  }

  if (status === 'completado') {
    return (
      <View style={[styles.chip, { backgroundColor: colors.success + '18', borderColor: colors.success + '40' }]}>
        <Feather name="check" size={10} color={colors.success} />
        <Text style={[styles.chipText, { color: colors.success }]} numberOfLines={1}>
          {codigo ? `Registrado · ${codigo}` : 'Registrado'}
        </Text>
      </View>
    );
  }

  if (status === 'aplicando') {
    return (
      <View style={[styles.chip, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '40' }]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.chipText, { color: colors.primary }]} numberOfLines={1}>Aplicando…</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={[styles.chip, { backgroundColor: colors.danger + '18', borderColor: colors.danger + '40' }]}>
        <Feather name="alert-triangle" size={10} color={colors.danger} />
        <Text style={[styles.chipText, { color: colors.danger }]} numberOfLines={1}>Error</Text>
      </View>
    );
  }

  return (
    <View style={[styles.chip, { backgroundColor: colors.warning + '18', borderColor: colors.warning + '40' }]}>
      <Feather name="clock" size={10} color={colors.warning} />
      <Text style={[styles.chipText, { color: colors.warning }]} numberOfLines={1}>En cola</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingTop: 4, paddingBottom: 24, gap: 10 },

  subTabContainer: {
    flexDirection:    'row',
    marginHorizontal: 16,
    marginVertical:   12,
    padding:          4,
    borderRadius:     14,
    gap:              4,
    borderWidth:      0.5,
  },
  subTabBtn: {
    flex:            1,
    paddingVertical: 10,
    borderRadius:    10,
    borderWidth:     0.5,
    borderColor:     'transparent',
    alignItems:      'center',
    justifyContent:  'center',
  },
  subTabText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 12,
    borderWidth: 0.5,
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 10 },
  searchInput: {
    flex: 1,
    height: '100%',
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: scaleFont(14),
    paddingVertical: 0,
  },
  searchClear: { padding: 4 },

  registrarBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius:    12,
    borderWidth:     1,
    borderStyle:     'dashed',
  },
  registrarText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  empty: {
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: 60,
    gap:             12,
  },
  emptyTitle: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  emptySub:   { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(20), paddingHorizontal: 24 },

  card: {
    marginHorizontal: 16,
    borderRadius:     12,
    borderWidth:      0.5,
    padding:          14,
    gap:              6,
  },
  cardTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  cardId:   { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold', flexShrink: 1, marginRight: 8 },
  cardName: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  cardInfoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  infoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoBadgeText: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  cardSub:  { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular', marginTop: 2 },
  cardMeta: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', marginTop: 2 },
  cardError: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop:  4,
    lineHeight: scaleFont(15),
  },

  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   3,
    paddingHorizontal: 10,
    maxWidth:          '60%',
  },
  chipText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },
});
