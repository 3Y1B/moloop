import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrioritySignal } from '@/components/task/badges';
import { Icon } from '@/components/ui/icon';
import { StatusLine } from '@/components/ui/status-line';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useNow, useRepo, useTaskStatus, type NeedsItem } from '@/data/hooks';
import { ago } from '@/lib/format';
import type { Proposal } from '@/lib/schema';
import type { Status } from '@/lib/status';
import { useTheme } from '@/hooks/use-theme';
import { attempt } from './sheet';
import { useLiveNow } from './use-live-now';

/** One thing that needs the lead: what, the status line, who and where. Tap opens the right sheet. */
export function NeedsRow({ item }: { item: NeedsItem }) {
  const theme = useTheme();
  const repo = useRepo();
  const now = useNow();
  const { volunteers, zones } = useLookups();
  const taskStatus = useTaskStatus(item.task);
  const { task, kind } = item;
  const owner = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : null;
  const waiting = kind === 'approval' || kind === 'unassigned' || kind === 'escalated';
  const sub = [owner?.name.split(' ')[0], zone, waiting ? ago(item.since, now) : null].filter(Boolean).join(' · ');

  const open = () => {
    if (kind === 'approval' && item.proposal) router.push({ pathname: '/approve/[id]', params: { id: item.proposal.id } });
    else if (kind === 'unassigned' || kind === 'escalated') router.push({ pathname: '/assign/[id]', params: { id: task.id, mode: 'assign' } });
    else router.push({ pathname: '/respond/[id]', params: { id: task.id } });
  };

  return (
    <Pressable onPress={open} style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={styles.signal}>
        <PrioritySignal priority={task.priority} size={13} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{task.title}</Text>
        {kind === 'approval' && item.proposal ? <ApprovalLine proposal={item.proposal} /> : taskStatus && <StatusLine status={taskStatus} />}
        {!!sub && <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>{sub}</Text>}
      </View>
      {kind === 'handover' ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            attempt(() => repo.arrived(task.id));
          }}
          style={({ pressed }) => [styles.action, { backgroundColor: theme.tint, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.actionText, { color: theme.onTint }]}>Arrived</Text>
        </Pressable>
      ) : (
        <Icon sf="chevron.right" md="chevron_right" size={12} color={theme.textTertiary} weight="medium" />
      )}
    </Pressable>
  );
}

/** "Maya in 24 s": who the AI will assign, ticking down. Status copy has no proposal line, so it's built here. */
function ApprovalLine({ proposal }: { proposal: Proposal }) {
  const now = useLiveNow();
  const { volunteers } = useLookups();
  const pick = volunteers[proposal.candidates[0]?.volunteerId ?? '']?.name.split(' ')[0];
  const left = Math.max(0, Math.ceil((proposal.autoAssignAt - now) / 1000));
  const status: Status = { label: left > 0 ? `Approve${pick ? ` ${pick}` : ''} · ${left} s` : 'Assigning', tone: 'warning' };
  return <StatusLine status={status} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 60 },
  signal: { alignSelf: 'flex-start', paddingTop: 3 },
  body: { flex: 1, gap: 3 },
  title: { fontSize: Type.body - 1, fontWeight: '500' },
  sub: { fontSize: Type.footnote - 1 },
  action: { paddingHorizontal: 12, height: 30, borderRadius: Radius.pill, justifyContent: 'center' },
  actionText: { fontSize: Type.footnote, fontWeight: '600' },
});
