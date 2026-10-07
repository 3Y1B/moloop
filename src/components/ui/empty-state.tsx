import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Card } from './card';
import { Text } from './text';

/**
 * What an empty list says. `inline`: one quiet line where a row would be. `card`: that line in a card, under a
 * Section. `screen`: centred, a way down an otherwise empty screen ("Nothing yet."). `divider` (inline) puts a
 * hairline above it, like the flat rows it stands in for.
 */
export function EmptyState({ title, body, variant = 'inline', divider, style }: {
  title: string;
  body?: string;
  variant?: 'inline' | 'card' | 'screen';
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  if (variant === 'screen') {
    return (
      <View style={[styles.screen, style]}>
        <Text tone="secondary" style={styles.center}>{title}</Text>
        {body && <Text variant="footnote" tone="tertiary" style={styles.center}>{body}</Text>}
      </View>
    );
  }
  const text = (
    <>
      <Text variant={variant === 'card' ? 'callout' : 'footnote'} tone="tertiary" style={variant === 'card' && styles.medium}>
        {title}
      </Text>
      {body && <Text variant="footnote" tone="tertiary">{body}</Text>}
    </>
  );
  if (variant === 'card') return <Card style={[styles.card, style]}>{text}</Card>;
  return (
    <View style={[styles.inline, divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }, style]}>
      {text}
    </View>
  );
}

/** Nothing waiting: "All clear", and how many are on duty. */
export function AllClear({ onDuty, style }: { onDuty: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.clear, style]}>
      <Text variant="title">All clear</Text>
      <Text variant="footnote" tone="secondary">{onDuty} on duty</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { marginTop: 60, gap: Spacing.one, alignItems: 'center' },
  center: { textAlign: 'center' },
  card: { paddingHorizontal: 14, paddingVertical: 14, gap: 2 },
  medium: { fontWeight: '500' },
  inline: { minHeight: 48, justifyContent: 'center', paddingVertical: Spacing.two, gap: 2 },
  clear: { gap: Spacing.one },
});
