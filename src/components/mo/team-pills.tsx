import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useChosenTeam, useLookups, useTeamStats } from '@/data/hooks';
import { chooseTeam } from '@/lib/team-pill';
import type { Team } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/** Bleeds past the page's 20 px gutter so the row scrolls edge to edge but starts in line with the list. */
const GUTTER = 20;

/**
 * All, then one pill per rostered team with how many are on shift. The picked pill takes its team's colour, and the
 * list and the maps follow it.
 */
export function TeamPills() {
  const stats = useTeamStats();
  const chosen = useChosenTeam();
  const { teams } = useLookups();
  const everyone = stats.reduce((n, t) => n + t.onDuty, 0);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.row}>
      <Pill label="All" count={everyone} accessibilityLabel={`Everyone, ${everyone} on duty`} on={chosen === null} onPress={() => chooseTeam(null)} />
      {stats.map((t) => {
        const team = teams[t.slug];
        if (!team) return null;
        return (
          <Pill
            key={t.slug}
            team={team}
            label={team.short}
            count={t.onDuty}
            accessibilityLabel={`${team.name}, ${t.onDuty} on duty`}
            on={chosen === t.slug}
            onPress={() => chooseTeam(chosen === t.slug ? null : t.slug)}
          />
        );
      })}
    </ScrollView>
  );
}

function Pill({ team, label, count, accessibilityLabel, on, onPress }: {
  team?: Team;
  label: string;
  count: number;
  accessibilityLabel: string;
  on: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  // All is the app's own chosen chip; a team wears its colour.
  const accent = team?.color ?? theme.tint;
  const fill = on ? (team ? `${accent}1F` : theme.tintSoft) : theme.backgroundElement;
  const ink = on && !team ? theme.tint : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: fill, borderColor: on ? accent : 'transparent', opacity: pressed ? 0.7 : 1 },
      ]}>
      {team && <Icon sf={team.sf} md={team.md} size={15} color={team.color} weight="medium" />}
      <Text style={[styles.label, { color: ink, fontWeight: on ? '600' : '500' }]}>{label}</Text>
      <Text style={[styles.count, { color: on ? ink : theme.textSecondary }]}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: { marginHorizontal: -GUTTER },
  row: { gap: Spacing.two, paddingHorizontal: GUTTER, paddingTop: Spacing.three - Spacing.one, paddingBottom: Spacing.one },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  label: { fontSize: Type.callout },
  count: { fontSize: Type.callout, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
