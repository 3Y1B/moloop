import { router } from 'expo-router';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Dot } from '@/components/ui/dot';
import { Icon } from '@/components/ui/icon';
import { PressableOpacity } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useNow, useSummary } from '@/data/hooks';
import { ago } from '@/lib/format';
import type { SummaryPoint } from '@/lib/summary';
import { chooseTeam } from '@/lib/team-pill';
import { useTheme } from '@/hooks/use-theme';

/**
 * The shift at a glance (no `taskId`) or one task's story, in a hairline panel: a headline, up to three points that
 * open the task or team they're about, and when it was made. Without the model the server answers with plain counts;
 * those aren't shown, since Tasks has them in its filters and the task page has its timeline, so the card steps aside.
 */
export function SummaryCard({ taskId, style }: { taskId?: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const now = useNow();
  const summary = useSummary(taskId);
  if (summary && !summary.ai) return null;

  return (
    <View style={[styles.panel, { borderColor: theme.border }, style]}>
      <View style={styles.head}>
        <Icon sf="sparkles" md="auto_awesome" size={14} color={theme.tint} weight="medium" />
        <Text variant="callout" tone={summary ? 'primary' : 'tertiary'} style={styles.headline}>
          {summary?.headline ?? (taskId ? 'Summarising this task…' : 'Summarising the shift…')}
        </Text>
      </View>
      {summary?.points.map((p, i) => <Point key={i} point={p} />)}
      {summary && <Text variant="caption" tone="tertiary" style={styles.when}>Updated {ago(summary.at, now)}</Text>}
    </View>
  );
}

/** One point: plain text, or a tap through to its task page or its team on the Crew tab. */
function Point({ point }: { point: SummaryPoint }) {
  const theme = useTheme();
  const open = point.taskId
    ? () => router.push({ pathname: '/task/[id]', params: { id: point.taskId! } })
    : point.teamSlug
      ? () => {
        chooseTeam(point.teamSlug!);
        router.navigate('/crew');
      }
      : undefined;
  const body = (
    <>
      <Dot color={theme.textTertiary} size={4} style={styles.bullet} />
      <Text variant="footnote" tone="secondary" style={styles.point}>{point.text}</Text>
      {open && <Icon sf="chevron.right" md="chevron_right" size={10} color={theme.textTertiary} weight="semibold" />}
    </>
  );
  if (!open) return <View style={styles.row}>{body}</View>;
  return (
    <PressableOpacity accessibilityRole="button" accessibilityLabel={point.text} hitSlop={4} onPress={open} style={styles.row}>
      {body}
    </PressableOpacity>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 6, padding: 12, borderRadius: Radius.control, borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  headline: { flex: 1, lineHeight: 19, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  bullet: { marginLeft: 5 },
  point: { flex: 1, lineHeight: 17 },
  when: { marginTop: Spacing.half },
});
