import { zoneSpot, type MapMarker } from '@/components/map/venue-map';
import { useSnapshot, type TeamMember } from '@/data/hooks';
import { initials } from '@/lib/format';
import { needsResponse } from '@/lib/lifecycle';
import { placeOf } from '@/lib/presence';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

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
 * The team on the site, as map markers: an ink dot per member (ring when on a task, red when they asked for help) and a
 * pin per open task. A member is where their phone says, faded once it has gone quiet; without one they stand at
 * their zone, and markers sharing a zone fan out around it. The screen's one map draws them, so switching to the
 * team doesn't rebuild the map.
 */
export function useTeamMarkers(members: TeamMember[], tasks: Task[]): MapMarker[] {
  const theme = useTheme();
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
    markers.push({ kind: 'volunteer', id: v.id, at, ...personMarker(m, theme), stale: live?.stale });
  }
  return markers;
}
