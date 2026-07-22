import { scaleFont } from '../theme/responsive';
import React, { useEffect, useState } from 'react';
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
import { PressableScale } from './PressableScale';

export interface RegisteredData {
  id: number;
  codigo: string;
  nombre: string;
  rif: string;
  telefono?: string | null;
  direccion?: string | null;
}

interface RegistroStatusModalProps {
  visible:          boolean;
  tipo:             'cliente' | 'proveedor';
  registroId:       number | null;
  initialNombre:    string;
  initialRif:       string;
  initialTelefono?: string;
  initialDireccion?:string;
  onClose:          () => void;
  onProceed?:       (data: RegisteredData) => void;
  proceedLabel?:    string;
}

type BackendStatus = 'pendiente' | 'aplicando' | 'completado' | 'error';

export default function RegistroStatusModal({
  visible,
  tipo,
  registroId,
  initialNombre,
  initialRif,
  initialTelefono,
  initialDireccion,
  onClose,
  onProceed,
  proceedLabel,
}: RegistroStatusModalProps): React.JSX.Element {
  const { colors } = useTheme();

  const [status, setStatus]             = useState<BackendStatus>('pendiente');
  const [resultado, setResultado]       = useState<string | null>(null);
  const [codigoHybrid, setCodigoHybrid] = useState<string | null>(null);
  const [isRetrying, setIsRetrying]     = useState(false);

  const tabla = tipo === 'cliente' ? 'registro_clientes_app' : 'registro_proveedores_app';
  const colCodigo = tipo === 'cliente' ? 'codigo_cliente_hybrid' : 'codigo_proveedor_hybrid';
  const prefix = tipo === 'cliente' ? 'RC-' : 'RP-';

  // ── Fetch & Realtime subscription ──────────────────────────────────────────
  useEffect(() => {
    if (!visible || !registroId) return;

    setStatus('pendiente');
    setResultado(null);
    setCodigoHybrid(null);

    let isMounted = true;

    async function fetchCurrentStatus() {
      try {
        const { data, error } = await supabase
          .from(tabla)
          .select(`backend_status, backend_resultado, ${colCodigo}`)
          .eq('id', registroId)
          .single();

        if (error) return;
        if (data && isMounted) {
          setStatus((data.backend_status as BackendStatus) || 'pendiente');
          setResultado(data.backend_resultado || null);
          const code = (data as any)[colCodigo];
          if (code) setCodigoHybrid(code);
        }
      } catch (e) {
        console.warn('[RegistroStatusModal] error fetching status:', e);
      }
    }

    fetchCurrentStatus();

    // Setup Realtime subscription
    const channel = supabase
      .channel(`status-${tabla}-${registroId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tabla,
          filter: `id=eq.${registroId}`,
        },
        (payload: any) => {
          if (!isMounted) return;
          const newRow = payload.new;
          if (newRow) {
            setStatus((newRow.backend_status as BackendStatus) || 'pendiente');
            setResultado(newRow.backend_resultado || null);
            const code = newRow[colCodigo];
            if (code) setCodigoHybrid(code);
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
  }, [visible, registroId, tabla, colCodigo]);

  // ── Reintento en caso de error ─────────────────────────────────────────────
  async function handleRetry() {
    if (!registroId) return;
    setIsRetrying(true);
    try {
      const { error } = await supabase
        .from(tabla)
        .update({
          backend_status: 'pendiente',
          backend_resultado: null,
          backend_intentos: 0,
        })
        .eq('id', registroId);

      if (!error) {
        setStatus('pendiente');
        setResultado(null);
      }
    } catch (e) {
      console.error('[RegistroStatusModal] retry failed:', e);
    } finally {
      setIsRetrying(false);
    }
  }

  // ── Continuar / Seleccionar objeto final ──────────────────────────────────
  function handleProceed() {
    const finalCode = codigoHybrid || (initialRif ? initialRif.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : `AUTO-${registroId}`);
    const registeredObj: RegisteredData = {
      id: registroId || 0,
      codigo: finalCode,
      nombre: initialNombre,
      rif: initialRif,
      telefono: initialTelefono,
      direccion: initialDireccion,
    };

    if (onProceed) {
      onProceed(registeredObj);
    }
    onClose();
  }

  const numFormateado = registroId ? `${prefix}${String(registroId).padStart(4, '0')}` : '';
  const defaultActionText = tipo === 'cliente' ? 'Usar en Presupuesto' : 'Usar en Compra';
  const actionText = proceedLabel || defaultActionText;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[styles.iconBox, { backgroundColor: colors.primary + '15' }]}>
                <Feather
                  name={tipo === 'cliente' ? 'user-check' : 'truck'}
                  size={20}
                  color={colors.primary}
                />
              </View>
              <View>
                <Text style={[styles.title, { color: colors.text }]}>
                  {status === 'completado'
                    ? `${tipo === 'cliente' ? 'Cliente' : 'Proveedor'} Registrado`
                    : `Registrando ${tipo === 'cliente' ? 'cliente' : 'proveedor'}`}
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
                <Text style={[styles.stepDesc, { color: colors.textMuted }]}>
                  {initialNombre} ({initialRif})
                </Text>
              </View>
            </View>

            <View style={[styles.stepLine, { backgroundColor: status === 'completado' ? '#10B981' : colors.border }]} />

            {/* Paso 2: Sincronización en DB */}
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
                    ? 'Subido a la base de datos'
                    : status === 'aplicando'
                    ? 'Procesando en la tienda...'
                    : status === 'error'
                    ? 'Error de sincronización'
                    : 'En cola para sincronización...'}
                </Text>
                <Text style={[styles.stepDesc, { color: colors.textMuted }]}>
                  {status === 'completado'
                    ? 'Ficha creada y disponible para operaciones.'
                    : status === 'aplicando'
                    ? 'Dando de alta la ficha en Hybrid Lite.'
                    : status === 'error'
                    ? resultado || 'No se pudo dar de alta la ficha.'
                    : 'El backend procesará el alta en breve.'}
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
                  Listo para usar
                </Text>
              </View>

              <View style={styles.summaryDetails}>
                <Text style={[styles.summaryText, { color: colors.text }]}>
                  <Text style={{ fontFamily: 'JetBrainsMono_700Bold' }}>Nombre: </Text>
                  {initialNombre}
                </Text>
                <Text style={[styles.summaryText, { color: colors.text }]}>
                  <Text style={{ fontFamily: 'JetBrainsMono_700Bold' }}>RIF / Cédula: </Text>
                  {initialRif}
                </Text>
                {codigoHybrid && (
                  <Text style={[styles.summaryText, { color: colors.text }]}>
                    <Text style={{ fontFamily: 'JetBrainsMono_700Bold' }}>Código DB: </Text>
                    {codigoHybrid}
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
                  {actionText}
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
                      <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>Reintentar registro</Text>
                    </>
                  )}
                </PressableScale>

                <PressableScale style={[styles.btnSecondary, { borderColor: colors.border }]} onPress={onClose}>
                  <Text style={[styles.btnSecondaryText, { color: colors.textMuted }]}>Cerrar</Text>
                </PressableScale>
              </View>
            ) : (
              <View style={{ gap: 10, width: '100%' }}>
                {onProceed && (
                  <PressableScale
                    style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
                    onPress={handleProceed}
                  >
                    <Feather name="check" size={18} color={colors.onPrimary} />
                    <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>
                      {actionText} (Usar de inmediato)
                    </Text>
                  </PressableScale>
                )}
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
