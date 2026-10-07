import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrioritySignal } from '@/components/task/badges';
import { StatusLine } from '@/components/ui/status-line';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useMobilizationStatus, useNow, useRepo, useTaskStatus, type NeedsItem } from '@/data/hooks';
import { ago } from '@/lib/format';
import type { Mobilization, Proposal } from '@/lib/schema';
import type { Status } from '@/lib/status';
import { useTheme } from '@/hooks/use-theme';
import { openNeed } from './open-sheet';
import { attempt } from './sheet';
import { TeamRow } from './team-list';
import { useLiveNow } from './use-live-now';

/** One thing that needs the lead: what, and its status line. Tap opens the right sheet; a handover takes Arrived here. */
export function NeedsRow({ item }: { item: NeedsItem }) {
  return item.kind === 'mobilization'
    ? <MobilizationNeedsRow mobilization={item.mobilization} since={item.since} />
    : <TaskNeedsRow item={item} />;
}

/** A mobilization has several tasks and teams, not one task owner or an auto-assignment countdown. */
function MobilizationNeedsRow({ mobilization, since }: { mobilization: Mobilization; since: number }) {
  const theme = useTheme();
  const now = useNow();
  const tasks = mobilization.steps.length;
  const teams = new Set(mobilization.steps.map((step) => step.teamSlug)).size;
  const sub = [`${tasks} task${tasks === 1 ? '' : 's'} · ${teams} team${teams === 1 ? '' : 's'}`, ago(since, now)]
    .filter(Boolean).join(' · ');
  return (
    <TeamRow label={mobilization.title} onPress={() => openNeed({ kind: 'mobilization', mobilization, since })}>
      <PrioritySignal priority={mobilization.urgency} size={13} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{mobilization.title}</Text>
        <MobilizationNeedStatus mobilization={mobilization} />
        <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>{sub}</Text>
      </View>
    </TeamRow>
  );
}

function TaskNeedsRow({ item }: { item: Exclude<NeedsItem, { kind: 'mobilization' }> }) {
  const theme = useTheme();
  const repo = useRepo();
  const { task, kind } = item;
  return (
    <TeamRow label={task.title} onPress={() => openNeed(item)}>
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{task.title}</Text>
        <NeedStatus item={item} />
      </View>
      {kind === 'handover' && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            attempt(() => repo.arrived(task.id));
          }}
          style={({ pressed }) => [styles.action, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.actionText, { color: theme.text }]}>Arrived</Text>
        </Pressable>
      )}
    </TeamRow>
  );
}

/** The status line for a "Needs you" item: the approval countdown, else the task's status as I see it. */
export function NeedStatus({ item }: { item: NeedsItem }) {
  return item.kind === 'mobilization'
    ? <MobilizationNeedStatus mobilization={item.mobilization} />
    : <TaskNeedStatus item={item} />;
}

function MobilizationNeedStatus({ mobilization }: { mobilization: Mobilization }) {
  const status = useMobilizationStatus(mobilization);
  return status ? <StatusLine status={status} /> : null;
}

function TaskNeedStatus({ item }: { item: Exclude<NeedsItem, { kind: 'mobilization' }> }) {
  const status = useTaskStatus(item.task);
  if (item.kind === 'approval' && item.proposal) return <ApprovalLine proposal={item.proposal} />;
  return status ? <StatusLine status={status} /> : null;
}

/** "Approve Maya · 24 s": who the AI will assign, ticking down. Status copy has no proposal line, so it's built here. */
function ApprovalLine({ proposal }: { proposal: Proposal }) {
  const now = useLiveNow();
  const { volunteers } = useLookups();
  const pick = volunteers[proposal.candidates[0]?.volunteerId ?? '']?.name.split(' ')[0];
  const left = Math.max(0, Math.ceil((proposal.autoAssignAt - now) / 1000));
  const status: Status = { label: left > 0 ? `Approve${pick ? ` ${pick}` : ''} · ${left} s` : 'Assigning', tone: 'warning' };
  return <StatusLine status={status} />;
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: 2 },
  title: { fontSize: Type.body, fontWeight: '500' },
  sub: { fontSize: Type.footnote },
  action: { paddingHorizontal: 12, height: 30, borderRadius: Radius.pill, justifyContent: 'center' },
  actionText: { fontSize: Type.footnote, fontWeight: '600' },
});
