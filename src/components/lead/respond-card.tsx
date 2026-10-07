import { StyleSheet, type LayoutChangeEvent } from 'react-native';

import { Card } from '@/components/ui/card';
import { StatusLine } from '@/components/ui/status-line';
import { Text } from '@/components/ui/text';
import { useLookups, useTaskStatus } from '@/data/hooks';
import { POLICY } from '@/lib/lifecycle';
import type { Task } from '@/lib/schema';
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

  return (
    <Card onLayout={onLayout} style={styles.card}>
      {status && (
        <StatusLine
          status={status}
          trailing={
            toMo != null && <Text variant="footnote" tabular style={styles.clock}>Mo in {countdown(toMo)}</Text>
          }
        />
      )}
      <Text variant="hero" style={styles.quote} numberOfLines={4}>
        {e?.reason ? `“${e.reason}”` : task.title}
      </Text>
      {(owner || !!where) && (
        <Text variant="footnote" tone="secondary" numberOfLines={1}>
          {owner && <Text variant="footnote" style={styles.owner}>{owner.name}  </Text>}
          {where}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', top: 16, left: 12, right: 12, padding: 16, gap: 8 },
  clock: { marginLeft: 'auto', fontWeight: '600' },
  // A quote, in their words: large but not bold.
  quote: { lineHeight: 28, fontWeight: '400', letterSpacing: -0.2 },
  owner: { fontWeight: '600' },
});
