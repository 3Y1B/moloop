import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A thin bar filled to `fraction` (0–1, clamped). Tint fill on a grey track by default. `animated` eases the fill to
 * each new value instead of jumping.
 */
export function ProgressTrack({ fraction, color, trackColor, height = 4, animated }: {
  fraction: number;
  color?: string;
  trackColor?: string;
  height?: number;
  animated?: boolean;
}) {
  const theme = useTheme();
  const f = Math.min(1, Math.max(0, fraction));
  const fill = { height, backgroundColor: color ?? theme.tint };
  return (
    <View style={[styles.track, { height, backgroundColor: trackColor ?? theme.backgroundElement }]}>
      {animated ? <AnimatedFill fraction={f} style={fill} /> : <View style={[styles.fill, fill, { width: `${f * 100}%` }]} />}
    </View>
  );
}

function AnimatedFill({ fraction, style }: { fraction: number; style: { height: number; backgroundColor: string } }) {
  const width = useAnimatedStyle(() => ({ width: withTiming(`${fraction * 100}%`, { duration: 600 }) }));
  return <Animated.View style={[styles.fill, style, width]} />;
}

const styles = StyleSheet.create({
  track: { borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { borderRadius: Radius.pill },
});
