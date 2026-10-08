import type { Point } from '@/data/venue';
import { initials } from '@/lib/format';
import { placeOf, type Place } from '@/lib/presence';
import type { Position } from '@/lib/schema';
import { zoneSpot, type MapMarker } from './map-model';

/**
 * Where a person is drawn: where their phone says (grey once it has gone quiet), else `beside`, a spot by their zone.
 * `beside` is only asked when there's no live position, so a zoneSpreader hands out its spots in turn.
 */
export function personSpot(
  positions: Record<string, Position> | undefined,
  id: string,
  now: number,
  beside: () => Point | null,
): Place | null {
  const live = placeOf(positions, id, now);
  if (live) return live;
  const at = beside();
  return at ? { at, stale: false } : null;
}

/** Spots around zones handed out in turn, so people sharing a zone fan out. Index 0, the centre, is left for me. */
export function zoneSpreader() {
  const used: Record<string, number> = {};
  return (zone: string | null | undefined): Point | null => {
    if (!zone) return null;
    used[zone] = (used[zone] ?? 0) + 1;
    return zoneSpot(zone, used[zone]);
  };
}

/** A volunteer's dot on the map, with their face (or initials), at `place`. */
export function volunteerMarker(
  v: { id: string; name: string; avatar?: string | null },
  place: Place,
  look: { color: string; onTask?: boolean; needsHelp?: boolean },
): MapMarker {
  return { kind: 'volunteer', id: v.id, at: place.at, stale: place.stale, initials: initials(v.name), face: v.avatar, ...look };
}
