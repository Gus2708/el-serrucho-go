import { scaleFont } from '../../theme/responsive';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
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
import { useCrearCuenta } from '../../hooks/useCreditoMutations';

interface NuevaCuentaSheetProps {
  visible:    boolean;
  onClose:    () => void;
  /**
   * Devuelve también el nombre ya normalizado. Quien abre este sheet suele
   * necesitar mostrar a quién se le va a cargar algo ("Anotar a María"), y
   * adivinarlo desde fuera lleva a enseñar un nombre que no es el real.
   */
  onCreated:  (cuentaId: number, nombre: string) => void;
}

const NOMBRE_MIN = 3;

/**
 * Abre una cuenta de crédito nueva. Solo el nombre es obligatorio — cédula,
 * teléfono y nota ayudan a ubicar al cliente después, pero no bloquean el alta.
 */
export default function NuevaCuentaSheet({ visible, onClose, onCreated }: NuevaCuentaSheetProps): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useCrearCuenta();

  const [nombre, setNombre] = useState<string>('');
  const [rif, setRif] = useState<string>('');
  const [telefono, setTelefono] = useState<string>('');
  const [nota, setNota] = useState<string>('');
  const enviandoRef = useRef<boolean>(false);

  // Reabrir siempre en blanco: un formulario nunca hereda datos de la vez anterior.
  useEffect(() => {
    if (visible) {
      setNombre('');
      setRif('');
      setTelefono('');
      setNota('');
      enviandoRef.current = false;
    }
  }, [visible]);

  const nombreValido = nombre.trim().length >= NOMBRE_MIN;
  const puedeGuardar = nombreValido && !isPending;

  async function handleGuardar(): Promise<void> {
    if (!puedeGuardar || enviandoRef.current) return;
    enviandoRef.current = true;
    try {
      const nombreLimpio = nombre.trim();
      const id = await mutateAsync({
        nombre:   nombreLimpio,
        documento_id: rif.trim().length > 0 ? rif.trim() : null,
        telefono: telefono.trim().length > 0 ? telefono.trim() : null,
        nota:     nota.trim().length > 0 ? nota.trim() : null,
      });
      onCreated(id, nombreLimpio);
    } catch (error: any) {
      notify('No se pudo guardar', error?.message ?? 'Intenta de nuevo.');
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
            <Text style={[styles.titulo, { color: colors.text }]}>Nueva cuenta</Text>
            <PressableScale onPress={onClose} hitSlop={8} activeScale={pressScale.icon}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </PressableScale>
          </View>

          <View style={styles.campo}>
            <Text style={[styles.etiqueta, { color: colors.textMuted }]}>NOMBRE</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              placeholder="Nombre del cliente"
              placeholderTextColor={colors.textDim}
              value={nombre}
              onChangeText={setNombre}
              autoFocus
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          <View style={styles.campo}>
            <Text style={[styles.etiqueta, { color: colors.textMuted }]}>CÉDULA / RIF (OPCIONAL)</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              placeholder="V-00000000"
              placeholderTextColor={colors.textDim}
              value={rif}
              onChangeText={setRif}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>

          <View style={styles.campo}>
            <Text style={[styles.etiqueta, { color: colors.textMuted }]}>TELÉFONO (OPCIONAL)</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              placeholder="0000-0000000"
              placeholderTextColor={colors.textDim}
              value={telefono}
              onChangeText={setTelefono}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.campo}>
            <Text style={[styles.etiqueta, { color: colors.textMuted }]}>NOTA (OPCIONAL)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              placeholder="Observaciones…"
              placeholderTextColor={colors.textDim}
              value={nota}
              onChangeText={setNota}
              multiline
              numberOfLines={2}
            />
          </View>

          <PressableScale
            style={[styles.confirmarBtn, { backgroundColor: colors.primary }]}
            dimmed={!puedeGuardar}
            disabled={!puedeGuardar}
            onPress={handleGuardar}
          >
            {isPending ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={[styles.confirmarTexto, { color: colors.onPrimary }]}>Crear cuenta</Text>
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
    marginBottom:   20,
  },
  titulo: {
    fontSize:   scaleFont(18),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  campo: {
    marginBottom: 14,
  },
  etiqueta: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom:  6,
  },
  input: {
    fontSize:          scaleFont(14),
    fontFamily:        'JetBrainsMono_400Regular',
    borderWidth:       0.5,
    borderRadius:      10,
    paddingHorizontal: 12,
    paddingVertical:   Platform.OS === 'ios' ? 12 : 8,
  },
  inputMultiline: {
    minHeight:         56,
    textAlignVertical: 'top',
  },
  confirmarBtn: {
    height:         52,
    borderRadius:   14,
    alignItems:     'center',
    justifyContent: 'center',
    marginTop:      6,
  },
  confirmarTexto: {
    fontSize:   scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
