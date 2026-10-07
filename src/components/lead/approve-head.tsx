import { StyleSheet, Text, View } from 'react-native';

import { Type } from '@/constants/theme';
import { useLookups, useNow } from '@/data/hooks';
import { ago } from '@/lib/format';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';

/** Centred top of the Approve sheet: "P1   By the bins · just now", then the title. */
export function ApproveHead({ task }: { task: Task }) {
  const theme = useTheme();
  const now = useNow();
  const priority = usePriorityColors()[task.priority];
  const { zones } = useLookups();
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : null;
  const where = task.locationHint ? cap(task.locationHint) : zone;

  return (
    <View style={styles.head}>
      <Text style={[styles.meta, { color: theme.textSecondary }]} numberOfLines={1}>
        <Text style={[styles.priority, { color: priority }]}>{task.priority}</Text>
        {'   '}{[where, ago(task.createdAt, now)].filter(Boolean).join(' · ')}
      </Text>
      <Text style={[styles.title, { color: theme.text }]}>{task.title}</Text>
    </View>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: 6 },
  meta: { fontSize: Type.callout, textAlign: 'center', fontVariant: ['tabular-nums'] },
  priority: { fontWeight: '600' },
  title: { fontSize: Type.hero, lineHeight: 28, fontWeight: '600', letterSpacing: -0.3, textAlign: 'center' },
});
