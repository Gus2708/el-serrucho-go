import { Dimensions } from 'react-native';

/**
 * Responsive font scaling.
 *
 * Every `fontSize` / `lineHeight` in the app is a fixed pixel value tuned for a
 * ~390pt-wide phone (iPhone 13/14, Pixel). On narrower devices those fixed
 * sizes overflowed and broke their containers ("los textos quedan grandes en
 * pantallas pequeñas"). `scaleFont` shrinks text proportionally to the device
 * width so it always fits, while never *growing* it on tablets, desktop, or web
 * — those layouts are handled separately via `useWindowDimensions`.
 *
 * The factor is computed once at module load from the screen's shortest side,
 * so it is orientation-independent and has zero per-render cost.
 */
const BASE_WIDTH = 390;
const MIN_SCALE = 0.84; // floor: keep text legible on the smallest phones (~320pt)
const MAX_SCALE = 1; // ceiling: never upscale beyond the reference design

const { width, height } = Dimensions.get('window');
const shortestSide = Math.min(width, height);
const rawScale = shortestSide / BASE_WIDTH;

/** The clamped width-based multiplier applied to every text size. */
export const fontScale = Math.min(Math.max(rawScale, MIN_SCALE), MAX_SCALE);

/** Scale a pixel font size (or line height) to the current device width. */
export function scaleFont(size: number): number {
  return Math.round(size * fontScale);
}
