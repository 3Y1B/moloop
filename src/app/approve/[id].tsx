import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApproveHead } from '@/components/lead/approve-head';
import { ApproveRing } from '@/components/lead/approve-ring';
import { CandidateRow } from '@/components/lead/candidate-row';
import { attempt, Sheet } from '@/components/lead/sheet';
import { useLiveNow } from '@/components/lead/use-live-now';
import { Button } from '@/components/ui/button';
import { Card, Separator } from '@/components/ui/card';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useProposal, useRepo, useSnapshot, useTask, useTaskStatus } from '@/data/hooks';
import { initials } from '@/lib/format';
import { isBusy, POLICY } from '@/lib/lifecycle';
import { goBack } from '@/lib/navigation';
import type { Proposal, Task, Volunteer } from '@/lib/schema';
import { toneColor, useTheme } from '@/hooks/use-theme';

const RING = 152;

const first = (v?: Volunteer) => v?.name.split(' ')[0] ?? '';

/**
 * The AI's pick for a P1/P2 guest report (proposal `id`), inside a ring of the time left. Approve it, or pick who
 * goes: the first ticked gets the task, everyone else ticked is sent to help. Nobody acting before `autoAssignAt`
 * means the scheduler assigns the top pick; the sheet then shows who got it.
 */
export default function ApproveSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const proposal = useProposal(id);
  const task = useTask(proposal?.taskId);
  // Null until the lead changes who goes. From then on the countdown is theirs to beat, not the scheduler's:
  // if it auto-assigns meanwhile, their pick still wins on Send.
  const [picked, setPicked] = useState<string[] | null>(null);
  if (!proposal || !task) return null;
  const choosing = proposal.status === 'pending' || (picked !== null && proposal.status === 'auto_assigned');
  return (
    <Sheet>
      <ApproveHead task={task} />
      {choosing
        ? <Pending proposal={proposal} task={task} picked={picked} onPick={setPicked} />
        : <Decided proposal={proposal} task={task} />}
    </Sheet>
  );
}

function Pending({ proposal, task, picked, onPick }: {
  proposal: Proposal;
  task: Task;
  picked: string[] | null;
  onPick: (ids: string[]) => void;
}) {
  const theme = useTheme();
  const repo = useRepo();
  const now = useLiveNow();
  const { tasks } = useSnapshot();
  const { volunteers, teams } = useLookups();
  const [sending, setSending] = useState(false);
  const all = Object.values(tasks);
  const candidates = proposal.candidates.filter((c) => {
    const volunteer = volunteers[c.volunteerId];
    if (!volunteer || volunteer.role !== 'volunteer' || volunteer.duty !== 'on_duty') return false;
    if (!task.mobilizationId) return true;
    return volunteer.teamSlug === task.teamSlug &&
      (volunteer.shiftEndsAt == null || volunteer.shiftEndsAt > now) &&
      (task.requiredSkills ?? []).every((skill) => volunteer.skills.includes(skill)) &&
      !isBusy(all.filter((other) => other.id !== task.id), volunteer.id);
  });
  const top = candidates[0];

  if (!top) {
    return <Button label="Pick a volunteer" onPress={() => router.replace({ pathname: '/assign/[id]', params: { id: task.id, mode: 'assign' } })} />;
  }

  const touched = picked !== null;
  const eligible = new Set(candidates.map((candidate) => candidate.volunteerId));
  const selection = (picked ?? [top.volunteerId]).filter((volunteerId) => eligible.has(volunteerId));
  const lead = selection[0] ? volunteers[selection[0]] : undefined;
  const why = candidates.find((c) => c.volunteerId === lead?.id)?.rationale;
  const extras = selection.slice(1).map((vid) => volunteers[vid]).filter(Boolean);

  const leftMs = Math.max(0, proposal.autoAssignAt - now);
  const left = Math.ceil(leftMs / 1000);
  const share = Math.min(1, leftMs / POLICY.autoAssignMs);
  const ring = touched ? (lead ? 'closed' : 'open') : left > 0 ? 'counting' : 'open';
  const line = touched
    ? extras.length > 0 ? `With ${extras.map(first).join(', ')}` : null
    : left > 0 ? `Auto-assigns in ${left} s` : 'Assigning';

  const label = selection.length === 0 ? 'Send'
    : selection.length > 1 ? `Send ${selection.length}`
      : selection[0] === top.volunteerId ? `Approve ${first(lead)}`
        : `Send ${first(lead)}`;

  const toggle = (vid: string) => onPick(selection.includes(vid) ? selection.filter((x) => x !== vid) : [...selection, vid]);

  // The first ticked takes the task; the rest go with them as helpers.
  const send = async () => {
    const [assignee, ...helpers] = selection;
    if (!assignee || sending) return;
    setSending(true);
    const ok = await attempt(async () => {
      if (proposal.status === 'pending') await repo.approve(proposal.id, assignee, helpers);
      else if (proposal.volunteerId !== assignee || helpers.length) await repo.assign(task.id, assignee, helpers);
    });
    if (!ok) {
      setSending(false);
      return;
    }
    goBack({ pathname: '/task/[id]', params: { id: task.id } });
  };

  return (
    <>
      <View style={styles.center}>
        <ApproveRing size={RING} state={ring} share={share} endsAt={proposal.autoAssignAt} totalMs={POLICY.autoAssignMs} color={theme.tint}>
          {lead && <Text style={[styles.face, { color: theme.text }]}>{initials(lead.name)}</Text>}
        </ApproveRing>
        <View style={styles.who}>
          {lead
            ? <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{lead.name}</Text>
            : <Text style={[styles.name, { color: theme.textTertiary }]}>No one picked</Text>}
          {why && <Text style={[styles.small, { color: theme.textSecondary }]} numberOfLines={1}>{why}</Text>}
          {line && <Text style={[styles.small, styles.line, { color: theme.text }]} numberOfLines={1}>{line}</Text>}
        </View>
      </View>

      <Button
        size="large"
        label={label}
        sf={selection.length === 1 && !touched ? 'checkmark' : undefined}
        haptic="success"
        disabled={selection.length === 0 || sending}
        onPress={send}
      />

      <View style={styles.list}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>Who goes</Text>
        <Card>
          {candidates.map((c, i) => {
            const v = volunteers[c.volunteerId];
            return (
              <Fragment key={c.volunteerId}>
                {i > 0 && <Separator inset={58} />}
                <CandidateRow
                  candidate={c}
                  volunteer={v}
                  team={v.teamSlug ? teams[v.teamSlug] : undefined}
                  busy={isBusy(all, v.id)}
                  suggested={i === 0}
                  selected={selection.includes(v.id)}
                  onPress={() => toggle(v.id)}
                />
              </Fragment>
            );
          })}
        </Card>
      </View>
    </>
  );
}

/** Approved, auto-assigned or cancelled: the ring closes on who got it, and where the task is now. */
function Decided({ proposal, task }: { proposal: Proposal; task: Task }) {
  const theme = useTheme();
  const { volunteers } = useLookups();
  const status = useTaskStatus(task);
  const v = proposal.volunteerId ? volunteers[proposal.volunteerId] : undefined;
  const by = proposal.decidedById ? volunteers[proposal.decidedById] : undefined;
  const cancelled = proposal.status === 'cancelled';
  const auto = proposal.status === 'auto_assigned';
  const how = auto ? 'Auto-assigned' : cancelled ? 'Cancelled' : `Approved${by ? ` by ${first(by)}` : ''}`;

  return (
    <>
      <View style={styles.center}>
        <ApproveRing
          size={RING}
          state={cancelled || !v ? 'open' : 'closed'}
          share={0}
          endsAt={proposal.autoAssignAt}
          totalMs={POLICY.autoAssignMs}
          color={auto ? theme.text : theme.tint}>
          {v
            ? <Text style={[styles.face, { color: theme.text }]}>{initials(v.name)}</Text>
            : <Text style={[styles.small, { color: theme.textSecondary }]}>{how}</Text>}
        </ApproveRing>
        <View style={styles.who}>
          {v && <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{v.name}</Text>}
          {v && <Text style={[styles.small, { color: theme.textSecondary }]}>{how}</Text>}
          {status && !cancelled && (
            <Text style={[styles.small, { color: toneColor(theme, status.tone) }]} numberOfLines={1}>{status.label}</Text>
          )}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Done"
        onPress={() => goBack({ pathname: '/task/[id]', params: { id: task.id } })}
        style={({ pressed }) => [styles.done, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
        <Text style={[styles.doneText, { color: theme.text }]}>Done</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 16, paddingVertical: 8 },
  face: { fontSize: 40, fontWeight: '500', letterSpacing: 1 },
  who: { alignItems: 'center', gap: 4, alignSelf: 'stretch' },
  name: { fontSize: Type.hero, lineHeight: 28, fontWeight: '600', textAlign: 'center' },
  small: { fontSize: Type.callout, lineHeight: 20, textAlign: 'center' },
  line: { marginTop: 4, fontVariant: ['tabular-nums'] },
  list: { gap: 8, marginTop: 6 },
  label: { fontSize: Type.footnote, fontWeight: '500', paddingHorizontal: 4 },
  done: { height: 48, borderRadius: Radius.control, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  doneText: { fontSize: Type.body + 1, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
