import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '../theme/ThemeContext';
import { useUserRole } from '../hooks/useUserRole';
import { useAtencionesCount } from '../hooks/useAtenciones';

const logo = require('../assets/img/EL SERRUCHO go.png');

const TABS: { name: string; route: string; icon: keyof typeof Feather.glyphMap; label: string }[] = [
  { name: 'index',      route: '/',            icon: 'home',         label: 'Inicio'     },
  { name: 'ventas',     route: '/ventas',      icon: 'shopping-bag', label: 'Ventas'     },
  { name: 'inventario', route: '/inventario',  icon: 'package',      label: 'Inventario' },
  { name: 'notificaciones', route: '/notificaciones', icon: 'bell',   label: 'Notificaciones' },
  { name: 'reportes',   route: '/reportes',    icon: 'bar-chart',    label: 'Reportes'   },
  { name: 'ordenes',    route: '/ordenes',     icon: 'file-text',    label: 'Órdenes'    },
];

function isTabActive(tabName: string, pathname: string): boolean {
  if (tabName === 'index') return pathname === '/' || pathname === '/index';
  return pathname === `/${tabName}` || pathname.startsWith(`/${tabName}/`);
}

export function Sidebar() {
  const { colors } = useTheme();
  const router    = useRouter();
  const pathname  = usePathname();
  const { data: userAuth } = useUserRole();
  const { data: pendingCount = 0 } = useAtencionesCount();
  const isAdmin = userAuth?.role === 'admin';

  const visibleTabs = TABS; // Reportes ya está adaptado para empleados

  return (
    <View style={[styles.sidebar, { backgroundColor: colors.surface, borderRightColor: colors.border }]}>
      {/* Logo */}
      <View style={styles.logoWrap}>
        <Image source={logo} style={styles.logo} contentFit="contain" />
        <View style={styles.logoTexts}>
          <Text style={[styles.logoName, { color: colors.primary }]}>El Serrucho</Text>
          <Text style={[styles.logoSub,  { color: colors.textMuted }]}>to GO</Text>
        </View>
      </View>

      {/* Nav */}
      <View style={styles.nav}>
        {visibleTabs.map(tab => {
          const active = isTabActive(tab.name, pathname);
          return (
            <Pressable
              key={tab.name}
              style={({ pressed }) => [
                styles.item,
                active  && { backgroundColor: colors.primaryFaded, borderColor: colors.primary + '30' },
                pressed && !active && { backgroundColor: colors.surfaceAlt },
              ]}
              onPress={() => router.navigate(tab.route as any)}
              accessibilityLabel={tab.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Feather
                name={tab.icon}
                size={18}
                color={active ? colors.primary : (tab.name === 'notificaciones' && pendingCount > 0 ? '#25D366' : colors.textMuted)}
              />
              <Text style={[styles.label, { color: active ? colors.primary : colors.textMuted }]}>
                {tab.label}
              </Text>
              {tab.name === 'notificaciones' && pendingCount > 0 && (
                <View style={[styles.sidebarBadge, { backgroundColor: colors.danger }]}>
                  <Text style={styles.sidebarBadgeText}>{pendingCount}</Text>
                </View>
              )}
              {active && <View style={[styles.activeDot, { backgroundColor: colors.primary }]} />}
            </Pressable>
          );
        })}
      </View>

      {/* Bottom */}
      <View style={[styles.bottom, { borderTopColor: colors.border }]}>
        <Pressable
          style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceAlt }]}
          onPress={() => router.navigate('/perfil')}
          accessibilityLabel="Perfil"
        >
          <Feather name="user" size={18} color={colors.textMuted} />
          <Text style={[styles.label, { color: colors.textMuted }]}>Perfil</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width:            200,
    borderRightWidth: 0.5,
    paddingTop:       24,
    paddingBottom:    8,
    flexDirection:    'column',
  },
  logoWrap: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             10,
    paddingHorizontal: 16,
    paddingBottom:   20,
  },
  logo:      { width: 40, height: 40, borderRadius: 10 },
  logoTexts: { gap: 1 },
  logoName:  { fontSize: 13, fontFamily: 'JetBrainsMono_700Bold', letterSpacing: -0.3 },
  logoSub:   { fontSize: 10, fontFamily: 'JetBrainsMono_400Regular' },

  nav: { flex: 1, gap: 2, paddingHorizontal: 8 },

  item: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              10,
    paddingVertical:  9,
    paddingHorizontal: 12,
    borderRadius:     10,
    borderWidth:      0.5,
    borderColor:      'transparent',
  },
  label: {
    flex:       1,
    fontSize:   13,
    fontFamily: 'JetBrainsMono_500Medium',
  },
  sidebarBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    marginRight: 6,
  },
  sidebarBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: 'JetBrainsMono_700Bold',
    lineHeight: 10,
  },
  activeDot: {
    width:        5,
    height:       5,
    borderRadius: 3,
  },

  bottom: {
    paddingHorizontal: 8,
    paddingTop:        10,
    paddingBottom:     16,
    borderTopWidth:    0.5,
    gap:               2,
  },
});
