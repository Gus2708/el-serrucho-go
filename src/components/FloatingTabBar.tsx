import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { useUserRole } from '../hooks/useUserRole';
import { spring } from '../theme/motion';

const TABS: { name: string; icon: keyof typeof Feather.glyphMap; label: string }[] = [
  { name: 'index',          icon: 'home',         label: 'Inicio'         },
  { name: 'ventas',         icon: 'shopping-bag', label: 'Ventas'         },
  { name: 'inventario',     icon: 'package',      label: 'Inventario'     },
  { name: 'notificaciones', icon: 'bell',         label: 'Notificaciones' },
  { name: 'reportes',       icon: 'bar-chart',    label: 'Reportes'       },
  { name: 'ordenes',        icon: 'file-text',    label: 'Órdenes'        },
];

const PAD = 8;      // horizontal padding inside the pill
const CIRCLE = 44;  // active indicator diameter
const BAR_H = 60;

export function FloatingTabBar({ state, navigation }: BottomTabBarProps): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  useUserRole(); // Reportes ya está adaptado para empleados — todas las tabs visibles

  const reduced = useReducedMotion();
  const [barW, setBarW] = useState(0);

  // Only tabs whose route is actually registered, in render order.
  const visibleTabs = TABS
    .map((tab) => ({ ...tab, routeIndex: state.routes.findIndex((r) => r.name === tab.name) }))
    .filter((tab) => tab.routeIndex !== -1);

  const activePos = visibleTabs.findIndex((tab) => tab.routeIndex === state.index);
  const count = visibleTabs.length;
  const segW = barW > 0 ? (barW - PAD * 2) / count : 0;

  const tx = useSharedValue(0);
  const firstPlace = useRef(true);

  useEffect(() => {
    if (segW <= 0 || activePos < 0) return;
    const target = activePos * segW + (segW - CIRCLE) / 2;
    if (firstPlace.current || reduced) {
      tx.value = target; // no slide on first paint or under reduced motion
      firstPlace.current = false;
    } else {
      tx.value = withSpring(target, spring.indicator);
    }
  }, [activePos, segW, reduced, tx]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  function handleLayout(event: LayoutChangeEvent): void {
    setBarW(event.nativeEvent.layout.width);
  }

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.pill,
        {
          backgroundColor: '#141414',
          borderColor: colors.border,
          bottom: Platform.OS === 'web' ? 20 : Math.max(insets.bottom + 8, 18),
        },
      ]}
    >
      {segW > 0 && activePos >= 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            { width: CIRCLE, backgroundColor: colors.primary },
            indicatorStyle,
          ]}
        />
      )}

      {visibleTabs.map((tab) => (
        <TabButton
          key={tab.name}
          icon={tab.icon}
          label={tab.label}
          active={tab.routeIndex === state.index}
          activeColor={colors.onPrimary}
          inactiveColor="#484848"
          onPress={() => navigation.navigate(tab.name)}
        />
      ))}
    </View>
  );
}

interface TabButtonProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  active: boolean;
  activeColor: string;
  inactiveColor: string;
  onPress: () => void;
}

function TabButton({ icon, label, active, activeColor, inactiveColor, onPress }: TabButtonProps): React.ReactElement {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  function pressIn(): void {
    if (!reduced) scale.value = withSpring(0.86, spring.press);
  }
  function pressOut(): void {
    if (!reduced) scale.value = withSpring(1, spring.press);
  }

  return (
    <Pressable
      style={styles.btn}
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Animated.View style={iconStyle}>
        <Feather name={icon} size={20} color={active ? activeColor : inactiveColor} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position:       'absolute',
    alignSelf:      'center',
    width:          '92%',
    maxWidth:       360,
    height:         BAR_H,
    borderRadius:   999,
    borderWidth:    0.5,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-around',
    paddingHorizontal: PAD,
    ...Platform.select({
      ios: {
        shadowColor:   '#000',
        shadowOffset:  { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius:  8,
      },
      android: { elevation: 8 },
      web:     { boxShadow: '0 4px 20px rgba(0,0,0,0.5)' } as object,
    }),
  },
  indicator: {
    position:     'absolute',
    left:         PAD,
    top:          (BAR_H - CIRCLE) / 2,
    height:       CIRCLE,
    borderRadius: CIRCLE / 2,
  },
  btn: {
    flex:           1,
    height:         CIRCLE,
    alignItems:     'center',
    justifyContent: 'center',
  },
});
