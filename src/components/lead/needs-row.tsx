import { RowSignal, TaskRow } from '@/components/task/task-row';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { StatusLine } from '@/components/ui/status-line';
import { Text } from '@/components/ui/text';
import { useLookups, useMobilizationStatus, useNow, useRepo, useTaskStatus, type NeedsItem } from '@/data/hooks';
import { ago } from '@/lib/format';
import type { Mobilization, Proposal } from '@/lib/schema';
import type { Status } from '@/lib/status';
import { openNeed } from './open-sheet';
import { attempt } from './sheet';
import { useLiveNow } from './use-live-now';

type TaskNeed = Exclude<NeedsItem, { kind: 'mobilization' }>;

/** One thing that needs the lead: what, and its status line. Tap opens the right sheet; a handover takes Arrived here. */
export function NeedsRow({ item }: { item: NeedsItem }) {
  if (item.kind === 'mobilization') return <MobilizationNeedsRow mobilization={item.mobilization} since={item.since} />;
  if (item.kind === 'approval' && item.proposal) return <ApprovalNeedsRow item={item} proposal={item.proposal} />;
  return <TaskNeedsRow item={item} />;
}

/** A mobilization has several tasks and teams, not one task owner or an auto-assignment countdown. */
function MobilizationNeedsRow({ mobilization, since }: { mobilization: Mobilization; since: number }) {
  const now = useNow();
  const tasks = mobilization.steps.length;
  const teams = new Set(mobilization.steps.map((step) => step.teamSlug)).size;
  const sub = [`${tasks} task${tasks === 1 ? '' : 's'} · ${teams} team${teams === 1 ? '' : 's'}`, ago(since, now)]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListRow
      flush
      divider
      accessibilityLabel={mobilization.title}
      onPress={() => openNeed({ kind: 'mobilization', mobilization, since })}
      leading={<RowSignal priority={mobilization.urgency} />}>
      <Text variant="rowTitle" numberOfLines={1}>{mobilization.title}</Text>
      <MobilizationNeedStatus mobilization={mobilization} />
      <Text variant="footnote" tone="secondary" numberOfLines={1}>{sub}</Text>
    </ListRow>
  );
}

/** Ticks every second, so only approvals pay for the live clock. */
function ApprovalNeedsRow({ item, proposal }: { item: TaskNeed; proposal: Proposal }) {
  const status = useApprovalStatus(proposal);
  return <TaskRow task={item.task} flat status={status} onPress={() => openNeed(item)} />;
}

function TaskNeedsRow({ item }: { item: TaskNeed }) {
  const repo = useRepo();
  const { task, kind } = item;
  return (
    <TaskRow
      task={task}
      flat
      onPress={() => openNeed(item)}
      trailing={
        kind === 'handover' && (
          <Button
            label="Arrived"
            variant="secondary"
            size="small"
            haptic="success"
            onPress={() => attempt(() => repo.arrived(task.id))}
          />
        )
      }
    />
  );
}

/** The status line for a "Needs you" item: the approval countdown, else the task's status as I see it. */
export function NeedStatus({ item }: { item: NeedsItem }) {
  if (item.kind === 'mobilization') return <MobilizationNeedStatus mobilization={item.mobilization} />;
  if (item.kind === 'approval' && item.proposal) return <ApprovalLine proposal={item.proposal} />;
  return <TaskNeedStatus item={item} />;
}

function MobilizationNeedStatus({ mobilization }: { mobilization: Mobilization }) {
  const status = useMobilizationStatus(mobilization);
  return status ? <StatusLine status={status} /> : null;
}

function TaskNeedStatus({ item }: { item: TaskNeed }) {
  const status = useTaskStatus(item.task);
  return status ? <StatusLine status={status} /> : null;
}

function ApprovalLine({ proposal }: { proposal: Proposal }) {
  return <StatusLine status={useApprovalStatus(proposal)} />;
}

/** "Approve Maya · 24 s": who the AI will assign, ticking down. Status copy has no proposal line, so it's built here. */
function useApprovalStatus(proposal: Proposal): Status {
  const now = useLiveNow();
  const { volunteers } = useLookups();
  const pick = volunteers[proposal.candidates[0]?.volunteerId ?? '']?.name.split(' ')[0];
  const left = Math.max(0, Math.ceil((proposal.autoAssignAt - now) / 1000));
  return {
    label: left > 0 ? `Approve${pick ? ` ${pick}` : ''} · ${left} s` : 'Assigning',
    tone: 'warning',
  };
}
