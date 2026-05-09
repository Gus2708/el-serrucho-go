import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';

const logo = require('../../src/assets/img/EL SERRUCHO go.png');
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme/ThemeContext';

export default function Login() {
  const { colors } = useTheme();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) Alert.alert('Error al iniciar sesión', error.message);
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
        <Pressable
          style={({ pressed }) => [
            styles.btn,
            { backgroundColor: colors.primary },
            (loading || !email || !password) && { opacity: 0.5 },
            pressed && { opacity: 0.75 },
          ]}
          onPress={handleLogin}
          disabled={loading || !email.trim() || !password}
        >
          {loading
            ? <ActivityIndicator color={colors.onPrimary} />
            : <Text style={[styles.btnText, { color: colors.onPrimary }]}>Iniciar sesión</Text>
          }
        </Pressable>
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
    fontSize:    13,
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
    fontSize: 15,
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
    fontSize:   15,
    fontFamily: 'JetBrainsMono_700Bold',
  },
});
