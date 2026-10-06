import { StyleSheet, useWindowDimensions } from 'react-native';

import { VenueMap, zoneSpot, type MapMarker } from '@/components/map/venue-map';
import type { Point } from '@/data/venue';
import { useLookups, useNow, type RequestView } from '@/data/hooks';
import { initials } from '@/lib/format';
import { routeBetween, type Route } from '@/lib/route';
import { useTheme } from '@/hooks/use-theme';

/** The point a fraction `t` of the way along a polyline, and the index of the next vertex after it. */
function along(points: Point[], t: number): { at: Point; next: number } {
  const legs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = Math.min(1, Math.max(0, t)) * legs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i] && legs[i] > 0) {
      const f = left / legs[i];
      const a = points[i], b = points[i + 1];
      return { at: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, next: i + 1 };
    }
    left -= legs[i];
  }
  return { at: points[points.length - 1], next: points.length };
}

/**
 * Both dots: the festival-goer, and whoever is coming, walking the route toward them.
 * Full-bleed behind the sheet. Until GPS lands, the volunteer's dot is placed by time: how far into their walk they should be.
 */
export function RequestMap({ view, frame }: { view: RequestView; frame: { top: number; bottom: number } }) {
  const theme = useTheme();
  const now = useNow();
  const { teams } = useLookups();
  const { width, height } = useWindowDimensions();
  const { request, task, status, volunteer } = view;

  const zone = request.zoneSlug ?? task?.zoneSlug ?? null;
  const here = zoneSpot(zone);
  if (!here) return <VenueMap route={null} me={null} fit="site" aspect={width / height} frame={frame} style={StyleSheet.absoluteFill} />;

  const markers: MapMarker[] = [];
  let route: Route | null = null;

  if (volunteer) {
    const color = (volunteer.teamSlug && teams[volunteer.teamSlug]?.color) || theme.tint;
    const walk = status.stage === 'coming' && status.arriveAt ? routeBetween(volunteer.zoneSlug, zone) : null;
    let at = zoneSpot(zone, 1) ?? here;
    if (walk && walk.points.length > 1) {
      const start = task?.assignedAt ?? task?.createdAt ?? now;
      const span = (status.arriveAt ?? now) - start;
      const p = along(walk.points, span > 0 ? (now - start) / span : 1);
      at = p.at;
      route = { ...walk, points: [p.at, ...walk.points.slice(p.next)] };
    }
    markers.push({ kind: 'volunteer', id: volunteer.id, at, color, initials: initials(volunteer.name), onTask: true });
  }
  markers.push({ kind: 'person', id: 'me', at: here, color: theme.tint });

  return (
    <VenueMap route={route} me={null} markers={markers} fit="route" aspect={width / height} frame={frame} style={StyleSheet.absoluteFill} />
  );
}
