import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Type } from '@/constants/theme';
import type { ProposalCandidate, Team, Volunteer } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/** Someone who could take a task, with why ("free · 120 m · first aid cert"). Busy people are greyed. */
export function CandidateRow({ candidate, volunteer, team, busy, suggested, onPress }: {
  candidate: ProposalCandidate;
  volunteer: Volunteer;
  team?: Team;
  busy: boolean;
  suggested?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${volunteer.name}, ${candidate.rationale}`}
      onPress={() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.lead, busy && styles.dim]}>
        <Avatar name={volunteer.name} color={team?.color} size={32} />
        <View style={styles.body}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {volunteer.name}
            {team && <Text style={[styles.team, { color: theme.textTertiary }]}>  {team.name}</Text>}
          </Text>
          <Text style={[styles.why, { color: theme.textSecondary }]} numberOfLines={1}>{candidate.rationale}</Text>
        </View>
      </View>
      {suggested && <Text style={[styles.tag, { color: theme.tint }]}>Suggested</Text>}
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
