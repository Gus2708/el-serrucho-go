import { scaleFont } from '../../theme/responsive';
import * as React from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { notify } from '../../lib/notify';
import { PressableScale } from '../PressableScale';
import { pressScale } from '../../theme/motion';
import { parseMonto, fechaCorta } from '../../lib/creditos';
import { useCreditosCuentas, useVentasCreditoDisponibles } from '../../hooks/useCreditos';
import { useResolverCuenta, useRegistrarCargo } from '../../hooks/useCreditoMutations';
import type { VentaCreditoDisponible, CreditoCuenta } from '../../lib/supabase';
import { MontoInput } from './MontoInput';
import NuevaCuentaSheet from './NuevaCuentaSheet';

interface FacturaCreditoSheetProps {
  visible: boolean;
  onClose: () => void;
  onDone:  (cuentaId: number) => void;
}

type Paso = 'factura' | 'beneficiario';

/** Beneficiario resuelto en memoria: puede venir de la lista (CreditoCuenta
 *  completa) o de una cuenta recién creada (solo se conoce id + nombre). */
type Beneficiario = Pick<CreditoCuenta, 'id' | 'nombre'>;

/**
 * Flujo principal: elegir una factura reciente y anotarla a crédito. La
 * factura suele traer un cliente sugerido (el de la venta); si no tiene
 * cuenta todavía, se crea al vuelo antes de registrar el cargo.
 */
export default function FacturaCreditoSheet({ visible, onClose, onDone }: FacturaCreditoSheetProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const { mutateAsync: resolverCuenta } = useResolverCuenta();
  const { mutateAsync: registrarCargo, isPending } = useRegistrarCargo();

  const [paso, setPaso] = useState<Paso>('factura');
  const [search, setSearch] = useState<string>('');
  const [debounced, setDebounced] = useState<string>('');
  const [factura, setFactura] = useState<VentaCreditoDisponible | null>(null);
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState<Beneficiario | null>(null);
  const [sugeridaSeleccionada, setSugeridaSeleccionada] = useState<boolean>(false);
  const [buscarCuenta, setBuscarCuenta] = useState<string>('');
  const [monto, setMonto] = useState<string>('');
  const [nuevaCuentaVisible, setNuevaCuentaVisible] = useState<boolean>(false);
  const enviandoRef = useRef<boolean>(false);

  useEffect(() => {
    if (visible) {
      setPaso('factura');
      setSearch('');
      setDebounced('');
      setFactura(null);
      setCuentaSeleccionada(null);
      setSugeridaSeleccionada(false);
      setBuscarCuenta('');
      setMonto('');
      setNuevaCuentaVisible(false);
      enviandoRef.current = false;
    }
  }, [visible]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: facturas = [], isLoading: cargandoFacturas } = useVentasCreditoDisponibles(debounced);
  const { data: cuentas = [] } = useCreditosCuentas({ search: buscarCuenta });

  function handleElegirFactura(item: VentaCreditoDisponible): void {
    setFactura(item);
    setMonto(item.total_usd.toFixed(2));
    const haySugerido = item.sugerido_nombre !== null;
    setSugeridaSeleccionada(haySugerido);
    setCuentaSeleccionada(null);
    setPaso('beneficiario');
  }

  function handleVolver(): void {
    setPaso('factura');
  }

  function handleElegirCuenta(cuenta: Beneficiario): void {
    setCuentaSeleccionada(cuenta);
    setSugeridaSeleccionada(false);
  }

  function handleElegirSugerida(): void {
    setSugeridaSeleccionada(true);
    setCuentaSeleccionada(null);
  }

  function handleCuentaCreada(cuentaId: number, nombre: string): void {
    setCuentaSeleccionada({ id: cuentaId, nombre });
    setSugeridaSeleccionada(false);
    setNuevaCuentaVisible(false);
  }

  /**
   * Encuentra o crea la cuenta del beneficiario final.
   *
   * La persona sugerida por la factura puede no tener cuenta todavía. El
   * find-or-create es ATÓMICO en el servidor (`creditos_resolver_cuenta`), así
   * que si dos cajeros anotan facturas a la misma persona nueva a la vez, uno
   * la crea y el otro recibe ese mismo id — nadie pierde el cargo y no nacen
   * cuentas duplicadas.
   */
  async function resolverCuentaId(): Promise<number> {
    if (cuentaSeleccionada) return cuentaSeleccionada.id;
    if (!sugeridaSeleccionada || !factura?.sugerido_nombre) {
      throw new Error('Elige a quién anotarle esta factura.');
    }

    return resolverCuenta({
      nombre:         factura.sugerido_nombre,
      cliente_codigo: factura.sugerido_codigo ?? null,
      telefono:       factura.sugerido_telefono ?? null,
    });
  }

  const montoNumerico = parseMonto(monto);
  const hayBeneficiario = cuentaSeleccionada !== null || sugeridaSeleccionada;
  const puedeConfirmar = hayBeneficiario && montoNumerico !== null && !isPending;
  // Nombre a mostrar en todos los textos de confirmación: el de la cuenta
  // elegida, o el sugerido por la factura, o un genérico si aún no hay ninguno.
  const nombreBeneficiario = cuentaSeleccionada?.nombre ?? factura?.sugerido_nombre ?? 'la cuenta';

  async function handleConfirmar(): Promise<void> {
    if (!puedeConfirmar || !factura || montoNumerico === null || enviandoRef.current) return;
    enviandoRef.current = true;
    try {
      const cuentaId = await resolverCuentaId();
      await registrarCargo({
        cuenta_id:        cuentaId,
        monto_usd:        montoNumerico,
        origen:           'factura',
        venta_documento:  factura.documento,
        concepto:         `Factura ${factura.documento}`,
      });
      notify('Anotado', `${nombreBeneficiario} ahora debe ${formatUSD(montoNumerico)} más.`);
      onDone(cuentaId);
      onClose();
    } catch (error: any) {
      // Si el servidor avisa que la factura ya está cargada, se queda en el
      // sheet para que el usuario elija otra — no tiene sentido cerrar.
      notify('No se pudo anotar', error?.message ?? 'Intenta de nuevo.');
    } finally {
      enviandoRef.current = false;
    }
  }

  const renderFactura = useCallback(
    ({ item }: { item: VentaCreditoDisponible }) => (
      <FacturaRow factura={item} onPress={handleElegirFactura} />
    ),
    [],
  );

  const renderCuenta = useCallback(
    ({ item }: { item: CreditoCuenta }) => (
      <CuentaRow
        cuenta={item}
        seleccionada={cuentaSeleccionada?.id === item.id}
        onPress={handleElegirCuenta}
      />
    ),
    [cuentaSeleccionada?.id],
  );

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />

            <View style={styles.header}>
              {paso === 'beneficiario' ? (
                <PressableScale onPress={handleVolver} hitSlop={8} activeScale={pressScale.icon}>
                  <Feather name="chevron-left" size={22} color={colors.textMuted} />
                </PressableScale>
              ) : (
                <View style={{ width: 22 }} />
              )}
              <Text style={[styles.titulo, { color: colors.text }]}>Factura a crédito</Text>
              <PressableScale onPress={onClose} hitSlop={8} activeScale={pressScale.icon}>
                <Feather name="x" size={22} color={colors.textMuted} />
              </PressableScale>
            </View>

            {paso === 'factura' ? (
              <>
                <View style={[styles.buscador, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  <Feather name="search" size={16} color={colors.textDim} />
                  <TextInput
                    style={[styles.buscadorInput, { color: colors.text }]}
                    placeholder="Buscar factura por número o cliente"
                    placeholderTextColor={colors.textDim}
                    value={search}
                    onChangeText={setSearch}
                  />
                </View>

                <FlatList
                  data={facturas}
                  keyExtractor={(item) => item.documento}
                  renderItem={renderFactura}
                  style={styles.lista}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={
                    cargandoFacturas ? (
                      <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
                    ) : (
                      <View style={styles.vacio}>
                        <Text style={[styles.vacioTitulo, { color: colors.textMuted }]}>
                          No hay facturas disponibles
                        </Text>
                        <Text style={[styles.vacioSub, { color: colors.textDim }]}>
                          Todas las facturas recientes ya están asignadas.
                        </Text>
                      </View>
                    )
                  }
                />
              </>
            ) : (
              <View style={{ flex: 1 }}>
                {factura && (
                  <View style={[styles.resumenCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                    <Text style={[styles.resumenDocumento, { color: colors.text }]}>Factura {factura.documento}</Text>
                    <Text style={[styles.resumenFecha, { color: colors.textMuted }]}>{fechaCorta(factura.fecha_emision)}</Text>
                    <Text style={[styles.resumenTotal, { color: colors.primary }]}>{formatUSD(factura.total_usd)}</Text>
                  </View>
                )}

                <Text style={[styles.seccionTitulo, { color: colors.text }]}>¿A quién se lo anotamos?</Text>

                {factura?.sugerido_nombre ? (
                  <PressableScale onPress={handleElegirSugerida}>
                    <View
                      style={[
                        styles.sugeridaCard,
                        {
                          borderColor: sugeridaSeleccionada ? colors.primary : colors.border,
                          backgroundColor: sugeridaSeleccionada ? colors.primaryFaded : colors.surfaceAlt,
                          borderWidth: sugeridaSeleccionada ? 2 : 0.5,
                        },
                      ]}
                    >
                      <View style={[styles.sugeridaChip, { backgroundColor: colors.primary }]}>
                        <Text style={[styles.sugeridaChipTexto, { color: colors.onPrimary }]}>SUGERIDO</Text>
                      </View>
                      <Text style={[styles.sugeridaNombre, { color: colors.text }]} numberOfLines={1}>
                        {factura.sugerido_nombre}
                      </Text>
                      <Text style={[styles.sugeridaSub, { color: colors.textMuted }]}>
                        Es el cliente de esta factura
                      </Text>
                      {sugeridaSeleccionada && (
                        <Feather name="check-circle" size={20} color={colors.primary} style={styles.sugeridaCheck} />
                      )}
                    </View>
                  </PressableScale>
                ) : (
                  <View style={styles.infoNota}>
                    <Feather name="info" size={14} color={colors.textMuted} />
                    <Text style={[styles.infoNotaTexto, { color: colors.textMuted }]}>
                      Esta factura salió como cliente natural. Elige a quién anotársela.
                    </Text>
                  </View>
                )}

                <Text style={[styles.etiqueta, { color: colors.textMuted, marginTop: 16 }]}>OTRA PERSONA</Text>
                <View style={[styles.buscador, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  <Feather name="search" size={16} color={colors.textDim} />
                  <TextInput
                    style={[styles.buscadorInput, { color: colors.text }]}
                    placeholder="Buscar cuenta existente"
                    placeholderTextColor={colors.textDim}
                    value={buscarCuenta}
                    onChangeText={setBuscarCuenta}
                  />
                </View>

                <FlatList
                  data={cuentas}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={renderCuenta}
                  style={styles.listaCuentas}
                  keyboardShouldPersistTaps="handled"
                />

                <PressableScale
                  onPress={() => setNuevaCuentaVisible(true)}
                  style={[styles.crearCuentaBtn, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]}
                >
                  <Text style={[styles.crearCuentaTexto, { color: colors.primary }]}>＋ Crear cuenta nueva</Text>
                </PressableScale>

                <View style={styles.montoWrap}>
                  <Text style={[styles.etiqueta, { color: colors.textMuted, textAlign: 'center' }]}>MONTO</Text>
                  <MontoInput valor={monto} onChange={setMonto} />
                </View>

                <PressableScale
                  style={[styles.confirmarBtn, { backgroundColor: colors.primary }]}
                  dimmed={!puedeConfirmar}
                  disabled={!puedeConfirmar}
                  onPress={handleConfirmar}
                >
                  {isPending ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={[styles.confirmarTexto, { color: colors.onPrimary }]} numberOfLines={1}>
                      Anotar a {nombreBeneficiario}
                    </Text>
                  )}
                </PressableScale>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <NuevaCuentaSheet
        visible={nuevaCuentaVisible}
        onClose={() => setNuevaCuentaVisible(false)}
        onCreated={handleCuentaCreada}
      />
    </>
  );
}

// ── Filas de lista (memoizadas — dispatcher pattern) ─────────────────────────

interface FacturaRowProps {
  factura: VentaCreditoDisponible;
  onPress: (factura: VentaCreditoDisponible) => void;
}

const FacturaRow = memo(function FacturaRow({ factura, onPress }: FacturaRowProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const handlePress = useCallback(() => onPress(factura), [onPress, factura]);

  return (
    <PressableScale
      onPress={handlePress}
      style={[styles.facturaRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.facturaDocumento, { color: colors.text }]}>Factura {factura.documento}</Text>
        <Text style={[styles.facturaSub, { color: colors.textMuted }]} numberOfLines={1}>
          {fechaCorta(factura.fecha_emision)} · {factura.sugerido_nombre ?? 'Cliente natural'}
        </Text>
      </View>
      <Text style={[styles.facturaMonto, { color: colors.primary }]}>{formatUSD(factura.total_usd)}</Text>
    </PressableScale>
  );
});

interface CuentaRowProps {
  cuenta:       CreditoCuenta;
  seleccionada: boolean;
  onPress:      (cuenta: Beneficiario) => void;
}

const CuentaRow = memo(function CuentaRow({ cuenta, seleccionada, onPress }: CuentaRowProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const handlePress = useCallback(() => onPress(cuenta), [onPress, cuenta]);

  return (
    <PressableScale
      onPress={handlePress}
      style={[
        styles.facturaRow,
        {
          backgroundColor: seleccionada ? colors.primaryFaded : colors.surfaceAlt,
          borderColor:     seleccionada ? colors.primary : colors.border,
        },
      ]}
    >
      <Text style={[styles.facturaDocumento, { color: colors.text }]} numberOfLines={1}>{cuenta.nombre}</Text>
      <Text style={[styles.facturaMonto, { color: colors.textMuted }]}>{formatUSD(cuenta.saldo)}</Text>
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent:  'flex-end',
  },
  sheet: {
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    paddingHorizontal:    20,
    paddingTop:           10,
    height:               '90%',
  },
  grabber: {
    width:        36,
    height:       4,
    borderRadius: 2,
    alignSelf:    'center',
    marginBottom: 16,
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   16,
  },
  titulo: {
    fontSize:   scaleFont(17),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  buscador: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    borderWidth:       0.5,
    borderRadius:      10,
    paddingHorizontal: 12,
    paddingVertical:   Platform.OS === 'ios' ? 10 : 6,
    marginBottom:      10,
  },
  buscadorInput: {
    flex:       1,
    fontSize:   scaleFont(14),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  lista: {
    flex: 1,
  },
  vacio: {
    alignItems:      'center',
    paddingVertical: 24,
    gap:             4,
  },
  vacioTitulo: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  vacioSub: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign:  'center',
  },
  facturaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'space-between',
    borderWidth:   1,
    borderRadius:  10,
    padding:       12,
    marginBottom:  8,
    gap:           10,
  },
  facturaDocumento: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  facturaSub: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop:  2,
  },
  facturaMonto: {
    fontSize:   scaleFont(14),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  resumenCard: {
    borderWidth:   0.5,
    borderRadius:  12,
    padding:       14,
    alignItems:    'center',
    marginBottom:  16,
  },
  resumenDocumento: {
    fontSize:   scaleFont(14),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  resumenFecha: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop:  2,
  },
  resumenTotal: {
    fontSize:   scaleFont(24),
    fontFamily: 'JetBrainsMono_700Bold',
    marginTop:  6,
  },
  seccionTitulo: {
    fontSize:     scaleFont(14),
    fontFamily:   'JetBrainsMono_700Bold',
    marginBottom: 10,
  },
  sugeridaCard: {
    borderRadius:  12,
    padding:       14,
    position:      'relative',
  },
  sugeridaChip: {
    alignSelf:          'flex-start',
    borderRadius:       6,
    paddingVertical:    2,
    paddingHorizontal:  6,
    marginBottom:       8,
  },
  sugeridaChipTexto: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_700Bold',
    letterSpacing: 0.4,
  },
  sugeridaNombre: {
    fontSize:   scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  sugeridaSub: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop:  2,
  },
  sugeridaCheck: {
    position: 'absolute',
    top:      14,
    right:    14,
  },
  infoNota: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           8,
    paddingVertical: 4,
  },
  infoNotaTexto: {
    flex:       1,
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(16),
  },
  etiqueta: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom:  8,
  },
  listaCuentas: {
    maxHeight: 140,
  },
  crearCuentaBtn: {
    borderWidth:       1,
    borderRadius:      10,
    paddingVertical:   10,
    alignItems:        'center',
    marginTop:         4,
  },
  crearCuentaTexto: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  montoWrap: {
    paddingVertical: 12,
  },
  confirmarBtn: {
    height:         52,
    borderRadius:   14,
    alignItems:     'center',
    justifyContent: 'center',
    marginTop:      4,
    paddingHorizontal: 12,
  },
  confirmarTexto: {
    fontSize:   scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
