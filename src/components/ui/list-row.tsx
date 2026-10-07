import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { Icon } from './icon';
import { haptic as feel, type HapticKind } from './pressable';
import { Text } from './text';

/**
 * One list row: leading (icon, avatar, signal), a title with a line under it, trailing (time, check), chevron.
 * `children` replaces the title column. Tappable with `onPress`; pressed rows go grey. Card rows are padded; `flush`
 * is a row in a flat list on the sheet's own gutter, and `divider` puts a hairline above it.
 */
export function ListRow({
  leading, title, subtitle, trailing, chevron, onPress, onLongPress, haptic = 'none', divider, flush,
  accessibilityLabel, children, style,
}: {
  leading?: ReactNode;
  title?: string | ReactNode;
  /** A string is a quiet footnote line. */
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  haptic?: HapticKind;
  divider?: boolean;
  flush?: boolean;
  accessibilityLabel?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const body = (
    <>
      {leading}
      <View style={styles.body}>
        {children ?? (
          <>
            {typeof title === 'string' ? <Text variant="rowTitle" numberOfLines={1}>{title}</Text> : title}
            {typeof subtitle === 'string' ? (
              <Text variant="footnote" tone="secondary" numberOfLines={1}>{subtitle}</Text>
            ) : (
              subtitle
            )}
          </>
        )}
      </View>
      {trailing}
      {chevron && <Icon sf="chevron.right" md="chevron_right" size={12} color={theme.textTertiary} weight="medium" />}
    </>
  );
  const base = [
    styles.row,
    flush ? styles.flush : styles.padded,
    divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
  ];

  if (!onPress && !onLongPress) return <View style={[base, style]}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof title === 'string' ? title : undefined)}
      onPress={
        onPress &&
        (() => {
          feel(haptic);
          onPress();
        })
      }
      onLongPress={onLongPress}
      style={({ pressed }) => [base, pressed && { backgroundColor: theme.backgroundSelected }, style]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  padded: { paddingHorizontal: 14, paddingVertical: 10, minHeight: 52 },
  flush: { paddingVertical: 8, minHeight: 48 },
  body: { flex: 1, gap: 2 },
});
