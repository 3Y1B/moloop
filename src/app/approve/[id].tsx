import { router, useLocalSearchParams } from 'expo-router';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CandidateRow } from '@/components/lead/candidate-row';
import { Group } from '@/components/lead/group';
import { attempt, Sheet } from '@/components/lead/sheet';
import { TaskHead } from '@/components/lead/task-head';
import { useLiveNow } from '@/components/lead/use-live-now';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Separator } from '@/components/ui/card';
import { StatusLine } from '@/components/ui/status-line';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useProposal, useRepo, useSnapshot, useTask, useTaskStatus } from '@/data/hooks';
import { isBusy, POLICY } from '@/lib/lifecycle';
import type { Proposal, Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/**
 * The AI's pick for a P1/P2 guest report (proposal `id`). Approve it, or pick someone else. Nobody acting
 * before `autoAssignAt` means the scheduler assigns the top pick; the sheet then shows who got it.
 */
export default function ApproveSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const proposal = useProposal(id);
  const task = useTask(proposal?.taskId);
  if (!proposal || !task) return null;
  return (
    <Sheet>
      <TaskHead task={task} status={proposal.status !== 'pending'} />
      <Text style={[styles.summary, { color: theme.textSecondary }]}>{task.summary}</Text>
      {proposal.status === 'pending' ? <Pending proposal={proposal} task={task} /> : <Decided proposal={proposal} task={task} />}
    </Sheet>
  );
}

function Pending({ proposal, task }: { proposal: Proposal; task: Task }) {
  const theme = useTheme();
  const repo = useRepo();
  const now = useLiveNow();
  const { tasks } = useSnapshot();
  const { volunteers, teams } = useLookups();
  const all = Object.values(tasks);
  const [top, ...rest] = proposal.candidates.filter((c) => volunteers[c.volunteerId]);
  const left = Math.max(0, Math.ceil((proposal.autoAssignAt - now) / 1000));
  const share = Math.min(1, (proposal.autoAssignAt - now) / POLICY.autoAssignMs);

  const approve = async (volunteerId?: string) => {
    if (await attempt(() => repo.approve(proposal.id, volunteerId))) router.back();
  };
  const row = (c: Proposal['candidates'][number], suggested = false) => {
    const v = volunteers[c.volunteerId];
    return (
      <CandidateRow
        candidate={c}
        volunteer={v}
        team={v.teamSlug ? teams[v.teamSlug] : undefined}
        busy={isBusy(all, v.id)}
        suggested={suggested}
        onPress={() => approve(c.volunteerId)}
      />
    );
  };

  if (!top) {
    return <Button label="Pick a volunteer" onPress={() => router.replace({ pathname: '/assign/[id]', params: { id: task.id, mode: 'assign' } })} />;
  }

  return (
    <>
      <View style={styles.countdown}>
        <Text style={[styles.countText, { color: left > 0 ? theme.warning : theme.textSecondary }]}>
          {left > 0 ? `Auto-assigns in ${left} s` : 'Assigning'}
        </Text>
        <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
          <View style={[styles.fill, { width: `${Math.max(0, share) * 100}%`, backgroundColor: theme.warning }]} />
        </View>
      </View>

      <Card>{row(top, true)}</Card>
      <Button size="large" label={`Approve ${volunteers[top.volunteerId].name.split(' ')[0]}`} sf="checkmark" haptic="success" onPress={() => approve()} />

      {rest.length > 0 && (
        <Group title="Or pick">
          <Card>
            {rest.map((c, i) => (
              <Fragment key={c.volunteerId}>
                {i > 0 && <Separator inset={58} />}
                {row(c)}
              </Fragment>
            ))}
          </Card>
        </Group>
      )}
    </>
  );
}

/** Approved, auto-assigned or cancelled: who got it and where the task is now. */
function Decided({ proposal, task }: { proposal: Proposal; task: Task }) {
  const theme = useTheme();
  const { volunteers, teams } = useLookups();
  const status = useTaskStatus(task);
  const v = proposal.volunteerId ? volunteers[proposal.volunteerId] : undefined;
  const by = proposal.decidedById ? volunteers[proposal.decidedById] : undefined;
  const how = proposal.status === 'auto_assigned' ? 'Auto-assigned'
    : proposal.status === 'cancelled' ? 'Cancelled'
      : `Approved${by ? ` by ${by.name.split(' ')[0]}` : ''}`;

  return (
    <>
      <Card style={styles.decided}>
        {v && <Avatar name={v.name} color={v.teamSlug ? teams[v.teamSlug]?.color : undefined} size={36} />}
        <View style={styles.flex}>
          {v && <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{v.name}</Text>}
          <Text style={[styles.how, { color: theme.textSecondary }]}>{how}</Text>
        </View>
      </Card>
      {status && proposal.status !== 'cancelled' && <StatusLine status={status} size="callout" />}
      <Button label="Done" variant="tinted" onPress={() => router.back()} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  summary: { fontSize: Type.callout, lineHeight: 20, marginTop: -4 },
  countdown: { gap: 6 },
  countText: { fontSize: Type.callout, fontWeight: '600', fontVariant: ['tabular-nums'] },
  track: { height: 4, borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { height: 4, borderRadius: Radius.pill },
  decided: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  name: { fontSize: Type.body, fontWeight: '600' },
  how: { fontSize: Type.footnote, marginTop: 1 },
});
