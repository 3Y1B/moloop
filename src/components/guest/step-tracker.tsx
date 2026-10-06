import { Fragment, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { Type } from '@/constants/theme';
import type { GuestRequestStage } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

const STEPS = ['Heard', 'Understanding', 'Sorted'] as const;

/** The last step says what's happening now, so it never reads "Sorted" while someone is still walking over. */
const LAST: Partial<Record<GuestRequestStage, string>> = {
  finding: 'Finding someone',
  coming: 'On the way',
  with_you: 'With you',
};
const NODE = 22;

/**
 * Where the request is in the pipeline: route (Heard) → triage (Understanding) → assign until done (Sorted).
 * `done` steps are filled, the `active` one pulses. `reached` is how far a cancelled request got.
 */
function progress(stage: GuestRequestStage, reached: number): { done: number; active: number | null } {
  switch (stage) {
    case 'understanding':
      return { done: 1, active: 1 };
    case 'finding':
    case 'coming':
    case 'with_you':
      return { done: 2, active: 2 };
    case 'answered':
    case 'sorted':
      return { done: 3, active: null };
    case 'cancelled':
      return { done: reached, active: null };
  }
}

export function StepTracker({ stage, reached = 1 }: { stage: GuestRequestStage; reached?: number }) {
  const theme = useTheme();
  const { done, active } = progress(stage, reached);
  const color = stage === 'cancelled' ? theme.textTertiary : done === STEPS.length ? theme.success : theme.tint;

  return (
    <View accessibilityRole="progressbar" accessibilityLabel={`Step ${Math.min(done + 1, STEPS.length)} of ${STEPS.length}`} style={styles.wrap}>
      <View style={styles.track}>
        {STEPS.map((s, i) => (
          <Fragment key={s}>
            {i > 0 && <View style={[styles.line, { backgroundColor: i < done || i === active ? color : theme.border }]} />}
            <Node state={i === active ? 'active' : i < done ? 'done' : 'pending'} color={color} />
          </Fragment>
        ))}
      </View>
      <View style={styles.track}>
        {STEPS.map((s, i) => (
          <Fragment key={s}>
            {i > 0 && <View style={styles.flex} />}
            <View style={styles.labelBox}>
              <Text
                style={[styles.label, { color: i === active ? color : i < done ? theme.text : theme.textTertiary }]}>
                {i === STEPS.length - 1 ? LAST[stage] ?? s : s}
              </Text>
            </View>
          </Fragment>
        ))}
      </View>
    </View>
  );
}

function Node({ state, color }: { state: 'done' | 'active' | 'pending'; color: string }) {
  const theme = useTheme();
  const pulse = useSharedValue(0);
  const on = state === 'active';

  useEffect(() => {
    if (on) pulse.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
    else cancelAnimation(pulse);
    return () => cancelAnimation(pulse);
  }, [on, pulse]);

  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.get() * 0.7 }], opacity: on ? 0.35 * (1 - pulse.get()) : 0 }));

  if (state === 'done') {
    return (
      <View style={[styles.node, { backgroundColor: color }]}>
        <Icon sf="checkmark" md="check" size={11} color={theme.onTint} weight="bold" />
      </View>
    );
  }
  return (
    <View style={styles.nodeBox}>
      <Animated.View style={[styles.node, styles.halo, { backgroundColor: color }, ring]} />
      <View style={[styles.node, styles.ringed, { borderColor: on ? color : theme.border, backgroundColor: theme.card }]}>
        {on && <View style={[styles.core, { backgroundColor: color }]} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Side padding leaves room for the first and last labels, which are wider than their node.
  wrap: { gap: 8, paddingHorizontal: 40 },
  track: { flexDirection: 'row', alignItems: 'center' },
  line: { flex: 1, height: 2, marginHorizontal: 4, borderRadius: 1 },
  nodeBox: { width: NODE, height: NODE },
  node: { width: NODE, height: NODE, borderRadius: NODE / 2, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute' },
  ringed: { borderWidth: 2 },
  core: { width: 8, height: 8, borderRadius: 4 },
  labelBox: { width: NODE, height: 18, overflow: 'visible' },
  // Absolutely centred under the node, so a label wider than its node isn't squeezed (web caps truncating text at the parent's width).
  label: { position: 'absolute', width: 120, left: (NODE - 120) / 2, textAlign: 'center', fontSize: Type.footnote, fontWeight: '600' },
});
