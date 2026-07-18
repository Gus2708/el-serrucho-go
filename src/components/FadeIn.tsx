import * as React from 'react';
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { timing } from '../theme/motion';

interface FadeInProps {
  children: React.ReactNode;
  /** Stagger offset (ms). Use `staggerDelay(index)` for lists. */
  delay?: number;
  /** Initial vertical offset in px — the element rises into place. */
  translateY?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Mount entrance: fade + a short rise into place. Nothing appears from nothing —
 * it starts slightly offset and eases out to rest. Reduced motion keeps the fade
 * but drops the movement.
 */
export function FadeIn({ children, delay = 0, translateY = 8, style }: FadeInProps): React.ReactElement {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, timing.enter));
  }, [delay, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduced ? [] : [{ translateY: (1 - progress.value) * translateY }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
