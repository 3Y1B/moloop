import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { Radius, Type } from '@/constants/theme';
import { useLookups, useTaskStatus } from '@/data/hooks';
import { POLICY } from '@/lib/lifecycle';
import type { Task } from '@/lib/schema';
import { toneColor, useTheme } from '@/hooks/use-theme';
import { useLiveNow } from './use-live-now';

/** "0:15". */
const countdown = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Floats over the top of the Respond map: the status (red while they've asked for help), when it goes up to Mo,
 * what they said (or the task, if they went quiet), then who and where.
 */
export function RespondCard({ task, onLayout }: { task: Task; onLayout?: (e: LayoutChangeEvent) => void }) {
  const theme = useTheme();
  const status = useTaskStatus(task);
  const { volunteers, zones } = useLookups();
  const now = useLiveNow();

  const owner = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  const zone = task.zoneSlug ? zones[task.zoneSlug]?.name : null;
  const hint = task.locationHint && task.locationHint.toLowerCase() !== zone?.toLowerCase() ? task.locationHint : null;
  const where = [zone, hint].filter(Boolean).join(' · ');
  const e = task.escalation;
  const counting = task.status === 'escalated' && !!e && e.level === 'lead' && !e.response;
  const toMo = counting ? Math.max(0, POLICY.bumpToCoordinatorMs[task.priority] - (now - e.at)) : null;
  const tone = status ? toneColor(theme, status.tone) : theme.textSecondary;

  return (
    <View onLayout={onLayout} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      {status && (
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: tone }]} />
          <Text style={[styles.status, { color: tone }]} numberOfLines={1}>
            {status.label}
            {status.detail && <Text style={{ color: theme.textSecondary, fontWeight: '400' }}> · {status.detail}</Text>}
          </Text>
          {toMo != null && <Text style={[styles.clock, { color: theme.text }]}>Mo in {countdown(toMo)}</Text>}
        </View>
      )}
      <Text style={[styles.quote, { color: theme.text }]} numberOfLines={4}>
        {e?.reason ? `“${e.reason}”` : task.title}
      </Text>
      {(owner || !!where) && (
        <Text style={[styles.who, { color: theme.textSecondary }]} numberOfLines={1}>
          {owner && <Text style={{ color: theme.text, fontWeight: '600' }}>{owner.name}  </Text>}
          {where}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 16,
    left: 12,
    right: 12,
    padding: 16,
    gap: 8,
    borderRadius: Radius.card,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  status: { flex: 1, fontSize: Type.footnote, fontWeight: '600' },
  clock: { fontSize: Type.footnote, fontWeight: '600', fontVariant: ['tabular-nums'] },
  quote: { fontSize: Type.hero, lineHeight: 28, letterSpacing: -0.2 },
  who: { fontSize: Type.footnote },
});
