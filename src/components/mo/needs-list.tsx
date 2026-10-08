import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { NeedsRow } from '@/components/lead/needs-row';
import { TeamSection } from '@/components/lead/team-list';
import { visibleAnalysisJobs } from '@/components/mobilization/analysis-list';
import { AnalysisRow } from '@/components/mobilization/analysis-row';
import { TaskRow } from '@/components/task/task-row';
import { AllClear } from '@/components/ui/empty-state';
import { Spacing } from '@/constants/theme';
import { useCrew, useMyWork, useNeedsMe, useSnapshot } from '@/data/hooks';
import { useMobilizationAnalyses } from '@/data/mobilization-analysis-provider';

/**
 * What's on Mo: their own task and what's queued for them (only when there is one), then everything waiting on Mo,
 * most urgent first. Nothing waiting: "All clear".
 */
export function NeedsList({ analysisId }: { analysisId?: string }) {
  const needs = useNeedsMe();
  const snapshot = useSnapshot();
  const { jobs } = useMobilizationAnalyses();
  const analyses = visibleAnalysisJobs(jobs, snapshot.mobilizations);
  const selected = jobs.find((job) => job.id === analysisId);
  const selectedPlans = new Set(selected?.result?.mobilizationIds ?? []);
  // A freshly tested plan replaces its waiting row at the top, while other urgent work retains its order.
  const waiting = [
    ...needs.filter((item) => item.kind === 'mobilization' && selectedPlans.has(item.mobilization.id)),
    ...needs.filter((item) => item.kind !== 'mobilization' || !selectedPlans.has(item.mobilization.id)),
  ];
  const { active, queue } = useMyWork();
  const { members } = useCrew();
  const yours = active ? [active, ...queue] : queue;
  const onDuty = members.filter((m) => m.volunteer.duty === 'on_duty').length;

  return (
    <View>
      {analyses.length > 0 && (
        <TeamSection title="Situation analysis" count={analyses.length}>
          {analyses.map((job) => <AnalysisRow key={job.id} job={job}
            onPress={() => router.push({ pathname: '/mobilize/simulate', params: { analysis: job.id } })} />)}
        </TeamSection>
      )}
      {yours.length > 0 && (
        <TeamSection title="Yours" count={yours.length}>
          {yours.map((t) => <TaskRow key={t.id} task={t} flat />)}
        </TeamSection>
      )}
      {waiting.length > 0 ? (
        <TeamSection title="Waiting on you" count={waiting.length}>
          {waiting.map((n) => <NeedsRow key={`${n.kind}-${n.kind === 'mobilization' ? n.mobilization.id : n.task.id}`} item={n} />)}
        </TeamSection>
      ) : (
        analyses.length === 0 && <AllClear onDuty={onDuty} style={styles.clear} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clear: { marginTop: Spacing.four },
});
