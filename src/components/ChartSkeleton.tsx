import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, AccessibilityInfo, Easing } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  /** Altura total del placeholder (debe coincidir con el chart real). */
  height?: number;
}

/**
 * Skeleton del sparkline: silueta de área con un pulso sutil de opacidad
 * mientras los datos cargan. Da sensación de carga rápida sin spinner.
 * Respeta `prefers-reduced-motion`: si está activo, queda estático.
 */
function ChartSkeletonBase({ height = 140 }: Props) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue:         0.85,
          duration:        650,
          easing:          Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue:         0.4,
          duration:        650,
          easing:          Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, pulse]);

  return (
    <View style={[styles.wrap, { height }]} pointerEvents="none">
      {/* Línea base tenue, evoca el eje del chart */}
      <View style={[styles.baseline, { backgroundColor: colors.border }]} />
      {/* Bloque de área con pulso */}
      <Animated.View
        style={[
          styles.area,
          { backgroundColor: colors.primaryFaded, opacity: pulse },
        ]}
      />
    </View>
  );
}

export const ChartSkeleton = React.memo(ChartSkeletonBase);

const styles = StyleSheet.create({
  wrap: {
    justifyContent: 'flex-end',
    overflow:       'hidden',
  },
  area: {
    height:                 '62%',
    borderTopLeftRadius:    10,
    borderTopRightRadius:   10,
  },
  baseline: {
    position: 'absolute',
    left:     0,
    right:    0,
    bottom:   '38%',
    height:   1,
    opacity:  0.6,
  },
});
