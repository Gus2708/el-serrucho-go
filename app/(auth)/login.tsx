import { scaleFont } from '../../src/theme/responsive';
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';

const logo = require('../../src/assets/img/EL SERRUCHO go.png');
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';
import { notify } from '../../src/lib/notify';
import { useTheme } from '../../src/theme/ThemeContext';
import { PressableScale } from '../../src/components/PressableScale';
import { useDemoStore } from '../../src/demo/useDemoStore';
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from '../../src/lib/rateLimit';

export default function Login() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const enableDemo = useDemoStore((s) => s.enableDemo);
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  function handleEnterDemo() {
    enableDemo();
    queryClient.invalidateQueries();
    router.replace('/(tabs)');
  }

  async function handleLogin() {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) return;

    if (cleanEmail.length > 255 || password.length > 128) {
      notify('Error de validación', 'Formato de credenciales inválido.');
      return;
    }

    const limitStatus = checkRateLimit('login_form');
    if (!limitStatus.allowed) {
      notify(
        'Acceso bloqueado temporalmente',
        `Demasiados intentos fallidos. Por favor espera ${limitStatus.retryAfterSec ?? 30} segundos.`
      );
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    setLoading(false);

    if (error) {
      const updatedStatus = recordFailedAttempt('login_form');
      if (!updatedStatus.allowed) {
        notify(
          'Acceso bloqueado temporalmente',
          `Demasiados intentos fallidos. Por favor espera ${updatedStatus.retryAfterSec ?? 30} segundos.`
        );
      } else {
        notify(
          'Error al iniciar sesión',
          'Credenciales inválidas. Por favor verifica tu correo y contraseña.'
        );
      }
      return;
    }

    resetRateLimit('login_form');
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.inner}>
        {/* Logo */}
        <View style={styles.logoBox}>
          <Image source={logo} style={styles.logoImg} contentFit="contain" />
        </View>

        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Panel de inventario · acceso privado
        </Text>

        {/* Email */}
        <View style={[styles.inputWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Correo electrónico"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
        </View>

        {/* Password */}
        <View style={[styles.inputWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Contraseña"
            placeholderTextColor={colors.textDim}
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={handleLogin}
            returnKeyType="done"
          />
        </View>

        {/* Submit */}
        <PressableScale
          style={[styles.btn, { backgroundColor: colors.primary }]}
          dimmed={loading || !email || !password}
          onPress={handleLogin}
          disabled={loading || !email.trim() || !password}
        >
          {loading
            ? <ActivityIndicator color={colors.onPrimary} />
            : <Text style={[styles.btnText, { color: colors.onPrimary }]}>Iniciar sesión</Text>
          }
        </PressableScale>

        {/* Recruiter / Interactive Demo Entry */}
        <View style={styles.demoSection}>
          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.textMuted }]}>O BIEN</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <PressableScale
            style={[
              styles.demoCard,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.primary + '66',
              },
            ]}
            onPress={handleEnterDemo}
          >
            <View style={[styles.demoIconWrap, { backgroundColor: 'rgba(245, 178, 0, 0.12)' }]}>
              <Feather name="play" size={18} color={colors.primary} />
            </View>
            <View style={styles.demoContent}>
              <View style={styles.demoTitleRow}>
                <Text style={[styles.demoTitle, { color: colors.primary }]}>
                  Demo para Reclutadores
                </Text>
                <View style={[styles.demoPill, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.demoPillText, { color: colors.onPrimary }]}>1-CLICK</Text>
                </View>
              </View>
              <Text style={[styles.demoDesc, { color: colors.textMuted }]}>
                Explora sparklines, inventario, reportes, facturación y alertas en tiempo real sin credenciales.
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.textMuted} />
          </PressableScale>
        </View>
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1 },
  scroll: { flexGrow: 1 },
  inner: {
    flex:              1,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 32,
    paddingVertical:   48,
    gap:               14,
  },
  logoBox: {
    width:        200,
    height:       140,
    marginBottom: 8,
    alignItems:   'center',
    justifyContent: 'center',
  },
  logoImg: {
    width:  200,
    height: 140,
  },
  subtitle: {
    fontSize:    scaleFont(13),
    marginBottom: 16,
    fontFamily:  'JetBrainsMono_400Regular',
  },
  inputWrap: {
    width:        '100%',
    borderRadius: 12,
    borderWidth:  0.5,
    paddingHorizontal: 16,
    height:       52,
    justifyContent: 'center',
  },
  input: {
    fontSize: scaleFont(15),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  btn: {
    width:        '100%',
    height:       52,
    borderRadius: 12,
    alignItems:   'center',
    justifyContent: 'center',
    marginTop:    8,
  },
  btnText: {
    fontSize:   scaleFont(15),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  demoSection: {
    width: '100%',
    marginTop: 12,
    gap: 12,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_600SemiBold',
    letterSpacing: 1,
  },
  demoCard: {
    width: '100%',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  demoIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoContent: {
    flex: 1,
    gap: 3,
  },
  demoTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  demoTitle: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  demoPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  demoPillText: {
    fontSize: scaleFont(9),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  demoDesc: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: 15,
  },
});
