import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  label:      string;
  value:      string;
  sub?:       string;     // small secondary line
  accent?:    boolean;    // gold border highlight
  danger?:    boolean;    // red tint for negative values
  halfWidth?: boolean;
}

export function StatCard({ label, value, sub, accent, danger, halfWidth }: Props) {
  const { colors } = useTheme();

  const borderColor = accent
    ? colors.primary
    : danger
    ? colors.danger
    : colors.border;

  const valueColor = danger ? colors.danger : accent ? colors.primary : colors.text;

  return (
    <View
      style={[
        styles.card,
        halfWidth && styles.half,
        { backgroundColor: colors.surface, borderColor },
        accent && { backgroundColor: colors.primaryFaded },
      ]}
    >
      <Text style={[styles.label, { color: colors.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? (
        <Text style={[styles.sub, { color: colors.textMuted }]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius:  14,
    borderWidth:   0.5,
    padding:       16,
    gap:           4,
  },
  half: {
    flex: 1,
  },
  label: {
    fontSize:   11,
    fontFamily: 'JetBrainsMono_500Medium',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  value: {
    fontSize:   22,
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 11,
    marginTop: 1,
    fontFamily: 'JetBrainsMono_400Regular',
  },
});
