import * as React from 'react';
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { spring, timing, pressScale } from '../theme/motion';
import { PressableScale } from './PressableScale';
import { usePedido } from '../hooks/usePedido';
import PedidosView from './PedidosView';
import PedidosHistorialView from './PedidosHistorialView';

const FAB_SIZE = 58;

/**
 * Botón flotante de carrito (gold, abajo a la derecha) para armar un PEDIDO
 * desde cualquier pantalla — "a la mano", sin entrar a Órdenes. Al tocarlo abre
 * un modal deslizante con el armador de pedido + su historial.
 *
 * Motion (Emil/Apple): entra con un pop de spring suave (nunca desde scale 0),
 * el press usa PressableScale (spring), y el badge de ítems en borrador aparece
 * con un pop. Respeta prefers-reduced-motion.
 */
export function PedidoFab(): React.JSX.Element {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const modalOpen = usePedido(s => s.modalOpen);
  const setModalOpen = usePedido(s => s.setModalOpen);
  const draftCount = usePedido(s => s.items.length);

  // Entrada: pop de escala + opacidad al montar (nada desde scale 0).
  const enter = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = withSpring(1, spring.bouncy);
  }, [reduced, enter]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.8 + enter.value * 0.2 }],
  }));

  // Pop del badge cuando cambia el contador.
  const badgePop = useSharedValue(1);
  useEffect(() => {
    if (draftCount === 0 || reduced) return;
    badgePop.value = withTiming(1.28, timing.press, () => {
      badgePop.value = withSpring(1, spring.press);
    });
  }, [draftCount, reduced, badgePop]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badgePop.value }] }));

  const bottom = (Platform.OS === 'web' ? 94 : insets.bottom + 94);

  return (
    <>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.fabWrap, { bottom, right: 18 }, enterStyle]}
      >
        <PressableScale
          activeScale={0.92}
          onPress={() => setModalOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Nuevo pedido"
          style={[
            styles.fab,
            {
              backgroundColor: colors.primary,
              shadowColor: colors.primary,
            },
          ]}
        >
          <View style={styles.iconWrap}>
            <Feather name="shopping-cart" size={24} color={colors.onPrimary} style={styles.cartIcon} />
          </View>
          {draftCount > 0 ? (
            <Animated.View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.primary }, badgeStyle]}>
              <Text style={[styles.badgeText, { color: colors.primary }]} numberOfLines={1}>
                {draftCount > 9 ? '9+' : draftCount}
              </Text>
            </Animated.View>
          ) : null}
        </PressableScale>
      </Animated.View>

      <PedidoModal visible={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

// ── Modal (armar + historial) ─────────────────────────────────────────────────

function PedidoModal({ visible, onClose }: { visible: boolean; onClose: () => void }): React.JSX.Element {
  const { colors } = useTheme();
  const router = useRouter();
  const [subTab, setSubTab] = useState<'armar' | 'historial'>('armar');

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={[styles.modalRoot, { backgroundColor: colors.bg }]} edges={['top']}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <View style={styles.modalTitleRow}>
            <Feather name="shopping-cart" size={18} color={colors.primary} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>Pedido</Text>
          </View>
          <PressableScale onPress={onClose} hitSlop={10} activeScale={pressScale.icon} style={styles.closeBtn}>
            <Feather name="x" size={22} color={colors.textMuted} />
          </PressableScale>
        </View>

        <View style={[styles.subTabContainer, { backgroundColor: '#0A0A0A', borderColor: colors.border }]}>
          <PressableScale
            activeScale={pressScale.row}
            style={[styles.subTabBtn, subTab === 'armar' && { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setSubTab('armar')}
          >
            <Text style={[styles.subTabText, { color: subTab === 'armar' ? colors.primary : colors.textMuted }]}>Nuevo pedido</Text>
          </PressableScale>
          <PressableScale
            activeScale={pressScale.row}
            style={[styles.subTabBtn, subTab === 'historial' && { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setSubTab('historial')}
          >
            <Text style={[styles.subTabText, { color: subTab === 'historial' ? colors.primary : colors.textMuted }]}>Historial</Text>
          </PressableScale>
        </View>

        {subTab === 'armar'
          ? <PedidosView router={router} onEmitted={() => setSubTab('historial')} />
          : <PedidosHistorialView onEditRetry={() => setSubTab('armar')} />}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fabWrap: {
    position: 'absolute',
    zIndex: 50,
  },
  fab: {
    width:          FAB_SIZE,
    height:         FAB_SIZE,
    borderRadius:   FAB_SIZE / 2,
    alignItems:     'center',
    justifyContent: 'center',
    shadowOffset:   { width: 0, height: 6 },
    shadowOpacity:  0.4,
    shadowRadius:   10,
    elevation:      10,
  },
  iconWrap: {
    width:          24,
    height:         24,
    alignItems:     'center',
    justifyContent: 'center',
    marginLeft:     -1,
  },
  cartIcon: {
    textAlign:         'center',
    textAlignVertical: 'center',
    lineHeight:        24,
  },
  badge: {
    position:       'absolute',
    top:            -3,
    right:          -3,
    minWidth:       20,
    height:         20,
    borderRadius:   10,
    borderWidth:    2,
    alignItems:     'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: scaleFont(10), fontFamily: 'JetBrainsMono_700Bold' },

  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    paddingTop:        8,
    paddingBottom:     12,
    borderBottomWidth: 0.5,
  },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle: { fontSize: scaleFont(20), fontFamily: 'JetBrainsMono_700Bold' },
  closeBtn: { padding: 4 },

  subTabContainer: {
    flexDirection:    'row',
    marginHorizontal: 16,
    marginVertical:   12,
    padding:          4,
    borderRadius:     14,
    gap:              4,
    borderWidth:      0.5,
  },
  subTabBtn: {
    flex:            1,
    paddingVertical: 10,
    borderRadius:    10,
    borderWidth:     0.5,
    borderColor:     'transparent',
    alignItems:      'center',
    justifyContent:  'center',
  },
  subTabText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
});
