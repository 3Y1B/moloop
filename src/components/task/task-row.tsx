import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ListRow } from '@/components/ui/list-row';
import { StatusLine } from '@/components/ui/status-line';
import { Text } from '@/components/ui/text';
import { useLookups, useNow, useTaskStatus } from '@/data/hooks';
import { ago } from '@/lib/format';
import type { Priority, Task } from '@/lib/schema';
import type { Status } from '@/lib/status';
import { PrioritySignal } from './badges';
import { Untranslated } from './untranslated';

/** The priority at the head of every task row, level with its title. */
export function RowSignal({ priority }: { priority: Priority }) {
  return (
    <View style={styles.signal}>
      <PrioritySignal priority={priority} size={12} />
    </View>
  );
}

/**
 * The one task row: priority, what (dimmed once it's over), then its status line. In a card by default; `flat` is a
 * hairline row in a sheet list. `zone` adds where it is to the status detail and `detail` whatever follows; `when`
 * puts how long ago at the right of the title. `status` stands in for the task's own (the approval countdown); `trailing` sits at
 * the right (Arrived). Tap opens the task page unless `onPress` says otherwise.
 */
export function TaskRow({ task, onPress, flat, zone, when, status: override, detail, trailing, chevron = !flat }: {
  task: Task;
  onPress?: () => void;
  flat?: boolean;
  zone?: boolean;
  when?: number;
  status?: Status;
  detail?: string;
  trailing?: ReactNode;
  chevron?: boolean;
}) {
  const now = useNow();
  const { zones } = useLookups();
  const own = useTaskStatus(task);
  const status = override ?? own;
  const place = zone && task.zoneSlug ? zones[task.zoneSlug]?.name : undefined;
  const closed = task.status === 'resolved' || task.status === 'cancelled';
  const more = [status?.detail, place, detail].filter(Boolean).join(' · ');

  return (
    <ListRow
      flush={flat}
      divider={flat}
      chevron={chevron}
      accessibilityLabel={task.title}
      onPress={onPress ?? (() => router.push({ pathname: '/task/[id]', params: { id: task.id } }))}
      leading={<RowSignal priority={task.priority} />}
      trailing={trailing}>
      <View style={styles.top}>
        <Text variant="rowTitle" tone={closed ? 'secondary' : 'primary'} style={styles.title} numberOfLines={1}>
          {task.title}
        </Text>
        <Untranslated task={task} />
        {when != null && (
          <Text variant="meta" tone="tertiary" style={styles.when}>
            {ago(when, now)}
          </Text>
        )}
      </View>
      {status && <StatusLine status={{ ...status, detail: more || undefined }} />}
    </ListRow>
  );
}

const styles = StyleSheet.create({
  signal: { alignSelf: 'flex-start', paddingTop: 4 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { flexShrink: 1 },
  when: { marginLeft: 'auto' },
});
