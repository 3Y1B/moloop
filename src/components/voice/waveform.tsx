import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { VoiceGradient } from '@/constants/theme';
import { mix } from './gradient-words';

const SHAPE = [0.35, 0.6, 0.45, 0.9, 0.55, 1, 0.5, 0.75, 0.4];

/** Little level meter beside the orb. Flat dashes at rest, dancing bars while listening. */
export function Waveform({ active, mirrored }: { active: boolean; mirrored?: boolean }) {
  const shape = mirrored ? [...SHAPE].reverse() : SHAPE;
  return (
    <View style={styles.row}>
      {shape.map((h, i) => (
        <Bar key={i} height={h} index={i} active={active} color={mix(VoiceGradient, i / (shape.length - 1))} />
      ))}
    </View>
  );
}

function Bar({ height, index, active, color }: { height: number; index: number; active: boolean; color: string }) {
  const level = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      cancelAnimation(level);
      level.set(withTiming(0, { duration: 200 }));
      return;
    }
    const d = 340 + ((index * 53) % 220);
    level.set(withDelay(index * 40, withRepeat(withSequence(
      withTiming(1, { duration: d, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.3, { duration: d, easing: Easing.inOut(Easing.quad) }),
    ), -1, true)));
    return () => cancelAnimation(level);
  }, [active, index, level]);
  return <AnimatedBar level={level} height={height} color={color} />;
}

function AnimatedBar({ level, height, color }: { level: SharedValue<number>; height: number; color: string }) {
  const style = useAnimatedStyle(() => ({ height: 4 + level.get() * height * 22 }));
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 28 },
  bar: { width: 2.5, borderRadius: 2 },
});
