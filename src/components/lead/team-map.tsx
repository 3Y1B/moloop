import { StyleSheet } from 'react-native';

import { VenueMap, zoneSpot, type MapMarker } from '@/components/map/venue-map';
import { NODES, VENUE_ZONES } from '@/data/venue';
import type { TeamMember } from '@/data/hooks';
import { initials } from '@/lib/format';
import { needsResponse } from '@/lib/lifecycle';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/**
 * The whole site with the team on it: a dot per member (ring when on a task, red when they asked for help),
 * a pin per open task, and me. Full-bleed behind the sheet; markers sharing a zone fan out around it.
 */
export function TeamMap({ members, tasks, color, myZone, frame, onPerson, onTask }: {
  members: TeamMember[];
  tasks: Task[];
  /** Team colour for the dots. */
  color: string;
  myZone: string | null;
  frame: { top: number; bottom: number };
  onPerson: (volunteerId: string) => void;
  onTask: (taskId: string) => void;
}) {
  const theme = useTheme();

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
    if (m.volunteer.duty === 'off_shift') continue;
    const at = spot(m.volunteer.zoneSlug);
    if (!at) continue;
    markers.push({
      kind: 'volunteer',
      id: m.volunteer.id,
      at,
      color: m.volunteer.duty === 'on_break' ? theme.textTertiary : color,
      initials: initials(m.volunteer.name),
      onTask: !!m.task || !!m.helping,
      needsHelp: !!m.task && needsResponse(m.task),
    });
  }

  const mine = myZone ? VENUE_ZONES[myZone] : undefined;
  return (
    <VenueMap
      route={null}
      me={mine ? NODES[mine.node] : null}
      markers={markers}
      onMarkerPress={(m) => (m.kind === 'task' ? onTask(m.id) : onPerson(m.id))}
      fit="site"
      frame={frame}
      style={StyleSheet.absoluteFill}
    />
  );
}
