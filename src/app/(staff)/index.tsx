import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { DemoButton } from '@/components/demo-panel';
import { DutyChip, DutyPanel } from '@/components/duty-header';
import { openTaskSheet } from '@/components/lead/open-sheet';
import { useTeamMarkers } from '@/components/lead/team-map';
import { teamDetents, TeamSheet } from '@/components/lead/team-sheet';
import { MAP_BUTTON, MapButton } from '@/components/map/map-button';
import { MapTopBar, useMapLayout } from '@/components/map/map-screen';
import { VenueMap } from '@/components/map/venue-map';
import { TaskActions } from '@/components/task/task-actions';
import { TaskDock } from '@/components/task/task-dock';
import { FreeSheet, TaskSheet } from '@/components/task/task-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Segmented } from '@/components/ui/segmented';
import { useCrew, useInbox, useMe, useMyDot, useMyWork, useNeedsMe, useReporterPlace, useRole, useRouteTo, useSnapshot, useTeam } from '@/data/hooks';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';

/**
 * The whole volunteer app on one screen: the site map, a sheet with my task, and the assistant at the bottom.
 * Leads switch the sheet (and the map) between their own task and their team.
 */
/** The sheet's grabber row above its content (ui/bottom-sheet: 8 + 5 + 10). */
const GRABBER = 23;

export default function HomeScreen() {
  const theme = useTheme();
  const role = useRole();
  const lead = role === 'team_lead' || role === 'coordinator';
  const needs = useNeedsMe();
  const { unread } = useInbox();
  const { active } = useMyWork();
  const me = useMe();
  const [view, setView] = useState<'me' | 'team'>('me');
  const [duty, setDuty] = useState(false);
  const layout = useMapLayout(lead ? 244 : 200);
  const team = lead && view === 'team';

  // My task: collapsed, the sheet is exactly its head (what, where, the walk); the replies are pinned under the
  // sheet, so its content keeps clear of them too. Heights are measured: titles wrap, a guest's task adds a row.
  const [headerHeight, setHeaderHeight] = useState(0);
  const [headHeight, setHeadHeight] = useState(56);
  const [barHeight, setBarHeight] = useState(80);
  // Open all the way, the log shows everything from the end; "Show earlier" opens it.
  const [sheetAt, setSheetAt] = useState(0);
  const [opened, setOpened] = useState(0);
  const hasBar = !!active || (!!me && me.duty !== 'on_duty');
  const myInset = layout.bottomInset + (hasBar ? barHeight : 0);
  const above = GRABBER + (lead ? headerHeight : 0);
  const [, mid, full] = layout.detents;
  const { height } = useWindowDimensions();
  // A task opens a little past half: the pinned buttons take room, and the latest lines must still show.
  const myMid = Math.min(Math.max(mid, Math.round(height * 0.62)), full);
  const myDetents = [Math.min(myInset + above + headHeight, myMid), myMid, full];
  const detents = team ? teamDetents(layout) : myDetents;
  // Free: just the headline, the map gets the screen. A task brings it up. The team view rests on its peek.
  const stop = !team && active ? 1 : 0;
  // The map frames its subject in what the sheet leaves clear where it rests.
  const frame = { top: layout.frame.top, bottom: detents[stop] / height };

  return (
    <View style={[styles.screen, { backgroundColor: theme.mapGround }]}>
      <HomeMap team={team} task={active} frame={frame} />

      <MapTopBar
        top={layout.barTop}
        left={<DutyChip open={duty} onToggle={() => setDuty((d) => !d)} />}
        right={
          <>
            <DemoButton />
            <MapButton label="Inbox" sf="tray" md="inbox" badge={unread} onPress={() => router.push('/inbox')} />
          </>
        }
      />

      <BottomSheet
        detents={detents}
        stop={stop}
        raise={opened}
        stickToEnd={!team}
        onStopChange={setSheetAt}
        bottomInset={team ? layout.bottomInset : myInset}
        header={
          lead ? (
            <View style={styles.segments} onLayout={(e) => setHeaderHeight(Math.ceil(e.nativeEvent.layout.height))}>
              <Segmented
                segments={[{ key: 'me', label: 'My task' }, { key: 'team', label: 'Team', badge: needs.length }]}
                value={view}
                onChange={setView}
              />
            </View>
          ) : undefined
        }>
        {team ? <TeamSheet /> : (
          <MyWork
            onHeadLayout={setHeadHeight}
            minHeight={Math.max(0, myMid - myInset - above - 12)}
            expanded={sheetAt === detents.length - 1}
            onExpand={() => setOpened((n) => n + 1)}
          />
        )}
      </BottomSheet>

      {!team && <TaskActions onHeight={setBarHeight} />}
      <TaskDock />

      {duty && (
        <>
          {/* Tap anywhere outside the panel to close it. */}
          <Pressable accessibilityLabel="Close shift details" style={StyleSheet.absoluteFill} onPress={() => setDuty(false)} />
          <DutyPanel style={[styles.duty, { top: layout.barTop + MAP_BUTTON + 8 }]} />
        </>
      )}
    </View>
  );
}

/**
 * One map for both views, so switching to the team doesn't rebuild it. Mine: me, and the way to my task (free: the
 * whole site with me on it). Team: a lead's team, or for Mo the whole crew, live on the site.
 */
function HomeMap({ team, task, frame }: { team: boolean; task: Task | undefined; frame: { top: number; bottom: number } }) {
  const me = useMyDot();
  const reporter = useReporterPlace(task);
  const route = useRouteTo(task);
  const accent = usePriorityColors()[task?.priority ?? 'P3'];
  const role = useRole();
  const mine = useTeam();
  const crew = useCrew();
  const everyone = role === 'coordinator';
  const { proposals, tasks } = useSnapshot();
  const crewMarkers = useTeamMarkers(
    everyone ? crew.members : mine.members,
    everyone ? crew.openTasks : mine.openTasks,
  );
  if (team) {
    return (
      <VenueMap
        route={null}
        me={me}
        markers={crewMarkers}
        onMarkerPress={(m) => {
          if (m.kind === 'task') return tasks[m.id] && openTaskSheet(tasks[m.id], proposals);
          router.push({ pathname: '/person/[id]', params: { id: m.id } });
        }}
        fit="site"
        frame={frame}
        style={StyleSheet.absoluteFill}
      />
    );
  }
  return (
    <VenueMap
      route={route}
      me={me}
      target={task?.zoneSlug}
      targetColor={accent}
      markers={reporter ? [{ kind: 'person', id: 'reporter', at: reporter, color: accent }] : undefined}
      fit={task ? 'route' : 'site'}
      frame={frame}
      style={StyleSheet.absoluteFill}
    />
  );
}

/** My task as a log, or (free) my shift so far. */
function MyWork(props: { onHeadLayout: (height: number) => void; minHeight: number; expanded: boolean; onExpand: () => void }) {
  const { active, done } = useMyWork();
  return active ? <TaskSheet task={active} {...props} /> : <FreeSheet done={done} {...props} />;
}

const styles = StyleSheet.create({
  // The sheet hangs below the screen at its lower stops; on the web that must not make the page scroll.
  screen: { flex: 1, overflow: 'hidden' },
  segments: { paddingHorizontal: 20, paddingBottom: 12 },
  duty: { position: 'absolute', left: 16, right: 16 },
});
