import { scaleFont } from '../theme/responsive';
import * as React from 'react';
import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { notify } from '../lib/notify';
import { PressableScale } from './PressableScale';
import { useRegistrarProveedor } from '../hooks/useRegistrarProveedor';
import RegistroStatusModal, { RegisteredData } from './RegistroStatusModal';

interface RegistroProveedorModalProps {
  visible:       boolean;
  onClose:       () => void;
  onRegistered?: (id: number, data?: RegisteredData) => void;
  proceedLabel?: string;
}

export default function RegistroProveedorModal({ visible, onClose, onRegistered, proceedLabel }: RegistroProveedorModalProps): React.JSX.Element {
  const { colors } = useTheme();
  const { mutateAsync, isPending } = useRegistrarProveedor();

  const [nombre, setNombre]     = useState<string>('');
  const [rif, setRif]           = useState<string>('');
  const [telefono, setTelefono] = useState<string>('');
  const [contacto, setContacto] = useState<string>('');
  const [email, setEmail]       = useState<string>('');
  const [nota, setNota]         = useState<string>('');

  const [showStatusModal, setShowStatusModal] = useState<boolean>(false);
  const [submittedData, setSubmittedData]     = useState<{ id: number; nombre: string; rif: string; telefono?: string } | null>(null);

  function resetForm(): void {
    setNombre('');
    setRif('');
    setTelefono('');
    setContacto('');
    setEmail('');
    setNota('');
    setSubmittedData(null);
    setShowStatusModal(false);
  }

  function handleClose(): void {
    resetForm();
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (nombre.trim().length === 0) {
      notify('Falta información', 'El nombre es obligatorio.');
      return;
    }
    if (rif.trim().length === 0) {
      notify('Falta información', 'El RIF es obligatorio: de él se genera el código en el POS.');
      return;
    }
    try {
      const { id } = await mutateAsync({ nombre, rif, telefono, contacto, email, nota });
      setSubmittedData({ id, nombre: nombre.trim().toUpperCase(), rif: rif.trim().toUpperCase(), telefono });
      setShowStatusModal(true);
    } catch (e: any) {
      notify('Error', e?.message ?? 'No se pudo registrar el proveedor.');
    }
  }

  function handleStatusProceed(data: RegisteredData): void {
    setShowStatusModal(false);
    onRegistered?.(data.id, data);
    resetForm();
    onClose();
  }

  function handleStatusClose(): void {
    if (submittedData) {
      onRegistered?.(submittedData.id);
    }
    setShowStatusModal(false);
    resetForm();
    onClose();
  }

  return (
    <>
      <Modal visible={visible && !showStatusModal} animationType="slide" transparent onRequestClose={handleClose}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Registrar proveedor</Text>
              <Pressable onPress={handleClose} hitSlop={8}>
                <Feather name="x" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={[styles.infoBanner, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
              <Feather name="truck" size={15} color={colors.primary} style={styles.infoBannerIcon} />
              <View style={styles.infoBannerTextContainer}>
                <Text style={[styles.infoBannerTitle, { color: colors.primary }]}>Registro automático en Hybrid</Text>
                <Text style={[styles.infoBannerSub, { color: colors.textMuted }]}>
                  El proveedor se dará de alta en el POS y aparecerá listo para usar en tu compra.
                </Text>
              </View>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <LabeledInput label="NOMBRE / RAZÓN SOCIAL *" value={nombre} onChangeText={setNombre} placeholder="Nombre del proveedor" autoCapitalize="characters" />
              <LabeledInput label="RIF *" value={rif} onChangeText={setRif} placeholder="J-000000000" autoCapitalize="characters" />
              <LabeledInput label="TELÉFONO" value={telefono} onChangeText={setTelefono} placeholder="0000-0000000" keyboardType="phone-pad" />
              <LabeledInput label="CONTACTO" value={contacto} onChangeText={setContacto} placeholder="Persona de contacto (opcional)" />
              <LabeledInput label="EMAIL" value={email} onChangeText={setEmail} placeholder="correo@proveedor.com" keyboardType="email-address" autoCapitalize="none" />
              <LabeledInput label="NOTA" value={nota} onChangeText={setNota} placeholder="Observaciones (opcional)" multiline />

              <PressableScale
                style={[styles.formSubmitBtn, { backgroundColor: colors.primary }]}
                dimmed={isPending}
                disabled={isPending}
                onPress={handleSubmit}
              >
                {isPending ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <>
                    <Feather name="send" size={16} color={colors.onPrimary} />
                    <Text style={[styles.formSubmitText, { color: colors.onPrimary }]}>Registrar proveedor</Text>
                  </>
                )}
              </PressableScale>

              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {submittedData && (
        <RegistroStatusModal
          visible={showStatusModal}
          tipo="proveedor"
          registroId={submittedData.id}
          initialNombre={submittedData.nombre}
          initialRif={submittedData.rif}
          initialTelefono={submittedData.telefono}
          onClose={handleStatusClose}
          onProceed={handleStatusProceed}
          proceedLabel={proceedLabel}
        />
      )}
    </>
  );
}

// ── Campo etiquetado ──────────────────────────────────────────────────────────

interface LabeledInputProps {
  label:           string;
  value:           string;
  onChangeText:    (v: string) => void;
  placeholder?:    string;
  autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
  keyboardType?:   'default' | 'phone-pad' | 'email-address';
  multiline?:      boolean;
}

function LabeledInput({ label, value, onChangeText, placeholder, autoCapitalize = 'sentences', keyboardType = 'default', multiline = false }: LabeledInputProps): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View style={styles.formField}>
      <Text style={[styles.formLabel, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        style={[
          styles.formInput,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          multiline && styles.formInputMultiline,
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 2 : 1}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  modalOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent:  'flex-end',
  },
  modalContent: {
    maxHeight:            '85%',
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    borderWidth:          0.5,
    padding:              16,
    gap:                  12,
  },
  modalHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontSize: scaleFont(17), fontFamily: 'JetBrainsMono_700Bold' },

  infoBanner: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    padding:       12,
    borderRadius:  12,
    borderWidth:   0.5,
  },
  infoBannerIcon:          { marginTop: 2, marginRight: 10 },
  infoBannerTextContainer: { flex: 1 },
  infoBannerTitle: {
    fontSize:      scaleFont(12),
    fontFamily:    'JetBrainsMono_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom:  2,
  },
  infoBannerSub: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(15),
  },

  formField: { marginBottom: 14 },
  formLabel: {
    fontSize:      scaleFont(9),
    fontFamily:    'JetBrainsMono_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom:  6,
  },
  formInput: {
    fontSize:          scaleFont(14),
    fontFamily:        'JetBrainsMono_400Regular',
    borderWidth:       0.5,
    borderRadius:      10,
    paddingHorizontal: 12,
    paddingVertical:   10,
  },
  formInputMultiline: {
    minHeight:         56,
    textAlignVertical: 'top',
  },
  formSubmitBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    borderRadius:   12,
    paddingVertical: 14,
    marginTop:      4,
  },
  formSubmitText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
});
