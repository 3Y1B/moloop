import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';

const SIZE = 156;

/** Big hold-to-talk button with a breathing ring while listening. */
export function PushToTalk({ listening, disabled, onStart, onStop }: {
  listening: boolean;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const theme = useTheme();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (listening) {
      pulse.set(withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false));
    } else {
      cancelAnimation(pulse);
      pulse.set(withTiming(0, { duration: 150 }));
    }
  }, [listening, pulse]);

  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.get() * 0.5 }],
    opacity: listening ? 0.45 * (1 - pulse.get()) : 0,
  }));

  const color = listening ? theme.danger : theme.tint;

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.ring, { backgroundColor: color }, ring]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hold to talk"
        disabled={disabled}
        onPressIn={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onStart();
        }}
        onPressOut={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onStop();
        }}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: color, opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] },
        ]}>
        <Icon sf={listening ? 'waveform' : 'mic.fill'} md="mic" size={56} color="#fff" weight="semibold" />
      </Pressable>
      <Text style={[styles.label, { color: listening ? theme.danger : theme.textSecondary }]}>
        {listening ? 'Listening… let go to finish' : 'Hold to talk'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 18, gap: 18 },
  ring: { position: 'absolute', top: 18, width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '600' },
});
