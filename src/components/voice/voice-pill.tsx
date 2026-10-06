import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { Colors, Radius, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Orb } from './orb';
import { Waveform } from './waveform';

export const PILL_HEIGHT = 52;
const BUBBLE = 40;

/**
 * Hold anywhere on the pill to talk. At rest it reads like a text field; while held the
 * level meter fills it and the mic bubble swirls. Big target on purpose: one thumb, walking.
 */
export function VoicePill({ listening, placeholder, disabled, onHoldStart, onHoldEnd, style }: {
  listening: boolean;
  placeholder: string;
  disabled?: boolean;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${placeholder}. Hold to talk`}
      disabled={disabled}
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onHoldStart();
      }}
      onPressOut={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onHoldEnd();
      }}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: listening ? `${theme.tint}0F` : theme.backgroundElement,
          borderColor: listening ? `${theme.tint}33` : 'transparent',
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}>
      <View style={styles.middle}>
        {listening ? (
          <Animated.View key="wave" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.fill}>
            <Waveform active bars={22} height={22} />
          </Animated.View>
        ) : (
          <Animated.Text
            key="hint"
            entering={FadeIn.duration(160)}
            numberOfLines={1}
            style={[styles.placeholder, { color: theme.textSecondary }]}>
            {placeholder}
          </Animated.Text>
        )}
      </View>
      <MicBubble listening={listening} />
    </Pressable>
  );
}

/** The assistant, shrunk to a calm bubble with a mic on it. */
export function MicBubble({ listening, size = BUBBLE }: { listening: boolean; size?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <Orb size={size} ring={false} state={listening ? 'listening' : 'idle'} />
      <View style={styles.glyph} pointerEvents="none">
        <Icon sf={listening ? 'waveform' : 'mic.fill'} md="mic" size={size * 0.42} color={Colors.light.text} weight="medium" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flex: 1,
    height: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 18,
    paddingRight: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  middle: { flex: 1, height: '100%', justifyContent: 'center' },
  fill: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  placeholder: { fontSize: Type.body, fontWeight: '500' },
  glyph: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
