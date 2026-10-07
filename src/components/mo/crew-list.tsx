import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { OpenTaskRow } from '@/components/lead/open-task-row';
import { openTaskSheet } from '@/components/lead/open-sheet';
import { TaskProgress } from '@/components/lead/task-head';
import { TeamRow, TeamSection } from '@/components/lead/team-list';
import { PrioritySignal } from '@/components/task/badges';
import { Icon } from '@/components/ui/icon';
import { StatusLine } from '@/components/ui/status-line';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useChosenTeam, useCrew, useLookups, useSnapshot, useTeamStats, type TeamMember, type TeamStat } from '@/data/hooks';
import type { Task, Team, TeamSlug } from '@/lib/schema';
import type { Status } from '@/lib/status';
import { personMarker } from '@/components/lead/team-map';
import { Dot } from '@/components/map/map-markers';
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
        <Empty text="Nobody is rostered yet" />
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
        const color = c.key === 'free' && stretched(stat) ? theme.warning : undefined;
        return (
          <View key={c.key} style={styles.count}>
            <Icon sf={c.sf} md={c.md} size={size} color={color ?? theme.textTertiary} weight="medium" />
            <Text style={[styles.countText, { fontSize: compact ? Type.footnote : Type.callout, color: color ?? (compact ? theme.textSecondary : theme.text) }]}>
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
  const theme = useTheme();
  const { volunteers } = useLookups();
  const lead = stat.leadId ? volunteers[stat.leadId] : undefined;
  return (
    <View style={styles.head}>
      <View style={styles.headTitle}>
        <Icon sf={team.sf} md={team.md} size={18} color={team.color} weight="medium" />
        <Text accessibilityRole="header" style={[styles.teamName, { color: theme.text }]} numberOfLines={1}>{team.name}</Text>
      </View>
      <View style={styles.headMeta}>
        {lead ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Led by ${lead.name}`}
            hitSlop={6}
            onPress={() => router.push({ pathname: '/person/[id]', params: { id: lead.id } })}
            style={({ pressed }) => [styles.shrink, { opacity: pressed ? 0.6 : 1 }]}>
            <Text style={[styles.lead, { color: theme.textSecondary }]} numberOfLines={1}>
              Led by <Text style={{ color: theme.tint, fontWeight: '600' }}>{lead.name}</Text>
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.lead, styles.shrink, { color: theme.textSecondary }]} numberOfLines={1}>No lead: its calls come to you</Text>
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
  /** Keeps its full gap under the pills even when folded. */
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
    <View style={[styles.block, !open && !first && styles.blockFolded]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${team.name}${!open && urgent ? ', someone asked for help' : ''}`}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.blockHead,
          !open && [styles.headFolded, { borderBottomColor: theme.separator }],
          { opacity: pressed ? 0.6 : 1 },
        ]}>
        <Animated.View style={chevron}>
          <Icon sf="chevron.down" md="expand_more" size={11} color={theme.textTertiary} weight="semibold" />
        </Animated.View>
        <Icon sf={team.sf} md={team.md} size={15} color={team.color} weight="medium" />
        <Text style={[styles.blockTitle, { color: theme.text }]} numberOfLines={1}>{team.name}</Text>
        {!open && urgent && <View style={[styles.urgent, { backgroundColor: theme.danger }]} />}
        <Counts stat={stat} compact />
      </Pressable>
      {open && (
        <Animated.View entering={FadeIn.duration(160)}>
          {members.map((m) => <CrewRow key={m.volunteer.id} member={m} />)}
        </Animated.View>
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

/**
 * A person in one line pair: their map dot, name, and where they stand. The task they're on sits on the right as a
 * small button (priority and how far through its time) that opens it; the rest of the row opens the person. Two
 * buttons side by side, not one inside the other (a button can't hold a button).
 */
function CrewRow({ member }: { member: TeamMember }) {
  const theme = useTheme();
  const { volunteer: v, status } = member;
  const on = member.task ?? member.helping;
  const off = v.duty === 'off_shift';
  // A plain "Lost child · 6 min" already names the task; asked for help, quiet and helping say which task after.
  const line: Status = on && status.tone !== 'neutral' ? { ...status, detail: on.title } : status;
  const dot = personMarker(member, theme);
  return (
    <TeamRow>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${v.name}, ${status.label}`}
        onPress={() => router.push({ pathname: '/person/[id]', params: { id: v.id } })}
        style={({ pressed }) => [styles.person, { opacity: pressed ? 0.6 : 1 }]}>
        {/* As on the map: red when they asked for help, ringed while on a task, faded off shift. */}
        <Dot color={dot.needsHelp ? theme.danger : dot.color} initials={dot.initials} ring={dot.onTask || dot.needsHelp} stale={off} />
        <View style={styles.text}>
          <Text style={[styles.name, { color: off ? theme.textTertiary : theme.text }]} numberOfLines={1}>{v.name}</Text>
          <StatusLine status={line} />
        </View>
      </Pressable>
      {on && <TaskButton task={on} />}
    </TeamRow>
  );
}

/** The task a person is on, as a small button: priority, and a bar for how far through its time it is. */
function TaskButton({ task }: { task: Task }) {
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
      {tasks.map((t) => <OpenTaskRow key={t.id} task={t} flat onPress={() => openTaskSheet(t, proposals)} />)}
    </TeamSection>
  );
}

function Empty({ text }: { text: string }) {
  const theme = useTheme();
  return <Text style={[styles.empty, { color: theme.textSecondary }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  head: { gap: 6, paddingTop: Spacing.three },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  teamName: { flexShrink: 1, fontSize: Type.title, lineHeight: 23, fontWeight: '600', letterSpacing: -0.2 },
  lead: { fontSize: Type.callout },
  counts: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  compact: { marginLeft: 'auto', gap: 10 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countText: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  block: { marginTop: Spacing.four },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.one, minHeight: 28 },
  blockTitle: { flexShrink: 1, fontSize: Type.footnote, fontWeight: '600' },
  urgent: { width: 7, height: 7, borderRadius: 3.5 },
  // Folded, a team is one line in a list of lines: closer together, with a hairline under each.
  blockFolded: { marginTop: Spacing.two },
  headFolded: { marginBottom: 0, paddingBottom: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  headMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  shrink: { flex: 1 },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, gap: 1 },
  name: { fontSize: Type.body, fontWeight: '500' },
  task: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 9, borderRadius: Radius.pill },
  meter: { width: 20 },
  empty: { marginTop: Spacing.four, fontSize: Type.callout },
});
