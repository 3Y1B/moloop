import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { PRIORITY_LABEL } from '@/lib/format';
import type { Priority, Team } from '@/lib/schema';
import { usePriorityColors } from '@/hooks/use-theme';

/** "P1 · Urgent" in its priority's colour. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  const color = usePriorityColors()[priority];
  return (
    <Chip
      size="small"
      color={color}
      leading={<PrioritySignal priority={priority} size={10} />}
      label={`${priority} · ${PRIORITY_LABEL[priority]}`}
    />
  );
}

const BARS: Record<Priority, number> = { P1: 3, P2: 2, P3: 1 };

/** Signal-strength ramp: three bars for P1, two for P2, one for P3. Unlit bars stay as faint ghosts. */
export function PrioritySignal({ priority, size = 12 }: { priority: Priority; size?: number }) {
  const color = usePriorityColors()[priority];
  const bar = Math.max(2, Math.round(size / 4));
  return (
    <View
      accessibilityLabel={`${priority} ${PRIORITY_LABEL[priority]}`}
      style={[styles.signal, { width: size, height: size, gap: (size - bar * 3) / 2 }]}>
      {[0.45, 0.72, 1].map((h, i) => (
        <View
          key={i}
          style={{
            width: bar,
            height: size * h,
            borderRadius: bar / 2,
            backgroundColor: i < BARS[priority] ? color : `${color}33`,
          }}
        />
      ))}
    </View>
  );
}

export function TeamChip({ team }: { team: Team | undefined }) {
  if (!team) return null;
  return (
    <View style={styles.team}>
      <Icon sf={team.sf} md={team.md} size={13} color={team.color} />
      <Text variant="footnote" tone="secondary" style={styles.teamText} numberOfLines={1}>
        {team.name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  signal: { flexDirection: 'row', alignItems: 'flex-end' },
  team: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  teamText: { fontWeight: '500' },
});
