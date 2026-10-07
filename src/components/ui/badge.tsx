import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * A count in a small red capsule (unread, waiting). Nothing at zero. `outline` rings it in the card colour, for a
 * badge pinned over an icon's corner (position it with `style`).
 */
export function CountBadge({ count, color, outline, style }: {
  count: number;
  color?: string;
  outline?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  if (!count) return null;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: color ?? theme.danger },
        outline && [styles.outline, { borderColor: theme.card }],
        style,
      ]}>
      <Text style={[styles.text, { color: theme.onTint }]}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  outline: { minWidth: 18, height: 18, borderWidth: 1.5 },
  text: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
