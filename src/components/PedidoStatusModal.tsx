import { scaleFont } from '../theme/responsive';
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notify';
import { PressableScale } from './PressableScale';

export interface PedidoStatusModalProps {
  visible:        boolean;
  pedidoId:       number | null;
  initialCliente?: string | null;
  initialItemCount?: number;
  onClose:        () => void;
  onProceed?:     () => void;
  proceedLabel?:  string;
}

type BackendStatus = 'pendiente' | 'aplicando' | 'completado' | 'error';

export default function PedidoStatusModal({
  visible,
  pedidoId,
  initialCliente,
  initialItemCount = 0,
  onClose,
  onProceed,
  proceedLabel = 'Ir al historial',
}: PedidoStatusModalProps): React.JSX.Element {
  const { colors } = useTheme();

  const [status, setStatus]             = useState<BackendStatus>('pendiente');
  const [resultado, setResultado]       = useState<string | null>(null);
  const [documentoHybrid, setDocumentoHybrid] = useState<string | null>(null);
  const [clienteNombre, setClienteNombre]   = useState<string | null>(initialCliente || null);
  const [isRetrying, setIsRetrying]     = useState(false);

  const notifiedRef = useRef<Record<string, boolean>>({});

  // ── Sync initial values & reset notifications on new visible/pedidoId ──────
  useEffect(() => {
    if (visible && pedidoId) {
      if (initialCliente) setClienteNombre(initialCliente);
      notifiedRef.current = {};
    }
  }, [visible, pedidoId, initialCliente]);

  // ── Fetch & Realtime subscription ──────────────────────────────────────────
  useEffect(() => {
    if (!visible || !pedidoId) return;

    setStatus('pendiente');
    setResultado(null);
    setDocumentoHybrid(null);

    let isMounted = true;

    async function fetchCurrentStatus() {
      try {
        const { data, error } = await supabase
          .from('pedidos_app')
          .select('backend_status, backend_resultado, documento_hybrid, cliente_nombre')
          .eq('id', pedidoId)
          .single();

        if (error) return;
        if (data && isMounted) {
          const currentStatus = (data.backend_status as BackendStatus) || 'pendiente';
          setStatus(currentStatus);
          setResultado(data.backend_resultado || null);
          if (data.documento_hybrid) setDocumentoHybrid(data.documento_hybrid);
          if (data.cliente_nombre) setClienteNombre(data.cliente_nombre);

          // Avisos al terminar (una sola vez por estado final)
          if (currentStatus === 'completado' && !notifiedRef.current['completado']) {
            notifiedRef.current['completado'] = true;
            notify(
              '¡Pedido en caja!',
              `PED-${String(pedidoId).padStart(4, '0')} ${
                data.documento_hybrid ? `(Doc N° ${data.documento_hybrid})` : ''
              } listo para facturar.`
            );
          } else if (currentStatus === 'error' && !notifiedRef.current['error']) {
            notifiedRef.current['error'] = true;
            notify(
              'Error en pedido',
              data.backend_resultado || 'No se pudo dar de alta el pedido en Hybrid POS.'
            );
          }
        }
      } catch (e) {
        console.warn('[PedidoStatusModal] error fetching status:', e);
      }
    }

    fetchCurrentStatus();

    // Realtime listener
    const channel = supabase
      .channel(`status-pedidos_app-${pedidoId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pedidos_app',
          filter: `id=eq.${pedidoId}`,
        },
        (payload: any) => {
          if (!isMounted) return;
          const newRow = payload.new;
          if (newRow) {
            const currentStatus = (newRow.backend_status as BackendStatus) || 'pendiente';
            setStatus(currentStatus);
            setResultado(newRow.backend_resultado || null);
            if (newRow.documento_hybrid) setDocumentoHybrid(newRow.documento_hybrid);
            if (newRow.cliente_nombre) setClienteNombre(newRow.cliente_nombre);

            if (currentStatus === 'completado' && !notifiedRef.current['completado']) {
              notifiedRef.current['completado'] = true;
              notify(
                '¡Pedido en caja!',
                `PED-${String(pedidoId).padStart(4, '0')} ${
                  newRow.documento_hybrid ? `(Doc N° ${newRow.documento_hybrid})` : ''
                } listo para facturar.`
              );
            } else if (currentStatus === 'error' && !notifiedRef.current['error']) {
              notifiedRef.current['error'] = true;
              notify(
                'Error en pedido',
                newRow.backend_resultado || 'No se pudo dar de alta el pedido en Hybrid POS.'
              );
            }
          }
        }
      )
      .subscribe();

    // Fallback polling every 2.5s
    const interval = setInterval(() => {
      if (isMounted) fetchCurrentStatus();
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [visible, pedidoId]);

  // ── Reintento en caso de error ─────────────────────────────────────────────
  async function handleRetry() {
    if (!pedidoId) return;
    setIsRetrying(true);
    try {
      const { error } = await supabase
        .from('pedidos_app')
        .update({
          backend_status:      'pendiente',
          backend_resultado:   null,
          backend_intentos:    0,
          backend_aplicado_en: null,
        })
        .eq('id', pedidoId);

      if (!error) {
        setStatus('pendiente');
        setResultado(null);
        notifiedRef.current = {};
      } else {
        notify('Error', error.message);
      }
    } catch (e: any) {
      console.error('[PedidoStatusModal] retry failed:', e);
      notify('Error', e?.message || 'Error al reintentar');
    } finally {
      setIsRetrying(false);
    }
  }

  // ── Continuar / Proceder al historial ─────────────────────────────────────
  function handleProceed() {
    if (onProceed) {
      onProceed();
    }
    onClose();
  }

  const numFormateado = pedidoId ? `PED-${String(pedidoId).padStart(4, '0')}` : '';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[styles.iconBox, { backgroundColor: colors.primary + '15' }]}>
                <Feather
                  name={status === 'completado' ? 'check-circle' : 'shopping-bag'}
                  size={20}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                  {status === 'completado'
                    ? 'Pedido Registrado en Caja'
                    : status === 'error'
                    ? 'Error en Pedido'
                    : 'Registrando Pedido'}
                </Text>
                {numFormateado ? (
                  <Text style={[styles.subTitle, { color: colors.textMuted }]}>
                    Solicitud {numFormateado}
                  </Text>
                ) : null}
              </View>
            </View>

            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {/* Stepper Status */}
          <View style={[styles.stepperContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {/* Paso 1: Solicitud encolada */}
            <View style={styles.stepRow}>
              <View style={[styles.stepCircle, { backgroundColor: '#10B98120', borderColor: '#10B981' }]}>
                <Feather name="check" size={14} color="#10B981" />
              </View>
              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>Solicitud registrada</Text>
                <Text style={[styles.stepDesc, { color: colors.textMuted }]} numberOfLines={1}>
                  {clienteNombre ? clienteNombre : 'Cliente habitual'}
                  {initialItemCount > 0 ? ` · ${initialItemCount} ítem${initialItemCount > 1 ? 's' : ''}` : ''}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.stepLine,
                { backgroundColor: status === 'completado' ? '#10B981' : colors.border },
              ]}
            />

            {/* Paso 2: Sincronización en Hybrid POS */}
            <View style={styles.stepRow}>
              {status === 'completado' ? (
                <View style={[styles.stepCircle, { backgroundColor: '#10B98120', borderColor: '#10B981' }]}>
                  <Feather name="check" size={14} color="#10B981" />
                </View>
              ) : status === 'error' ? (
                <View style={[styles.stepCircle, { backgroundColor: '#EF444420', borderColor: '#EF4444' }]}>
                  <Feather name="alert-circle" size={14} color="#EF4444" />
                </View>
              ) : (
                <View style={[styles.stepCircle, { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              )}

              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                  {status === 'completado'
                    ? 'Registrado en caja'
                    : status === 'aplicando'
                    ? 'Procesando en la tienda...'
                    : status === 'error'
                    ? 'Error de sincronización'
                    : 'En cola para sincronización...'}
                </Text>
                <Text style={[styles.stepDesc, { color: colors.textMuted }]}>
                  {status === 'completado'
                    ? documentoHybrid
                      ? `Asignado Documento N° ${documentoHybrid} en caja.`
                      : 'Listo en caja para facturar.'
                    : status === 'aplicando'
                    ? 'Dando de alta el pedido en Hybrid POS.'
                    : status === 'error'
                    ? resultado || 'No se pudo enviar el pedido a caja.'
                    : 'El backend procesará el pedido en breve.'}
                </Text>
              </View>
            </View>
          </View>

          {/* Ficha Resumen (al completar) */}
          {status === 'completado' && (
            <View style={[styles.summaryCard, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
              <View style={styles.summaryHeader}>
                <Feather name="check-circle" size={16} color={colors.primary} />
                <Text style={[styles.summaryTitle, { color: colors.primary }]}>
                  Listo en Caja para Facturar
                </Text>
              </View>

              <View style={styles.summaryDetails}>
                <Text style={[styles.summaryText, { color: colors.text }]}>
                  <Text style={{ fontFamily: 'JetBrainsMono_700Bold' }}>Pedido: </Text>
                  {numFormateado}
                </Text>
                {clienteNombre ? (
                  <Text style={[styles.summaryText, { color: colors.text }]}>
                    <Text style={{ fontFamily: 'JetBrainsMono_700Bold' }}>Cliente: </Text>
                    {clienteNombre}
                  </Text>
                ) : null}
                {documentoHybrid && (
                  <Text style={[styles.summaryText, { color: colors.text }]}>
                    <Text style={{ fontFamily: 'JetBrainsMono_700Bold' }}>N° Pedido en POS: </Text>
                    {documentoHybrid}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Botones de acción */}
          <View style={styles.actionsContainer}>
            {status === 'completado' ? (
              <PressableScale
                style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
                onPress={handleProceed}
              >
                <Feather name="arrow-right-circle" size={18} color={colors.onPrimary} />
                <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>
                  {proceedLabel}
                </Text>
              </PressableScale>
            ) : status === 'error' ? (
              <View style={{ gap: 10, width: '100%' }}>
                <PressableScale
                  style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
                  dimmed={isRetrying}
                  disabled={isRetrying}
                  onPress={handleRetry}
                >
                  {isRetrying ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <>
                      <Feather name="refresh-cw" size={16} color={colors.onPrimary} />
                      <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>
                        Reintentar registro
                      </Text>
                    </>
                  )}
                </PressableScale>

                <PressableScale
                  style={[styles.btnSecondary, { borderColor: colors.border }]}
                  onPress={onClose}
                >
                  <Text style={[styles.btnSecondaryText, { color: colors.textMuted }]}>
                    Cerrar
                  </Text>
                </PressableScale>
              </View>
            ) : (
              <View style={{ gap: 10, width: '100%' }}>
                <PressableScale
                  style={[styles.btnSecondary, { borderColor: colors.border }]}
                  onPress={onClose}
                >
                  <Text style={[styles.btnSecondaryText, { color: colors.textMuted }]}>
                    Continuar en segundo plano
                  </Text>
                </PressableScale>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 0.5,
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: scaleFont(16),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  subTitle: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  stepperContainer: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    gap: 10,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stepCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepLine: {
    width: 2,
    height: 14,
    marginLeft: 12,
    marginVertical: -4,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  stepDesc: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop: 2,
  },
  summaryCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    gap: 8,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryTitle: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryDetails: {
    gap: 4,
  },
  summaryText: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_400Regular',
  },
  actionsContainer: {
    alignItems: 'center',
  },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnPrimaryText: {
    fontSize: scaleFont(14),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  btnSecondary: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  btnSecondaryText: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_500Medium',
  },
});
