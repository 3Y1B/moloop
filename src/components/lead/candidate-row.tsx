import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { Type } from '@/constants/theme';
import type { ProposalCandidate, Team, Volunteer } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/**
 * Someone who could take a task, with why ("free · 120 m · first aid cert"). Busy people are greyed and say so.
 * With `selected` it's one row of a multi-pick: a check on the right, and a tap toggles instead of committing.
 */
export function CandidateRow({ candidate, volunteer, team, busy, suggested, selected, onPress }: {
  candidate: ProposalCandidate;
  volunteer: Volunteer;
  team?: Team;
  busy: boolean;
  suggested?: boolean;
  selected?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const picking = selected !== undefined;
  return (
    <Pressable
      accessibilityRole={picking ? 'checkbox' : 'button'}
      accessibilityState={picking ? { checked: selected } : undefined}
      accessibilityLabel={`${volunteer.name}${busy ? ', busy' : ''}, ${candidate.rationale}`}
      onPress={() => {
        if (picking) Haptics.selectionAsync();
        else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.lead, busy && !selected && styles.dim]}>
        <Avatar name={volunteer.name} color={team?.color} size={32} />
        <View style={styles.body}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {volunteer.name}
            {team && <Text style={[styles.team, { color: theme.textTertiary }]}>  {team.name}</Text>}
          </Text>
          <Text style={[styles.why, { color: theme.textSecondary }]} numberOfLines={1}>{candidate.rationale}</Text>
        </View>
      </View>
      {suggested ? (
        <Text style={[styles.tag, { color: theme.tint }]}>Suggested</Text>
      ) : busy ? (
        <Text style={[styles.tag, { color: theme.textTertiary }]}>Busy</Text>
      ) : null}
      {picking && (
        selected
          ? <Icon sf="checkmark.circle.fill" md="check_circle" size={22} color={theme.tint} />
          : <Icon sf="circle" md="radio_button_unchecked" size={22} color={theme.textTertiary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56 },
  lead: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dim: { opacity: 0.45 },
  body: { flex: 1, gap: 2 },
  name: { fontSize: Type.body - 1, fontWeight: '500' },
  team: { fontSize: Type.footnote - 1, fontWeight: '400' },
  why: { fontSize: Type.footnote - 1 },
  tag: { fontSize: Type.caption, fontWeight: '600' },
});
