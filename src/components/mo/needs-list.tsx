import { StyleSheet, View } from 'react-native';

import { NeedsRow } from '@/components/lead/needs-row';
import { TeamSection } from '@/components/lead/team-list';
import { TaskRow } from '@/components/task/task-row';
import { AllClear } from '@/components/ui/empty-state';
import { Spacing } from '@/constants/theme';
import { useCrew, useMyWork, useNeedsMe } from '@/data/hooks';

/**
 * What's on Mo: their own task and what's queued for them (only when there is one), then everything waiting on Mo,
 * most urgent first. Nothing waiting: "All clear".
 */
export function NeedsList() {
  const needs = useNeedsMe();
  const { active, queue } = useMyWork();
  const { members } = useCrew();
  const yours = active ? [active, ...queue] : queue;
  const onDuty = members.filter((m) => m.volunteer.duty === 'on_duty').length;

  return (
    <View>
      {yours.length > 0 && (
        <TeamSection title="Yours" count={yours.length}>
          {yours.map((t) => <TaskRow key={t.id} task={t} flat />)}
        </TeamSection>
      )}
      {needs.length > 0 ? (
        <TeamSection title="Waiting on you" count={needs.length}>
          {needs.map((n) => <NeedsRow key={`${n.kind}-${n.kind === 'mobilization' ? n.mobilization.id : n.task.id}`} item={n} />)}
        </TeamSection>
      ) : (
        <AllClear onDuty={onDuty} style={styles.clear} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clear: { marginTop: Spacing.four },
});
