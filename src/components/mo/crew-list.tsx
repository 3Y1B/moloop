import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { openTaskSheet } from '@/components/lead/open-sheet';
import { TaskProgress } from '@/components/lead/task-head';
import { TeamSection } from '@/components/lead/team-list';
import { PersonRow } from '@/components/people/person-row';
import { PrioritySignal } from '@/components/task/badges';
import { TaskRow } from '@/components/task/task-row';
import { Separator } from '@/components/ui/card';
import { Dot } from '@/components/ui/dot';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { PressableOpacity } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useChosenTeam, useCrew, useLookups, useSnapshot, useTeamStats, type TeamMember, type TeamStat } from '@/data/hooks';
import type { Task, Team, TeamSlug } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/** Under the pills: everyone, team by team, or the one team Mo picked. Then what's still open. */
export function CrewList() {
  const chosen = useChosenTeam();
  const { members, openTasks } = useCrew(chosen);
  const stats = useTeamStats();
  const { teams } = useLookups();
  const stat = chosen ? stats.find((t) => t.slug === chosen) : undefined;
  // Folded teams under All. Kept here, not in each team, so they stay folded while Mo looks at one team and back.
  const [folded, setFolded] = useState<Partial<Record<TeamSlug, boolean>>>({});

  return (
    <View>
      {chosen && stat && teams[chosen] ? (
        <>
          <TeamHead team={teams[chosen]} stat={stat} />
          <TeamSection title="People" count={members.length}>
            {members.map((m) => <CrewRow key={m.volunteer.id} member={m} />)}
          </TeamSection>
        </>
      ) : members.length === 0 ? (
        <EmptyState title="Nobody is rostered yet" style={styles.empty} />
      ) : (
        <>
          {stats.map((t, i) =>
            teams[t.slug] ? (
              <TeamBlock
                key={t.slug}
                team={teams[t.slug]}
                stat={t}
                members={members.filter((m) => m.volunteer.teamSlug === t.slug)}
                first={i === 0}
                open={!folded[t.slug]}
                onToggle={() => setFolded((f) => ({ ...f, [t.slug]: !f[t.slug] }))}
              />
            ) : null,
          )}
          <Unteamed members={members.filter((m) => !m.volunteer.teamSlug)} />
        </>
      )}
      <OpenTasks tasks={openTasks} />
    </View>
  );
}

/** Everyone on shift is busy or on break: nobody left to send. */
const stretched = (stat: TeamStat) => stat.free === 0 && stat.onDuty > 0;

const COUNTS = [
  { key: 'onDuty', sf: 'person.fill', md: 'person', word: 'on duty' },
  { key: 'onTask', sf: 'figure.walk', md: 'directions_walk', word: 'on a task' },
  { key: 'free', sf: 'checkmark.circle.fill', md: 'check_circle', word: 'free' },
  { key: 'onBreak', sf: 'cup.and.saucer.fill', md: 'coffee', word: 'on break' },
] as const;

/**
 * How the shift splits, as icons and numbers: on duty, on a task, free, and on break when anyone is. `compact` (a
 * team's line under All) keeps on a task and free. No one free is the thing to notice, so it's in warning.
 */
function Counts({ stat, compact = false }: { stat: TeamStat; compact?: boolean }) {
  const theme = useTheme();
  const shown = COUNTS.filter((c) => (c.key !== 'onBreak' || stat.onBreak > 0) && (!compact || c.key === 'onTask' || c.key === 'free'));
  const size = compact ? 12 : 14;
  return (
    <View
      accessible
      accessibilityLabel={shown.map((c) => `${stat[c.key]} ${c.word}`).join(', ')}
      style={[styles.counts, compact && styles.compact]}>
      {shown.map((c) => {
        const warn = c.key === 'free' && stretched(stat);
        return (
          <View key={c.key} style={styles.count}>
            <Icon sf={c.sf} md={c.md} size={size} color={warn ? theme.warning : theme.textTertiary} weight="medium" />
            <Text
              variant={compact ? 'footnote' : 'callout'}
              tone={warn ? 'warning' : compact ? 'secondary' : 'primary'}
              tabular
              style={styles.countText}>
              {stat[c.key]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The picked team: its name in its colour's icon, who leads it, and how the shift splits. */
function TeamHead({ team, stat }: { team: Team; stat: TeamStat }) {
  const { volunteers } = useLookups();
  const lead = stat.leadId ? volunteers[stat.leadId] : undefined;
  return (
    <View style={styles.head}>
      <View style={styles.headTitle}>
        <Icon sf={team.sf} md={team.md} size={18} color={team.color} weight="medium" />
        <Text variant="title" accessibilityRole="header" style={styles.shrinkText} numberOfLines={1}>{team.name}</Text>
      </View>
      <View style={styles.headMeta}>
        {lead ? (
          <PressableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Led by ${lead.name}`}
            hitSlop={6}
            onPress={() => router.push({ pathname: '/person/[id]', params: { id: lead.id } })}
            style={styles.shrink}>
            <Text variant="callout" tone="secondary" numberOfLines={1}>
              Led by <Text variant="callout" tone="tint" style={styles.strong}>{lead.name}</Text>
            </Text>
          </PressableOpacity>
        ) : (
          <Text variant="callout" tone="secondary" style={styles.shrink} numberOfLines={1}>No lead: its calls come to you</Text>
        )}
        <Counts stat={stat} />
      </View>
    </View>
  );
}

/**
 * One team under All: its head, then its people. Tapping the head folds the team away; folded, it keeps its counts,
 * and a red dot if someone in it asked for help, so folding never hides that.
 */
function TeamBlock({ team, stat, members, first, open, onToggle }: {
  team: Team;
  /** Sits a full gap under the pills. */
  first: boolean;
  stat: TeamStat;
  members: TeamMember[];
  open: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const urgent = members.some((m) => m.status.tone === 'danger');
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(open ? '0deg' : '-90deg', { duration: 160 }) }] }));
  return (
    // The head never moves when it folds: the gap to the next team comes after the open rows, and a folded team's
    // hairline sits exactly where its first row's would.
    <View style={first ? styles.blockFirst : styles.block}>
      <PressableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${team.name}${!open && urgent ? ', someone asked for help' : ''}`}
        onPress={onToggle}
        style={styles.blockHead}>
        <Animated.View style={chevron}>
          <Icon sf="chevron.down" md="expand_more" size={11} color={theme.textTertiary} weight="semibold" />
        </Animated.View>
        <Icon sf={team.sf} md={team.md} size={15} color={team.color} weight="medium" />
        <Text variant="label" tone="primary" style={styles.shrinkText} numberOfLines={1}>{team.name}</Text>
        {!open && urgent && <Dot color={theme.danger} size={7} />}
        <Counts stat={stat} compact />
      </PressableOpacity>
      {open ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.blockRows}>
          {members.map((m) => <CrewRow key={m.volunteer.id} member={m} />)}
        </Animated.View>
      ) : (
        <Separator bleed />
      )}
    </View>
  );
}

/** Crew with no team (other coordinators), so nobody drops off the list. */
function Unteamed({ members }: { members: TeamMember[] }) {
  if (members.length === 0) return null;
  return (
    <TeamSection title="No team" count={members.length}>
      {members.map((m) => <CrewRow key={m.volunteer.id} member={m} />)}
    </TeamSection>
  );
}

/** A person, with the task they're on as its own button on the right. */
function CrewRow({ member }: { member: TeamMember }) {
  const on = member.task ?? member.helping;
  return <PersonRow member={member} trailing={on && <TaskButton task={on} />} />;
}

/** The task a person is on, as a small button: priority, and a bar for how far through its time it is. */
export function TaskButton({ task }: { task: Task }) {
  const theme = useTheme();
  const { proposals } = useSnapshot();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open task: ${task.title}`}
      hitSlop={8}
      onPress={() => openTaskSheet(task, proposals)}
      style={({ pressed }) => [styles.task, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
      <PrioritySignal priority={task.priority} size={11} />
      {/* No expected time, no bar: the button stays just the priority. */}
      {task.etaAt != null && (
        <View style={styles.meter}>
          <TaskProgress task={task} />
        </View>
      )}
      <Icon sf="chevron.right" md="chevron_right" size={10} color={theme.textTertiary} weight="semibold" />
    </Pressable>
  );
}

function OpenTasks({ tasks }: { tasks: Task[] }) {
  const { proposals } = useSnapshot();
  if (tasks.length === 0) return null;
  return (
    <TeamSection title="Open tasks" count={tasks.length}>
      {tasks.map((t) => <TaskRow key={t.id} task={t} flat zone onPress={() => openTaskSheet(t, proposals)} />)}
    </TeamSection>
  );
}

const styles = StyleSheet.create({
  head: { gap: 6, paddingTop: Spacing.three },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  shrinkText: { flexShrink: 1 },
  strong: { fontWeight: '600' },
  counts: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  compact: { marginLeft: 'auto', gap: 10 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countText: { fontWeight: '600' },
  blockFirst: { marginTop: Spacing.three },
  block: { marginTop: Spacing.one },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  blockRows: { paddingBottom: Spacing.three },
  headMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  shrink: { flex: 1 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 9, borderRadius: Radius.pill },
  meter: { width: 20 },
  empty: { marginTop: Spacing.four },
});
