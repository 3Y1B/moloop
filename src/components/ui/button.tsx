import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Icon } from './icon';

type Props = {
  label: string;
  sf?: string;
  onPress: () => void;
  /** filled: solid colour. tinted: soft colour wash. plain: text only. */
  variant?: 'filled' | 'tinted' | 'plain';
  size?: 'large' | 'medium' | 'small';
  color?: string;
  haptic?: 'success' | 'warning' | 'light' | 'none';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT = { large: 48, medium: 42, small: 36 };
const FONT = { large: Type.body + 1, medium: Type.body, small: Type.callout };

export function Button({
  label, sf, onPress, variant = 'filled', size = 'medium', color, haptic = 'light', disabled, style,
}: Props) {
  const theme = useTheme();
  const c = color ?? theme.tint;
  const fg = variant === 'filled' ? theme.onTint : c;
  const bg = variant === 'filled' ? c : variant === 'tinted' ? `${c}14` : 'transparent';

  const press = () => {
    if (haptic === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (haptic === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else if (haptic === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={press}
      style={({ pressed }) => [
        styles.base,
        { height: HEIGHT[size], backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        pressed && styles.pressed,
        style,
      ]}>
      <View style={styles.row}>
        {sf && <Icon sf={sf} size={FONT[size]} color={fg} weight="medium" />}
        <Text style={[styles.label, { color: fg, fontSize: FONT[size] }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.control,
    borderCurve: 'continuous',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.99 }] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontWeight: '600' },
});
