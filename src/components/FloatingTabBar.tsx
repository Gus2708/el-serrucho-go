import * as React from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useUserRole } from '../hooks/useUserRole';

const TABS: { name: string; icon: keyof typeof Feather.glyphMap; label: string }[] = [
  { name: 'index',      icon: 'home',         label: 'Inicio'     },
  { name: 'ventas',     icon: 'shopping-bag', label: 'Ventas'     },
  { name: 'inventario', icon: 'package',      label: 'Inventario' },
  { name: 'alertas',    icon: 'bell',         label: 'Alertas'    },
  { name: 'reportes',   icon: 'bar-chart',    label: 'Reportes'   },
  { name: 'ordenes',    icon: 'file-text',    label: 'Órdenes'    },
];

export function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data: userAuth } = useUserRole();
  const isAdmin = userAuth?.role === 'admin';

  // Filter tabs based on role
  const filteredTabs = TABS; // Reportes ya está adaptado para empleados

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: '#141414',
          borderColor:      colors.border,
          bottom: Platform.OS === 'web' 
            ? 10 // Consistent positioning on web/PWA
            : Math.max(insets.bottom + 8, 18),
        },
      ]}
    >
      {filteredTabs.map((tab) => {
        // Find index in original state routes to ensure correct navigation
        const routeIndex = state.routes.findIndex(r => r.name === tab.name);
        const active = state.index === routeIndex;
        
        if (routeIndex === -1) return null;

        return (
          <Pressable
            key={tab.name}
            style={({ pressed }) => [
              styles.btn,
              active && { backgroundColor: colors.primary },
              pressed && !active && { opacity: 0.7 },
            ]}
            onPress={() => navigation.navigate(tab.name)}
            accessibilityLabel={tab.label}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Feather
              name={tab.icon}
              size={20}
              color={active ? colors.onPrimary : '#484848'}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position:       'absolute',
    alignSelf:      'center',
    width:          '92%',
    maxWidth:       360,
    height:         60,
    borderRadius:   999,
    borderWidth:    0.5,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
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
  btn: {
    width:          44,
    height:         44,
    borderRadius:   22,
    alignItems:     'center',
    justifyContent: 'center',
  },
});
