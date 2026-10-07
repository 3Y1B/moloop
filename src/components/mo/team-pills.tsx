import { ScrollView, StyleSheet } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Shadow, Spacing } from '@/constants/theme';
import { useChosenTeam, useLookups, useTeamStats } from '@/data/hooks';
import { chooseTeam } from '@/lib/team-pill';
import { useTheme } from '@/hooks/use-theme';

/** Bleeds past the page's 20 px gutter so the row scrolls edge to edge but starts in line with the list. */
const GUTTER = 20;

/**
 * All, then one pill per rostered team with how many are on shift. The picked pill takes its team's colour, and the
 * list and the maps follow it. `overMap`: the same pills floating over the map, on solid fills with the map controls'
 * lift (a picked one keeps its colour in a border, since a wash would let the plan show through), scrolling from the
 * screen's 16 px edge.
 */
export function TeamPills({ overMap = false }: { overMap?: boolean }) {
  const theme = useTheme();
  const stats = useTeamStats();
  const chosen = useChosenTeam();
  const { teams } = useLookups();
  const everyone = stats.reduce((n, t) => n + t.onDuty, 0);
  const lift = (on: boolean, accent: string) =>
    overMap ? [Shadow.floating, styles.solid, { backgroundColor: theme.card }, on && { borderColor: accent }] : undefined;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={overMap ? undefined : styles.strip}
      contentContainerStyle={[styles.row, overMap && styles.rowOverMap]}>
      <Chip
        label="All"
        count={everyone}
        accessibilityLabel={`Everyone, ${everyone} on duty`}
        selected={chosen === null}
        onPress={() => chooseTeam(null)}
        style={lift(chosen === null, theme.tint)}
      />
      {stats.map((t) => {
        const team = teams[t.slug];
        if (!team) return null;
        const on = chosen === t.slug;
        return (
          <Chip
            key={t.slug}
            sf={team.sf}
            md={team.md}
            color={team.color}
            label={team.short}
            count={t.onDuty}
            accessibilityLabel={`${team.name}, ${t.onDuty} on duty`}
            selected={on}
            onPress={() => chooseTeam(on ? null : t.slug)}
            style={lift(on, team.color)}
          />
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { marginHorizontal: -GUTTER },
  row: { gap: Spacing.two, paddingHorizontal: GUTTER, paddingTop: Spacing.three - Spacing.one, paddingBottom: Spacing.one },
  // Room around the pills for their lift.
  rowOverMap: { paddingHorizontal: 16, paddingTop: Spacing.one, paddingBottom: Spacing.three },
  solid: { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: 'transparent' },
});
