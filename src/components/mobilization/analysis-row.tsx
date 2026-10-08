import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LoopMark } from '@/components/brand/loop-mark';
import { Brand, Spacing, Type } from '@/constants/theme';
import type { MobilizationAnalysisJob } from '@/data/mobilization-analysis';
import { useTheme } from '@/hooks/use-theme';
import { ANALYSIS_MESSAGE_DURATION_MS, analysisProgressMessage } from './analysis-progress';
import { readableText } from './readable-analysis';

type Props = { job: MobilizationAnalysisJob; peek?: boolean; onPress: () => void };

/** A live analysis occupies the same quiet, flat list space as the proposal it will produce. */
export function AnalysisRow({ job, peek = false, onPress }: Props) {
  const theme = useTheme();
  const running = job.status === 'running';
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!running) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const elapsed = Number.isFinite(job.startedAt) ? Math.max(0, current - job.startedAt) : 0;
      timer = setTimeout(tick, ANALYSIS_MESSAGE_DURATION_MS - (elapsed % ANALYSIS_MESSAGE_DURATION_MS));
    };
    tick();
    return () => clearTimeout(timer);
  }, [running, job.startedAt]);

  const title = readableText(job.title).trim() || 'Situation analysis';
  const configured = job.result?.status === 'configuration_required';
  const decision = job.result?.decision;
  const message = running
    ? job.error ? 'Checking the analysis connection…' : analysisProgressMessage(job.startedAt, now)
    : job.status === 'failed'
      ? configured ? 'Analysis settings need attention' : 'Analysis could not complete'
      : decision === 'no_mobilization'
        ? 'No mobilization needed'
        : decision === 'insufficient_data'
          ? 'More observations needed'
          : 'Response ready';
  const detail = running
    ? now - job.startedAt > 30_000 ? 'Still working — you can keep using the app.' : 'Estimated 30 seconds'
    : job.status === 'failed'
      ? job.error ? readableText(job.error) : configured ? 'Open details to check the setup.' : 'Open details to try again.'
      : decision === 'propose' ? 'Preparing proposals for review' : 'Open details to review the assessment.';
  const statusColor = running ? theme.tint : job.status === 'failed' ? theme.warning : theme.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${message}. ${detail}`}
      accessibilityHint={running
        ? 'Opens analysis details. The activity messages rotate while the analysis runs; they are not live progress measurements.'
        : 'Opens the analysis details.'}
      accessibilityState={{ busy: running }}
      onPress={onPress}
      style={({ pressed }) => [styles.row,
        { borderTopWidth: peek ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.separator },
        pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View accessible={false} style={styles.mark}>
        <LoopMark width={32} color={running ? theme.tint : theme.textSecondary} sparkColor={Brand.mist} spin={running} />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={2} style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Text numberOfLines={2} style={[styles.message, { color: statusColor }]}>{message}</Text>
        <Text numberOfLines={2} style={[styles.detail, { color: theme.textSecondary }]}>{detail}</Text>
      </View>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.open, { color: theme.tint }]}>View</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: Spacing.two },
  mark: { width: 32, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: Spacing.half },
  title: { fontSize: Type.body, lineHeight: 20, fontWeight: '600' },
  message: { fontSize: Type.footnote, lineHeight: 17, fontWeight: '500' },
  detail: { fontSize: Type.caption, lineHeight: 15 },
  open: { fontSize: Type.footnote, fontWeight: '600' },
});
