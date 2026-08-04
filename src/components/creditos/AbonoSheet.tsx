import { scaleFont } from '../../theme/responsive';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  ScrollView,
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
import { parseMonto, METODOS, saldoColor, saldoLabel, type CreditoMetodo } from '../../lib/creditos';
import { useRegistrarAbono } from '../../hooks/useCreditoMutations';
import { MontoInput } from './MontoInput';

interface AbonoSheetProps {
  visible:       boolean;
  onClose:       () => void;
  cuentaId:      number;
  saldoActual:   number;
  nombreCuenta:  string;
}

/**
 * Registra un abono a una cuenta. Tiene atajo "Pagar todo" para el caso más
 * común (saldar la deuda completa) y un preview en vivo que muestra el saldo
 * resultante antes de confirmar, incluyendo el caso de pago de más.
 */
export default function AbonoSheet({ visible, onClose, cuentaId, saldoActual, nombreCuenta }: AbonoSheetProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useRegistrarAbono();

  const [monto, setMonto] = useState<string>('');
  const [metodo, setMetodo] = useState<CreditoMetodo>('efectivo');
  const [referencia, setReferencia] = useState<string>('');
  const [nota, setNota] = useState<string>('');
  const enviandoRef = useRef<boolean>(false);

  useEffect(() => {
    if (visible) {
      setMonto('');
      setMetodo('efectivo');
      setReferencia('');
      setNota('');
      enviandoRef.current = false;
    }
  }, [visible]);

  const montoNumerico = parseMonto(monto);
  const puedeGuardar = montoNumerico !== null && !isPending;

  function handlePagarTodo(): void {
    if (saldoActual <= 0) return;
    setMonto(saldoActual.toFixed(2));
  }

  async function handleGuardar(): Promise<void> {
    if (!puedeGuardar || montoNumerico === null || enviandoRef.current) {
      if (montoNumerico === null) notify('Monto inválido', 'Escribe un monto mayor que cero.');
      return;
    }
    enviandoRef.current = true;
    try {
      await mutateAsync({
        cuenta_id:   cuentaId,
        monto_usd:   montoNumerico,
        concepto:    nota.trim().length > 0 ? nota.trim() : 'Abono',
        metodo,
        referencia:  referencia.trim().length > 0 ? referencia.trim() : null,
      });
      const nuevoSaldo = saldoActual - montoNumerico;
      notify('Abono registrado', `Saldo actualizado: ${saldoLabel(nuevoSaldo)} ${formatUSD(Math.abs(nuevoSaldo))}.`);
      onClose();
    } catch (error: any) {
      notify('No se pudo guardar', error?.message ?? 'Intenta de nuevo.');
    } finally {
      enviandoRef.current = false;
    }
  }

  const nuevoSaldoPreview = montoNumerico !== null ? saldoActual - montoNumerico : null;
  const excedente = montoNumerico !== null ? montoNumerico - saldoActual : 0;
  const pagoDeMas = excedente > 0;

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
              <Text style={[styles.titulo, { color: colors.text }]}>Abonar</Text>
              <Text style={[styles.subtitulo, { color: colors.textMuted }]} numberOfLines={1}>
                {nombreCuenta} debe {formatUSD(saldoActual)}
              </Text>
            </View>
            <PressableScale onPress={onClose} hitSlop={8} activeScale={pressScale.icon}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </PressableScale>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.montoWrap}>
              <MontoInput valor={monto} onChange={setMonto} autoFocus />
            </View>

            {saldoActual > 0 && (
              <PressableScale
                onPress={handlePagarTodo}
                style={[styles.pagarTodoChip, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]}
              >
                <Text style={[styles.pagarTodoTexto, { color: colors.primary }]}>
                  Pagar todo ({formatUSD(saldoActual)})
                </Text>
              </PressableScale>
            )}

            <Text style={[styles.etiqueta, { color: colors.textMuted, marginTop: 20 }]}>MÉTODO</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.metodosRow}>
              {METODOS.map((m) => {
                const activo = metodo === m.value;
                return (
                  <PressableScale
                    key={m.value}
                    onPress={() => setMetodo(m.value)}
                    style={[
                      styles.metodoChip,
                      {
                        borderColor: activo ? colors.primary : colors.border,
                        backgroundColor: activo ? colors.primaryFaded : colors.surfaceAlt,
                      },
                    ]}
                  >
                    <Feather name={m.icon as keyof typeof Feather.glyphMap} size={13} color={activo ? colors.primary : colors.textMuted} />
                    <Text style={[styles.metodoTexto, { color: activo ? colors.primary : colors.textMuted }]}>
                      {m.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>

            {metodo !== 'efectivo' && (
              <View style={styles.campo}>
                <Text style={[styles.etiqueta, { color: colors.textMuted }]}>REFERENCIA (OPCIONAL)</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                  placeholder="N° de referencia"
                  placeholderTextColor={colors.textDim}
                  value={referencia}
                  onChangeText={setReferencia}
                />
              </View>
            )}

            <View style={styles.campo}>
              <Text style={[styles.etiqueta, { color: colors.textMuted }]}>NOTA (OPCIONAL)</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                placeholder="Nota (opcional)"
                placeholderTextColor={colors.textDim}
                value={nota}
                onChangeText={setNota}
              />
            </View>

            {nuevoSaldoPreview !== null && (
              <View style={[styles.previewCard, { backgroundColor: colors.surfaceAlt }]}>
                {pagoDeMas ? (
                  <View style={styles.previewAvisoRow}>
                    <Feather name="alert-triangle" size={14} color={colors.warning} />
                    <Text style={[styles.previewAvisoTexto, { color: colors.warning }]}>
                      Está pagando {formatUSD(excedente)} de más. Le quedará ese saldo a favor.
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={[styles.previewLabel, { color: colors.textMuted }]}>Después de este abono:</Text>
                    <Text style={[styles.previewMonto, { color: saldoColor(nuevoSaldoPreview, colors) }]}>
                      {formatUSD(Math.abs(nuevoSaldoPreview))}
                    </Text>
                    <Text style={[styles.previewLabel, { color: saldoColor(nuevoSaldoPreview, colors) }]}>
                      {saldoLabel(nuevoSaldoPreview)}
                    </Text>
                  </>
                )}
              </View>
            )}

            <View style={{ height: 20 }} />
          </ScrollView>

          <PressableScale
            style={[styles.confirmarBtn, { backgroundColor: colors.primary }]}
            dimmed={!puedeGuardar}
            disabled={!puedeGuardar}
            onPress={handleGuardar}
          >
            {isPending ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={[styles.confirmarTexto, { color: colors.onPrimary }]}>Registrar abono</Text>
            )}
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

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
    marginBottom:   12,
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
  montoWrap: {
    paddingVertical: 16,
  },
  pagarTodoChip: {
    alignSelf:         'center',
    borderWidth:       1,
    borderRadius:       999,
    paddingVertical:    8,
    paddingHorizontal:  16,
    marginBottom:       4,
  },
  pagarTodoTexto: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  etiqueta: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom:  8,
  },
  metodosRow: {
    gap:            8,
    paddingBottom:  4,
  },
  metodoChip: {
    flexDirection:      'row',
    alignItems:         'center',
    gap:                6,
    borderWidth:        1,
    borderRadius:       10,
    paddingVertical:    8,
    paddingHorizontal:  12,
  },
  metodoTexto: {
    fontSize:   scaleFont(12),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  campo: {
    marginTop: 16,
  },
  input: {
    fontSize:          scaleFont(14),
    fontFamily:        'JetBrainsMono_400Regular',
    borderWidth:       0.5,
    borderRadius:      10,
    paddingHorizontal: 12,
    paddingVertical:   Platform.OS === 'ios' ? 12 : 8,
  },
  previewCard: {
    marginTop:     20,
    borderRadius:  12,
    padding:       16,
    alignItems:    'center',
  },
  previewLabel: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  previewMonto: {
    fontSize:   scaleFont(28),
    fontFamily: 'JetBrainsMono_700Bold',
    marginVertical: 4,
  },
  previewAvisoRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           8,
  },
  previewAvisoTexto: {
    flex:       1,
    fontSize:   scaleFont(12),
    fontFamily: 'JetBrainsMono_500Medium',
    lineHeight: scaleFont(17),
  },
  confirmarBtn: {
    height:         52,
    borderRadius:   14,
    alignItems:     'center',
    justifyContent: 'center',
    marginTop:      12,
  },
  confirmarTexto: {
    fontSize:   scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
