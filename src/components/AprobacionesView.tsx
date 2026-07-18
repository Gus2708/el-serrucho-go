import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { notify, confirm } from '../lib/notify';
import { supabase } from '../lib/supabase';
import { useAprobaciones, useAprobarOrden, useRechazarOrden } from '../hooks/useAprobaciones';
import { OrdenConItems } from '../hooks/useOrdenesHistory';
import { OrdenCambioDetailModal } from './OrdenCambioDetailModal';
import { PressableScale } from './PressableScale';
import { pressScale } from '../theme/motion';

export default function AprobacionesView(): React.JSX.Element {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { data: ordenes = [], isLoading, refetch } = useAprobaciones();
  const aprobar = useAprobarOrden();
  const rechazar = useRechazarOrden();

  const [selectedOrden, setSelectedOrden] = useState<OrdenConItems | null>(null);
  const [rechazoOrdenId, setRechazoOrdenId] = useState<number | null>(null);
  const [motivo, setMotivo] = useState<string>('');
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Realtime: refresca cuando cambia una orden (empleado emite / se resuelve).
  useEffect(() => {
    const channel = supabase
      .channel('aprobaciones-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes_cambio' }, () => {
        queryClient.invalidateQueries({ queryKey: ['aprobaciones-pendientes'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  function handleAprobar(orden: OrdenConItems): void {
    confirm({
      title:       'Aprobar ajuste',
      message:     `OC-${String(orden.id).padStart(4, '0')} se enviará al POS Hybrid para aplicarse automáticamente.`,
      confirmText: 'Aprobar',
      onConfirm: () => {
        aprobar.mutate(orden.id, {
          onError: (e: Error) => notify('Error', e.message),
        });
      },
    });
  }

  function openRechazo(ordenId: number): void {
    setMotivo('');
    setRechazoOrdenId(ordenId);
  }

  function confirmarRechazo(): void {
    if (rechazoOrdenId === null) return;
    const ordenId = rechazoOrdenId;
    setRechazoOrdenId(null);
    rechazar.mutate(
      { ordenId, motivo: motivo.trim() || undefined },
      { onError: (e: Error) => notify('Error', e.message) },
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {ordenes.length === 0 ? (
        <View style={styles.center}>
          <Feather name="check-circle" size={32} color={colors.textDim} />
          <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Sin ajustes por aprobar</Text>
          <Text style={[styles.emptySub, { color: colors.textDim }]}>
            Los ajustes que emitan los empleados{'\n'}aparecerán aquí para tu revisión.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
        >
          {ordenes.map(orden => {
            const dateStr = new Date(orden.creado_en).toLocaleString('es-VE', {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            });
            const itemCount = orden.backend_resumen?.total ?? orden.item_count ?? 0;
            const busy = aprobar.isPending || rechazar.isPending;

            return (
              <PressableScale
                key={orden.id}
                style={[
                  styles.card,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                activeScale={pressScale.row}
                onPress={() => setSelectedOrden(orden)}
              >
                <View style={styles.cardTop}>
                  <Text style={[styles.cardId, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>
                    OC-{String(orden.id).padStart(4, '0')}
                  </Text>
                  <View style={[styles.waitBadge, { backgroundColor: colors.warning + '18', borderColor: colors.warning + '40' }]}>
                    <Feather name="clock" size={10} color={colors.warning} />
                    <Text style={[styles.waitBadgeText, { color: colors.warning }]}>Espera aprobación</Text>
                  </View>
                </View>

                <Text style={[styles.cardMeta, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                  {dateStr}{'  ·  '}{itemCount} ítem{itemCount !== 1 ? 's' : ''}
                  {orden.creado_por_nombre ? `  ·  ${orden.creado_por_nombre}` : ''}
                </Text>

                {orden.nota ? (
                  <Text style={[styles.cardNota, { color: colors.textMuted }]} numberOfLines={2}>
                    {orden.nota}
                  </Text>
                ) : null}

                <View style={styles.actions}>
                  <PressableScale
                    disabled={busy}
                    style={[
                      styles.actionBtn,
                      { borderColor: colors.danger + '55', backgroundColor: colors.danger + '10' },
                    ]}
                    dimmed={busy}
                    onPress={() => openRechazo(orden.id)}
                  >
                    <Feather name="x" size={14} color={colors.danger} />
                    <Text style={[styles.actionText, { color: colors.danger }]}>Rechazar</Text>
                  </PressableScale>

                  <PressableScale
                    disabled={busy}
                    style={[
                      styles.actionBtn,
                      { borderColor: colors.success + '55', backgroundColor: colors.success + '10' },
                    ]}
                    dimmed={busy}
                    onPress={() => handleAprobar(orden)}
                  >
                    <Feather name="check" size={14} color={colors.success} />
                    <Text style={[styles.actionText, { color: colors.success }]}>Aprobar</Text>
                  </PressableScale>
                </View>
              </PressableScale>
            );
          })}
          <View style={{ height: 150 }} />
        </ScrollView>
      )}

      <OrdenCambioDetailModal orden={selectedOrden} onClose={() => setSelectedOrden(null)} />

      {/* Modal de motivo de rechazo */}
      <Modal visible={rechazoOrdenId !== null} transparent animationType="fade" onRequestClose={() => setRechazoOrdenId(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Rechazar ajuste</Text>
            <Text style={[styles.modalSub, { color: colors.textMuted }]}>
              Opcional: indica por qué se rechaza (lo verá el empleado).
            </Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              placeholder="Motivo del rechazo…"
              placeholderTextColor={colors.textDim}
              value={motivo}
              onChangeText={setMotivo}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalActions}>
              <PressableScale
                style={[styles.modalBtn, { borderColor: colors.border }]}
                onPress={() => setRechazoOrdenId(null)}
              >
                <Text style={[styles.modalBtnText, { color: colors.textMuted }]}>Cancelar</Text>
              </PressableScale>
              <PressableScale
                style={[styles.modalBtn, { borderColor: colors.danger + '55', backgroundColor: colors.danger + '15' }]}
                onPress={confirmarRechazo}
              >
                <Text style={[styles.modalBtnText, { color: colors.danger }]}>Rechazar</Text>
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  scroll: { paddingTop: 12, gap: 8 },

  emptyTitle: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  emptySub:   { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_400Regular', textAlign: 'center', lineHeight: scaleFont(20) },

  card: {
    marginHorizontal: 16,
    borderRadius:     12,
    borderWidth:      0.5,
    padding:          14,
    gap:              6,
  },
  cardTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  cardId: { fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  waitBadge: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   3,
    paddingHorizontal: 10,
  },
  waitBadgeText: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },
  cardMeta: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },
  cardNota: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular' },

  actions: {
    flexDirection: 'row',
    gap:           8,
    marginTop:     8,
  },
  actionBtn: {
    flex:              1,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               6,
    borderRadius:      10,
    borderWidth:       0.5,
    paddingVertical:   10,
  },
  actionText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },

  modalOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent:  'center',
    alignItems:      'center',
    padding:         24,
  },
  modalCard: {
    width:        '100%',
    maxWidth:     420,
    borderRadius: 16,
    borderWidth:  0.5,
    padding:      18,
    gap:          10,
  },
  modalTitle: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  modalSub:   { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(17) },
  modalInput: {
    fontSize:          scaleFont(14),
    fontFamily:        'JetBrainsMono_400Regular',
    borderWidth:       0.5,
    borderRadius:      10,
    padding:           12,
    minHeight:         70,
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalBtn: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    10,
    borderWidth:     0.5,
    paddingVertical: 12,
  },
  modalBtnText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
});
