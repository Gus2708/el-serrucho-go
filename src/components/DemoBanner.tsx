import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useDemoStore } from '../demo/useDemoStore';
import { useTheme } from '../theme/ThemeContext';
import { scaleFont } from '../theme/responsive';
import { useDeviceSize } from '../hooks/useDeviceSize';
import { clearRoleCache } from '../hooks/useUserRole';

export function DemoBanner() {
  const isDemoMode = useDemoStore((s) => s.isDemoMode);
  const disableDemo = useDemoStore((s) => s.disableDemo);
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isDesktop } = useDeviceSize();

  if (!isDemoMode) return null;

  const handleExit = () => {
    disableDemo();
    clearRoleCache();
    queryClient.clear();
    router.replace('/(auth)/login');
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: '#16140c',
          borderBottomColor: colors.primary + '55',
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.badge}>
          <Feather name="zap" size={12} color={colors.primary} />
          <Text style={[styles.badgeText, { color: colors.primary }]}>MODO DEMO</Text>
        </View>

        <Text
          style={[
            styles.title,
            { color: colors.textMuted },
          ]}
          numberOfLines={1}
        >
          {isDesktop
            ? 'Exploración para Reclutadores · Datos simulados en memoria'
            : 'Reclutadores · Datos simulados'}
        </Text>
      </View>

      <Pressable
        onPress={handleExit}
        style={({ pressed }) => [
          styles.exitBtn,
          {
            borderColor: colors.border,
            backgroundColor: pressed ? '#222' : '#1a1a1a',
          },
        ]}
      >
        <Feather name="log-out" size={12} color="#f87171" style={{ marginRight: 5 }} />
        <Text style={styles.exitText}>Salir de demo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 999,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 178, 0, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  badgeText: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    flexShrink: 1,
  },
  exitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  exitText: {
    fontSize: scaleFont(11),
    color: '#f87171',
    fontFamily: 'JetBrainsMono_500Medium',
  },
});
