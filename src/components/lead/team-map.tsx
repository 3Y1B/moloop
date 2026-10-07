import { StyleSheet } from 'react-native';

import { VenueMap, zoneSpot, type MapMarker } from '@/components/map/venue-map';
import type { Point } from '@/data/venue';
import { useLookups, useSnapshot, type TeamMember } from '@/data/hooks';
import { initials } from '@/lib/format';
import { needsResponse } from '@/lib/lifecycle';
import { placeOf } from '@/lib/presence';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/**
 * The whole site with the team on it: a dot per member (ring when on a task, red when they asked for help),
 * a pin per open task, and me. Full-bleed behind the sheet. A member is where their phone says, faded once it
 * has gone quiet; without one they stand at their zone, and markers sharing a zone fan out around it.
 */
export function TeamMap({ members, tasks, color, me, frame, onPerson, onTask }: {
  members: TeamMember[];
  tasks: Task[];
  /** Dot colour for anyone without a team colour of their own. */
  color: string;
  me: Point | null;
  frame: { top: number; bottom: number };
  onPerson: (volunteerId: string) => void;
  onTask: (taskId: string) => void;
}) {
  const theme = useTheme();
  const { teams } = useLookups();
  const { positions, now } = useSnapshot();

  // Index 0 is the zone's centre, where I'm drawn; everyone else spreads around it.
  const used: Record<string, number> = {};
  const spot = (zone: string | null) => {
    if (!zone) return null;
    used[zone] = (used[zone] ?? 0) + 1;
    return zoneSpot(zone, used[zone]);
  };

  const markers: MapMarker[] = [];
  for (const t of tasks) {
    const at = spot(t.zoneSlug);
    if (at) markers.push({ kind: 'task', id: t.id, at, priority: t.priority });
  }
  for (const m of members) {
    const v = m.volunteer;
    if (v.duty === 'off_shift') continue;
    const live = placeOf(positions, v.id, now);
    const at = live?.at ?? spot(v.zoneSlug);
    if (!at) continue;
    markers.push({
      kind: 'volunteer',
      id: v.id,
      at,
      color: v.duty === 'on_break' ? theme.textTertiary : (v.teamSlug && teams[v.teamSlug]?.color) || color,
      initials: initials(v.name),
      onTask: !!m.task || !!m.helping,
      needsHelp: !!m.task && needsResponse(m.task),
      stale: live?.stale,
    });
  }

  return (
    <VenueMap
      route={null}
      me={me}
      markers={markers}
      onMarkerPress={(m) => (m.kind === 'task' ? onTask(m.id) : onPerson(m.id))}
      fit="site"
      frame={frame}
      style={StyleSheet.absoluteFill}
    />
  );
}
