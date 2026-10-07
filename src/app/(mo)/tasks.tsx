import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TeamRow } from '@/components/lead/team-list';
import { LogRow } from '@/components/mo/log-row';
import { MoPage } from '@/components/mo/mo-page';
import { SummaryCard } from '@/components/mo/summary-card';
import { TeamPills } from '@/components/mo/team-pills';
import { Segmented } from '@/components/ui/segmented';
import { Spacing, Type } from '@/constants/theme';
import { useChosenTeam, useTaskLog } from '@/data/hooks';
import type { LogStatus } from '@/lib/task-log';
import { useTheme } from '@/hooks/use-theme';

const EMPTY: Record<LogStatus, string> = {
  all: 'No tasks yet this shift',
  open: 'Nothing open: every task has someone on it',
  active: 'Nobody is on a task right now',
  done: 'Nothing finished yet',
};

/** Every task this shift, most recent activity first, filtered by where it stands and by the team pills. */
export default function TasksScreen() {
  const theme = useTheme();
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
          <TeamRow>
            <Text style={[styles.empty, { color: theme.textTertiary }]}>{EMPTY[status]}</Text>
          </TeamRow>
        ) : (
          rows.map((r) => <LogRow key={r.task.id} row={r} />)
        )}
      </View>
    </MoPage>
  );
}

const styles = StyleSheet.create({
  filters: { gap: Spacing.two, paddingBottom: Spacing.two },
  summary: { marginTop: Spacing.two },
  list: { marginTop: Spacing.two },
  empty: { fontSize: Type.footnote },
});
