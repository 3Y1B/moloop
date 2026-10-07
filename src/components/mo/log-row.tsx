import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { TeamRow } from '@/components/lead/team-list';
import { PrioritySignal } from '@/components/task/badges';
import { StatusLine } from '@/components/ui/status-line';
import { Type } from '@/constants/theme';
import { useLookups, useNow, useTaskStatus } from '@/data/hooks';
import { ago } from '@/lib/format';
import { lastLine, type LogRow as Row } from '@/lib/task-log';
import { useTheme } from '@/hooks/use-theme';

/** One task in the log: priority, what, where it stands, then team, zone and what happened last. Opens the task page. */
export function LogRow({ row }: { row: Row }) {
  const theme = useTheme();
  const now = useNow();
  const { teams, zones } = useLookups();
  const { task, last } = row;
  const status = useTaskStatus(task);
  const team = task.teamSlug ? teams[task.teamSlug]?.short : undefined;
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : undefined;
  const meta = [team, zone, last && lastLine(last)].filter(Boolean).join(' · ');
  const when = Math.max(last?.at ?? 0, task.lastActivityAt);
  const closed = task.status === 'resolved' || task.status === 'cancelled';

  return (
    <TeamRow label={task.title} onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}>
      <View style={styles.signal}>
        <PrioritySignal priority={task.priority} size={12} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={[styles.title, { color: closed ? theme.textSecondary : theme.text }]} numberOfLines={1}>{task.title}</Text>
          <Text style={[styles.when, { color: theme.textTertiary }]}>{ago(when, now)}</Text>
        </View>
        {status && <StatusLine status={status} />}
        {!!meta && <Text style={[styles.meta, { color: theme.textTertiary }]} numberOfLines={1}>{meta}</Text>}
      </View>
    </TeamRow>
  );
}

const styles = StyleSheet.create({
  signal: { alignSelf: 'flex-start', paddingTop: 4 },
  body: { flex: 1, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { flex: 1, fontSize: Type.body, fontWeight: '500' },
  when: { fontSize: Type.caption, fontVariant: ['tabular-nums'] },
  meta: { fontSize: Type.caption },
});
