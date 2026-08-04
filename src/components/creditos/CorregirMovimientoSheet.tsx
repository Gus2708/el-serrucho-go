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
import { parseMonto, saldoColor, saldoLabel } from '../../lib/creditos';
import { useCorregirMovimiento } from '../../hooks/useCreditoMutations';
import type { CreditoMovimiento } from '../../lib/supabase';
import { MontoInput } from './MontoInput';

interface CorregirMovimientoSheetProps {
  visible:     boolean;
  onClose:     () => void;
  movimiento:  CreditoMovimiento | null;
  saldoActual: number;
}

/**
 * Corrige un movimiento existente sin borrarlo: el original queda en el
 * historial marcado como corregido, y se registra el ajuste con motivo
 * obligatorio (transparencia total sobre qué cambió y por qué).
 */
export default function CorregirMovimientoSheet({ visible, onClose, movimiento, saldoActual }: CorregirMovimientoSheetProps): React.ReactElement {
  const { colors, formatUSD } = useTheme();
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useCorregirMovimiento();

  const [monto, setMonto] = useState<string>('');
  const [concepto, setConcepto] = useState<string>('');
  const [motivo, setMotivo] = useState<string>('');
  const enviandoRef = useRef<boolean>(false);

  useEffect(() => {
    if (visible && movimiento) {
      setMonto(movimiento.monto_usd.toFixed(2));
      setConcepto(movimiento.concepto);
      setMotivo('');
      enviandoRef.current = false;
    }
  }, [visible, movimiento]);

  if (!movimiento) {
    return <Modal visible={false} transparent />;
  }

  const montoNumerico = parseMonto(monto);
  const motivoValido = motivo.trim().length > 0;
  const puedeGuardar = montoNumerico !== null && motivoValido && !isPending;

  // El saldo actual ya refleja el efecto del movimiento viejo: un cargo suma,
  // un abono resta. Para pasar a "como si siempre hubiera sido montoNuevo",
  // se deshace el efecto del monto viejo y se aplica el del monto nuevo.
  let nuevoSaldoPreview: number | null = null;
  if (montoNumerico !== null) {
    const delta = movimiento.tipo === 'cargo'
      ? montoNumerico - movimiento.monto_usd
      : movimiento.monto_usd - montoNumerico;
    nuevoSaldoPreview = saldoActual + delta;
  }

  async function handleGuardar(): Promise<void> {
    if (!puedeGuardar || montoNumerico === null || !movimiento || enviandoRef.current) return;
    enviandoRef.current = true;
    try {
      await mutateAsync({
        movimiento_id: movimiento.id,
        monto_usd:     montoNumerico,
        concepto:      concepto.trim().length > 0 ? concepto.trim() : undefined,
        motivo:        motivo.trim(),
        cuenta_id:     movimiento.cuenta_id,
      });
      notify('Movimiento corregido', 'El ajuste quedó registrado en el historial.');
      onClose();
    } catch (error: any) {
      notify('No se pudo corregir', error?.message ?? 'Intenta de nuevo.');
    } finally {
      enviandoRef.current = false;
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <Text style={[styles.titulo, { color: colors.text }]}>Corregir movimiento</Text>
            <PressableScale onPress={onClose} hitSlop={8} activeScale={pressScale.icon}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </PressableScale>
          </View>

          <Text style={[styles.explicacion, { color: colors.textMuted }]}>
            El movimiento original no se borra: queda en el historial marcado como corregido.
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={[styles.cardLabel, { color: colors.textMuted }]}>ANTES</Text>
              <Text style={[styles.cardConcepto, { color: colors.text }]} numberOfLines={1}>
                {movimiento.concepto}
              </Text>
              <Text style={[styles.cardMonto, styles.cardMontoTachado, { color: colors.textMuted }]}>
                {formatUSD(movimiento.monto_usd)}
              </Text>
            </View>

            <View style={styles.flechaWrap}>
              <Feather name="arrow-down" size={18} color={colors.textDim} />
            </View>

            <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={[styles.cardLabel, { color: colors.textMuted }]}>AHORA</Text>
              <View style={styles.montoWrap}>
                <MontoInput valor={monto} onChange={setMonto} autoFocus />
              </View>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder="Concepto"
                placeholderTextColor={colors.textDim}
                value={concepto}
                onChangeText={setConcepto}
              />
            </View>

            <View style={styles.campo}>
              <Text style={[styles.etiqueta, { color: colors.textMuted }]}>MOTIVO</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                placeholder="¿Por qué se corrige?"
                placeholderTextColor={colors.textDim}
                value={motivo}
                onChangeText={setMotivo}
              />
              <Text style={[styles.hint, { color: colors.textDim }]}>Queda en el historial para siempre.</Text>
            </View>

            {nuevoSaldoPreview !== null && (
              <View style={[styles.previewCard, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.previewTexto, { color: colors.textMuted }]}>
                  El saldo quedará en{' '}
                  <Text style={{ color: saldoColor(nuevoSaldoPreview, colors), fontFamily: 'JetBrainsMono_700Bold' }}>
                    {formatUSD(Math.abs(nuevoSaldoPreview))} ({saldoLabel(nuevoSaldoPreview)})
                  </Text>
                </Text>
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
              <Text style={[styles.confirmarTexto, { color: colors.onPrimary }]}>Guardar corrección</Text>
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
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   8,
  },
  titulo: {
    fontSize:   scaleFont(18),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  explicacion: {
    fontSize:     scaleFont(11),
    fontFamily:   'JetBrainsMono_400Regular',
    lineHeight:   scaleFont(16),
    marginBottom: 16,
  },
  card: {
    borderWidth:   0.5,
    borderRadius:  12,
    padding:       14,
    alignItems:    'center',
  },
  cardLabel: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_700Bold',
    letterSpacing: 0.4,
    marginBottom:  8,
  },
  cardConcepto: {
    fontSize:     scaleFont(13),
    fontFamily:   'JetBrainsMono_500Medium',
    marginBottom: 6,
  },
  cardMonto: {
    fontSize:   scaleFont(20),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  cardMontoTachado: {
    textDecorationLine: 'line-through',
  },
  flechaWrap: {
    alignItems:      'center',
    paddingVertical: 8,
  },
  montoWrap: {
    paddingVertical: 8,
  },
  input: {
    width:             '100%',
    fontSize:          scaleFont(14),
    fontFamily:        'JetBrainsMono_400Regular',
    borderWidth:       0.5,
    borderRadius:      10,
    paddingHorizontal: 12,
    paddingVertical:   Platform.OS === 'ios' ? 12 : 8,
    marginTop:         4,
  },
  campo: {
    marginTop: 16,
  },
  etiqueta: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom:  8,
  },
  hint: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop:  6,
  },
  previewCard: {
    marginTop:    20,
    borderRadius: 12,
    padding:      14,
  },
  previewTexto: {
    fontSize:   scaleFont(13),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(19),
    textAlign:  'center',
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
