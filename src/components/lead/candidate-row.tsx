import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { haptic } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
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
  const dim = busy && !selected && styles.dim;
  // Its own Pressable (not ListRow's) so a pick reads as a checkbox.
  return (
    <Pressable
      accessibilityRole={picking ? 'checkbox' : 'button'}
      accessibilityState={picking ? { checked: selected } : undefined}
      accessibilityLabel={`${volunteer.name}${busy ? ', busy' : ''}, ${candidate.rationale}`}
      onPress={() => {
        haptic(picking ? 'selection' : 'success');
        onPress();
      }}
      style={({ pressed }) => pressed && { backgroundColor: theme.backgroundSelected }}>
      <ListRow
        leading={<Avatar name={volunteer.name} size={32} style={dim} />}
        trailing={
          <>
            {suggested ? <Chip size="small" tone="tint" label="Suggested" /> : busy ? <Chip size="small" label="Busy" /> : null}
            {picking && (
              selected
                ? <Icon sf="checkmark.circle.fill" md="check_circle" size={22} color={theme.tint} />
                : <Icon sf="circle" md="radio_button_unchecked" size={22} color={theme.textTertiary} />
            )}
          </>
        }>
        <View style={[styles.body, dim]}>
          <Text variant="rowTitle" numberOfLines={1}>
            {volunteer.name}
            {team && <Text variant="footnote" tone="tertiary" style={styles.regular}>  {team.name}</Text>}
          </Text>
          <Text variant="footnote" tone="secondary" numberOfLines={1}>{candidate.rationale}</Text>
        </View>
      </ListRow>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { gap: 2 },
  dim: { opacity: 0.45 },
  regular: { fontWeight: '400' },
});
