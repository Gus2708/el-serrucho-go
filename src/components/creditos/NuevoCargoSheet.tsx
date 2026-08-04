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
import { useVentasCreditoDisponibles } from '../../hooks/useCreditos';
import { useRegistrarCargo } from '../../hooks/useCreditoMutations';
import type { VentaCreditoDisponible } from '../../lib/supabase';
import { MontoInput } from './MontoInput';

interface NuevoCargoSheetProps {
  visible:      boolean;
  onClose:      () => void;
  cuentaId:     number;
  nombreCuenta: string;
}

type Pestana = 'libre' | 'factura';

/**
 * Agrega deuda a una cuenta ya elegida: venta libre (monto + concepto a mano)
 * o factura existente (busca y elige de las ventas que aún no están cargadas
 * a ninguna cuenta).
 */
export default function NuevoCargoSheet({ visible, onClose, cuentaId, nombreCuenta }: NuevoCargoSheetProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useRegistrarCargo();

  const [pestana, setPestana] = useState<Pestana>('libre');
  const [monto, setMonto] = useState<string>('');
  const [concepto, setConcepto] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [debounced, setDebounced] = useState<string>('');
  const [facturaElegida, setFacturaElegida] = useState<VentaCreditoDisponible | null>(null);
  const enviandoRef = useRef<boolean>(false);

  useEffect(() => {
    if (visible) {
      setPestana('libre');
      setMonto('');
      setConcepto('');
      setSearch('');
      setDebounced('');
      setFacturaElegida(null);
      enviandoRef.current = false;
    }
  }, [visible]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: facturas = [], isLoading: cargandoFacturas } = useVentasCreditoDisponibles(debounced);

  const montoNumerico = parseMonto(monto);
  const conceptoValido = pestana === 'libre'
    ? concepto.trim().length > 0
    : facturaElegida !== null;
  const puedeGuardar = montoNumerico !== null && conceptoValido && !isPending;

  function handleElegirFactura(factura: VentaCreditoDisponible): void {
    setFacturaElegida(factura);
    setMonto(factura.total_usd.toFixed(2));
    setConcepto(`Factura ${factura.documento}`);
  }

  async function handleGuardar(): Promise<void> {
    if (!puedeGuardar || montoNumerico === null || enviandoRef.current) {
      if (montoNumerico === null) notify('Monto inválido', 'Escribe un monto mayor que cero.');
      return;
    }
    // pestana === 'factura' ya probó facturaElegida !== null vía conceptoValido.
    if (pestana === 'factura' && !facturaElegida) return;

    enviandoRef.current = true;
    try {
      await mutateAsync({
        cuenta_id:        cuentaId,
        monto_usd:        montoNumerico,
        concepto:         pestana === 'libre' ? concepto.trim() : `Factura ${facturaElegida!.documento}`,
        origen:           pestana === 'libre' ? 'libre' : 'factura',
        venta_documento:  pestana === 'factura' ? facturaElegida!.documento : null,
      });
      notify('Deuda agregada', `${nombreCuenta} ahora debe ${formatUSD(montoNumerico)} más.`);
      onClose();
    } catch (error: any) {
      notify('No se pudo guardar', error?.message ?? 'Intenta de nuevo.');
    } finally {
      enviandoRef.current = false;
    }
  }

  const renderFactura = useCallback(
    ({ item }: { item: VentaCreditoDisponible }) => (
      <FacturaRow
        factura={item}
        seleccionada={facturaElegida?.documento === item.documento}
        onPress={handleElegirFactura}
      />
    ),
    [facturaElegida?.documento],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.titulo, { color: colors.text }]}>Agregar deuda</Text>
              <Text style={[styles.subtitulo, { color: colors.textMuted }]} numberOfLines={1}>
                {nombreCuenta}
              </Text>
            </View>
            <PressableScale onPress={onClose} hitSlop={8} activeScale={pressScale.icon}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </PressableScale>
          </View>

          <View style={[styles.tabs, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <PressableScale
              style={[styles.tab, pestana === 'libre' && { backgroundColor: colors.primary }]}
              onPress={() => setPestana('libre')}
            >
              <Text style={[styles.tabTexto, { color: pestana === 'libre' ? colors.onPrimary : colors.textMuted }]}>
                Venta libre
              </Text>
            </PressableScale>
            <PressableScale
              style={[styles.tab, pestana === 'factura' && { backgroundColor: colors.primary }]}
              onPress={() => setPestana('factura')}
            >
              <Text style={[styles.tabTexto, { color: pestana === 'factura' ? colors.onPrimary : colors.textMuted }]}>
                Factura
              </Text>
            </PressableScale>
          </View>

          {pestana === 'libre' ? (
            <>
              <View style={styles.montoWrap}>
                <MontoInput valor={monto} onChange={setMonto} autoFocus />
              </View>

              <View style={styles.campo}>
                <Text style={[styles.etiqueta, { color: colors.textMuted }]}>CONCEPTO</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                  placeholder="¿Qué se llevó? Ej: 2 sacos de cemento"
                  placeholderTextColor={colors.textDim}
                  value={concepto}
                  onChangeText={setConcepto}
                />
              </View>

              <Text style={[styles.fechaInfo, { color: colors.textDim }]}>Se registra con fecha de hoy</Text>
            </>
          ) : (
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
                style={styles.facturaLista}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  cargandoFacturas ? (
                    <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
                  ) : (
                    <View style={styles.facturaVacio}>
                      <Text style={[styles.facturaVacioTitulo, { color: colors.textMuted }]}>
                        No hay facturas disponibles
                      </Text>
                      <Text style={[styles.facturaVacioSub, { color: colors.textDim }]}>
                        Todas las facturas recientes ya están asignadas.
                      </Text>
                    </View>
                  )
                }
              />

              {facturaElegida && (
                <View style={styles.montoWrap}>
                  <Text style={[styles.etiqueta, { color: colors.textMuted, textAlign: 'center' }]}>MONTO A CARGAR</Text>
                  <MontoInput valor={monto} onChange={setMonto} />
                  <Text style={[styles.fechaInfo, { color: colors.textDim }]}>Se registra con fecha de hoy</Text>
                </View>
              )}
            </>
          )}

          <PressableScale
            style={[styles.confirmarBtn, { backgroundColor: colors.primary }]}
            dimmed={!puedeGuardar}
            disabled={!puedeGuardar}
            onPress={handleGuardar}
          >
            {isPending ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={[styles.confirmarTexto, { color: colors.onPrimary }]}>Agregar deuda</Text>
            )}
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Fila de factura ──────────────────────────────────────────────────────────

interface FacturaRowProps {
  factura:      VentaCreditoDisponible;
  seleccionada: boolean;
  onPress:      (factura: VentaCreditoDisponible) => void;
}

/** Memoizada: en una lista de facturas, solo repinta la fila cuya selección cambió. */
const FacturaRow = memo(function FacturaRow({ factura, seleccionada, onPress }: FacturaRowProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const handlePress = useCallback(() => onPress(factura), [onPress, factura]);

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
    maxHeight:            '90%',
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
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    marginBottom:   16,
    gap:            12,
  },
  titulo: {
    fontSize:   scaleFont(18),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  subtitulo: {
    fontSize:   scaleFont(12),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop:  2,
  },
  tabs: {
    flexDirection: 'row',
    borderRadius:  10,
    borderWidth:   1,
    padding:       3,
    marginBottom:  8,
  },
  tab: {
    flex:           1,
    paddingVertical: 10,
    borderRadius:    8,
    alignItems:      'center',
  },
  tabTexto: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  montoWrap: {
    paddingVertical: 12,
  },
  campo: {
    marginTop: 8,
  },
  etiqueta: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom:  8,
  },
  input: {
    fontSize:          scaleFont(14),
    fontFamily:        'JetBrainsMono_400Regular',
    borderWidth:       0.5,
    borderRadius:      10,
    paddingHorizontal: 12,
    paddingVertical:   Platform.OS === 'ios' ? 12 : 8,
  },
  fechaInfo: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign:  'center',
    marginTop:  10,
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
  facturaLista: {
    maxHeight: 220,
  },
  facturaRow: {
    flexDirection:      'row',
    alignItems:         'center',
    borderWidth:        1,
    borderRadius:        10,
    padding:             12,
    marginBottom:        8,
    gap:                 10,
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
  facturaVacio: {
    alignItems:    'center',
    paddingVertical: 24,
    gap:           4,
  },
  facturaVacioTitulo: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  facturaVacioSub: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign:  'center',
  },
  confirmarBtn: {
    height:         52,
    borderRadius:   14,
    alignItems:     'center',
    justifyContent: 'center',
    marginTop:      16,
  },
  confirmarTexto: {
    fontSize:   scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
