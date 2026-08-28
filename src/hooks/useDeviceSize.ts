import { useWindowDimensions } from 'react-native';
import { useDemoStore } from '../demo/useDemoStore';
import { MOBILE_FRAME_WIDTH } from '../theme/layout';

const DESKTOP_BREAKPOINT = 768;

export function useDeviceSize() {
  const { width, height } = useWindowDimensions();
  const isDemoMode = useDemoStore((s) => s.isDemoMode);

  if (isDemoMode) {
    return {
      width: Math.min(width, MOBILE_FRAME_WIDTH),
      height,
      isDesktop: false,
    };
  }

  return {
    width,
    height,
    isDesktop: width >= DESKTOP_BREAKPOINT,
  };
}
