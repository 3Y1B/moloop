import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Spacing } from '@/constants/theme';

/**
 * A section under the peek: small title and count, then flat rows split by hairlines (`ListRow flush divider`).
 * No cards.
 */
export function TeamSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text variant="label" tone="primary" accessibilityRole="header">{title}</Text>
        {count != null && <Text variant="footnote" tone="tertiary" tabular style={styles.count}>{count}</Text>}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: Spacing.four },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.one },
  count: { fontWeight: '500' },
});
