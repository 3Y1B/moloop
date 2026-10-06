import { StyleSheet, Text, View } from 'react-native';

import { PriorityBadge, PrioritySignal } from '@/components/task/badges';
import { Icon } from '@/components/ui/icon';
import { StatusLine } from '@/components/ui/status-line';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useNow, useTaskStatus } from '@/data/hooks';
import { ago } from '@/lib/format';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';

/** Priority, title, where, and the status line as I see it. The top of every lead sheet about a task. */
export function TaskHead({ task, eyebrow, status = true }: { task: Task; eyebrow?: string; status?: boolean }) {
  const theme = useTheme();
  const now = useNow();
  const accent = usePriorityColors()[task.priority];
  const { zones } = useLookups();
  const line = useTaskStatus(task);
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <PriorityBadge priority={task.priority} />
        <Text style={[styles.meta, { color: theme.textTertiary }]} numberOfLines={1}>
          {eyebrow ?? ago(task.createdAt, now)}
        </Text>
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{task.title}</Text>
      {zone && (
        <View style={styles.location}>
          <Icon sf="mappin" md="location_on" size={13} color={accent} />
          <Text style={[styles.zone, { color: theme.text }]} numberOfLines={1}>
            {zone}
            {task.locationHint && <Text style={{ color: theme.textSecondary, fontWeight: '400' }}> · {task.locationHint}</Text>}
          </Text>
        </View>
      )}
      {status && line && <StatusLine status={line} />}
    </View>
  );
}

/** One line about a task, under a sheet title: priority, what, where. */
export function TaskLine({ task }: { task: Task }) {
  const theme = useTheme();
  const { zones } = useLookups();
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : null;
  return (
    <View style={styles.line}>
      <PrioritySignal priority={task.priority} size={12} />
      <Text style={[styles.lineText, { color: theme.textSecondary }]} numberOfLines={1}>
        <Text style={{ color: theme.text, fontWeight: '500' }}>{task.title}</Text>
        {zone ? ` · ${zone}` : ''}
      </Text>
    </View>
  );
}

/** How far through the expected time a task is. Turns orange once it runs over. Nothing without an ETA. */
export function TaskProgress({ task }: { task: Task }) {
  const theme = useTheme();
  const now = useNow();
  const start = task.assignedAt ?? task.createdAt;
  if (task.etaAt == null || task.etaAt <= start) return null;
  const p = Math.min(1, Math.max(0.04, (now - start) / (task.etaAt - start)));
  const over = now > task.etaAt;
  return (
    <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.fill, { width: `${p * 100}%`, backgroundColor: over ? theme.warning : theme.tint }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  meta: { fontSize: Type.caption, fontWeight: '500', fontVariant: ['tabular-nums'], flexShrink: 1 },
  title: { fontSize: Type.title, lineHeight: 23, fontWeight: '600', letterSpacing: -0.2 },
  location: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  zone: { flex: 1, fontSize: Type.footnote, fontWeight: '500' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineText: { flex: 1, fontSize: Type.callout },
  track: { height: 4, borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { height: 4, borderRadius: Radius.pill },
});
