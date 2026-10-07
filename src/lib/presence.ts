import { NODES, VENUE, VENUE_ZONES, type Point } from '@/data/venue';
import type { Position } from '@/lib/schema';

/*
 * Live location, the rules every screen and the server share. A phone sends its position (crew on duty, a
 * festival-goer while someone is coming); everyone else reads it from `presence`. Where nobody has a fresh
 * position, people stand at their zone, as before GPS.
 */

export const PRESENCE = {
  /** Send at most this often while moving... */
  everyMs: 1_000,
  /** ...and only after moving this far. Maps glide between updates, so a second apart reads as walking. */
  afterM: 2,
  /** Standing still: send anyway this often, so the dot doesn't go grey. */
  heartbeatMs: 20_000,
  /** No update for this long: the dot greys and nobody routes from it as if it were live. */
  staleMs: 60_000,
  /** Older than this, it says nothing: back to their zone. */
  goneMs: 10 * 60_000,
  /** A fix vaguer than this (indoors, just woken) isn't worth sending. */
  worstAccuracyM: 75,
} as const;

/** A fix from the phone's GPS, before it's on the plan. */
export type Fix = { lat: number; lng: number; accuracy: number | null; heading: number | null; at: number };

/** Off the site by more than this and the position isn't used: someone testing at home, or GPS gone wrong. */
const OFF_SITE_M = 40;

export function onSite(p: Point): boolean {
  return p.x > -OFF_SITE_M && p.y > -OFF_SITE_M && p.x < VENUE.width + OFF_SITE_M && p.y < VENUE.height + OFF_SITE_M;
}

export type Place = { at: Point; /** No update for a minute: draw it grey. */ stale: boolean };

/** Where someone's phone says they are, if it's recent and on the site. */
export function placeOf(positions: Record<string, Position> | undefined, id: string | null | undefined, now: number): Place | null {
  const p = id ? positions?.[id] : undefined;
  if (!p || now - p.at > PRESENCE.goneMs || !onSite(p)) return null;
  return { at: { x: p.x, y: p.y }, stale: now - p.at > PRESENCE.staleMs };
}

/**
 * Where to route someone from: their live position while it's fresh, else their zone. A stale position isn't
 * used: a route or a "3 min" from where someone was a few minutes ago would look right and be wrong.
 */
export function walkFrom(positions: Record<string, Position> | undefined, id: string | null | undefined, zoneSlug: string | null, now: number): Point | string | null {
  const place = placeOf(positions, id, now);
  return place && !place.stale ? place.at : zoneSlug;
}

/** A festival-goer this far from where they reported is reporting for somewhere else: help goes to the zone, not to them. */
const WITH_IT_M = 60;

/**
 * Where help should walk to: the festival-goer, if their phone puts them at (or near) what they reported, so the
 * route ends where they're standing. Otherwise the zone they reported.
 */
export function meetingPoint(guest: Point | null, zoneSlug: string | null): Point | string | null {
  const zone = zoneSlug ? VENUE_ZONES[zoneSlug] : undefined;
  if (!guest) return zoneSlug;
  if (!zone) return guest;
  const n = NODES[zone.node];
  return Math.hypot(n.x - guest.x, n.y - guest.y) <= WITH_IT_M ? guest : zoneSlug;
}

/** The zone whose landmark is closest, for "Near me". */
export function nearestZone(p: Point): string | null {
  let best: { slug: string; d: number } | null = null;
  for (const z of Object.values(VENUE_ZONES)) {
    const n = NODES[z.node];
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (!best || d < best.d) best = { slug: z.slug, d };
  }
  return best?.slug ?? null;
}

/** Whether a new fix is worth sending: moved far enough, not too soon after the last, or time for a heartbeat. */
export function worthSending(fix: { at: Point; accuracy: number | null; time: number }, last: { at: Point; time: number } | null): boolean {
  if (fix.accuracy != null && fix.accuracy > PRESENCE.worstAccuracyM) return false;
  if (!last) return true;
  const since = fix.time - last.time;
  if (since >= PRESENCE.heartbeatMs) return true;
  return since >= PRESENCE.everyMs && Math.hypot(fix.at.x - last.at.x, fix.at.y - last.at.y) >= PRESENCE.afterM;
}
