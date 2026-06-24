import { scaleFont } from '../theme/responsive';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export interface MarginWarningBadgeProps {
  costoMinimo: number;
  formatUSD:   (n: number) => string;
}

const NATIVE_DRIVER = Platform.OS !== 'web';

export function MarginWarningBadge({ costoMinimo, formatUSD }: MarginWarningBadgeProps) {
  const { colors } = useTheme();
  const scale   = useRef(new Animated.Value(0.88)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(scale, {
          toValue:         1,
          duration:        160,
          easing:          Easing.out(Easing.cubic),
          useNativeDriver: NATIVE_DRIVER,
        }),
        Animated.timing(opacity, {
          toValue:         1,
          duration:        140,
          easing:          Easing.out(Easing.quad),
          useNativeDriver: NATIVE_DRIVER,
        }),
      ]),
      Animated.timing(scale, {
        toValue:         1.06,
        duration:        110,
        easing:          Easing.out(Easing.quad),
        useNativeDriver: NATIVE_DRIVER,
      }),
      Animated.timing(scale, {
        toValue:         1,
        duration:        110,
        easing:          Easing.in(Easing.quad),
        useNativeDriver: NATIVE_DRIVER,
      }),
      Animated.timing(scale, {
        toValue:         1.04,
        duration:        90,
        easing:          Easing.out(Easing.quad),
        useNativeDriver: NATIVE_DRIVER,
      }),
      Animated.timing(scale, {
        toValue:         1,
        duration:        90,
        easing:          Easing.in(Easing.quad),
        useNativeDriver: NATIVE_DRIVER,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.badge,
        {
          backgroundColor: colors.warning + '1A',
          borderColor:     colors.warning + '45',
          transform:       [{ scale }],
          opacity,
        },
      ]}
    >
      <Feather name="alert-triangle" size={10} color={colors.warning} />
      <Text style={[styles.label, { color: colors.warning }]}>
        Bajo costo · mín {formatUSD(costoMinimo)}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection:     'row',
    alignItems:        'center',
    alignSelf:         'flex-start',
    gap:               4,
    paddingVertical:   4,
    paddingHorizontal: 8,
    borderRadius:      6,
    borderWidth:       0.5,
  },
  label: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_700Bold',
    lineHeight: scaleFont(14),
  },
});
