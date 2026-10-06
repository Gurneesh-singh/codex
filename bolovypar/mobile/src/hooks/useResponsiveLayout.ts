import { useWindowDimensions } from 'react-native';

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();

  return {
    isCompact: width < 375,
    isMedium: width >= 600,
    isWide: width >= 840 && height >= 600,
    isShort: height < 500
  };
}
