import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import Svg, { Path } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';

import { supabase, AtencionPendiente } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme/ThemeContext';
import { useUserRole } from '../../src/hooks/useUserRole';
import { useAtenciones } from '../../src/hooks/useAtenciones';
import { useInventarioStore } from '../../src/hooks/useInventarioStore';
import { notify } from '../../src/lib/notify';
import { requestNotificationPermission } from '../../src/utils/notifications';

// Icono SVG personalizado de WhatsApp
function WhatsAppIcon({ size = 22, color = '#25D366' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12.004 2C6.48 2 2 6.48 2 12.004c0 1.824.493 3.543 1.348 5.029L2 22l5.084-1.332A9.972 9.972 0 0 0 12.004 22c5.524 0 10.004-4.48 10.004-10.004C22.008 6.48 17.528 2 12.004 2zm6.184 14.156c-.27.76-1.357 1.393-2.15 1.503-.54.075-1.246.136-3.64-.856-3.065-1.267-5.01-4.385-5.163-4.588-.152-.204-1.235-1.642-1.235-3.13 0-1.488.78-2.217 1.057-2.52.277-.305.61-.382.812-.382.203 0 .406.002.583.01.183.008.43-.075.674.508.249.593.856 2.083.93 2.235.074.152.124.33.024.53-.1.203-.15.33-.298.508-.148.178-.312.397-.446.533-.149.153-.306.321-.132.617.174.296.772 1.272 1.657 2.057.905.803 1.666 1.053 1.967 1.173.301.12.477.102.656-.102.178-.204.762-.882.966-1.186.204-.305.407-.254.686-.153.28.102 1.77.835 2.076.988.305.152.508.229.584.356.076.127.076.737-.194 1.498z"
        fill={color}
      />
    </Svg>
  );
}

// Sub-componente para refrescar el tiempo transcurrido en vivo
function TimeAgoText({ creadoEn }: { creadoEn: string }) {
  const { colors } = useTheme();
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    function calculate() {
      const elapsed = Date.now() - new Date(creadoEn).getTime();
      const mins = Math.floor(elapsed / 60_000);
      if (mins < 1) {
        setTimeStr('Hace un instante');
        return;
      }
      if (mins < 60) {
        setTimeStr(`Esperando hace ${mins}m`);
        return;
      }
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) {
        setTimeStr(`Esperando hace ${hrs}h`);
        return;
      }
      setTimeStr(`Esperando hace ${Math.floor(hrs / 24)}d`);
    }

    calculate();
    const interval = setInterval(calculate, 30_000);
    return () => clearInterval(interval);
  }, [creadoEn]);

  return (
    <Text style={[styles.timeAgo, { color: colors.warning }]}>
      {timeStr}
    </Text>
  );
}

export default function Notificaciones() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const listRef = useRef<FlashList<any>>(null);
  
  const { data: userAuth } = useUserRole();
  const { data: listData = [], isLoading, refetch } = useAtenciones();
  const { scrollOffsetNotificaciones, setScrollOffsetNotificaciones } = useInventarioStore();

  const [claimingId, setClaimingId] = useState<number | null>(null);

  // Solicitar permiso de notificaciones al montar la pestaña
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Restaurar posición de scroll al enfocar la pestaña
  useFocusEffect(
    useCallback(() => {
      if (scrollOffsetNotificaciones > 0 && listRef.current) {
        const timer = setTimeout(() => {
          listRef.current?.scrollToOffset({ offset: scrollOffsetNotificaciones, animated: false });
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [scrollOffsetNotificaciones])
  );

  // Guardar posición de scroll
  const handleScroll = (event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset >= 0) {
      setScrollOffsetNotificaciones(offset);
    }
  };

  // Handler de reclamo de atención
  async function handleClaim(id: number, nombre: string) {
    if (claimingId !== null) return;
    
    if (!userAuth || !userAuth.is_active) {
      notify('Acceso Restringido', 'Debes tener un usuario activo para atender clientes.');
      return;
    }

    const employeeId = userAuth.profile?.id;
    if (!employeeId) {
      notify('Error', 'No se pudo obtener el identificador del empleado.');
      return;
    }

    setClaimingId(id);

    try {
      const { data, error } = await supabase
        .from('atenciones_pendientes')
        .update({
          status: 'atendido',
          atendido_en: new Date().toISOString(),
          atendido_por: employeeId,
        })
        .eq('id', id)
        .eq('status', 'pendiente')
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        notify('Cliente Asignado', `Ahora estás atendiendo a ${nombre}.`);
        queryClient.setQueryData<AtencionPendiente[]>(['atenciones-pendientes'], (prev) =>
          prev ? prev.filter((item) => item.id !== id) : []
        );
        queryClient.invalidateQueries({ queryKey: ['atenciones-count'] });
      } else {
        notify('No disponible', 'Esta atención ya fue tomada por otro compañero.');
        refetch();
      }
    } catch (e: any) {
      notify('Error al reclamar', e.message || 'Ocurrió un error inesperado');
    } finally {
      setClaimingId(null);
    }
  }

  function formatPhone(phone: string): string {
    if (!phone) return '';
    return phone.replace('@c.us', '');
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
          Notificaciones
        </Text>
        {!isLoading && listData.length > 0 && (
          <View style={[styles.badge, { backgroundColor: colors.danger + '22', borderColor: colors.danger + '55' }]}>
            <Text style={[styles.badgeText, { color: colors.danger }]}>{listData.length}</Text>
          </View>
        )}
      </View>

      {/* Renderizado condicional en base a isLoading - Elimina el Spinner Infinito */}
      {isLoading && listData.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlashList
          ref={listRef}
          data={listData}
          estimatedItemSize={110}
          keyExtractor={(item) => `atencion-${item.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 110 }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          refreshing={isLoading}
          onRefresh={refetch}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Feather name="check-circle" size={48} color={colors.success} style={{ marginBottom: 12, opacity: 0.8 }} />
              <Text style={[styles.emptyTextTitle, { color: colors.text }]}>Sin pendientes</Text>
              <Text style={[styles.emptyTextSub, { color: colors.textMuted }]}>
                ¡Todo al día! No hay solicitudes de atención en este momento.
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <View style={styles.clientInfo}>
                  <View style={styles.clientNameRow}>
                    <WhatsAppIcon size={18} />
                    <Text style={[styles.clientName, { color: colors.text }]} numberOfLines={1}>
                      {item.nombre || 'Cliente sin nombre'}
                    </Text>
                  </View>
                  <Text style={[styles.clientPhone, { color: colors.textMuted }]}>
                    +{formatPhone(item.telefono)}
                  </Text>
                </View>
                <TimeAgoText creadoEn={item.creado_en} />
              </View>

              <View style={styles.reasonBox}>
                <Text style={[styles.reasonText, { color: colors.text }]} numberOfLines={3}>
                  {item.motivo || 'Solicita atención humana en chat.'}
                </Text>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.claimBtn,
                  { backgroundColor: colors.primary },
                  claimingId === item.id && { opacity: 0.7 },
                  pressed && { opacity: 0.8 },
                ]}
                disabled={claimingId !== null}
                onPress={() => handleClaim(item.id, item.nombre || formatPhone(item.telefono))}
              >
                {claimingId === item.id ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.claimBtnText, { color: colors.onPrimary }]}>
                    ATENDER CLIENTE
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  title: {
    fontSize: 26,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  badge: {
    borderRadius: 999,
    borderWidth: 0.5,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  badgeText: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  
  // Card
  card: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 0.5,
    marginBottom: 12,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  clientInfo: {
    flex: 1,
    gap: 2,
  },
  clientNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  clientName: {
    fontSize: 16,
    fontFamily: 'JetBrainsMono_700Bold',
    flex: 1,
  },
  clientPhone: {
    fontSize: 12,
    fontFamily: 'JetBrainsMono_500Medium',
    paddingLeft: 26,
  },
  timeAgo: {
    fontSize: 11,
    fontFamily: 'JetBrainsMono_600SemiBold',
    textAlign: 'right',
  },
  reasonBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    padding: 12,
  },
  reasonText: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: 18,
  },
  claimBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  claimBtnText: {
    fontSize: 12,
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },

  // Vacío
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 100,
    paddingHorizontal: 32,
  },
  emptyTextTitle: {
    fontSize: 18,
    fontFamily: 'JetBrainsMono_700Bold',
    marginBottom: 6,
  },
  emptyTextSub: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign: 'center',
    lineHeight: 18,
  },
});
