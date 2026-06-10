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
import { useOrdenCambioDetalle, OrdenCambioItem } from '../hooks/useOrdenCambioDetalle';
import { OrdenConItems } from '../hooks/useOrdenesHistory';
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

export function OrdenCambioDetailModal({ orden, onClose }: OrdenCambioDetailModalProps): React.JSX.Element | null {
  const [showTicketDots, setShowTicketDots] = useState<boolean>(true);
  const { colors } = useTheme();
  const { data: details = [], isLoading } = useOrdenCambioDetalle(orden?.id ?? null);
  const distinctCount = details.length;
  
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

                  <View style={{ height: 32 }} />

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
                                  Cód: {item.codigo_producto}  ·  Stock: {item.existencia_actual} → {item.nueva_existencia}
                                </Text>
                                {item.nota && item.nota !== 'fail' ? (
                                  <Text style={[styles.ticketItemNote, { color: colors.textMuted, fontStyle: 'italic', fontSize: 11, marginTop: 4 }]}>
                                    Nota: {item.nota}
                                  </Text>
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
  ticketTitle: { fontSize: 8.5, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.85 },
  ticketFolio: { fontSize: 20, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -0.5, marginTop: 2 },
  ticketProducts: { fontSize: 10, fontFamily: 'JetBrainsMono_500Medium', marginTop: 4, opacity: 0.95 },
  ticketTimeContainer: { alignItems: 'flex-end', gap: 0 },
  ticketDateLabel: { fontSize: 9, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1, opacity: 0.85, marginBottom: 2 },
  ticketDate: { fontSize: 12, fontFamily: 'JetBrainsMono_700Bold' },
  ticketTime: { fontSize: 10, fontFamily: 'JetBrainsMono_500Medium', opacity: 0.9 },
  
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
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
    lineHeight: 20,
  },
  ticketItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  ticketItemMain: { flex: 1, gap: 2, paddingRight: 12 },
  ticketItemDesc: { fontSize: 13, fontFamily: 'JetBrainsMono_700Bold', lineHeight: 18 },
  ticketItemQty: { fontSize: 11, fontFamily: 'JetBrainsMono_500Medium', opacity: 0.85, marginTop: 2 },
  ticketItemNote: { fontSize: 11, fontFamily: 'JetBrainsMono_400Regular', fontStyle: 'italic', marginTop: 4 },
  
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
    fontSize: 12,
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
  ticketFooterLabel: { fontSize: 12, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.85 },
  ticketFooterValue: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },

  ticketTotalSection: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 8,
  },
  ticketTotalLabel: { fontSize: 10, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1.5, marginBottom: 8, opacity: 0.85 },
  ticketTotalValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  ticketTotalCurrency: { fontSize: 14, fontFamily: 'JetBrainsMono_700Bold' },
  ticketTotalValue: { fontSize: 36, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -1 },

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
    fontSize:      11,
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
    fontSize: 10,
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
  obsText: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: 18,
  },
});
