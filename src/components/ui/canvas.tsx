import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/** Full-bleed backdrop: a flat canvas colour, nothing else. */
export function Canvas() {
  const theme = useTheme();
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]} />;
}
