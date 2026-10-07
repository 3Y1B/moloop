import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Icon } from './icon';
import { haptic as feel, PRESSED_OPACITY, type HapticKind } from './pressable';

type Props = {
  label: string;
  sf?: string;
  /** Material Symbol for `sf` on Android/web. */
  md?: string;
  /** Icon after the label, e.g. `chevron.right`. */
  trailingSf?: string;
  trailingMd?: string;
  onPress: () => void;
  /**
   * filled: solid colour. tinted: soft colour wash. plain: text only. secondary: grey fill, text colour.
   * outline: hairline border in the colour, no fill. Defaults to filled, or plain when `size` is inline.
   */
  variant?: 'filled' | 'tinted' | 'plain' | 'secondary' | 'outline';
  /** inline: a text link, no height or padding. */
  size?: 'large' | 'medium' | 'small' | 'inline';
  /** Which colour: tint (default), danger, or neutral (text; secondary text when plain). */
  tone?: 'tint' | 'danger' | 'neutral';
  /** Any colour; wins over `tone`. */
  color?: string;
  haptic?: Extract<HapticKind, 'success' | 'warning' | 'light' | 'none'>;
  disabled?: boolean;
  /** Spinner in place of the icon; not pressable meanwhile. */
  loading?: boolean;
  /** What a screen reader says, when the label alone isn't enough. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT = { large: 48, medium: 42, small: 36, inline: undefined };
const FONT = { large: Type.body + 1, medium: Type.body, small: Type.callout, inline: Type.callout };

export function Button({
  label, sf, md, trailingSf, trailingMd, onPress, variant: chosen, size = 'medium', tone, color, haptic = 'light',
  disabled, loading, accessibilityLabel, style,
}: Props) {
  const theme = useTheme();
  // An inline link is plain text unless asked otherwise.
  const variant = chosen ?? (size === 'inline' ? 'plain' : 'filled');
  const textOnly = variant === 'plain' || size === 'inline';
  const toned =
    tone === 'danger' ? theme.danger
    : tone === 'neutral' ? (textOnly ? theme.textSecondary : theme.text)
    : tone === 'tint' ? theme.tint
    : undefined;
  // Secondary is a neutral control unless a colour is asked for.
  const c = color ?? toned ?? (variant === 'secondary' ? theme.text : theme.tint);
  const fg = variant === 'filled' ? (tone === 'neutral' && !color ? theme.background : theme.onTint) : c;
  const bg =
    variant === 'filled' ? c
    : variant === 'tinted' ? `${c}14`
    : variant === 'secondary' ? theme.backgroundElement
    : 'transparent';
  const inline = size === 'inline';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      hitSlop={inline ? 8 : undefined}
      onPress={() => {
        feel(haptic);
        onPress();
      }}
      style={({ pressed }) => [
        inline ? styles.inline : styles.base,
        { height: HEIGHT[size], backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? PRESSED_OPACITY : 1 },
        variant === 'outline' && { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c },
        pressed && !inline && styles.pressed,
        style,
      ]}>
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          sf && <Icon sf={sf} md={md} size={FONT[size]} color={fg} weight="medium" />
        )}
        <Text style={[styles.label, { color: fg, fontSize: FONT[size] }]} numberOfLines={1}>
          {label}
        </Text>
        {trailingSf && <Icon sf={trailingSf} md={trailingMd} size={FONT[size] - 3} color={fg} weight="semibold" />}
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
  inline: { alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.99 }] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontWeight: '600' },
});
