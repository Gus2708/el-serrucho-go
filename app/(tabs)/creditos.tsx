import { scaleFont } from '../../src/theme/responsive';
import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeContext';
import { useCreditosCuentas, useCreditosResumen } from '../../src/hooks/useCreditos';
import { useUserRole, isPrivilegedRole } from '../../src/hooks/useUserRole';
import { PressableScale } from '../../src/components/PressableScale';
import { FadeIn } from '../../src/components/FadeIn';
import { CuentaCard } from '../../src/components/creditos/CuentaCard';
import NuevaCuentaSheet from '../../src/components/creditos/NuevaCuentaSheet';
import FacturaCreditoSheet from '../../src/components/creditos/FacturaCreditoSheet';
import { pressScale } from '../../src/theme/motion';
import type { CreditoCuenta } from '../../src/lib/supabase';

type FiltroChip = 'deben' | 'al_dia' | 'cerradas';

const CHIPS: { key: FiltroChip; label: string }[] = [
  { key: 'deben',    label: 'Deben'    },
  { key: 'al_dia',   label: 'Al día'   },
  { key: 'cerradas', label: 'Cerradas' },
];

/** Plural correcto: "1 persona debe" vs "3 personas deben". */
function personasLabel(num: number): string {
  return num === 1 ? '1 persona debe' : `${num} personas deben`;
}

export default function Creditos(): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filtro, setFiltro] = useState<FiltroChip>('deben');
  const [nuevaCuentaVisible, setNuevaCuentaVisible] = useState(false);
  const [facturaVisible, setFacturaVisible]         = useState(false);

  const { data: userAuth } = useUserRole();
  const puedeCrear = isPrivilegedRole(userAuth?.role);

  // Debounce de 350ms — evitar refetch en cada tecla.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const incluirCerradas = filtro === 'cerradas';
  const {
    data: cuentas = [],
    isLoading: isLoadingCuentas,
    isRefetching: isRefetchingCuentas,
    refetch: refetchCuentas,
  } = useCreditosCuentas({ search: debouncedSearch, incluirCerradas });

  const {
    data: resumen,
    isLoading: isLoadingResumen,
    refetch: refetchResumen,
  } = useCreditosResumen();

  const isLoading = isLoadingCuentas || isLoadingResumen;

  // Filtro en cliente sobre el resultado del hook (salvo "Cerradas", que ya viene filtrado por incluirCerradas).
  const cuentasFiltradas = useMemo(() => {
    if (filtro === 'deben') return cuentas.filter(c => c.saldo > 0.005);
    if (filtro === 'al_dia') return cuentas.filter(c => c.saldo <= 0.005 && c.saldo >= -0.005);
    return cuentas.filter(c => c.estado === 'cerrada');
  }, [cuentas, filtro]);

  const handleRefresh = useCallback(() => {
    refetchCuentas();
    refetchResumen();
  }, [refetchCuentas, refetchResumen]);

  const handlePress = useCallback((id: number) => {
    router.push({ pathname: '/credito/[id]', params: { id: String(id) } });
  }, [router]);

  const renderItem = useCallback(
    ({ item, index }: { item: CreditoCuenta; index: number }) => (
      <CuentaCard cuenta={item} index={index} onPress={handlePress} />
    ),
    [handlePress]
  );

  const keyExtractor = useCallback((c: CreditoCuenta) => String(c.id), []);

  // Tras crear una cuenta o anotar una factura, llevamos al usuario a la cuenta:
  // acaba de mover dinero y lo primero que quiere ver es cómo quedó el saldo.
  const handleCreated = useCallback((cuentaId: number) => {
    setNuevaCuentaVisible(false);
    setFacturaVisible(false);
    router.push({ pathname: '/credito/[id]', params: { id: String(cuentaId) } });
  }, [router]);

  const totalPorCobrar = resumen?.total_por_cobrar ?? 0;
  const totalAFavor = resumen?.total_a_favor ?? 0;
  const cuentasConDeuda = resumen?.cuentas_con_deuda ?? 0;
  const hayDeuda = totalPorCobrar > 0;

  // FAB debe quedar por encima de la barra flotante (~18px + 60px de alto + margen).
  const fabBottom = insets.bottom + 96;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
          Créditos
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
          Quién debe y cuánto
        </Text>
      </View>

      {/* Tarjeta hero */}
      <FadeIn style={styles.heroWrap}>
        <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.heroLabel, { color: colors.textMuted }]}>EN LA CALLE</Text>
          <Text
            style={[styles.heroValue, { color: hayDeuda ? colors.danger : colors.success }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatUSD(totalPorCobrar)}
          </Text>
          <Text style={[styles.heroSub, { color: colors.textMuted }]} numberOfLines={1}>
            {personasLabel(cuentasConDeuda)}
            {totalAFavor > 0 && (
              <Text style={{ color: colors.primary }}> · {formatUSD(totalAFavor)} a favor de clientes</Text>
            )}
          </Text>
        </View>
      </FadeIn>

      {/* Buscador */}
      <View style={[styles.searchWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Buscar por nombre, cédula o teléfono"
          placeholderTextColor={colors.textDim}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <PressableScale onPress={() => setSearch('')} hitSlop={8} activeScale={pressScale.icon}>
            <Feather name="x" size={16} color={colors.textMuted} />
          </PressableScale>
        )}
      </View>

      {/* Chips de filtro */}
      <View style={styles.chipsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          {CHIPS.map(chip => {
            const active = filtro === chip.key;
            return (
              <PressableScale
                key={chip.key}
                activeScale={pressScale.row}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primaryFaded : colors.surfaceAlt,
                    borderColor:     active ? colors.primary + '30' : colors.border,
                  },
                ]}
                onPress={() => setFiltro(chip.key)}
              >
                <Text
                  style={[styles.chipText, { color: active ? colors.primary : colors.textMuted }]}
                  numberOfLines={1}
                >
                  {chip.label}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>

      {/* Lista */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : cuentasFiltradas.length === 0 ? (
        <EmptyState filtro={filtro} totalCuentas={cuentas.length} colors={colors} />
      ) : (
        <FlashList
          data={cuentasFiltradas}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={88}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetchingCuentas}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        />
      )}

      {/* Solo roles privilegiados escriben. Dos acciones, sin menús:
          anotar una factura es lo que se hace a diario (el cajero ya la cobró);
          crear una cuenta vacía es raro, así que va en segundo plano. */}
      {puedeCrear && (
        <>
          <PressableScale
            activeScale={pressScale.button}
            onPress={() => setNuevaCuentaVisible(true)}
            style={[
              styles.fab,
              styles.fabSecundario,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border, bottom: fabBottom + 58 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Nueva cuenta"
          >
            <Feather name="user-plus" size={16} color={colors.text} />
            <Text style={[styles.fabTextSecundario, { color: colors.text }]}>Nueva cuenta</Text>
          </PressableScale>

          <PressableScale
            activeScale={pressScale.button}
            onPress={() => setFacturaVisible(true)}
            style={[styles.fab, { backgroundColor: colors.primary, bottom: fabBottom }]}
            accessibilityRole="button"
            accessibilityLabel="Anotar una factura a crédito"
          >
            <Feather name="file-plus" size={18} color={colors.onPrimary} />
            <Text style={[styles.fabText, { color: colors.onPrimary }]}>Anotar factura</Text>
          </PressableScale>
        </>
      )}

      <NuevaCuentaSheet
        visible={nuevaCuentaVisible}
        onClose={() => setNuevaCuentaVisible(false)}
        onCreated={handleCreated}
      />

      <FacturaCreditoSheet
        visible={facturaVisible}
        onClose={() => setFacturaVisible(false)}
        onDone={handleCreated}
      />
    </SafeAreaView>
  );
}

interface EmptyStateProps {
  filtro: FiltroChip;
  totalCuentas: number;
  colors: ReturnType<typeof useTheme>['colors'];
}

function EmptyState({ filtro, totalCuentas, colors }: EmptyStateProps): React.ReactElement {
  // Sin cuentas del todo (ningún crédito registrado nunca).
  if (totalCuentas === 0 && filtro !== 'cerradas') {
    return (
      <View style={styles.center}>
        <Feather name="users" size={32} color={colors.textDim} />
        <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Todavía no hay créditos</Text>
        <Text style={[styles.emptySub, { color: colors.textDim }]}>
          Cuando le fíes a alguien, aparecerá aquí.
        </Text>
      </View>
    );
  }

  // Filtro "Deben" vacío pero sí hay cuentas — buena noticia.
  if (filtro === 'deben') {
    return (
      <View style={styles.center}>
        <Feather name="check-circle" size={32} color={colors.success} />
        <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Nadie debe nada</Text>
        <Text style={[styles.emptySub, { color: colors.textDim }]}>
          Todas las cuentas están al día.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Feather name="package" size={32} color={colors.textDim} />
      <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Sin resultados</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingTop:        12,
    marginBottom:      16,
  },
  title:    { fontSize: scaleFont(26), fontFamily: 'JetBrainsMono_700Bold' },
  subtitle: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular', marginTop: 2 },

  heroWrap: {
    marginHorizontal: 16,
    marginBottom:     16,
  },
  hero: {
    borderRadius:  16,
    borderWidth:   0.5,
    padding:       18,
    gap:           6,
  },
  heroLabel: {
    fontSize:      scaleFont(11),
    fontFamily:    'JetBrainsMono_500Medium',
    letterSpacing: 0.6,
  },
  heroValue: {
    fontSize:      scaleFont(34),
    fontFamily:    'JetBrainsMono_700Bold',
    letterSpacing: -0.5,
  },
  heroSub: {
    fontSize:   scaleFont(12),
    fontFamily: 'JetBrainsMono_400Regular',
  },

  searchWrap: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    marginHorizontal:  16,
    marginBottom:      10,
    paddingHorizontal: 14,
    height:            44,
    borderRadius:      12,
    borderWidth:       0.5,
  },
  searchInput: {
    flex:       1,
    fontSize:   scaleFont(15),
    fontFamily: 'JetBrainsMono_400Regular',
  },

  chipsContainer: {
    marginBottom: 12,
  },
  chipsContent: {
    paddingHorizontal: 16,
    flexDirection:     'row',
    gap:               8,
  },
  chip: {
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   6,
    paddingHorizontal: 14,
  },
  chipText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium' },

  list: {
    paddingTop:    4,
    paddingBottom: 140,
  },

  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    paddingBottom:  80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize:   scaleFont(14),
    fontFamily: 'JetBrainsMono_500Medium',
    marginTop:  4,
  },
  emptySub: {
    fontSize:   scaleFont(12),
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign:  'center',
  },

  fab: {
    position:          'absolute',
    right:              16,
    flexDirection:      'row',
    alignItems:         'center',
    gap:                8,
    paddingVertical:    14,
    paddingHorizontal:  20,
    borderRadius:       999,
    shadowColor:        '#000',
    shadowOffset:       { width: 0, height: 4 },
    shadowOpacity:      0.3,
    shadowRadius:        8,
    elevation:           8,
  },
  fabText: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  // La acción secundaria pesa menos: sin sombra, más compacta, con borde en vez
  // de relleno. Se ve que es una opción, no el camino principal.
  fabSecundario: {
    paddingVertical:   10,
    paddingHorizontal: 16,
    borderWidth:       0.5,
    shadowOpacity:     0,
    elevation:         0,
  },
  fabTextSecundario: {
    fontSize:   scaleFont(12),
    fontFamily: 'JetBrainsMono_500Medium',
  },
});
