import * as React from 'react';
import { useEffect, useState } from 'react';
import { View, Text, Modal, StyleSheet, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { pressScale } from '../theme/motion';
import { PressableScale } from './PressableScale';

interface GuardarBorradorModalProps {
  visible:        boolean;
  defaultTitulo:  string;
  placeholder:    string;
  itemCount:      number;
  isSaving:       boolean;
  onClose:        () => void;
  onSave:         (titulo: string) => void;
}

const TITULO_MAX = 60;

/**
 * Pide un nombre para la lista antes de guardarla como borrador. El nombre es
 * lo único que el usuario ve en la pestaña Borradores, así que se exige.
 */
export default function GuardarBorradorModal({
  visible,
  defaultTitulo,
  placeholder,
  itemCount,
  isSaving,
  onClose,
  onSave,
}: GuardarBorradorModalProps): React.JSX.Element {
  const { colors } = useTheme();
  const [titulo, setTitulo] = useState<string>(defaultTitulo);

  // Al reabrir, arranca del nombre actual del borrador (si ya tenía uno).
  useEffect(() => {
    if (visible) setTitulo(defaultTitulo);
  }, [visible, defaultTitulo]);

  const canSave = titulo.trim().length > 0 && !isSaving;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Feather name="bookmark" size={16} color={colors.primary} />
              <Text style={[styles.title, { color: colors.text }]}>Guardar borrador</Text>
            </View>
            <PressableScale onPress={onClose} hitSlop={8} activeScale={pressScale.icon}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </PressableScale>
          </View>

          <Text style={[styles.sub, { color: colors.textMuted }]}>
            La lista de {itemCount} ítem{itemCount === 1 ? '' : 's'} queda guardada sin emitirse. Puedes retomarla
            cuando quieras desde la pestaña Borradores.
          </Text>

          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            placeholder={placeholder}
            placeholderTextColor={colors.textDim}
            value={titulo}
            onChangeText={setTitulo}
            maxLength={TITULO_MAX}
            autoFocus
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => { if (canSave) onSave(titulo); }}
          />

          <PressableScale
            style={[styles.saveBtn, { backgroundColor: colors.primary }]}
            dimmed={!canSave}
            disabled={!canSave}
            onPress={() => onSave(titulo)}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <>
                <Feather name="save" size={16} color={colors.onPrimary} />
                <Text style={[styles.saveBtnText, { color: colors.onPrimary }]}>Guardar</Text>
              </>
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
    justifyContent:  'center',
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 18,
    borderWidth:  0.5,
    padding:      18,
    gap:          12,
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:    { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  sub:      { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(16) },
  input: {
    fontSize:          scaleFont(14),
    fontFamily:        'JetBrainsMono_400Regular',
    borderWidth:       0.5,
    borderRadius:      10,
    paddingHorizontal: 12,
    paddingVertical:   Platform.OS === 'ios' ? 12 : 8,
  },
  saveBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
    borderRadius:    12,
    paddingVertical: 13,
  },
  saveBtnText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
});
