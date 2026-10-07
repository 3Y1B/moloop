import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFinder } from '@/components/finder/use-finder';
import { Icon } from '@/components/ui/icon';
import type { Step, Trend } from '@/lib/finder';

/*
 * Apple's Precision Finding "Nearby" screen, driven by Bluetooth: a cloud of dots that draws in as the other phone
 * gets closer, the step in big type, warmer/colder under it, and the whole screen green once you're there.
 * Bluetooth gives closeness, not direction, so there's no arrow.
 */

const GREEN = '#30C759';
const NIGHT = '#0B0B0D';

const LABEL: Record<Step, string> = {
  searching: 'Searching…',
  nearby: 'Nearby',
  closer: 'Getting closer',
  very_close: 'Very close',
  here: 'Here',
};

const HINT: Record<Step, string> = {
  searching: 'Keep Moloop open on both phones',
  nearby: 'Walk around and watch the dots',
  closer: 'Keep going',
  very_close: 'Look around you',
  here: 'You’ve found each other',
};

const TREND: Record<NonNullable<Trend>, string | null> = { warmer: 'Warmer', colder: 'Colder', steady: null };

/** How far out the dots sit, as a share of the cloud's full radius. */
const SPREAD: Record<Step, number> = { searching: 1, nearby: 0.85, closer: 0.6, very_close: 0.35, here: 0 };

/** Fixed, scattered dot positions: golden-angle spiral, so the cloud looks random but never clumps. */
const DOTS = Array.from({ length: 42 }, (_, i) => {
  const angle = i * 2.39996;
  const r = 0.3 + 0.7 * Math.sqrt((i + 0.5) / 42);
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, phase: (i * 0.137) % 1, size: 5 + (i % 3) * 2 };
});

const CLOUD = 150;

export default function FindScreen() {
  useKeepAwake();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const insets = useSafeAreaInsets();
  const { reading, error } = useFinder(id);
  const { step } = reading;

  const spread = useSharedValue(SPREAD.searching);
  const found = useSharedValue(0);
  const clock = useSharedValue(0);

  useEffect(() => {
    clock.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.linear }), -1, false);
  }, [clock]);

  // Each step change: the cloud springs to its new size, and a tap you can feel, stronger the closer you are.
  const last = useRef<Step>('searching');
  useEffect(() => {
    spread.value = withSpring(SPREAD[step], { damping: 14, stiffness: 90 });
    found.value = withTiming(step === 'here' ? 1 : 0, { duration: 450 });
    if (step === last.current) return;
    const closer = SPREAD[step] < SPREAD[last.current];
    last.current = step;
    if (step === 'here') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (step !== 'searching' && closer) {
      Haptics.impactAsync(step === 'very_close' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [step, spread, found]);

  const background = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(found.value, [0, 1], [NIGHT, GREEN]) }));
  const disc = useAnimatedStyle(() => ({
    opacity: found.value,
    transform: [{ scale: interpolate(found.value, [0, 1], [0.3, 1]) }],
  }));

  const trend = reading.trend ? TREND[reading.trend] : null;

  return (
    <Animated.View style={[styles.screen, background, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar style="light" />

      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={styles.finding}>Finding</Text>
          <Text style={styles.name} numberOfLines={1}>{name ?? 'Your match'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Done" hitSlop={10} onPress={() => router.back()} style={styles.close}>
          <Icon sf="xmark" md="close" size={15} color="#FFFFFF" weight="bold" />
        </Pressable>
      </View>

      <View style={styles.stage} accessibilityLabel={LABEL[step]}>
        {DOTS.map((d, i) => (
          <Dot key={i} dot={d} spread={spread} clock={clock} found={found} searching={step === 'searching'} />
        ))}
        <Animated.View style={[styles.disc, disc]} />
      </View>

      <View style={styles.bottom}>
        <Animated.Text key={step} entering={FadeIn.duration(250)} style={styles.step}>{LABEL[step]}</Animated.Text>
        <Text style={styles.hint}>{error ?? trend ?? HINT[step]}</Text>
      </View>
    </Animated.View>
  );
}

function Dot({ dot, spread, clock, found, searching }: {
  dot: (typeof DOTS)[number];
  spread: SharedValue<number>;
  clock: SharedValue<number>;
  found: SharedValue<number>;
  searching: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const shimmer = 0.5 + 0.5 * Math.sin(2 * Math.PI * (clock.value + dot.phase));
    // Searching drifts slowly round; once heard, the dots hold their places and only breathe.
    const turn = searching ? clock.value * 0.4 : 0;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const x = (dot.x * cos - dot.y * sin) * CLOUD * spread.value;
    const y = (dot.x * sin + dot.y * cos) * CLOUD * spread.value;
    return {
      opacity: (searching ? 0.15 + 0.35 * shimmer : 0.35 + 0.65 * shimmer) * (1 - found.value),
      transform: [{ translateX: x }, { translateY: y }],
    };
  });
  return <Animated.View style={[styles.dot, { width: dot.size, height: dot.size, borderRadius: dot.size / 2 }, style]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  finding: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '600' },
  name: { color: '#FFFFFF', fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  close: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', backgroundColor: '#FFFFFF' },
  disc: { position: 'absolute', width: 132, height: 132, borderRadius: 66, backgroundColor: '#FFFFFF' },
  bottom: { gap: 6 },
  step: { color: '#FFFFFF', fontSize: 40, fontWeight: '700', letterSpacing: -0.8 },
  hint: { color: 'rgba(255,255,255,0.7)', fontSize: 19, fontWeight: '500' },
});
