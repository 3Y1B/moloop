import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrioritySignal } from '@/components/task/badges';
import { Icon } from '@/components/ui/icon';
import { StatusLine } from '@/components/ui/status-line';
import { Type } from '@/constants/theme';
import { useLookups, useTaskStatus } from '@/data/hooks';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';
import { TeamRow } from './team-list';

/**
 * Unassigned or queued task for the team: what, status ("Unassigned", "Up next for Tom"), where. In a card by default;
 * `flat` makes it a hairline row in a list.
 */
export function OpenTaskRow({ task, onPress, flat = false }: { task: Task; onPress: () => void; flat?: boolean }) {
  const theme = useTheme();
  const status = useTaskStatus(task);
  const { zones } = useLookups();
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : null;
  const content = (
    <>
      <View style={styles.signal}>
        <PrioritySignal priority={task.priority} size={13} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{task.title}</Text>
        {status && <StatusLine status={status} />}
        {zone && <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>{zone}</Text>}
      </View>
      <Icon sf="chevron.right" md="chevron_right" size={12} color={theme.textTertiary} weight="medium" />
    </>
  );
  if (flat) return <TeamRow label={task.title} onPress={onPress}>{content}</TeamRow>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 60 },
  signal: { alignSelf: 'flex-start', paddingTop: 3 },
  body: { flex: 1, gap: 3 },
  title: { fontSize: Type.body - 1, fontWeight: '500' },
  sub: { fontSize: Type.footnote - 1 },
});
