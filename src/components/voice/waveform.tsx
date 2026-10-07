import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { VoiceGradient } from '@/constants/theme';
import { mix } from './gradient-words';

/** A hand-drawn speech envelope: quiet edges, a few peaks. Repeated to fill however many bars fit. */
const SHAPE = [0.3, 0.5, 0.4, 0.8, 0.55, 1, 0.45, 0.7, 0.35, 0.9, 0.5, 0.65];

/**
 * Level meter that fills the voice pill: dots at rest, dancing gradient bars while listening.
 * `level` (0–1) is the microphone: bars stay low in silence and jump when you speak. Without it they just dance.
 */
export function Waveform({ active, level, bars = 24, height = 24 }: { active: boolean; level?: number; bars?: number; height?: number }) {
  const amp = useSharedValue(1);
  useEffect(() => {
    amp.set(withTiming(level == null ? 1 : 0.15 + 0.85 * level, { duration: 90 }));
  }, [amp, level]);
  return (
    <View style={[styles.row, { height }]}>
      {Array.from({ length: bars }, (_, i) => (
        <Bar
          key={i}
          index={i}
          peak={SHAPE[i % SHAPE.length]}
          max={height}
          active={active}
          amp={amp}
          color={mix(VoiceGradient, bars > 1 ? i / (bars - 1) : 0)}
        />
      ))}
    </View>
  );
}

function Bar({ index, peak, max, active, amp, color }: {
  index: number; peak: number; max: number; active: boolean; amp: SharedValue<number>; color: string;
}) {
  const level = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      cancelAnimation(level);
      level.set(withTiming(0, { duration: 220 }));
      return;
    }
    const d = 320 + ((index * 53) % 240);
    level.set(withDelay((index % 7) * 45, withRepeat(withSequence(
      withTiming(1, { duration: d, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.25, { duration: d, easing: Easing.inOut(Easing.quad) }),
    ), -1, true)));
    return () => cancelAnimation(level);
  }, [active, index, level]);
  return <AnimatedBar level={level} amp={amp} peak={peak} max={max} color={color} />;
}

function AnimatedBar({ level, amp, peak, max, color }: {
  level: SharedValue<number>; amp: SharedValue<number>; peak: number; max: number; color: string;
}) {
  const style = useAnimatedStyle(() => ({
    height: 3 + level.get() * amp.get() * peak * (max - 3),
    opacity: 0.35 + level.get() * 0.65,
  }));
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bar: { width: 3, borderRadius: 2 },
});
