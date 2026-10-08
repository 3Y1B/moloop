import { StyleSheet, View } from 'react-native';

import { ProgressTrack } from '@/components/ui/progress-track';
import { Text } from '@/components/ui/text';
import type { GuestRequestStage } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

const STEPS = ['Heard', 'Understanding', 'Sorted'] as const;

/** The last step says what's happening now, so it never reads "Sorted" while someone is still walking over. */
const LAST: Partial<Record<GuestRequestStage, string>> = {
  finding: 'Finding someone',
  coming: 'On the way',
  with_you: 'With you',
};

/**
 * Where the request is in the pipeline: route (Heard) → triage (Understanding) → assign until done (Sorted).
 * `reached` is how far a cancelled request got.
 */
function progress(stage: GuestRequestStage, reached: number): { done: number; active: number | null } {
  switch (stage) {
    case 'understanding':
      return { done: 1, active: 1 };
    case 'finding':
    case 'coming':
    case 'with_you':
      return { done: 2, active: 2 };
    case 'answered':
      // Sorted only once they say the answer solved it.
      return { done: 2, active: null };
    case 'sorted':
      return { done: 3, active: null };
    case 'cancelled':
      return { done: reached, active: null };
  }
}

/**
 * The steps as one line in three segments. Done segments are full; the live one fills by `live` (0–1: the walk,
 * or the clock against how long the stage usually takes), so progress moves even when nothing new has happened.
 * `matched`: someone's lined up while the stage is still `finding`. `approving`: a lead has the AI's pick to approve.
 */
export function StepTracker({ stage, reached = 1, matched = false, approving = false, live = 1 }: {
  stage: GuestRequestStage;
  reached?: number;
  matched?: boolean;
  approving?: boolean;
  live?: number;
}) {
  const theme = useTheme();
  const { done, active } = progress(stage, reached);
  const cancelled = stage === 'cancelled';
  const fill = cancelled ? theme.textTertiary : done === STEPS.length ? theme.success : theme.tint;
  const track = cancelled ? theme.border : theme.tintSoft;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${Math.min(done + 1, STEPS.length)} of ${STEPS.length}`}
      style={styles.row}>
      {STEPS.map((s, i) => {
        const state = i === active ? 'active' : i < done ? 'done' : 'pending';
        const finding = stage === 'finding' && (matched ? 'Matched' : approving ? 'Approval' : null);
        const name = i === STEPS.length - 1 ? (finding || (LAST[stage] ?? s)) : s;
        return (
          <View key={s} style={styles.step}>
            <ProgressTrack animated fraction={state === 'done' ? 1 : state === 'active' ? live : 0} color={fill} trackColor={track} />
            <Text
              variant="footnote"
              tone={state === 'pending' ? 'tertiary' : state === 'active' ? 'primary' : 'secondary'}
              numberOfLines={1}
              style={styles.label}>
              {name}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Height of the line and its labels, for sizing the sheet's peek. */
export const STEP_TRACKER_HEIGHT = 28;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  step: { flex: 1, gap: 8 },
  label: { lineHeight: 16 },
});
