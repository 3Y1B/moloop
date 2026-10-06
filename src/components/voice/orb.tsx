import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';

import { VoiceGradient } from '@/constants/theme';

export type OrbState = 'idle' | 'listening';

/** Motion per state: degrees/second of swirl, breath period (ms) and breath depth. */
const MOTION = {
  idle: { spin: 24, breathMs: 6000, depth: 0.012 },
  listening: { spin: 55, breathMs: 2400, depth: 0.03 },
} as const;
const TWO_PI = Math.PI * 2;

/**
 * The assistant's "face": a slowly swirling sky-blue sphere. It runs on one continuous clock,
 * so the loop never restarts and state changes only ease the speed, never jump.
 */
export function Orb({ size, state = 'idle', ring = true }: { size: number; state?: OrbState; ring?: boolean }) {
  const angle = useSharedValue(0);
  const phase = useSharedValue(0);
  const spin = useSharedValue<number>(MOTION[state].spin);
  const breathMs = useSharedValue<number>(MOTION[state].breathMs);
  const depth = useSharedValue<number>(MOTION[state].depth);

  useEffect(() => {
    const ease = { duration: 900, easing: Easing.inOut(Easing.quad) };
    spin.set(withTiming(MOTION[state].spin, ease));
    breathMs.set(withTiming(MOTION[state].breathMs, ease));
    depth.set(withTiming(MOTION[state].depth, ease));
  }, [state, spin, breathMs, depth]);

  useFrameCallback(({ timeSincePreviousFrame }) => {
    const dt = Math.min(timeSincePreviousFrame ?? 16, 64); // don't lurch after a dropped frame or backgrounding
    angle.set((angle.get() + (spin.get() * dt) / 1000) % 360);
    phase.set((phase.get() + (TWO_PI * dt) / breathMs.get()) % TWO_PI);
  });

  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 + Math.sin(phase.get()) * depth.get() }] }));
  // Whole-number ratios keep both layers lined up at every wrap, so there's no visible seam.
  const swirl = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}deg` }] }));
  const counter = useAnimatedStyle(() => ({ transform: [{ rotate: `${-angle.get() * 2}deg` }] }));

  const r = size / 2;
  const [sky, azure, cobalt] = VoiceGradient;
  const blob = (c: string, s: number) => ({
    position: 'absolute' as const,
    width: size * s,
    height: size * s,
    experimental_backgroundImage: `radial-gradient(circle at 50% 50%, ${c} 0%, ${c}00 68%)`,
  });

  return (
    <Animated.View style={[{ width: size, height: size }, body]}>
      {ring && <View style={[styles.ring, { inset: -size * 0.09, borderRadius: r * 1.2 }]} />}
      <View style={[styles.sphere, { borderRadius: r, backgroundColor: '#E4F0FF' }]}>
        <Animated.View style={[StyleSheet.absoluteFill, swirl]}>
          <View style={[blob(sky, 1.05), { left: -size * 0.35, top: -size * 0.2 }]} />
          <View style={[blob(cobalt, 1.1), { right: -size * 0.4, bottom: -size * 0.3 }]} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, counter]}>
          <View style={[blob(azure, 0.9), { left: size * 0.2, top: size * 0.35 }]} />
          <View style={[blob('#FFFFFF', 0.7), { left: -size * 0.05, top: size * 0.45 }]} />
        </Animated.View>
        {/* Specular highlight and a soft rim so it reads as a sphere, not a disc. */}
        <View
          style={[StyleSheet.absoluteFill, {
            experimental_backgroundImage:
              'radial-gradient(circle at 32% 26%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 34%)',
          }]}
        />
        <View style={[StyleSheet.absoluteFill, { borderRadius: r, borderWidth: Math.max(1.5, size * 0.03), borderColor: 'rgba(255,255,255,0.75)' }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sphere: { flex: 1, overflow: 'hidden', boxShadow: '0 8px 22px rgba(47, 123, 245, 0.18)' },
  ring: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.55)', boxShadow: '0 4px 16px rgba(47, 123, 245, 0.08)' },
});
