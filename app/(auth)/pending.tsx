import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme/ThemeContext';
import { useUserRole } from '../../src/hooks/useUserRole';
import { StatusBar } from 'expo-status-bar';

const logo = require('../../src/assets/img/EL SERRUCHO go.png');

export default function PendingActivation() {
  const { colors } = useTheme();
  const router = useRouter();
  const { data: roleData, isLoading, refetch } = useUserRole();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  }

  // Si el usuario ya está activo, lo mandamos a los tabs
  if (roleData?.is_active) {
    router.replace('/(tabs)');
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar style="light" />
      
      <View style={styles.content}>
        <View style={styles.logoBox}>
          <Image source={logo} style={styles.logoImg} contentFit="contain" />
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Cuenta en revisión</Text>
          <Text style={[styles.message, { color: colors.textMuted }]}>
            Tu cuenta ha sido creada exitosamente, pero aún requiere la activación manual por parte del administrador.
          </Text>
          <Text style={[styles.message, { color: colors.textMuted }]}>
            Por favor, contacta al encargado para habilitar tu acceso al panel.
          </Text>

          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.spacer} />
          ) : (
            <Pressable 
              style={({ pressed }) => [
                styles.refreshBtn, 
                { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                pressed && { opacity: 0.7 }
              ]}
              onPress={() => refetch()}
            >
              <Text style={[styles.refreshText, { color: colors.text }]}>Verificar estado</Text>
            </Pressable>
          )}
        </View>

        <Pressable 
          style={({ pressed }) => [
            styles.logoutBtn, 
            pressed && { opacity: 0.7 }
          ]}
          onPress={handleLogout}
        >
          <Text style={[styles.logoutText, { color: colors.danger }]}>Cerrar sesión</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    gap: 24,
  },
  logoBox: {
    width: 180,
    height: 100,
    marginBottom: 12,
  },
  logoImg: {
    width: '100%',
    height: '100%',
  },
  card: {
    width: '100%',
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: 'JetBrainsMono_700Bold',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  refreshBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
  },
  refreshText: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_600SemiBold',
  },
  logoutBtn: {
    padding: 12,
  },
  logoutText: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_600SemiBold',
  },
  spacer: {
    marginVertical: 12,
  }
});
