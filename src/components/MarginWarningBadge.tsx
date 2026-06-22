import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

interface MarginWarningBadgeProps {
  costoMinimo: number;      // ex-IVA cost in USD
  formatUSD: (n: number) => string;  // from useTheme()
}

export function MarginWarningBadge({ costoMinimo, formatUSD }: MarginWarningBadgeProps): React.JSX.Element {
  return (
    <View style={styles.badge}>
      <Feather name="alert-triangle" size={11} color="#FF9800" />
      <Text style={styles.text}>
        Bajo costo mín. {formatUSD(costoMinimo)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,152,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,152,0,0.30)',
    marginTop: 4,
  },
  text: {
    fontSize: 10,
    fontFamily: 'JetBrainsMono_500Medium',
    color: '#FF9800',
  },
});
