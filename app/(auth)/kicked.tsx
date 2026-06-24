import { scaleFont } from '../../src/theme/responsive';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeContext';
import { Image } from 'expo-image';

const logo = require('../../src/assets/img/EL SERRUCHO go.png');

export default function KickedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();
  const isDesktop = screenW >= 768;

  const handleLoginAgain = () => {
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg || '#0C0C0C' }]}>
      <StatusBar style="light" />
      
      <View style={[styles.container, isDesktop && styles.containerDesktop]}>
        {/* Header Branding */}
        <View style={styles.branding}>
          <Image source={logo} style={styles.logo} contentFit="contain" />
          <Text style={[styles.brandSub, { color: colors.textMuted || '#888888' }]}>FERRETERÍA</Text>
          <Text style={[styles.brandTitle, { color: colors.primary || '#F5B200' }]}>EL SERRUCHO GO</Text>
        </View>

        {/* Warning Card */}
        <View style={[styles.card, { backgroundColor: colors.surface || '#1E1E1E', borderColor: colors.border || '#333' }]}>
          <View style={[styles.iconContainer, { backgroundColor: (colors.warning || '#F5B200') + '15' }]}>
            <Feather name="lock" size={32} color={colors.warning || '#F5B200'} />
          </View>

          <Text style={[styles.cardTitle, { color: colors.text || '#FFFFFF' }]}>
            Cuenta en Uso
          </Text>

          <Text style={[styles.cardDesc, { color: colors.textMuted || '#A0A0A0' }]}>
            Esta cuenta ya tiene una sesión activa en otro dispositivo. Por razones de seguridad, debes cerrar la sesión en el otro dispositivo antes de poder ingresar en este.
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.border || '#333' }]} />

          {/* Secure details */}
          <View style={styles.infoBlock}>
            <View style={styles.infoRow}>
              <Feather name="shield" size={16} color={colors.primary || '#F5B200'} />
              <Text style={[styles.infoText, { color: colors.textDim || '#CCCCCC' }]}>
                Tu sesión activa en el otro dispositivo sigue funcionando.
              </Text>
            </View>

            <View style={styles.infoRow}>
              <Feather name="check-circle" size={16} color={colors.success || '#10B981'} />
              <Text style={[styles.infoText, { color: colors.textDim || '#CCCCCC' }]}>
                Evitamos el uso compartido no autorizado de cuentas.
              </Text>
            </View>
          </View>
        </View>

        {/* Login Button */}
        <Pressable
          onPress={handleLoginAgain}
          style={({ pressed }) => [
            styles.actionBtn,
            { backgroundColor: colors.primary || '#F5B200' },
            pressed && { opacity: 0.85 }
          ]}
        >
          <Feather name="arrow-left" size={16} color="#0C0C0C" style={styles.btnIcon} />
          <Text style={styles.actionBtnText}>
            VOLVER AL INICIO DE SESIÓN
          </Text>
        </Pressable>

        <Text style={[styles.footerNotice, { color: colors.textMuted || '#888888' }]}>
          Para proteger la integridad de tus datos, solo se permite un dispositivo activo por cuenta.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    gap: 24,
  },
  containerDesktop: {
    maxWidth: 420,
  },
  branding: {
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  logo: {
    width: 90,
    height: 90,
    marginBottom: 8,
  },
  brandSub: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  brandTitle: {
    fontSize: scaleFont(22),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: -0.5,
  },
  card: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: scaleFont(20),
    fontFamily: 'JetBrainsMono_700Bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  cardDesc: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign: 'center',
    lineHeight: scaleFont(20),
    marginBottom: 16,
  },
  divider: {
    width: '100%',
    height: 1,
    opacity: 0.3,
    marginVertical: 16,
  },
  infoBlock: {
    width: '100%',
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_500Medium',
    lineHeight: scaleFont(15),
  },
  actionBtn: {
    width: '100%',
    height: 54,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 3,
  },
  btnIcon: {
    marginRight: 8,
  },
  actionBtnText: {
    color: '#0C0C0C',
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  footerNotice: {
    fontSize: scaleFont(9),
    fontFamily: 'JetBrainsMono_500Medium',
    textAlign: 'center',
    lineHeight: scaleFont(14),
    opacity: 0.7,
    paddingHorizontal: 12,
  },
});
