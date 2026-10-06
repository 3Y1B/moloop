import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming,
  ZoomIn, type SharedValue,
} from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';

const DISC = 64;
const RIPPLES = 3;
const PERIOD = 4200;

/**
 * The empty state's mark: a flat accent disc with a tick, sending slow ripples outward while
 * on duty ("listening for the next task"). On break it goes still and grey with a cup.
 */
export function AllClear({ onBreak = false }: { onBreak?: boolean }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  const live = !onBreak && !reduceMotion;

  useEffect(() => {
    if (!live) return;
    t.set(0);
    t.set(withRepeat(withTiming(1, { duration: PERIOD, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(t);
  }, [live, t]);

  const fill = onBreak ? theme.textTertiary : theme.tint;

  return (
    <View style={styles.stage}>
      {live && Array.from({ length: RIPPLES }, (_, i) => <Ripple key={i} t={t} offset={i / RIPPLES} color={fill} />)}
      <Animated.View
        key={onBreak ? 'break' : 'free'}
        entering={ZoomIn.springify().damping(14)}
        style={[styles.disc, { backgroundColor: fill }]}>
        <Icon
          sf={onBreak ? 'cup.and.saucer.fill' : 'checkmark'}
          md={onBreak ? 'coffee' : 'check'}
          size={onBreak ? 24 : 26}
          color="#FFFFFF"
          weight="semibold"
        />
      </Animated.View>
    </View>
  );
}

function Ripple({ t, offset, color }: { t: SharedValue<number>; offset: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const p = (t.get() + offset) % 1;
    return { opacity: 0.3 * (1 - p), transform: [{ scale: 1 + p * 1.1 }] };
  });
  return <Animated.View style={[styles.ripple, { borderColor: color }, style]} />;
}

const styles = StyleSheet.create({
  stage: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  ripple: { position: 'absolute', width: DISC, height: DISC, borderRadius: DISC / 2, borderWidth: 1 },
  disc: { width: DISC, height: DISC, borderRadius: DISC / 2, alignItems: 'center', justifyContent: 'center' },
});
