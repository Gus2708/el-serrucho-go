import * as React from 'react';
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { useTheme } from '../src/theme/ThemeContext';
import { useQueryClient } from '@tanstack/react-query';
import { useUserRole } from '../src/hooks/useUserRole';

export default function Perfil() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [profile, setProfile] = useState<{
    id: string;
    email: string;
    display_name: string;
    role: string;
  } | null>(null);
  
  const [newName, setNewName] = useState('');

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/(auth)/login');
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      
      setProfile(data);
      setNewName(data.display_name || '');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!profile || !newName.trim()) {
      setIsEditing(false);
      return;
    }
    
    if (newName.trim() === profile.display_name) {
      setIsEditing(false);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: newName.trim() })
        .eq('id', profile.id);

      if (error) throw error;
      
      setProfile({ ...profile, display_name: newName.trim() });
      setIsEditing(false);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    Alert.alert(
      'Cerrar sesión',
      '¿Estás seguro de que quieres salir?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Salir', 
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            queryClient.clear();
            router.replace('/(auth)/login');
          }
        }
      ]
    );
  }

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <Feather name="chevron-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>MI PERFIL</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Card Única de Perfil */}
        <View style={[styles.mainCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.avatarContainer, { backgroundColor: colors.primary + '10' }]}>
               <Text style={[styles.avatarLetter, { color: colors.primary }]}>
                  {profile?.display_name?.charAt(0).toUpperCase() || '?'}
               </Text>
            </View>
            
            <View style={styles.mainInfo}>
              <View style={styles.nameRow}>
                {isEditing ? (
                  <TextInput
                    style={[styles.nameInput, { color: colors.text, borderBottomColor: colors.primary }]}
                    value={newName}
                    onChangeText={setNewName}
                    autoFocus
                    placeholder="Nombre..."
                    placeholderTextColor={colors.textMuted}
                  />
                ) : (
                  <Text style={[styles.mainName, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                    {profile?.display_name}
                  </Text>
                )}
                
                <Pressable
                  onPress={() => isEditing ? handleSave() : setIsEditing(true)}
                  disabled={saving}
                  style={({ pressed }) => [styles.editBtn, { backgroundColor: isEditing ? colors.primary : colors.bg }, pressed && { opacity: 0.7 }]}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={isEditing ? colors.onPrimary : colors.primary} />
                  ) : (
                    <Feather
                      name={isEditing ? "check" : "edit-2"}
                      size={14}
                      color={isEditing ? colors.onPrimary : colors.primary}
                    />
                  )}
                </Pressable>
              </View>

              <View style={[styles.badge, { backgroundColor: colors.primary + '15' }]}>
                <Text style={[styles.badgeText, { color: colors.primary }]}>
                  {profile?.role === 'admin' ? 'ADMINISTRADOR' : 'EMPLEADO'}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.cardFooter}>
            <View style={styles.footerItem}>
              <Feather name="mail" size={14} color={colors.primary} style={{ opacity: 0.7 }} />
              <Text style={[styles.footerText, { color: colors.textDim }]} numberOfLines={1} adjustsFontSizeToFit>{profile?.email}</Text>
            </View>
          </View>
        </View>

        {/* Salida */}
        <Pressable
          style={({ pressed }) => [styles.logoutRow, { backgroundColor: colors.danger + '10', borderColor: colors.danger + '20' }, pressed && { opacity: 0.75 }]}
          onPress={handleLogout}
        >
          <Feather name="log-out" size={18} color={colors.danger} />
          <Text style={[styles.logoutText, { color: colors.danger }]}>CERRAR SESIÓN</Text>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 0.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 2 },
  content: { paddingHorizontal: 16, gap: 24 },
  
  // Card Principal Única
  mainCard: {
    padding: 20,
    borderRadius: 24,
    borderWidth: 0.5,
    gap: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: 24, fontFamily: 'JetBrainsMono_700Bold' },
  mainInfo: { flex: 1, gap: 6 },
  nameRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    gap: 10 
  },
  mainName: { 
    flex: 1,
    fontSize: 20, 
    fontFamily: 'JetBrainsMono_700Bold', 
    letterSpacing: -0.5 
  },
  nameInput: {
    flex: 1,
    fontSize: 20,
    fontFamily: 'JetBrainsMono_700Bold',
    paddingVertical: 0,
    borderBottomWidth: 1,
  },
  editBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: { fontSize: 9, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 0.5 },

  divider: { height: 1, opacity: 0.3 },

  cardFooter: {
    gap: 12,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  footerText: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_500Medium',
  },

  // Botón Salida
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 58,
    borderRadius: 18,
    borderWidth: 0.5,
    marginTop: 10,
  },
  logoutText: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1 },
});

