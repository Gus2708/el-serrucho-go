import { scaleFont } from '../src/theme/responsive';
import * as React from 'react';
import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/theme/ThemeContext';
import { notify } from '../src/lib/notify';
import { UserRole } from '../src/lib/supabase';
import { useUserRole } from '../src/hooks/useUserRole';
import { useUsuarios, useUpdateUsuario } from '../src/hooks/useUsuarios';
import { PressableScale } from '../src/components/PressableScale';
import { pressScale } from '../src/theme/motion';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'empleado',      label: 'Empleado' },
  { value: 'superempleado', label: 'Super' },
  { value: 'admin',         label: 'Admin' },
];

export default function AdminUsuarios(): React.JSX.Element {
  const { colors } = useTheme();
  const router = useRouter();
  const { data: userAuth } = useUserRole();
  const isAdmin = userAuth?.role === 'admin';
  const currentUserId = userAuth?.profile?.id;

  const { data: usuarios = [], isLoading, refetch } = useUsuarios();
  const updateUsuario = useUpdateUsuario();
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  function handleSetRole(id: string, role: UserRole): void {
    setSavingId(id);
    updateUsuario.mutate(
      { id, role },
      {
        onError: (e: Error) => notify('Error', e.message),
        onSettled: () => setSavingId(null),
      },
    );
  }

  function handleToggleActive(id: string, is_active: boolean): void {
    setSavingId(id);
    updateUsuario.mutate(
      { id, is_active },
      {
        onError: (e: Error) => notify('Error', e.message),
        onSettled: () => setSavingId(null),
      },
    );
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Feather name="lock" size={32} color={colors.textDim} />
          <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Acceso restringido</Text>
          <Text style={[styles.emptySub, { color: colors.textDim }]}>Solo un administrador puede gestionar usuarios.</Text>
          <PressableScale
            style={[styles.backLink, { borderColor: colors.border }]}
            onPress={() => router.back()}
          >
            <Text style={[styles.backLinkText, { color: colors.primary }]}>Volver</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <PressableScale
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.back()}
          activeScale={pressScale.icon}
        >
          <Feather name="chevron-left" size={22} color={colors.text} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>USUARIOS</Text>
        <View style={{ width: 38 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        >
          {usuarios.map(u => {
            const esYo = u.id === currentUserId;
            const saving = savingId === u.id;
            const activo = u.is_active !== false;

            return (
              <View key={u.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardTop}>
                  <View style={[styles.avatar, { backgroundColor: colors.primary + '12' }]}>
                    <Text style={[styles.avatarLetter, { color: colors.primary }]}>
                      {(u.display_name || u.email || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.cardInfo}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                        {u.display_name || 'Sin nombre'}
                      </Text>
                      {esYo ? (
                        <View style={[styles.youBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '40' }]}>
                          <Text style={[styles.youBadgeText, { color: colors.primary }]}>Tú</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.email, { color: colors.textMuted }]} numberOfLines={1}>{u.email}</Text>
                  </View>
                  {saving ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                </View>

                {/* Selector de rol (segmentado) */}
                <View style={[styles.segment, { borderColor: colors.border }]}>
                  {ROLES.map(r => {
                    const active = u.role === r.value;
                    return (
                      <Pressable
                        key={r.value}
                        disabled={esYo || saving || active}
                        style={({ pressed }) => [
                          styles.segmentBtn,
                          active && { backgroundColor: colors.primary },
                          pressed && !active && { backgroundColor: colors.primary + '10' },
                          esYo && { opacity: 0.5 },
                        ]}
                        onPress={() => handleSetRole(u.id, r.value)}
                      >
                        <Text
                          style={[
                            styles.segmentText,
                            { color: active ? colors.onPrimary : colors.textMuted },
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                        >
                          {r.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Toggle de activación */}
                <PressableScale
                  disabled={esYo || saving}
                  style={[
                    styles.activeRow,
                    { borderColor: colors.border },
                  ]}
                  dimmed={esYo}
                  onPress={() => handleToggleActive(u.id, !activo)}
                  activeScale={pressScale.row}
                >
                  <Feather
                    name={activo ? 'check-circle' : 'slash'}
                    size={14}
                    color={activo ? colors.success : colors.textDim}
                  />
                  <Text style={[styles.activeText, { color: activo ? colors.success : colors.textMuted }]}>
                    {activo ? 'Activo' : 'Inactivo'}
                  </Text>
                  {!esYo ? (
                    <Text style={[styles.activeAction, { color: colors.textDim }]}>
                      {activo ? 'Desactivar' : 'Activar'}
                    </Text>
                  ) : null}
                </PressableScale>
              </View>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 0.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 2 },

  content: { paddingHorizontal: 16, gap: 12 },

  emptyTitle: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  emptySub: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(20) },
  backLink: { marginTop: 8, borderWidth: 0.5, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 20 },
  backLinkText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },

  card: {
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 14,
    gap: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: scaleFont(18), fontFamily: 'JetBrainsMono_700Bold' },
  cardInfo: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold', flexShrink: 1 },
  youBadge: { borderRadius: 999, borderWidth: 0.5, paddingHorizontal: 8, paddingVertical: 1 },
  youBadgeText: { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_700Bold' },
  email: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular' },

  segment: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },

  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 0.5,
    paddingTop: 10,
  },
  activeText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },
  activeAction: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', marginLeft: 'auto' },
});
