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
import { useFocusEffect, useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import Svg, { Path } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';

import { supabase, AtencionPendiente, SolicitudAyuda } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme/ThemeContext';
import { useUserRole } from '../../src/hooks/useUserRole';
import { useAtenciones } from '../../src/hooks/useAtenciones';
import { useSolicitudes } from '../../src/hooks/useSolicitudes';
import { useResolverSolicitud } from '../../src/hooks/useResolverSolicitud';
import { useInventarioStore } from '../../src/hooks/useInventarioStore';
import { notify, confirm } from '../../src/lib/notify';
import { requestNotificationPermission } from '../../src/utils/notifications';

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

function TimeAgoText({ creadoEn }: { creadoEn: string }) {
  const { colors } = useTheme();
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    function calculate() {
      const elapsed = Date.now() - new Date(creadoEn).getTime();
      const mins = Math.floor(elapsed / 60_000);
      if (mins < 1) { setTimeStr('Hace un instante'); return; }
      if (mins < 60) { setTimeStr(`Esperando hace ${mins}m`); return; }
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) { setTimeStr(`Esperando hace ${hrs}h`); return; }
      setTimeStr(`Esperando hace ${Math.floor(hrs / 24)}d`);
    }
    calculate();
    const interval = setInterval(calculate, 30_000);
    return () => clearInterval(interval);
  }, [creadoEn]);

  return <Text style={[styles.timeAgo, { color: colors.warning }]}>{timeStr}</Text>;
}

export default function Notificaciones() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const listRef = useRef<FlashList<any>>(null);

  const { data: userAuth } = useUserRole();
  const { data: atenciones = [], isLoading: atencionesLoading, refetch: refetchAtenciones } = useAtenciones();
  const { data: solicitudes = [], isLoading: solicitudesLoading, refetch: refetchSolicitudes } = useSolicitudes();
  const { descartarSolicitud, descartandoId } = useResolverSolicitud();
  // Solo seleccionamos el setter (referencia estable). Suscribirse al valor
  // `scrollOffsetNotificaciones` re-renderizaba toda la pantalla en cada frame
  // de scroll (~60 fps). El valor solo se necesita al recuperar foco, así que
  // se lee con getState() sin suscripción.
  const setScrollOffsetNotificaciones = useInventarioStore(s => s.setScrollOffsetNotificaciones);

  const [activeTab, setActiveTab] = useState<'atenciones' | 'solicitudes'>('atenciones');
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);

  const pendingSolicitudesCount = solicitudes.filter(s => s.status === 'pendiente').length;

  // Read the current permission state once on mount (no automatic request).
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  async function handleEnableNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    if (result === 'granted') {
      // Trigger subscription now that the user granted permission.
      requestNotificationPermission();
    }
  }

  // Restaurar scroll — leemos el offset guardado una sola vez al recuperar foco.
  useFocusEffect(
    useCallback(() => {
      const saved = useInventarioStore.getState().scrollOffsetNotificaciones;
      if (saved > 0 && listRef.current) {
        const timer = setTimeout(() => {
          listRef.current?.scrollToOffset({ offset: saved, animated: false });
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [])
  );

  // Guardar scroll (el setter de Zustand es estable, no provoca re-render aquí)
  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset >= 0) setScrollOffsetNotificaciones(offset);
  }, [setScrollOffsetNotificaciones]);

  async function handleClaim(id: number, nombre: string) {
    if (claimingId !== null) return;
    if (!userAuth?.is_active) {
      notify('Acceso Restringido', 'Debes tener un usuario activo para atender clientes.');
      return;
    }
    const employeeId = userAuth.profile?.id;
    if (!employeeId) { notify('Error', 'No se pudo obtener el identificador del empleado.'); return; }

    setClaimingId(id);
    try {
      const { data, error } = await supabase
        .from('atenciones_pendientes')
        .update({ status: 'atendido', atendido_en: new Date().toISOString(), atendido_por: employeeId })
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
        refetchAtenciones();
      }
    } catch (e: any) {
      notify('Error al reclamar', e.message || 'Ocurrió un error inesperado');
    } finally {
      setClaimingId(null);
    }
  }

  function handleDiscard(id: number) {
    confirm({
      title: 'Descartar solicitud',
      message: '¿Ignorar esta solicitud sin responder al cliente?',
      confirmText: 'Descartar',
      cancelText: 'Cancelar',
      destructive: true,
      onConfirm: async () => {
        try {
          await descartarSolicitud(id);
        } catch (e: any) {
          notify('Error', e.message || 'No se pudo descartar la solicitud.');
        }
      },
    });
  }

  async function handleRetry(id: number) {
    if (retryingId !== null) return;
    setRetryingId(id);
    try {
      await refetchSolicitudes();
    } finally {
      setRetryingId(null);
    }
  }

  function formatPhone(phone: string): string {
    return phone ? phone.replace('@c.us', '') : '';
  }

  const isLoading = activeTab === 'atenciones' ? atencionesLoading : solicitudesLoading;
  const listData = activeTab === 'atenciones' ? atenciones : solicitudes;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style="light" />

      {/* Notification permission card — shown when permission is not yet granted */}
      {notifPermission !== null && notifPermission !== 'granted' && (
        <Pressable
          onPress={notifPermission === 'denied' ? undefined : handleEnableNotifications}
          style={[
            styles.notifCard,
            { backgroundColor: colors.surfaceAlt, borderColor: notifPermission === 'denied' ? colors.danger + '44' : colors.primary + '44' },
          ]}
        >
          <Feather
            name={notifPermission === 'denied' ? 'bell-off' : 'bell'}
            size={16}
            color={notifPermission === 'denied' ? colors.danger : colors.primary}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.notifCardTitle, { color: notifPermission === 'denied' ? colors.danger : colors.primary }]}>
              {notifPermission === 'denied' ? 'Notificaciones bloqueadas' : 'Activar notificaciones'}
            </Text>
            <Text style={[styles.notifCardBody, { color: colors.textMuted }]}>
              {notifPermission === 'denied'
                ? 'Abre Configuración del sitio en Chrome → Notificaciones → Permitir'
                : 'Toca aquí para recibir alertas aunque la app esté cerrada'}
            </Text>
          </View>
          {notifPermission !== 'denied' && (
            <Feather name="chevron-right" size={16} color={colors.textDim} />
          )}
        </Pressable>
      )}

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text, flex: 1, marginRight: 8 }]} numberOfLines={1} adjustsFontSizeToFit>
          Notificaciones
        </Text>
        {/* Tab switcher */}
        <View style={[styles.tabSwitcher, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            style={({ pressed }) => [
              styles.tabBtn,
              activeTab === 'atenciones' && { backgroundColor: colors.primary },
              pressed && activeTab !== 'atenciones' && { opacity: 0.7 },
            ]}
            onPress={() => setActiveTab('atenciones')}
          >
            <Text style={[
              styles.tabBtnText,
              { color: activeTab === 'atenciones' ? colors.onPrimary : colors.textMuted },
            ]}>
              ATENCIONES
            </Text>
            {atenciones.length > 0 && (
              <View style={[
                styles.tabBadge,
                { backgroundColor: activeTab === 'atenciones' ? colors.onPrimary + '33' : colors.danger + '33' },
              ]}>
                <Text style={[
                  styles.tabBadgeText,
                  { color: activeTab === 'atenciones' ? colors.onPrimary : colors.danger },
                ]}>
                  {atenciones.length}
                </Text>
              </View>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.tabBtn,
              activeTab === 'solicitudes' && { backgroundColor: colors.primary },
              pressed && activeTab !== 'solicitudes' && { opacity: 0.7 },
            ]}
            onPress={() => setActiveTab('solicitudes')}
          >
            <Text style={[
              styles.tabBtnText,
              { color: activeTab === 'solicitudes' ? colors.onPrimary : colors.textMuted },
            ]}>
              BOT
            </Text>
            {pendingSolicitudesCount > 0 && (
              <View style={[
                styles.tabBadge,
                { backgroundColor: activeTab === 'solicitudes' ? colors.onPrimary + '33' : colors.primary + '33' },
              ]}>
                <Text style={[
                  styles.tabBadgeText,
                  { color: activeTab === 'solicitudes' ? colors.onPrimary : colors.primary },
                ]}>
                  {pendingSolicitudesCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      {isLoading && listData.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : activeTab === 'atenciones' ? (
        /* ── Lista de Atenciones ── */
        <FlashList
          ref={listRef}
          data={atenciones}
          estimatedItemSize={110}
          keyExtractor={(item) => `atencion-${item.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 110 }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          refreshing={atencionesLoading}
          onRefresh={refetchAtenciones}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Feather name="check-circle" size={48} color={colors.success} style={{ marginBottom: 12, opacity: 0.8 }} />
              <Text style={[styles.emptyTextTitle, { color: colors.text }]}>Sin pendientes</Text>
              <Text style={[styles.emptyTextSub, { color: colors.textMuted }]}>
                ¡Todo al día! No hay clientes esperando atención.
              </Text>
            </View>
          )}
          renderItem={({ item }: { item: AtencionPendiente }) => (
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
                  styles.actionBtn,
                  { backgroundColor: colors.primary },
                  claimingId === item.id && { opacity: 0.7 },
                  pressed && { opacity: 0.8 },
                ]}
                disabled={claimingId !== null}
                onPress={() => handleClaim(item.id, item.nombre || formatPhone(item.telefono))}
              >
                {claimingId === item.id
                  ? <ActivityIndicator color={colors.onPrimary} size="small" />
                  : <Text style={[styles.actionBtnText, { color: colors.onPrimary }]}>ATENDER CLIENTE</Text>
                }
              </Pressable>
            </View>
          )}
        />
      ) : (
        /* ── Lista de Solicitudes Bot ── */
        <FlashList
          data={solicitudes}
          estimatedItemSize={150}
          keyExtractor={(item) => `solicitud-${item.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 110 }}
          refreshing={solicitudesLoading}
          onRefresh={refetchSolicitudes}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Feather name="help-circle" size={48} color={colors.success} style={{ marginBottom: 12, opacity: 0.8 }} />
              <Text style={[styles.emptyTextTitle, { color: colors.text }]}>Sin solicitudes</Text>
              <Text style={[styles.emptyTextSub, { color: colors.textMuted }]}>
                No hay solicitudes de ayuda pendientes en este momento.
              </Text>
            </View>
          )}
          renderItem={({ item }: { item: SolicitudAyuda }) => {
            const isPendiente = item.status === 'pendiente';
            const motivoLabel = item.motivo === 'no_encontrado' ? 'No encontrado' : 'Refutado';
            return (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <View style={styles.clientInfo}>
                    <Text style={[styles.clientName, { color: colors.text }]} numberOfLines={1}>
                      {item.nombre || formatPhone(item.telefono)}
                    </Text>
                    <Text style={[styles.clientPhone, { color: colors.textMuted }]}>
                      +{formatPhone(item.telefono)}
                    </Text>
                  </View>
                  <TimeAgoText creadoEn={item.creado_en} />
                  {isPendiente && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.discardBtn,
                        { borderColor: colors.border },
                        (descartandoId === item.id || pressed) && { opacity: 0.5 },
                      ]}
                      onPress={() => handleDiscard(item.id)}
                      disabled={descartandoId === item.id}
                      hitSlop={8}
                    >
                      {descartandoId === item.id
                        ? <ActivityIndicator size={14} color={colors.textMuted} />
                        : <Feather name="x" size={14} color={colors.textMuted} />
                      }
                    </Pressable>
                  )}
                </View>

                <View style={styles.reasonBox}>
                  <Text style={[styles.motivoText, { color: colors.primary }]}>
                    Motivo: {motivoLabel}
                  </Text>
                  {item.consulta && (
                    <Text style={[styles.reasonText, { color: colors.text }]}>
                      Consulta: {item.consulta}
                    </Text>
                  )}
                </View>

                {isPendiente ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtn,
                      { backgroundColor: colors.primary },
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={() => router.push({
                      pathname: '/seleccionar-productos',
                      params: { solicitudId: item.id.toString() },
                    } as any)}
                  >
                    <Text style={[styles.actionBtnText, { color: colors.onPrimary }]}>
                      ELEGIR PRODUCTO(S)
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtn,
                      { backgroundColor: colors.border },
                      retryingId === item.id && { opacity: 0.7 },
                      pressed && { opacity: 0.8 },
                    ]}
                    disabled={retryingId === item.id}
                    onPress={() => handleRetry(item.id)}
                  >
                    {retryingId === item.id
                      ? <ActivityIndicator color={colors.text} size="small" />
                      : <Text style={[styles.actionBtnText, { color: colors.text }]}>REINTENTAR ENVÍO</Text>
                    }
                  </Pressable>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  notifCard: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    marginHorizontal:  16,
    marginTop:         10,
    marginBottom:      4,
    paddingVertical:   10,
    paddingHorizontal: 14,
    borderRadius:      12,
    borderWidth:       1,
  },
  notifCardTitle: {
    fontSize:   11,
    fontFamily: 'JetBrainsMono_700Bold',
    marginBottom: 2,
  },
  notifCardBody: {
    fontSize:   10,
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: 14,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  title: {
    fontSize: 26,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  tabSwitcher: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 14,
  },
  tabBtnText: {
    fontSize: 10,
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  tabBadge: {
    borderRadius: 999,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    fontSize: 9,
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
  discardBtn: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  motivoText: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  reasonText: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: 18,
  },
  actionBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  actionBtnText: {
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
