import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { useUserRole } from '../hooks/useUserRole';
import { useFacturaBorradores } from '../hooks/useFacturasProveedor';

/** Number of this account's invoice drafts that exist only on this device. Renders nothing when there are none. */
export default function FacturaBorradoresBadge(): React.JSX.Element | null {
  const { colors } = useTheme();
  const { data: userAuth } = useUserRole();
  const { data } = useFacturaBorradores(userAuth?.profile?.id ?? null, true);
  const count = data?.drafts.length ?? 0;
  if (count === 0) return null;

  return (
    <View
      style={[styles.badge, { backgroundColor: colors.primary }]}
      testID="factura-borradores-badge"
      accessibilityLabel={count === 1 ? '1 borrador sin guardar' : `${count} borradores sin guardar`}
    >
      <Text style={[styles.text, { color: colors.onPrimary }]}>{String(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold' },
});
