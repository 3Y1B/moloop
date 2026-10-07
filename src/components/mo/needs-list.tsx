import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { NeedsRow } from '@/components/lead/needs-row';
import { TeamRow, TeamSection } from '@/components/lead/team-list';
import { PrioritySignal } from '@/components/task/badges';
import { StatusLine } from '@/components/ui/status-line';
import { Spacing, Type } from '@/constants/theme';
import { useCrew, useMyWork, useNeedsMe, useTaskStatus } from '@/data/hooks';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/**
 * What's on Mo: their own task and what's queued for them (only when there is one), then everything waiting on Mo,
 * most urgent first. Nothing waiting: "All clear".
 */
export function NeedsList() {
  const needs = useNeedsMe();
  const { active, queue } = useMyWork();
  const yours = active ? [active, ...queue] : queue;

  return (
    <View>
      {yours.length > 0 && (
        <TeamSection title="Yours" count={yours.length}>
          {yours.map((t) => <YourRow key={t.id} task={t} />)}
        </TeamSection>
      )}
      {needs.length > 0 ? (
        <TeamSection title="Waiting on you" count={needs.length}>
          {needs.map((n) => <NeedsRow key={`${n.kind}-${n.kind === 'mobilization' ? n.mobilization.id : n.task.id}`} item={n} />)}
        </TeamSection>
      ) : (
        <AllClear />
      )}
    </View>
  );
}

/** One of Mo's own tasks: what, and where it stands. Opens the task. */
function YourRow({ task }: { task: Task }) {
  const theme = useTheme();
  const status = useTaskStatus(task);
  return (
    <TeamRow label={task.title} onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}>
      <View style={styles.signal}>
        <PrioritySignal priority={task.priority} size={12} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{task.title}</Text>
        {status && <StatusLine status={status} />}
      </View>
    </TeamRow>
  );
}

function AllClear() {
  const theme = useTheme();
  const { members } = useCrew();
  const onDuty = members.filter((m) => m.volunteer.duty === 'on_duty').length;
  return (
    <View style={styles.clear}>
      <Text style={[styles.clearTitle, { color: theme.text }]}>All clear</Text>
      <Text style={[styles.small, { color: theme.textSecondary }]}>{onDuty} on duty</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  signal: { alignSelf: 'flex-start', paddingTop: 4 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: Type.body, fontWeight: '500' },
  clear: { marginTop: Spacing.four, gap: Spacing.one },
  clearTitle: { fontSize: Type.title, lineHeight: 23, fontWeight: '600', letterSpacing: -0.2 },
  small: { fontSize: Type.footnote },
});
