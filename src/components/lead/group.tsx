import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Section on the Team tab: plain title, the count in a quieter tone, then a card. Same look as My task. */
export function Group({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.group}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        {count != null && <Text style={[styles.count, { color: theme.textTertiary }]}>{count}</Text>}
      </View>
      {children}
    </View>
  );
}

/** One quiet line in a card when a list is empty. */
export function EmptyCard({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Card style={styles.empty}>
      <Text style={[styles.emptyText, { color: theme.textTertiary }]}>{text}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  title: { fontSize: Type.title - 1, fontWeight: '600', letterSpacing: -0.2 },
  count: { fontSize: Type.title - 1, fontWeight: '500', fontVariant: ['tabular-nums'] },
  empty: { paddingHorizontal: 14, paddingVertical: 14 },
  emptyText: { fontSize: Type.callout, fontWeight: '500' },
});
