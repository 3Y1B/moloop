import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Icon } from './icon';
import { haptic, pressedStyle } from './pressable';

export type ChipTone = 'neutral' | 'tint' | 'danger' | 'warning' | 'success';

/**
 * A pill. Unselected it's a grey fill with text; `selected` is the tint wash with tint text. `tone` (or a team or
 * priority `color`) gives a soft wash of that colour with coloured text, for labels like "P1 · Urgent"; a tappable
 * chip with `color` wears it only when selected (team filters). `small` is a 22 px label; `medium` (default) a 34 px
 * filter you tap. `count` sits after the label in tabular figures.
 */
export function Chip({ label, sf, md, leading, selected, tone, color, size = 'medium', count, onPress, accessibilityLabel, style }: {
  label: string;
  sf?: string;
  md?: string;
  /** A custom mark before the label (the priority signal); used instead of `sf`. */
  leading?: ReactNode;
  selected?: boolean;
  tone?: ChipTone;
  /** Any colour (a team's); wins over `tone`. */
  color?: string;
  size?: 'small' | 'medium';
  count?: number | string;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const wash: Record<ChipTone, [string, string]> = {
    neutral: [theme.backgroundElement, theme.text],
    tint: [theme.tintSoft, theme.tint],
    danger: [theme.dangerSoft, theme.danger],
    warning: [`${theme.warning}1A`, theme.warning],
    success: [`${theme.success}1A`, theme.success],
  };
  // A tappable chip only wears its `color` once chosen; a static label always does.
  const [bg, fg] = color && (selected || !onPress) ? [`${color}1A`, color] : wash[selected ? 'tint' : tone ?? 'neutral'];
  const small = size === 'small';
  const font = small ? Type.caption - 1 : Type.callout;

  const body = (
    <>
      {leading ?? (sf && <Icon sf={sf} md={md} size={small ? 10 : 15} color={fg} weight="medium" />)}
      <Text style={[styles.label, { color: fg, fontSize: font, fontWeight: small || selected ? '600' : '500' }]} numberOfLines={1}>
        {label}
      </Text>
      {count != null && (
        <Text style={[styles.count, { color: selected || tone || (color && !onPress) ? fg : theme.textSecondary, fontSize: font }]}>{count}</Text>
      )}
    </>
  );
  const shape = [styles.chip, small ? styles.small : styles.medium, { backgroundColor: bg }];

  if (!onPress) return <View style={[shape, style]}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      style={({ pressed }) => [shape, pressedStyle(pressed), style]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.pill, borderCurve: 'continuous' },
  small: { height: 22, paddingHorizontal: 8, gap: 5 },
  medium: { height: 34, paddingHorizontal: 12, gap: 6 },
  label: { flexShrink: 1 },
  count: { fontWeight: '600', fontVariant: ['tabular-nums'] },
});
