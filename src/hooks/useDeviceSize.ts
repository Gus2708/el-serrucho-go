import { useWindowDimensions } from 'react-native';

const DESKTOP_BREAKPOINT = 768;

export function useDeviceSize() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isDesktop: width >= DESKTOP_BREAKPOINT,
  };
}
