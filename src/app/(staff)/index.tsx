import { router } from 'expo-router';
import { Fragment, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { DutyChip, DutyPanel } from '@/components/duty-header';
import { openTaskSheet } from '@/components/lead/open-sheet';
import { TeamMap } from '@/components/lead/team-map';
import { TeamSheet } from '@/components/lead/team-sheet';
import { MAP_BUTTON, MapButton } from '@/components/map/map-button';
import { MapTopBar, useMapLayout } from '@/components/map/map-screen';
import { VenueMap } from '@/components/map/venue-map';
import { TaskDock } from '@/components/task/task-dock';
import { TaskRow } from '@/components/task/task-row';
import { TaskSheet } from '@/components/task/task-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card, Separator } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Segmented } from '@/components/ui/segmented';
import { Type } from '@/constants/theme';
import { NODES, VENUE_ZONES } from '@/data/venue';
import { useInbox, useMe, useMyWork, useNeedsMe, useRepo, useRole, useRouteTo, useSnapshot, useTeam } from '@/data/hooks';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';

/**
 * The whole volunteer app on one screen: the site map, a sheet with my task, and the assistant at the bottom.
 * Leads switch the sheet (and the map) between their own task and their team.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const role = useRole();
  const lead = role === 'team_lead' || role === 'coordinator';
  const needs = useNeedsMe();
  const { unread } = useInbox();
  const { active } = useMyWork();
  const [view, setView] = useState<'me' | 'team'>('me');
  const [duty, setDuty] = useState(false);
  const layout = useMapLayout(lead ? 244 : 200);
  const team = lead && view === 'team';

  return (
    <View style={[styles.screen, { backgroundColor: theme.mapGround }]}>
      {team ? <LeadMap frame={layout.frame} /> : <MyMap task={active} frame={layout.frame} />}

      <MapTopBar
        top={layout.barTop}
        left={<DutyChip open={duty} onToggle={() => setDuty((d) => !d)} />}
        right={<MapButton label="Inbox" sf="tray" md="inbox" badge={unread} onPress={() => router.push('/inbox')} />}
      />

      <BottomSheet
        detents={layout.detents}
        // Free: just the headline, the map gets the screen. A task (or the team view) brings it up.
        stop={team || active ? 1 : 0}
        bottomInset={layout.bottomInset}
        header={
          lead ? (
            <View style={styles.segments}>
              <Segmented
                segments={[{ key: 'me', label: 'My task' }, { key: 'team', label: 'Team', badge: needs.length }]}
                value={view}
                onChange={setView}
              />
            </View>
          ) : undefined
        }>
        {team ? <TeamSheet /> : <MyWork />}
      </BottomSheet>

      <TaskDock />

      {duty && (
        <>
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, styles.scrim]}>
            <Pressable accessibilityLabel="Close shift details" style={styles.flex} onPress={() => setDuty(false)} />
          </Animated.View>
          <DutyPanel style={[styles.duty, { top: layout.barTop + MAP_BUTTON + 8 }]} />
        </>
      )}
    </View>
  );
}

/** Me, and the way to my task. Free: the whole site with me on it. */
function MyMap({ task, frame }: { task: Task | undefined; frame: { top: number; bottom: number } }) {
  const me = useMe();
  const route = useRouteTo(task);
  const accent = usePriorityColors()[task?.priority ?? 'P3'];
  const { width, height } = useWindowDimensions();
  const zone = me?.zoneSlug ? VENUE_ZONES[me.zoneSlug] : undefined;
  return (
    <VenueMap
      route={route}
      me={zone ? NODES[zone.node] : null}
      target={task?.zoneSlug}
      targetColor={accent}
      fit={task ? 'route' : 'site'}
      aspect={width / height}
      frame={frame}
      style={StyleSheet.absoluteFill}
    />
  );
}

function LeadMap({ frame }: { frame: { top: number; bottom: number } }) {
  const theme = useTheme();
  const me = useMe();
  const { team, members, openTasks } = useTeam();
  const { proposals, tasks } = useSnapshot();
  return (
    <TeamMap
      members={members}
      tasks={openTasks}
      color={team?.color ?? theme.tint}
      myZone={me?.zoneSlug ?? null}
      frame={frame}
      onPerson={(id) => router.push({ pathname: '/person/[id]', params: { id } })}
      onTask={(id) => tasks[id] && openTaskSheet(tasks[id], proposals)}
    />
  );
}

function MyWork() {
  const { active, queue, done } = useMyWork();
  return (
    <>
      {active ? <TaskSheet task={active} /> : <Free />}
      {queue.length > 0 && (
        <Group title="Up next" count={queue.length}>
          <TaskList tasks={queue} />
        </Group>
      )}
      {done.length > 0 && <DoneGroup tasks={done} />}
    </>
  );
}

function Free() {
  const theme = useTheme();
  const repo = useRepo();
  const me = useMe();
  const onBreak = me?.duty !== 'on_duty';
  return (
    <View style={styles.free}>
      <Text style={[styles.freeTitle, { color: theme.text }]}>{onBreak ? 'On break' : 'You’re free'}</Text>
      <Text style={[styles.freeBody, { color: theme.textSecondary }]}>
        {onBreak ? 'No new tasks will come to you.' : 'New tasks will be read out to you.'}
      </Text>
      {onBreak && (
        <Button
          label="Back on duty"
          sf="figure.walk"
          variant="tinted"
          color={theme.success}
          onPress={() => repo.setDuty('on_duty')}
          style={styles.freeButton}
        />
      )}
    </View>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <GroupHeader title={title} count={count} />
      {children}
    </View>
  );
}

function GroupHeader({ title, count, trailing }: { title: string; count: number; trailing?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.groupHeader}>
      <Text style={[styles.groupTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.groupCount, { color: theme.textTertiary }]}>{count}</Text>
      {trailing}
    </View>
  );
}

function DoneGroup({ tasks }: { tasks: Task[] }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        hitSlop={8}
        style={({ pressed }) => [styles.toggle, { opacity: pressed ? 0.6 : 1 }]}>
        <GroupHeader
          title="Done this shift"
          count={tasks.length}
          trailing={<Icon sf={open ? 'chevron.up' : 'chevron.down'} md={open ? 'expand_less' : 'expand_more'} size={11} color={theme.textTertiary} weight="semibold" />}
        />
      </Pressable>
      {open && (
        <Animated.View entering={FadeIn.duration(180)}>
          <TaskList tasks={tasks} />
        </Animated.View>
      )}
    </View>
  );
}

function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <Card>
      {tasks.map((t, i) => (
        <Fragment key={t.id}>
          {i > 0 && <Separator inset={34} />}
          <TaskRow task={t} />
        </Fragment>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // The sheet hangs below the screen at its lower stops; on the web that must not make the page scroll.
  screen: { flex: 1, overflow: 'hidden' },
  segments: { paddingHorizontal: 20, paddingBottom: 12 },
  scrim: { backgroundColor: 'rgba(17, 24, 39, 0.06)' },
  duty: { position: 'absolute', left: 16, right: 16 },
  free: { gap: 4 },
  freeTitle: { fontSize: Type.hero, fontWeight: '700', letterSpacing: -0.4 },
  freeBody: { fontSize: Type.callout, lineHeight: 20 },
  freeButton: { alignSelf: 'flex-start', marginTop: 10 },
  group: { gap: 8 },
  toggle: { alignSelf: 'flex-start' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 4 },
  groupTitle: { fontSize: Type.title - 1, fontWeight: '600', letterSpacing: -0.2 },
  groupCount: { fontSize: Type.title - 1, fontWeight: '500', fontVariant: ['tabular-nums'] },
});
