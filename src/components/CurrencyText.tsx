import React from 'react';
import { Text, TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  amount:    number | null | undefined;
  style?:    TextStyle;
  muted?:    boolean;      // use textMuted color instead of text
  primary?:  boolean;      // use primary (gold) color
}

/**
 * Renders a USD amount: "$1,234.56"
 * NEVER renders Bs or any other currency.
 */
export function CurrencyText({ amount, style, muted, primary }: Props) {
  const { colors, formatUSD } = useTheme();

  const color = primary
    ? colors.primary
    : muted
    ? colors.textMuted
    : colors.text;

  return (
    <Text style={[{ color }, style]}>
      {formatUSD(amount)}
    </Text>
  );
}
