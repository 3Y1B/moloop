import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Type } from '@/constants/theme';
import { useLookups, useNow } from '@/data/hooks';
import { ago, STATUS_LABEL } from '@/lib/format';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';
import { PrioritySignal } from './badges';

/** Compact list row (queue, history). Tap for the timeline. */
export function TaskRow({ task }: { task: Task }) {
  const theme = useTheme();
  const now = useNow();
  const { zones } = useLookups();
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : null;
  const when = task.status === 'resolved' && task.resolvedAt ? `Done ${ago(task.resolvedAt, now)}` : task.status === 'queued' ? null : STATUS_LABEL[task.status];

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
