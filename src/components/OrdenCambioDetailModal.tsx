import { scaleFont } from '../theme/responsive';
import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Modal,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import { useOrdenCambioDetalle, useReencolarItem, OrdenCambioItem, BackendStatus } from '../hooks/useOrdenCambioDetalle';
import { OrdenConItems } from '../hooks/useOrdenesHistory';
import { useUserRole, isPrivilegedRole } from '../hooks/useUserRole';
import { useAprobarOrden, useRechazarOrden } from '../hooks/useAprobaciones';
import { confirm, notify } from '../lib/notify';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildPdfHtml, printHtml } from '../utils/pdfGenerator';
import Svg, {
  Path, Defs, LinearGradient as SvgGradient, Stop, Filter,
  FeGaussianBlur, FeOffset, FeComponentTransfer, FeFuncA, FeMerge, FeMergeNode, Line
} from 'react-native-svg';

export interface OrdenCambioDetailModalProps {
  orden:   OrdenConItems | null;
  onClose: () => void;
}

/** Un item muestra el chip de write-back solo si viene de la app y su estado es informativo. */
function esItemRastreable(esOrdenApp: boolean, item: OrdenCambioItem): boolean {
  if (!esOrdenApp) return false;
  if (
    item.backend_status === 'pendiente' ||
    item.backend_status === 'aplicando' ||
    item.backend_status === 'error' ||
    item.backend_status === 'espera_aprobacion' ||
    item.backend_status === 'rechazado'
  ) {
    return true;
  }
  return item.backend_status === 'completado' && !!item.backend_aplicado_en;
}

function formatFechaCorta(iso: string): string {
  const d = new Date(iso);
  const fecha = d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${fecha} ${hora}`;
}

interface ResumenColors {
  danger:  string;
  warning: string;
  success: string;
}

function resumenAplicacion(items: OrdenCambioItem[], colors: ResumenColors): { texto: string; color: string } | null {
  const rastreables = items.filter(item => esItemRastreable(true, item));
  if (rastreables.length === 0) return null;

  const completados = rastreables.filter(item => item.backend_status === 'completado').length;
  const errores = rastreables.filter(item => item.backend_status === 'error').length;
  const total = rastreables.length;

  if (errores > 0) {
    return {
      texto: `${completados}/${total} aplicados · ${errores} error${errores > 1 ? 'es' : ''}`,
      color: colors.danger,
    };
  }
  return {
    texto: `${completados}/${total} aplicados`,
    color: completados === total ? colors.success : colors.warning,
  };
}

interface TicketBackgroundProps {
  width:  number;
  height: number;
  notchY: number;
}

function TicketBackground({ width, height, notchY }: TicketBackgroundProps): React.JSX.Element {
  const r  = 24; // corner radius
  const nr = 14; // notch radius
  
  const d = `
    M ${r} 0
    H ${width - r}
    A ${r} ${r} 0 0 1 ${width} ${r}
    V ${notchY - nr}
    A ${nr} ${nr} 0 0 0 ${width} ${notchY + nr}
    V ${height - r}
    A ${r} ${r} 0 0 1 ${width - r} ${height}
    H ${r}
    A ${r} ${r} 0 0 1 0 ${height - r}
    V ${notchY + nr}
    A ${nr} ${nr} 0 0 0 0 ${notchY - nr}
    V ${r}
    A ${r} ${r} 0 0 1 ${r} 0
    Z
  `;

  return (
    <View style={{ width, height, position: 'absolute', overflow: 'visible' }}>
      <Svg width={width + 80} height={height + 80} viewBox={`-40 -40 ${width + 80} ${height + 80}`} style={{ position: 'absolute', left: -40, top: -40 }}>
        <Defs>
          <Filter id="premiumShadow" x="-50%" y="-50%" width="200%" height="200%">
            <FeGaussianBlur in="SourceAlpha" stdDeviation="10" />
            <FeOffset dx="0" dy="8" result="offsetblur" />
            <FeComponentTransfer>
              <FeFuncA type="linear" slope="0.4" />
            </FeComponentTransfer>
            <FeMerge>
              <FeMergeNode />
              <FeMergeNode in="SourceGraphic" />
            </FeMerge>
          </Filter>
          
          <SvgGradient id="ticketGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#2A2A2A" stopOpacity="1" />
            <Stop offset="1" stopColor="#181818" stopOpacity="1" />
          </SvgGradient>
        </Defs>
        
        {/* Main Body with Shadow */}
        <Path d={d} fill="url(#ticketGrad)" filter="url(#premiumShadow)" />
        
        {/* Premium Edge Highlight - Notches */}
        <Path 
          d={`M ${width} ${notchY - nr} A ${nr} ${nr} 0 0 0 ${width} ${notchY + nr}`} 
          stroke="rgba(255,255,255,0.06)" 
          strokeWidth="1.5" 
          fill="none"
        />
        <Path 
          d={`M 0 ${notchY + nr} A ${nr} ${nr} 0 0 0 0 ${notchY - nr}`} 
          stroke="rgba(255,255,255,0.06)" 
          strokeWidth="1.5" 
          fill="none"
        />

        {/* Improved Perforation line */}
        <Line
          x1={nr + 4}
          y1={notchY}
          x2={width - nr - 4}
          y2={notchY}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1.5"
          strokeDasharray="6 6"
        />
      </Svg>
    </View>
  );
}

interface BackendStatusChipProps {
  item:          OrdenCambioItem;
  esDueno:       boolean;
  isExpanded:    boolean;
  onToggleExpand: () => void;
  ordenId:       number | null;
}

function TimelineSteps({ status }: { status: BackendStatus }): React.JSX.Element {
  const { colors } = useTheme();
  
  // Determine active index
  let activeIndex = 0;
  if (status === 'pendiente') activeIndex = 1;
  else if (status === 'aplicando') activeIndex = 2;
  else if (status === 'completado') activeIndex = 3;
  else if (status === 'error') activeIndex = 3;

  return (
    <View style={styles.timelineRow}>
      {/* Step 1: Emitido */}
      <View style={styles.timelineStep}>
        <View style={[styles.timelineDot, { backgroundColor: colors.success }]} />
        <Text style={[styles.timelineText, { color: colors.textMuted }]}>Emitido</Text>
      </View>
      
      <View style={[styles.timelineLine, { backgroundColor: activeIndex >= 1 ? (status === 'error' ? colors.danger : colors.primary) : colors.border }]} />

      {/* Step 2: En cola */}
      <View style={styles.timelineStep}>
        <View style={[
          styles.timelineDot, 
          activeIndex >= 1 && { backgroundColor: status === 'error' ? colors.danger : (activeIndex === 1 ? colors.warning : colors.success) },
          activeIndex < 1 && { borderColor: colors.border, borderWidth: 1, backgroundColor: 'transparent' }
        ]} />
        <Text style={[styles.timelineText, { color: activeIndex >= 1 ? colors.text : colors.textMuted }]}>En Cola</Text>
      </View>

      <View style={[styles.timelineLine, { backgroundColor: activeIndex >= 2 ? (status === 'error' ? colors.danger : colors.primary) : colors.border }]} />

      {/* Step 3: POS */}
      <View style={styles.timelineStep}>
        <View style={[
          styles.timelineDot,
          status === 'error' && { backgroundColor: colors.danger },
          status === 'completado' && { backgroundColor: colors.success },
          status === 'aplicando' && { backgroundColor: colors.primary },
          status !== 'error' && status !== 'completado' && status !== 'aplicando' && { borderColor: colors.border, borderWidth: 1, backgroundColor: 'transparent' }
        ]} />
        <Text style={[
          styles.timelineText, 
          { color: status === 'error' ? colors.danger : (status === 'completado' ? colors.success : (status === 'aplicando' ? colors.primary : colors.textMuted)) }
        ]}>
          {status === 'error' ? 'Error' : status === 'completado' ? 'Aplicado' : 'POS'}
        </Text>
      </View>
    </View>
  );
}

function BackendStatusChip({ item, esDueno, isExpanded, onToggleExpand, ordenId }: BackendStatusChipProps): React.JSX.Element {
  const { colors } = useTheme();
  const reencolar = useReencolarItem(ordenId);

  function handleReencolar(): void {
    const esRiesgoso = /ATENCIÓN|riesgo de ajuste doble/i.test(item.backend_resultado ?? '');

    function ejecutarReencolar(): void {
      reencolar.mutate(item.id, {
        onError: (e: Error) => notify('Error', e.message),
      });
    }

    if (esRiesgoso) {
      confirm({
        title:       'Riesgo de ajuste doble',
        message:     'El intento anterior quedó en estado ambiguo: puede que el ajuste SÍ se haya aplicado en HybridLite. Verifica la existencia actual del producto en HybridLite (o en Inventario tras un sync) antes de continuar. Si ya se aplicó, reencolar lo aplicaría DOS VECES.',
        confirmText: 'Reencolar igual',
        cancelText:  'Cancelar',
        destructive: true,
        onConfirm:   ejecutarReencolar,
      });
      return;
    }

    confirm({
      title:       'Reintentar aplicación',
      message:     'El item volverá a la cola y el backend lo aplicará de nuevo en HybridLite automáticamente.',
      confirmText: 'Reencolar',
      cancelText:  'Cancelar',
      onConfirm:   ejecutarReencolar,
    });
  }

  if (item.backend_status === 'espera_aprobacion') {
    return (
      <View style={styles.backendChipBlock}>
        <View style={[styles.backendChip, { backgroundColor: colors.warning + '18', borderColor: colors.warning + '40' }]}>
          <Feather name="clock" size={11} color={colors.warning} />
          <Text style={[styles.backendChipText, { color: colors.warning }]}>EN ESPERA DE APROBACIÓN</Text>
        </View>
        <Text style={[styles.backendChipSubtext, { color: colors.textDim }]}>
          Un administrador o superempleado debe aprobarlo antes de aplicarse al POS
        </Text>
      </View>
    );
  }

  if (item.backend_status === 'rechazado') {
    return (
      <View style={styles.backendChipBlock}>
        <View style={[styles.backendChip, { backgroundColor: colors.danger + '18', borderColor: colors.danger + '40' }]}>
          <Feather name="slash" size={11} color={colors.danger} />
          <Text style={[styles.backendChipText, { color: colors.danger }]}>RECHAZADO</Text>
        </View>
      </View>
    );
  }

  if (item.backend_status === 'pendiente') {
    const esPrueba = item.backend_resultado?.startsWith('[PREVIEW]');
    return (
      <View style={styles.backendChipBlock}>
        <TimelineSteps status="pendiente" />
        <View style={[styles.backendChip, { backgroundColor: colors.warning + '18', borderColor: colors.warning + '40', marginTop: 4 }]}>
          <Feather name="clock" size={11} color={colors.warning} />
          <Text style={[styles.backendChipText, { color: colors.warning }]}>
            {esPrueba ? 'EN COLA · PRUEBA' : 'EN COLA'}
          </Text>
        </View>
        <Text style={[styles.backendChipSubtext, { color: colors.textDim }]}>
          Se aplica automático fuera de horario comercial
        </Text>
      </View>
    );
  }

  if (item.backend_status === 'aplicando') {
    return (
      <View style={styles.backendChipBlock}>
        <TimelineSteps status="aplicando" />
        <View style={[styles.backendChip, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '40', marginTop: 4 }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.backendChipText, { color: colors.primary }]}>APLICANDO A LA BASE REAL...</Text>
        </View>
      </View>
    );
  }

  if (item.backend_status === 'completado') {
    return (
      <View style={styles.backendChipBlock}>
        <TimelineSteps status="completado" />
        <View style={[styles.backendChip, { backgroundColor: colors.success + '18', borderColor: colors.success + '40', marginTop: 4 }]}>
          <Feather name="check-circle" size={11} color={colors.success} />
          <Text style={[styles.backendChipText, { color: colors.success }]}>
            APLICADO EN HYBRID{item.backend_aplicado_en ? ` · ${formatFechaCorta(item.backend_aplicado_en)}` : ''}
          </Text>
        </View>
      </View>
    );
  }

  // error
  const esRiesgoso = /ATENCIÓN|riesgo de ajuste doble/i.test(item.backend_resultado ?? '');
  return (
    <View style={styles.backendChipBlock}>
      <TimelineSteps status="error" />
      <View style={[styles.backendChip, { backgroundColor: colors.danger + '18', borderColor: colors.danger + '40', marginTop: 4 }]}>
        <Feather name="alert-triangle" size={11} color={colors.danger} />
        <Text style={[styles.backendChipText, { color: colors.danger }]}>
          ERROR EN POS{item.backend_intentos > 0 ? ` · ${item.backend_intentos} intentos` : ''}
        </Text>
      </View>
      
      {esRiesgoso && (
        <View style={[styles.inlineWarning, { backgroundColor: colors.danger + '08', borderColor: colors.danger + '30' }]}>
          <Feather name="alert-octagon" size={12} color={colors.danger} />
          <Text style={[styles.inlineWarningText, { color: colors.danger }]}>
            RIESGO AJUSTE DOBLE: Verifica el stock actual en el POS antes de reintentar.
          </Text>
        </View>
      )}

      {item.backend_resultado ? (
        <Pressable 
          onPress={onToggleExpand} 
          style={[styles.errorLogContainer, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        >
          <View style={styles.errorLogHeader}>
            <Text style={[styles.errorLogTitle, { color: colors.textMuted }]}>
              Detalle del Error ({isExpanded ? 'Contraer' : 'Expandir'})
            </Text>
            <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} />
          </View>
          <Text
            style={[styles.backendErrorText, { color: colors.text }]}
            numberOfLines={isExpanded ? undefined : 2}
          >
            {item.backend_resultado}
          </Text>
        </Pressable>
      ) : null}

      {esDueno ? (
        <Pressable
          onPress={handleReencolar}
          disabled={reencolar.isPending}
          style={({ pressed }) => [
            styles.backendRetryBtn,
            { borderColor: colors.primary + '40', backgroundColor: colors.primary + '10', marginTop: 4 },
            (pressed || reencolar.isPending) && { opacity: 0.7 },
          ]}
        >
          {reencolar.isPending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Feather name="refresh-cw" size={11} color={colors.primary} />
              <Text style={[styles.backendRetryText, { color: colors.primary }]}>Reintentar Sincronización</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

export function OrdenCambioDetailModal({ orden, onClose }: OrdenCambioDetailModalProps): React.JSX.Element | null {
  const [showTicketDots, setShowTicketDots] = useState<boolean>(true);
  const [expandedErrorIds, setExpandedErrorIds] = useState<Set<number>>(new Set());
  const { colors } = useTheme();
  const { data: details = [], isLoading } = useOrdenCambioDetalle(orden?.id ?? null);
  const { data: userAuth } = useUserRole();
  const isPrivileged = isPrivilegedRole(userAuth?.role);
  const aprobarOrden = useAprobarOrden();
  const rechazarOrden = useRechazarOrden();
  const distinctCount = details.length;

  function toggleErrorExpanded(itemId: number): void {
    setExpandedErrorIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  const animProgress = useRef(new Animated.Value(0)).current; 
  const [ticketLayout, setTicketLayout] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const closeModal = (): void => {
    Animated.timing(animProgress, {
      toValue: 0,
      duration: 250,
      useNativeDriver: Platform.OS !== 'web',
    }).start(onClose);
  };

  const handleDownloadPdf = async (): Promise<void> => {
    if (!orden || details.length === 0) return;
    try {
      const html = buildPdfHtml(
        details.map(d => ({
          codigo_producto:   d.codigo_producto,
          descripcion:       d.descripcion,
          existencia_actual: d.existencia_actual,
          nueva_existencia:  d.nueva_existencia,
          precio_actual:      d.precio_actual,
          nuevo_precio:       d.nuevo_precio,
          costo:              d.costo,
          nota:              d.nota || '',
        })),
        orden.nota || '',
        orden.id,
        orden.creado_por_nombre
      );

      if (Platform.OS === 'web') {
        await printHtml(html);
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
    }
  };

  const onShow = (): void => {
    animProgress.setValue(0);
    Animated.spring(animProgress, {
      toValue: 1,
      useNativeDriver: Platform.OS !== 'web',
      tension: 65,
      friction: 11
    }).start();
  };

  useEffect(() => {
    if (orden) {
      onShow();
    }
  }, [orden]);

  if (!orden) return null;

  const esOrdenApp = !!orden.creado_por;
  const esDueno = !!userAuth?.profile?.id && userAuth.profile.id === orden.creado_por;

  // Detect transaction type from notes/header
  const cabeceraNota = orden.nota || '';
  let labelTipoUpper = 'AJUSTE DE INVENTARIO';
  let labelTipo = 'Ajuste de Stock';
  let badgeColor = colors.warning;
  let cleanNota = cabeceraNota;

  if (cabeceraNota.includes('[Local Com ID:')) {
    labelTipoUpper = 'COMPRA DE INVENTARIO';
    labelTipo = 'Compra Local';
    badgeColor = colors.success;
    cleanNota = cabeceraNota.replace(/\[Local Com ID:\s*\d+\]\s*-\s*/g, '');
  } else if (cabeceraNota.includes('[Local Inv ID:')) {
    labelTipoUpper = 'AJUSTE DE INVENTARIO';
    labelTipo = 'Ajuste (Local)';
    badgeColor = colors.primary;
    cleanNota = cabeceraNota.replace(/\[Local Inv ID:\s*\d+\]\s*-\s*/g, '');
  } else if (cabeceraNota.toLowerCase().includes('fail')) {
    cleanNota = '';
  }

  // Calculate stats
  const totalItemsAdjusted = details.reduce((acc, d) => acc + Math.abs(d.delta), 0);
  const netDelta = details.reduce((acc, d) => acc + d.delta, 0);
  const resumenApp = esOrdenApp ? resumenAplicacion(details, colors) : null;
  const hasErrors = details.some(d => d.backend_status === 'error');

  const ordenId = orden.id;
  const requiereAprobacion = orden.aprobacion_estado === 'pendiente';
  const puedeAprobar = isPrivileged && requiereAprobacion;
  const resolviendo = aprobarOrden.isPending || rechazarOrden.isPending;

  function handleAprobar(): void {
    confirm({
      title:       'Aprobar ajuste',
      message:     `OC-${String(ordenId).padStart(4, '0')} se enviará al POS Hybrid para aplicarse automáticamente.`,
      confirmText: 'Aprobar',
      onConfirm: () => {
        aprobarOrden.mutate(ordenId, {
          onSuccess: () => closeModal(),
          onError:   (e: Error) => notify('Error', e.message),
        });
      },
    });
  }

  function handleRechazar(): void {
    confirm({
      title:       'Rechazar ajuste',
      message:     `OC-${String(ordenId).padStart(4, '0')} no se aplicará al POS y quedará marcado como rechazado.`,
      confirmText: 'Rechazar',
      destructive: true,
      onConfirm: () => {
        rechazarOrden.mutate({ ordenId }, {
          onSuccess: () => closeModal(),
          onError:   (e: Error) => notify('Error', e.message),
        });
      },
    });
  }

  return (
    <Modal
      visible={!!orden}
      transparent={true}
      animationType="none"
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      onRequestClose={closeModal}
    >
      <Animated.View 
        style={[
          styles.modalOverlay, 
          { 
            opacity: animProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1]
            }) 
          }
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={closeModal}
        />
        <View style={styles.modalCloseContainer}>
          <Pressable 
            onPress={handleDownloadPdf} 
            style={({ pressed }) => [
              styles.modalCloseBtn,
              { 
                opacity: pressed ? 0.7 : 1, 
                marginRight: 10,
                backgroundColor: colors.primary + '20',
                borderColor: colors.primary + '40'
              }
            ]}
          >
            <Feather name="download" size={20} color={colors.primary} />
          </Pressable>
          <Pressable 
            onPress={closeModal} 
            style={({ pressed }) => [
              styles.modalCloseBtn,
              { opacity: pressed ? 0.7 : 1 }
            ]}
          >
            <Feather name="x" size={24} color="#FFF" />
          </Pressable>
        </View>
        <Animated.View 
          style={[
            styles.modalTicketWindow, 
            { 
              transform: [
                { 
                  scale: animProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1]
                  }) 
                },
                {
                  translateY: animProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [20, 0]
                  })
                }
              ] 
            }
          ]}
        >
          {isLoading ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <ScrollView 
              style={styles.modalScroll}
              contentContainerStyle={styles.modalContentWrapper}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.ticketShadowWrapper}>
                {ticketLayout.width > 0 ? (
                  <TicketBackground 
                    width={ticketLayout.width} 
                    height={ticketLayout.height} 
                    notchY={104}
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: '#222', borderRadius: 24 }]} />
                )}
                
                <View 
                  style={[
                    styles.ticketInnerContent,
                    { paddingBottom: 32 }
                  ]}
                  onLayout={(e) => {
                    const { width, height } = e.nativeEvent.layout;
                    if (Math.abs(ticketLayout.width - width) > 1 || Math.abs(ticketLayout.height - height) > 1) {
                      setTicketLayout({ width, height });
                    }
                  }}
                >
                  {/* Header */}
                  <View style={styles.ticketHeader}>
                    <View style={styles.ticketHeaderLeft}>
                      <Text style={[styles.ticketTitle, { color: colors.textMuted }]}>{labelTipoUpper}</Text>
                      <Text style={[styles.ticketFolio, { color: colors.text }]}>
                        {`OC-${String(orden.id).padStart(4, '0')}`}
                      </Text>
                      <Text style={[styles.ticketProducts, { color: colors.textMuted }]}>
                        {distinctCount} {distinctCount === 1 ? 'producto' : 'productos'}
                      </Text>
                    </View>
                    <View style={styles.ticketTimeContainer}>
                      <Text style={[styles.ticketDateLabel, { color: colors.textMuted }]}>FECHA / HORA</Text>
                      <Text style={[styles.ticketDate, { color: colors.text }]}>
                        {new Date(orden.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </Text>
                      <Text style={[styles.ticketTime, { color: colors.text }]}>
                        {new Date(orden.creado_en).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </Text>
                    </View>
                  </View>

                  {hasErrors && (
                    <View style={[styles.modalWarningBanner, { backgroundColor: colors.danger + '10', borderColor: colors.danger + '30' }]}>
                      <Feather name="alert-triangle" size={16} color={colors.danger} style={{ marginTop: 2 }} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[styles.modalWarningTitle, { color: colors.danger }]}>
                          Errores de Sincronización POS
                        </Text>
                        <Text style={[styles.modalWarningText, { color: colors.textMuted }]}>
                          Algunos ítems no pudieron aplicarse en el punto de venta. Revisa las advertencias y detalles de error a continuación.
                        </Text>
                      </View>
                    </View>
                  )}

                  {requiereAprobacion && (
                    <View style={[styles.approvalBanner, { backgroundColor: colors.warning + '10', borderColor: colors.warning + '30' }]}>
                      <Feather name="clock" size={16} color={colors.warning} style={{ marginTop: 2 }} />
                      <View style={{ flex: 1, gap: 10 }}>
                        <View style={{ gap: 2 }}>
                          <Text style={[styles.modalWarningTitle, { color: colors.warning }]}>En espera de aprobación</Text>
                          <Text style={[styles.modalWarningText, { color: colors.textMuted }]}>
                            {puedeAprobar
                              ? 'Revisa el ajuste y decide si aplicarlo al POS Hybrid.'
                              : 'Un administrador o superempleado debe aprobarlo antes de aplicarse al POS.'}
                          </Text>
                        </View>
                        {puedeAprobar && (
                          <View style={styles.approvalActions}>
                            <Pressable
                              disabled={resolviendo}
                              onPress={handleRechazar}
                              style={({ pressed }) => [
                                styles.approvalBtn,
                                { borderColor: colors.danger + '55', backgroundColor: colors.danger + '12' },
                                (pressed || resolviendo) && { opacity: 0.6 },
                              ]}
                            >
                              <Feather name="x" size={14} color={colors.danger} />
                              <Text style={[styles.approvalBtnText, { color: colors.danger }]}>Rechazar</Text>
                            </Pressable>
                            <Pressable
                              disabled={resolviendo}
                              onPress={handleAprobar}
                              style={({ pressed }) => [
                                styles.approvalBtn,
                                { borderColor: colors.success + '55', backgroundColor: colors.success + '12' },
                                (pressed || resolviendo) && { opacity: 0.6 },
                              ]}
                            >
                              {resolviendo ? (
                                <ActivityIndicator size="small" color={colors.success} />
                              ) : (
                                <>
                                  <Feather name="check" size={14} color={colors.success} />
                                  <Text style={[styles.approvalBtnText, { color: colors.success }]}>Aprobar</Text>
                                </>
                              )}
                            </Pressable>
                          </View>
                        )}
                      </View>
                    </View>
                  )}

                  <View style={{ height: hasErrors || requiereAprobacion ? 16 : 32 }} />

                  {/* Items List - Internal scroll for 3+ items */}
                  <View style={{ height: 16 }} />
                  <View style={[styles.ticketListContainer, { maxHeight: 280 }]}>
                    <ScrollView 
                      nestedScrollEnabled={true} 
                      showsVerticalScrollIndicator={false}
                      onScroll={(e) => {
                        const y = e.nativeEvent.contentOffset.y;
                        if (y > 10 && showTicketDots) setShowTicketDots(false);
                        if (y <= 10 && !showTicketDots) setShowTicketDots(true);
                      }}
                      scrollEventThrottle={16}
                    >
                      <View style={styles.ticketList}>
                        {details.map((item) => {
                          const delta = item.delta;
                          const isNeg = delta < 0;
                          const deltaColor = isNeg ? colors.danger : delta > 0 ? colors.success : colors.textMuted;
                          return (
                            <View key={item.id} style={styles.ticketItemRow}>
                              <View style={styles.ticketItemMain}>
                                <Text style={[styles.ticketItemDesc, { color: colors.text }]}>
                                  {item.descripcion}
                                </Text>
                                 <Text style={[styles.ticketItemQty, { color: colors.textMuted }]}>
                                   Cód: {item.codigo_producto}
                                   {item.existencia_actual !== item.nueva_existencia || item.delta !== 0 ? `  ·  Stock: ${item.existencia_actual} → ${item.nueva_existencia}` : ''}
                                 </Text>
                                 {((item.nuevo_precio !== undefined && item.nuevo_precio !== null) || (item.costo !== undefined && item.costo !== null)) && (
                                   <Text style={[styles.ticketItemQty, { color: colors.textMuted, marginTop: 2 }]}>
                                     {item.nuevo_precio !== undefined && item.nuevo_precio !== null ? `Precio: $${item.precio_actual?.toFixed(2)} → $${item.nuevo_precio.toFixed(2)}` : ''}
                                     {item.costo !== undefined && item.costo !== null ? `${item.nuevo_precio !== undefined && item.nuevo_precio !== null ? '  ·  ' : ''}Costo: $${item.costo.toFixed(2)}` : ''}
                                   </Text>
                                 )}
                                {item.nota && item.nota !== 'fail' ? (
                                  <Text style={[styles.ticketItemNote, { color: colors.textMuted, fontStyle: 'italic', fontSize: scaleFont(11), marginTop: 4 }]}>
                                    Nota: {item.nota}
                                  </Text>
                                ) : null}
                                {esItemRastreable(esOrdenApp, item) ? (
                                  <BackendStatusChip
                                    item={item}
                                    esDueno={esDueno}
                                    isExpanded={expandedErrorIds.has(item.id)}
                                    onToggleExpand={() => toggleErrorExpanded(item.id)}
                                    ordenId={orden.id}
                                  />
                                ) : null}
                              </View>
                              <View style={[styles.deltaBadge, { backgroundColor: deltaColor + '18', borderColor: deltaColor + '40' }]}>
                                <Text style={[styles.deltaText, { color: deltaColor }]}>
                                  {delta >= 0 ? '+' : ''}{delta}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </ScrollView>
                    
                    {details.length > 3 && (
                      <>
                        <LinearGradient
                          colors={['transparent', 'rgba(34,34,34,0.8)', '#222222']}
                          style={styles.ticketListFade}
                        />
                        {showTicketDots && (
                          <View style={styles.ticketScrollIndicator}>
                            <Text style={[styles.ticketScrollDots, { color: colors.text }]}>...</Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>

                  {/* Footer & Totals */}
                  <View style={styles.ticketFooter}>
                    <View style={{ height: 20 }} />
                    
                    <View style={styles.ticketFooterGrid}>
                      <View style={styles.ticketFooterRow}>
                        <Text style={[styles.ticketFooterLabel, { color: colors.textMuted }]}>TIPO</Text>
                        <View style={[styles.pagoChip, { backgroundColor: badgeColor + '18', borderColor: badgeColor + '40', marginRight: 0 }]}>
                          <Feather name={labelTipo.includes('Compra') ? 'shopping-cart' : 'sliders'} size={10} color={badgeColor} />
                          <Text style={[styles.pagoChipText, { color: badgeColor, fontFamily: 'JetBrainsMono_700Bold' }]} numberOfLines={1}>
                            {labelTipo.toUpperCase()}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.ticketFooterRow}>
                        <Text style={[styles.ticketFooterLabel, { color: colors.textMuted }]}>CREADO POR</Text>
                        <Text style={[styles.ticketFooterValue, { color: colors.text }]}>
                          {orden.creado_por_nombre || 'Desconocido'}
                        </Text>
                      </View>
                      <View style={styles.ticketFooterRow}>
                        <Text style={[styles.ticketFooterLabel, { color: colors.textMuted }]}>CAMBIO NETO</Text>
                        <Text style={[styles.ticketFooterValue, { color: netDelta >= 0 ? colors.success : colors.danger }]}>
                          {netDelta >= 0 ? '+' : ''}{netDelta} uds
                        </Text>
                      </View>
                      {resumenApp ? (
                        <View style={styles.ticketFooterRow}>
                          <Text style={[styles.ticketFooterLabel, { color: colors.textMuted }]}>APLICACIÓN AUTO</Text>
                          <Text style={[styles.ticketFooterValue, { color: resumenApp.color }]}>
                            {resumenApp.texto}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {cleanNota ? (
                      <View style={[styles.obsContainer, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
                        <Text style={[styles.obsLabel, { color: colors.textMuted }]}>OBSERVACIONES</Text>
                        <Text style={[styles.obsText, { color: colors.text }]}>{cleanNota}</Text>
                      </View>
                    ) : null}

                    <View style={[styles.ticketTotalSection, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '30', marginTop: 16 }]}>
                      <Text style={[styles.ticketTotalLabel, { color: colors.textMuted }]}>TOTAL UNIDADES AJUSTADAS</Text>
                      <View style={styles.ticketTotalValueRow}>
                        <Text style={[styles.ticketTotalValue, { color: colors.primary }]}>
                          {totalItemsAdjusted}
                        </Text>
                        <Text style={[styles.ticketTotalCurrency, { color: colors.primary }]}>UDS</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            </ScrollView>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalTicketWindow: {
    width: '92%',
    maxWidth: 500,
    maxHeight: '85%',
    borderRadius: 32,
    overflow: 'visible',
    alignSelf: 'center',
  },
  modalScroll: { 
    borderRadius: 32,
    overflow: 'visible',
  },
  modalContentWrapper: {
    padding: 16,
    paddingBottom: 32,
  },
  ticketShadowWrapper: {
    borderRadius: 24,
    backgroundColor: 'transparent',
    overflow: 'visible',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: '0px 4px 10px rgba(0,0,0,0.3)',
      } as any,
    }),
  },
  ticketInnerContent: {
    paddingTop: 32,
    paddingBottom: 32,
    overflow: 'visible',
  },
  ticketHeader: {
    paddingHorizontal: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  ticketHeaderLeft: { gap: 0, flex: 1, paddingRight: 8 },
  ticketTitle: { fontSize: scaleFont(8.5), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.85 },
  ticketFolio: { fontSize: scaleFont(20), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -0.5, marginTop: 2 },
  ticketProducts: { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_500Medium', marginTop: 4, opacity: 0.95 },
  ticketTimeContainer: { alignItems: 'flex-end', gap: 0 },
  ticketDateLabel: { fontSize: scaleFont(9), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1, opacity: 0.85, marginBottom: 2 },
  ticketDate: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },
  ticketTime: { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_500Medium', opacity: 0.9 },
  
  ticketListContainer: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  ticketList: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
  ticketListFade: {
    position: 'absolute',
    bottom: 0,
    left: 24,
    right: 24,
    height: 45,
    pointerEvents: 'none',
  },
  ticketScrollIndicator: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    alignItems: 'center',
    opacity: 0.5,
  },
  ticketScrollDots: {
    fontSize: scaleFont(20),
    fontWeight: '900',
    letterSpacing: 2,
    lineHeight: scaleFont(20),
  },
  ticketItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  ticketItemMain: { flex: 1, gap: 2, paddingRight: 12 },
  ticketItemDesc: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold', lineHeight: scaleFont(18) },
  ticketItemQty: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_500Medium', opacity: 0.85, marginTop: 2 },
  ticketItemNote: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', fontStyle: 'italic', marginTop: 4 },

  backendChipBlock: { gap: 6, marginTop: 6, alignItems: 'flex-start' },
  backendChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   3,
    paddingHorizontal: 8,
  },
  backendChipStandalone: { marginTop: 6 },
  backendChipText: {
    fontSize:      scaleFont(10),
    fontFamily:    'JetBrainsMono_700Bold',
    letterSpacing: 0.2,
  },
  backendChipSubtext: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
    fontStyle:  'italic',
  },
  backendErrorText: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(15),
  },
  backendRetryBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    borderRadius:      999,
    borderWidth:       0.5,
    paddingVertical:   4,
    paddingHorizontal: 10,
  },
  backendRetryText: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
  },

  deltaBadge: {
    borderRadius: 8,
    borderWidth: 0.5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
  },
  deltaText: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_700Bold',
  },

  ticketFooter: {
    paddingHorizontal: 24,
    marginTop: 10,
  },
  ticketFooterGrid: {
    gap: 14,
    marginBottom: 16,
  },
  ticketFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketFooterLabel: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.85 },
  ticketFooterValue: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },

  ticketTotalSection: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 8,
  },
  ticketTotalLabel: { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1.5, marginBottom: 8, opacity: 0.85 },
  ticketTotalValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  ticketTotalCurrency: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  ticketTotalValue: { fontSize: scaleFont(36), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -1 },

  modalLoading: { height: 200, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseContainer: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pagoChip: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              4,
    borderRadius:     999,
    borderWidth:      0.5,
    paddingVertical:  3,
    paddingHorizontal: 8,
    marginRight:      6,
  },
  pagoChipText: {
    fontSize:      scaleFont(11),
    fontFamily:    'JetBrainsMono_700Bold',
    letterSpacing: 0.2,
  },
  obsContainer: {
    borderWidth: 0.5,
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
    gap: 4,
  },
  obsLabel: {
    fontSize: scaleFont(10),
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  obsText: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(18),
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    paddingRight: 10,
  },
  timelineStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timelineLine: {
    flex: 1,
    height: 1,
    marginHorizontal: 8,
  },
  timelineText: {
    fontSize: scaleFont(9.5),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  inlineWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 0.5,
    padding: 8,
    marginTop: 6,
    alignSelf: 'stretch',
  },
  inlineWarningText: {
    fontSize: scaleFont(9.5),
    fontFamily: 'JetBrainsMono_700Bold',
    flex: 1,
    lineHeight: scaleFont(13),
  },
  errorLogContainer: {
    borderWidth: 0.5,
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    alignSelf: 'stretch',
    gap: 4,
  },
  errorLogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorLogTitle: {
    fontSize: scaleFont(9.5),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  modalWarningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 24,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  approvalBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 24,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  approvalActions: {
    flexDirection: 'row',
    gap: 8,
  },
  approvalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 0.5,
    paddingVertical: 10,
  },
  approvalBtnText: {
    fontSize: scaleFont(13),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  modalWarningTitle: {
    fontSize: scaleFont(12),
    fontFamily: 'JetBrainsMono_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  modalWarningText: {
    fontSize: scaleFont(11),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(15),
  },
});
