import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A section under the peek: small title and count, then flat rows split by hairlines. No cards. */
export function TeamSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        {count != null && <Text style={[styles.count, { color: theme.textTertiary }]}>{count}</Text>}
      </View>
      {children}
    </View>
  );
}

/** One flat row with a hairline above it. Tappable when given `onPress`. */
export function TeamRow({ onPress, label, children }: { onPress?: () => void; label?: string; children: ReactNode }) {
  const theme = useTheme();
  if (!onPress) return <View style={[styles.row, { borderTopColor: theme.separator }]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderTopColor: theme.separator }, pressed && { backgroundColor: theme.backgroundSelected }]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: Spacing.four },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.one },
  title: { fontSize: Type.footnote, fontWeight: '600' },
  count: { fontSize: Type.footnote, fontWeight: '500', fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
