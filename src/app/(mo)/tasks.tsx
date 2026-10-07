import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MoPage } from '@/components/mo/mo-page';
import { SummaryCard } from '@/components/mo/summary-card';
import { TeamPills } from '@/components/mo/team-pills';
import { TaskRow } from '@/components/task/task-row';
import { EmptyState } from '@/components/ui/empty-state';
import { Segmented } from '@/components/ui/segmented';
import { Spacing } from '@/constants/theme';
import { useChosenTeam, useTaskLog } from '@/data/hooks';
import { lastLine, type LogStatus } from '@/lib/task-log';

const EMPTY: Record<LogStatus, string> = {
  all: 'No tasks yet this shift',
  open: 'Nothing open: every task has someone on it',
  active: 'Nobody is on a task right now',
  done: 'Nothing finished yet',
};

/** Every task this shift, most recent activity first, filtered by where it stands and by the team pills. */
export default function TasksScreen() {
  const team = useChosenTeam();
  const [status, setStatus] = useState<LogStatus>('all');
  const { rows, counts } = useTaskLog({ status, team });

  return (
    <MoPage
      title="Tasks"
      sticky={
        <View style={styles.filters}>
          <TeamPills />
          <Segmented
            value={status}
            onChange={setStatus}
            segments={[
              { key: 'all', label: `All ${counts.total}` },
              { key: 'open', label: `Open ${counts.open}` },
              { key: 'active', label: `Active ${counts.active}` },
              { key: 'done', label: `Done ${counts.done}` },
            ]}
          />
        </View>
      }>
      <SummaryCard style={styles.summary} />
      <View style={styles.list}>
        {rows.length === 0 ? (
          <EmptyState title={EMPTY[status]} divider />
        ) : (
          // Two lines like a crew row: what, and when it last moved; then where it stands, where, and what happened
          // last. The team is in the pills, so it isn't repeated here.
          rows.map(({ task, last }) => (
            <TaskRow
              key={task.id}
              task={task}
              flat
              zone
              when={Math.max(last?.at ?? 0, task.lastActivityAt)}
              detail={last ? lastLine(last) : undefined}
            />
          ))
        )}
      </View>
    </MoPage>
  );
}

const styles = StyleSheet.create({
  filters: { gap: Spacing.two, paddingBottom: Spacing.two },
  summary: { marginTop: Spacing.two },
  list: { marginTop: Spacing.two },
});
