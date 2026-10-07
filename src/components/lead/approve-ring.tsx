import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

const STROKE = 3;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Time left as a ring, clockwise from twelve. `counting` drains it to empty at `endsAt` (on the UI thread; with
 * reduced motion it steps with `share`). `closed` fills it: someone decided. `open` is the bare track.
 */
export function ApproveRing({ size = 168, state, share, endsAt, totalMs, color, children }: {
  size?: number;
  state: 'counting' | 'closed' | 'open';
  /** Fraction of the time left, 1 → 0. */
  share: number;
  endsAt: number;
  totalMs: number;
  color: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const r = (size - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const value = useSharedValue(state === 'closed' ? 1 : state === 'open' ? 0 : share);

  useEffect(() => {
    if (state === 'counting') {
      if (reduced) return;
      const ms = Math.max(0, endsAt - Date.now());
      value.set(Math.min(1, ms / totalMs));
      value.set(withTiming(0, { duration: ms, easing: Easing.linear }));
      return;
    }
    const to = state === 'closed' ? 1 : 0;
    value.set(reduced ? to : withTiming(to, { duration: 420 }));
  }, [state, endsAt, totalMs, reduced, value]);

  useEffect(() => {
    if (state === 'counting' && reduced) value.set(share);
  }, [state, reduced, share, value]);

  const props = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - value.get()) }));

  return (
    <View style={[styles.ring, { width: size, height: size }]}>
      <Svg width={size} height={size} style={styles.svg}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.separator} strokeWidth={STROKE} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          animatedProps={props}
        />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center' },
  svg: { position: 'absolute', transform: [{ rotate: '-90deg' }] },
});
