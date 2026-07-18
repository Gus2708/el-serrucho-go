import { Easing } from 'react-native-reanimated';
import type { WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

/**
 * Motion tokens — Emil Kowalski's animation philosophy, translated to Reanimated.
 *
 * Rules baked in here so components never re-decide them:
 *  - UI animations stay under ~300ms; press feedback is ~130ms.
 *  - Enter/exit uses a strong ease-out (the built-in curves are too weak).
 *  - On-screen movement/morphing uses a strong ease-in-out.
 *  - Springs (physics) drive anything gesture-like or "alive" (indicators, presses).
 *  - Nothing appears from scale(0): entrances start at ~0.95 + opacity.
 *
 * Good defaults matter more than options — reach for these presets, don't hand-roll curves.
 */

/** Raw cubic-bezier control points (also handy for web/CSS parity). */
export const bezier = {
  /** Strong ease-out for entering/exiting UI. Starts fast → feels responsive. */
  out:     [0.23, 1, 0.32, 1] as const,
  /** Strong ease-in-out for elements moving/morphing on screen. */
  inOut:   [0.77, 0, 0.175, 1] as const,
  /** iOS-like drawer/sheet curve (from Ionic). */
  drawer:  [0.32, 0.72, 0, 1] as const,
} as const;

/** Reanimated easing functions built from the curves above. */
export const easing = {
  out:    Easing.bezier(...bezier.out),
  inOut:  Easing.bezier(...bezier.inOut),
  drawer: Easing.bezier(...bezier.drawer),
  linear: Easing.linear,
} as const;

/** Durations (ms). Keep UI motion snappy — perceived speed is a feature. */
export const duration = {
  press:  130, // button press feedback
  fast:   160, // tooltips, tiny popovers
  base:   220, // dropdowns, cards, list items
  slow:   300, // modals, drawers (upper bound for UI)
} as const;

/**
 * Spring presets. Springs keep velocity when interrupted, so gestures and
 * rapid taps stay smooth where duration-based curves would restart from zero.
 */
export const spring = {
  /** Snappy, no overshoot — press feedback and instant reactions. */
  press:     { mass: 0.5, damping: 20, stiffness: 340 } as WithSpringConfig,
  /** Smooth slide with a whisper of settle — moving indicators (tab bar). */
  indicator: { mass: 0.8, damping: 22, stiffness: 210 } as WithSpringConfig,
  /** Gentle, no bounce — general on-screen movement. */
  gentle:    { mass: 0.9, damping: 26, stiffness: 180 } as WithSpringConfig,
  /** Subtle bounce (~0.2) — playful, drag-to-dismiss, celebratory pops. */
  bouncy:    { mass: 0.7, damping: 13, stiffness: 190 } as WithSpringConfig,
} as const;

/** Ready-made timing configs so callers just pass `timing.enter`. */
export const timing = {
  press: { duration: duration.press, easing: easing.out } as WithTimingConfig,
  enter: { duration: duration.base,  easing: easing.out } as WithTimingConfig,
  move:  { duration: duration.base,  easing: easing.inOut } as WithTimingConfig,
  exit:  { duration: duration.fast,  easing: easing.out } as WithTimingConfig,
} as const;

/** How much a pressable shrinks on press. Subtle by design (0.95–0.98). */
export const pressScale = {
  /** Standalone buttons / cards. */
  button: 0.97,
  /** Rows inside long lists — seen constantly, so barely-there. */
  row:    0.985,
  /** Small icon targets (tab bar, toolbar). */
  icon:   0.9,
} as const;

/**
 * Stagger delay (ms) for the Nth item in a group entrance.
 * Kept short (≤ cap) so a long list never feels slow.
 */
export function staggerDelay(index: number, step = 45, cap = 6): number {
  return Math.min(index, cap) * step;
}

export const motion = { bezier, easing, duration, spring, timing, pressScale, staggerDelay } as const;
