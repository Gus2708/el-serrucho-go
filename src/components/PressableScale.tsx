import * as React from 'react';
import { useEffect } from 'react';
import { Pressable } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle, GestureResponderEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { spring, timing, pressScale } from '../theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  /** Static container style (press feedback is handled internally, not via `pressed`). */
  style?: StyleProp<ViewStyle>;
  /** Target scale on press. Defaults to the standard button value (0.97). */
  activeScale?: number;
  /**
   * Dim to signal a loading/in-flight/disabled state without losing press
   * feedback. Use this instead of a `condition && { opacity }` entry in `style`
   * (the internal animated opacity would otherwise override it).
   */
  dimmed?: boolean;
}

/**
 * A Pressable that springs to `activeScale` on press and settles back on release —
 * instant, physical feedback so the UI feels like it heard the tap. Under
 * `prefers-reduced-motion` it drops the transform and dims via opacity instead.
 *
 * Emil: buttons must feel responsive; scale (0.95–0.98) beats an opacity flicker
 * because it confirms the press physically. Springs keep velocity if the user
 * taps rapidly, so it never stutters.
 */
export function PressableScale({
  children,
  style,
  activeScale = pressScale.button,
  dimmed = false,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps): React.ReactElement {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(dimmed ? 0.5 : 1);

  useEffect(() => {
    opacity.value = withTiming(dimmed ? 0.5 : 1, timing.press);
  }, [dimmed, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  function handlePressIn(event: GestureResponderEvent): void {
    if (reduced) {
      opacity.value = withTiming((dimmed ? 0.5 : 1) * 0.65, timing.press);
    } else {
      scale.value = withSpring(activeScale, spring.press);
    }
    onPressIn?.(event);
  }

  function handlePressOut(event: GestureResponderEvent): void {
    if (reduced) {
      opacity.value = withTiming(dimmed ? 0.5 : 1, timing.press);
    } else {
      scale.value = withSpring(1, spring.press);
    }
    onPressOut?.(event);
  }

  return (
    <AnimatedPressable
      style={[style, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
