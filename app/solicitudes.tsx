import { scaleFont } from '../src/theme/responsive';
import * as React from 'react';
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';

import { SolicitudAyuda } from '../src/lib/supabase';
import { useTheme } from '../src/theme/ThemeContext';
import { useSolicitudes } from '../src/hooks/useSolicitudes';
import { useResolverSolicitud } from '../src/hooks/useResolverSolicitud';
import { notify, confirm } from '../src/lib/notify';
import { PressableScale } from '../src/components/PressableScale';
import { pressScale } from '../src/theme/motion';

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

export default function Solicitudes() {
  const { colors } = useTheme();
  const router = useRouter();
  const { data: solicitudes = [], isLoading, refetch } = useSolicitudes();
  const { reintentarEnvio, descartarSolicitud, descartandoId } = useResolverSolicitud();

  const [retryingId, setRetryingId] = useState<number | null>(null);

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
      await reintentarEnvio(id);
      notify('Envío Exitoso', 'Se ha reenviado la solicitud al cliente correctamente.');
      refetch();
    } catch (e: any) {
      notify('Error al reintentar', e.message || 'No se pudo reenviar la solicitud.');
    } finally {
      setRetryingId(null);
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
        <PressableScale
          style={[
            styles.backBtn,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          activeScale={pressScale.icon}
          onPress={() => router.replace('/(tabs)/notificaciones' as any)}
        >
          <Feather name="chevron-left" size={22} color={colors.text} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
          SOLICITUDES BOT
        </Text>
        <View style={{ width: 38 }} />
      </View>

      {isLoading && solicitudes.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlashList
          data={solicitudes}
          estimatedItemSize={120}
          keyExtractor={(item) => `solicitud-${item.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 50 }}
          refreshing={isLoading}
          onRefresh={refetch}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Feather name="help-circle" size={48} color={colors.success} style={{ marginBottom: 12, opacity: 0.8 }} />
              <Text style={[styles.emptyTextTitle, { color: colors.text }]}>Sin solicitudes</Text>
              <Text style={[styles.emptyTextSub, { color: colors.textMuted }]}>
                No hay solicitudes de ayuda pendientes en este momento.
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
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
                    <PressableScale
                      style={[
                        styles.discardBtn,
                        { borderColor: colors.border },
                      ]}
                      activeScale={pressScale.icon}
                      dimmed={descartandoId === item.id}
                      onPress={() => handleDiscard(item.id)}
                      disabled={descartandoId === item.id}
                      hitSlop={8}
                    >
                      {descartandoId === item.id
                        ? <ActivityIndicator size={14} color={colors.textMuted} />
                        : <Feather name="x" size={14} color={colors.textMuted} />
                      }
                    </PressableScale>
                  )}
                </View>

                <View style={styles.detailsBox}>
                  <Text style={[styles.motivoText, { color: colors.primary }]}>
                    Motivo: {motivoLabel}
                  </Text>
                  {item.consulta && (
                    <Text style={[styles.consultaText, { color: colors.text }]}>
                      Consulta: {item.consulta}
                    </Text>
                  )}
                </View>

                {isPendiente ? (
                  <PressableScale
                    style={[
                      styles.actionBtn,
                      { backgroundColor: colors.primary },
                    ]}
                    onPress={() => {
                      router.push({
                        pathname: '/seleccionar-productos',
                        params: { solicitudId: item.id.toString() },
                      } as any);
                    }}
                  >
                    <Text style={[styles.actionBtnText, { color: colors.onPrimary }]}>
                      ELEGIR PRODUCTO(S)
                    </Text>
                  </PressableScale>
                ) : (
                  <PressableScale
                    style={[
                      styles.actionBtn,
                      { backgroundColor: colors.border },
                    ]}
                    dimmed={retryingId === item.id}
                    disabled={retryingId === item.id}
                    onPress={() => handleRetry(item.id)}
                  >
                    {retryingId === item.id ? (
                      <ActivityIndicator color={colors.text} size="small" />
                    ) : (
                      <Text style={[styles.actionBtnText, { color: colors.text }]}>
                        REINTENTAR ENVÍO
                      </Text>
                    )}
                  </PressableScale>
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
  headerTitle: {
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 2,
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
  clientName: {
    fontSize: scaleFont(16),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  clientPhone: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  timeAgo: {
    fontSize: scaleFont(11),
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
  detailsBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  motivoText: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  consultaText: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(18),
  },
  actionBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  actionBtnText: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  // Empty
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 100,
    paddingHorizontal: 32,
  },
  emptyTextTitle: {
    fontSize: scaleFont(18),
    fontFamily: 'JetBrainsMono_700Bold',
    marginBottom: 6,
  },
  emptyTextSub: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_400Regular',
    textAlign: 'center',
    lineHeight: scaleFont(18),
  },
});
