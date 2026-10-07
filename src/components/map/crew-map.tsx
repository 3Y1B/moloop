import { router } from 'expo-router';
import type { StyleProp, ViewStyle } from 'react-native';

import { openTaskSheet } from '@/components/lead/open-sheet';
import { useMyDot, useSnapshot, type TeamMember } from '@/data/hooks';
import { initials } from '@/lib/format';
import { needsResponse } from '@/lib/lifecycle';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';
import type { MapMarker, VenueMapProps } from './map-model';
import { personSpot, volunteerMarker, zoneSpreader } from './people';
import { VenueMap } from './venue-map';

type Crew = { members: TeamMember[]; openTasks: Task[] };

/**
 * How a person is drawn, on the map and in Mo's crew list. Ink, not team colours: colour means help (red) or a task's
 * priority. Ringed when on a task (owning or helping), grey on a break.
 */
export function personMarker(m: TeamMember, theme: ReturnType<typeof useTheme>) {
  const v = m.volunteer;
  return {
    color: v.duty === 'on_break' ? theme.textTertiary : theme.text,
    initials: initials(v.name),
    onTask: !!m.task || !!m.helping,
    needsHelp: !!m.task && needsResponse(m.task),
  };
}

/**
 * The crew on the site, as map markers: an ink dot per member (ring when on a task, red when they asked for help) and a
 * pin per open task. A member is where their phone says, faded once it has gone quiet; without one they stand at
 * their zone, and markers sharing a zone fan out around it.
 */
function useTeamMarkers(members: TeamMember[], tasks: Task[]): MapMarker[] {
  const theme = useTheme();
  const { positions, now } = useSnapshot();
  const spot = zoneSpreader();

  const markers: MapMarker[] = [];
  for (const t of tasks) {
    const at = spot(t.zoneSlug);
    if (at) markers.push({ kind: 'task', id: t.id, at, priority: t.priority });
  }
  for (const m of members) {
    const v = m.volunteer;
    if (v.duty === 'off_shift') continue;
    const place = personSpot(positions, v.id, now, () => spot(v.zoneSlug));
    if (place) markers.push(volunteerMarker(v, place, personMarker(m, theme)));
  }
  return markers;
}

/**
 * The map's content for a crew (a lead's team, or Mo's pick): the whole site with me, its people and its open tasks.
 * A task opens its sheet, a person theirs. A hook, so a screen with one map can switch to it without rebuilding.
 */
export function useCrewMap({ members, openTasks }: Crew): VenueMapProps {
  const me = useMyDot();
  const { proposals, tasks } = useSnapshot();
  const markers = useTeamMarkers(members, openTasks);
  return {
    route: null,
    me,
    markers,
    fit: 'site',
    onMarkerPress: (m) => {
      if (m.kind === 'task') return tasks[m.id] && openTaskSheet(tasks[m.id], proposals);
      router.push({ pathname: '/person/[id]', params: { id: m.id } });
    },
  };
}

/** A crew on the whole site. */
export function CrewMap({ crew, frame, style }: { crew: Crew; frame?: { top: number; bottom: number }; style?: StyleProp<ViewStyle> }) {
  return <VenueMap {...useCrewMap(crew)} frame={frame} style={style} />;
}
