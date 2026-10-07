import { StyleSheet, View } from 'react-native';

import { PriorityBadge, PrioritySignal } from '@/components/task/badges';
import { Icon } from '@/components/ui/icon';
import { ProgressTrack } from '@/components/ui/progress-track';
import { StatusLine } from '@/components/ui/status-line';
import { Text } from '@/components/ui/text';
import { useLookups, useNow, useTaskStatus } from '@/data/hooks';
import { ago } from '@/lib/format';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The top of a sheet about a task: priority and how long ago, the title, where, and the status line as I see it.
 * `align="center"` is the Approve sheet's: priority, then where and when on one line, the title large, no status
 * (the sheet says who got it).
 */
export function TaskHead({ task, align = 'left' }: { task: Task; align?: 'left' | 'center' }) {
  const now = useNow();
  const accent = usePriorityColors()[task.priority];
  const { zones } = useLookups();
  const line = useTaskStatus(task);
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : null;
  const when = ago(task.createdAt, now);

  if (align === 'center') {
    const where = task.locationHint ? cap(task.locationHint) : zone;
    return (
      <View style={[styles.wrap, styles.center]}>
        <View style={styles.centerTop}>
          <PriorityBadge priority={task.priority} />
          <Text variant="meta" style={styles.shrink} numberOfLines={1}>{[where, when].filter(Boolean).join(' · ')}</Text>
        </View>
        <Text variant="hero" style={styles.centered}>{task.title}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <PriorityBadge priority={task.priority} />
        <Text variant="meta" tone="tertiary" style={styles.shrink} numberOfLines={1}>{when}</Text>
      </View>
      <Text variant="title">{task.title}</Text>
      {zone && (
        <View style={styles.location}>
          <Icon sf="mappin" md="location_on" size={13} color={accent} />
          <Text variant="footnote" style={styles.zone} numberOfLines={1}>
            {zone}
            {task.locationHint && <Text variant="footnote" tone="secondary" style={styles.regular}> · {task.locationHint}</Text>}
          </Text>
        </View>
      )}
      {line && <StatusLine status={line} />}
    </View>
  );
}

/** One line about a task, under a sheet title: priority, what, where. */
export function TaskLine({ task }: { task: Task }) {
  const { zones } = useLookups();
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : null;
  return (
    <View style={styles.line}>
      <PrioritySignal priority={task.priority} size={12} />
      <Text variant="callout" tone="secondary" style={styles.flex} numberOfLines={1}>
        <Text variant="callout" style={styles.medium}>{task.title}</Text>
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
  const p = Math.max(0.04, (now - start) / (task.etaAt - start));
  return <ProgressTrack fraction={p} color={now > task.etaAt ? theme.warning : undefined} />;
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  center: { alignItems: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  centerTop: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  shrink: { flexShrink: 1 },
  centered: { textAlign: 'center' },
  location: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  zone: { flex: 1, fontWeight: '500' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  medium: { fontWeight: '500' },
  regular: { fontWeight: '400' },
});
