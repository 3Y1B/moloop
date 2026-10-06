import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Type } from '@/constants/theme';
import { useLookups, useNow, useTaskStatus } from '@/data/hooks';
import { ago } from '@/lib/format';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';
import { PrioritySignal } from './badges';

/** Compact list row (queue, history). Tap for the timeline. */
export function TaskRow({ task }: { task: Task }) {
  const theme = useTheme();
  const now = useNow();
  const { zones } = useLookups();
  const status = useTaskStatus(task);
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : null;
  // Queued rows sit under "Up next" already; finished ones say how it ended and when ("Handed to medics 5 min ago").
  const ended = (task.status === 'resolved' || task.status === 'cancelled') && task.resolvedAt;
  const when = task.status === 'queued' ? null : ended ? `${status?.label} ${ago(task.resolvedAt!, now)}` : status?.label;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <PrioritySignal priority={task.priority} size={13} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{task.title}</Text>
        <View style={styles.subRow}>
          {zone && <Icon sf="mappin" md="location_on" size={11} color={theme.textTertiary} />}
          <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>
            {[zone, when].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <Icon sf="chevron.right" md="chevron_right" size={12} color={theme.textTertiary} weight="medium" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 52 },
  body: { flex: 1, gap: 1 },
  title: { fontSize: Type.body - 1, fontWeight: '500' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sub: { flexShrink: 1, fontSize: Type.footnote - 1 },
});
