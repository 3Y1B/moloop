import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { PRIORITY_LABEL } from '@/lib/format';
import type { Priority, Team } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';

export function PriorityBadge({ priority }: { priority: Priority }) {
  const color = usePriorityColors()[priority];
  return (
    <View style={[styles.capsule, { backgroundColor: `${color}1A` }]}>
      <PrioritySignal priority={priority} size={10} />
      <Text style={[styles.capsuleText, { color }]}>
        {priority} · {PRIORITY_LABEL[priority]}
      </Text>
    </View>
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
  const theme = useTheme();
  if (!team) return null;
  return (
    <View style={styles.team}>
      <Icon sf={team.sf} md={team.md} size={13} color={team.color} />
      <Text style={[styles.teamText, { color: theme.textSecondary }]} numberOfLines={1}>
        {team.name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  capsule: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 22, borderRadius: Radius.pill },
  signal: { flexDirection: 'row', alignItems: 'flex-end' },
  capsuleText: { fontSize: Type.caption - 1, fontWeight: '600' },
  team: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  teamText: { fontSize: Type.footnote, fontWeight: '500' },
});
