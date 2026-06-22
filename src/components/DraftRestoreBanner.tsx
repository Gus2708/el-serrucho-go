import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  itemCount: number;
  nota?:     string;
  onRestore: () => void;
  onDiscard: () => void;
}

export function DraftRestoreBanner({ itemCount, nota, onRestore, onDiscard }: Props) {
  const { colors } = useTheme();

  return (
    <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
      <View style={styles.iconRow}>
        <Feather name="alert-circle" size={16} color={colors.primary} />
        <Text style={[styles.title, { color: colors.primary }]}>Borrador guardado</Text>
      </View>

      <Text style={[styles.body, { color: colors.textMuted }]}>
        Tienes {itemCount} ítem{itemCount !== 1 ? 's' : ''} en el borrador
        {nota ? ` · "${nota}"` : ''}.{'\n'}
        ¿Deseas continuar o descartarlo?
      </Text>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.btn, styles.discardBtn, { borderColor: colors.border }, pressed && { opacity: 0.7 }]}
          onPress={onDiscard}
        >
          <Text style={[styles.btnText, { color: colors.textMuted }]}>Descartar</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary }, pressed && { opacity: 0.75 }]}
          onPress={onRestore}
        >
          <Text style={[styles.btnText, { color: colors.onPrimary }]}>Continuar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position:         'absolute',
    top:              12,
    left:             16,
    right:            16,
    borderRadius:     14,
    borderWidth:      1,
    padding:          16,
    gap:              10,
    zIndex:           100,
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 4 },
    shadowOpacity:    0.4,
    shadowRadius:     8,
    elevation:        8,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  title: {
    fontSize:   14,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  body: {
    fontSize:   13,
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap:           10,
    marginTop:     4,
  },
  btn: {
    flex:              1,
    paddingVertical:   10,
    borderRadius:      10,
    alignItems:        'center',
    justifyContent:    'center',
  },
  discardBtn: {
    borderWidth: 0.5,
  },
  btnText: {
    fontSize:   13,
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
