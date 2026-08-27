import { useWindowDimensions } from 'react-native';
import { useDemoStore } from '../demo/useDemoStore';

const DESKTOP_BREAKPOINT = 768;
const MOBILE_MAX_WIDTH = 480;

export function useDeviceSize() {
  const { width, height } = useWindowDimensions();
  const isDemoMode = useDemoStore((s) => s.isDemoMode);

  if (isDemoMode) {
    return {
      width: Math.min(width, MOBILE_MAX_WIDTH),
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
