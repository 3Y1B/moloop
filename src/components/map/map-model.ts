import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { StyleProp, ViewStyle } from 'react-native';

import { GEO, NODES, VENUE, VENUE_ZONES, toLngLat, toPlan, type Point } from '@/data/venue';
import type { Route } from '@/lib/route';
import type { Priority } from '@/lib/schema';
import { zoneFootprint } from './map-art';

/*
 * What the venue map shows and where the camera goes, shared by the native and web maps.
 * Everything is worked out in plan metres (see data/venue.ts) and only turned into lng/lat at the end.
 */

export type MapPerson = { id: string; initials: string; face?: string | null; color: string; at: Point };

/**
 * Things drawn on top of the site plan for leads and festival-goers.
 *  - volunteer: team-coloured dot, a ring when on a task, red when they asked for help, faded when their GPS has gone quiet
 *  - task: a pin in its priority colour
 *  - person: someone who isn't a volunteer, e.g. the festival-goer at the end of a two-person route
 * For a two-person route (volunteer → reporter), pass `route` plus a volunteer and a person marker, and `me={null}`.
 */
export type MapMarker =
  | { kind: 'volunteer'; id: string; at: Point; color: string; initials?: string; face?: string | null; onTask?: boolean; needsHelp?: boolean; stale?: boolean }
  | { kind: 'task'; id: string; at: Point; priority: Priority }
  | { kind: 'person'; id: string; at: Point; color: string; initials?: string };

export type VenueMapProps = {
  route: Route | null;
  /** Where I am (start of route, or my zone when there is no route). */
  me: Point | null;
  /** Destination zone slug, highlighted with a pin. */
  target?: string | null;
  targetColor?: string;
  /** Teammates to show as small faces (initials when they have none). */
  people?: MapPerson[];
  /** Volunteers, task pins and people (see MapMarker). */
  markers?: MapMarker[];
  onMarkerPress?: (marker: MapMarker) => void;
  /** Zoom to the route (cards) or show the whole site (navigation). */
  fit?: 'route' | 'site';
  /**
   * Fractions of the height covered by things floating over the map (top controls, a bottom sheet).
   * What's being framed is centred in the part that's left.
   */
  frame?: { top: number; bottom: number };
  /** Pan and zoom. Off for thumbnails, which are tapped as a whole. */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** On-screen sizes, in points. */
export const DOT = 22;
export const PIN = { w: 26, h: 32 } as const;

/** A spot near a zone's path node, spread around it so several markers in one zone don't stack. */
export function zoneSpot(zoneSlug: string | null, index = 0): Point | null {
  const zone = zoneSlug ? VENUE_ZONES[zoneSlug] : undefined;
  if (!zone) return null;
  const n = NODES[zone.node];
  if (index === 0) return { x: n.x, y: n.y };
  const angle = (index - 1) * 2.4; // golden-ish angle: no two neighbours line up
  const r = 6 + 3 * Math.floor((index - 1) / 6);
  return { x: n.x + Math.cos(angle) * r, y: n.y + Math.sin(angle) * r };
}

export type Box = { x: number; y: number; w: number; h: number };
export type Camera = { center: [number, number]; zoom: number; bearing: number };

/** The plan box to show, in metres: the route and markers, or the whole site, clear of whatever floats over the map. */
export function frameBox(p: VenueMapProps, size: { width: number; height: number }): Box {
  const dest = p.target ? VENUE_ZONES[p.target] : undefined;
  const points =
    p.fit === 'site'
      ? []
      : [...(p.route?.points ?? []), ...(p.me ? [p.me] : []), ...(dest ? [NODES[dest.node]] : []), ...(p.markers ?? []).map((m) => m.at)];
  const covered = (p.frame?.top ?? 0) + (p.frame?.bottom ?? 0);
  return framed(viewBoxFor(points, size.width / size.height / (1 - covered)), p.frame);
}

/** Camera for a plan box filling a view `width` points wide. The plan's up is screen up. */
export function cameraFor(box: Box, width: number): Camera {
  const metresPerPoint = box.w / width;
  const lat = toLngLat({ x: box.x + box.w / 2, y: box.y + box.h / 2 })[1];
  // Metres per point at zoom 0 with 512-point tiles, scaled by latitude.
  const zoom = Math.log2((40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / 512 / metresPerPoint);
  return { center: toLngLat({ x: box.x + box.w / 2, y: box.y + box.h / 2 }), zoom, bearing: GEO.bearing - 90 };
}

/**
 * As far out as the map goes: the whole site in the part nothing covers, or the screen's own framing if
 * that's further out (me standing outside).
 */
export function minZoomFor(size: { width: number; height: number }, frame: VenueMapProps['frame'], auto: Camera | null): number {
  const site = cameraFor(frameBox({ route: null, me: null, fit: 'site', frame }, size), size.width).zoom;
  return Math.min(site, auto?.zoom ?? site);
}
/** How far past the plan's edge the map can be dragged, in metres. */
const SLACK = 10;

/** Plan metres per point at a zoom; the inverse of cameraFor's zoom. */
function metresPerPoint(zoom: number): number {
  return (40_075_016.686 * Math.cos((GEO.origin[1] * Math.PI) / 180)) / 512 / 2 ** zoom;
}

/**
 * Where the middle of the map can go at a zoom, in plan metres, so the site's edge never comes more than SLACK
 * into the part of the map nothing covers. Zoomed out past the site, it keeps the whole site in that part instead.
 * The screen's own framing always fits (it can reach past the edge, e.g. to take in me standing outside).
 */
export function panLimit(zoom: number, size: { width: number; height: number }, frame: VenueMapProps['frame'], auto: Camera | null): Box {
  const m = metresPerPoint(zoom);
  const w = size.width * m, h = size.height * m;
  const top = (frame?.top ?? 0) * h, bottom = (frame?.bottom ?? 0) * h;
  // What there is to see: the site, and whatever the screen frames itself.
  let [x0, y0, x1, y1] = [-SLACK, -SLACK, VENUE.width + SLACK, VENUE.height + SLACK];
  const c = auto && toPlan(auto.center);
  if (auto && c) {
    const am = metresPerPoint(auto.zoom);
    const aw = size.width * am, ah = size.height * am;
    const aTop = c.y - ah / 2 + (frame?.top ?? 0) * ah, aBottom = c.y + ah / 2 - (frame?.bottom ?? 0) * ah;
    [x0, y0, x1, y1] = [Math.min(x0, c.x - aw / 2), Math.min(y0, aTop), Math.max(x1, c.x + aw / 2), Math.max(y1, aBottom)];
  }
  // The middle runs from one edge in view to the other edge in view, whichever way round they come.
  const range = (lo: number, hi: number) => [Math.min(lo, hi), Math.max(lo, hi)];
  let [cx0, cx1] = range(x0 + w / 2, x1 - w / 2);
  // Measured on the uncovered part, then shifted back to the middle of the whole map.
  const seen = h - top - bottom;
  const shift = h / 2 - top - seen / 2;
  let [cy0, cy1] = range(y0 + seen / 2 + shift, y1 - seen / 2 + shift);
  // The screen's own framing must get through at any zoom.
  if (c) {
    [cx0, cx1, cy0, cy1] = [Math.min(cx0, c.x), Math.max(cx1, c.x), Math.min(cy0, c.y), Math.max(cy1, c.y)];
  }
  return { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 };
}

/** A lng/lat pulled back inside the limit, square to the plan. */
export function clampToLimit(lngLat: readonly [number, number], limit: Box): [number, number] {
  const p = toPlan(lngLat);
  return toLngLat({
    x: Math.min(Math.max(p.x, limit.x), limit.x + limit.w),
    y: Math.min(Math.max(p.y, limit.y), limit.y + limit.h),
  });
}

/**
 * Nudge markers apart until none overlap at the framed zoom, so a crowd at one stage reads as separate
 * people. Pins are pushed by their head, which sits above the point they mark.
 */
export function spread(markers: MapMarker[], metresPerPoint: number): MapMarker[] {
  const lift = (m: MapMarker) => (m.kind === 'task' ? (PIN.h * 0.6 * metresPerPoint) : 0);
  const c = markers.map((m) => ({ x: m.at.x, y: m.at.y - lift(m), r: ((m.kind === 'task' ? PIN.w : DOT) / 2) * metresPerPoint }));
  for (let round = 0; round < 16; round++) {
    let moved = false;
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 1; j < c.length; j++) {
        const dx = c[j].x - c[i].x, dy = c[j].y - c[i].y;
        const d = Math.hypot(dx, dy);
        const min = c[i].r + c[j].r + 3 * metresPerPoint;
        if (d >= min) continue;
        // Exactly on top of each other: split along a fixed angle per pair so it's stable between renders.
        const [ux, uy] = d > 0.01 ? [dx / d, dy / d] : [Math.cos(i + j * 2.4), Math.sin(i + j * 2.4)];
        const push = (min - d) / 2;
        c[i].x -= ux * push; c[i].y -= uy * push;
        c[j].x += ux * push; c[j].y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return markers.map((m, i) => ({ ...m, at: { x: c[i].x, y: c[i].y + lift(m) } }) as MapMarker);
}

/** The route line and the destination's footprint, as one source. */
export function liveData(route: Route | null, target: string | null | undefined, accent: string): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const zone = !route?.here ? zoneFootprint(target) : null;
  if (zone) features.push({ ...zone, properties: { kind: 'zone', color: accent } });
  if (route && route.points.length > 1) {
    features.push({ type: 'Feature', properties: { kind: 'route' }, geometry: { type: 'LineString', coordinates: route.points.map(toLngLat) } });
  }
  return { type: 'FeatureCollection', features };
}

/** How the live source is drawn. The route uses the voice gradient along its length, so it needs `lineMetrics`. */
export function liveLayers(gradient: readonly string[]): LayerSpecification[] {
  const stops = gradient.flatMap((c, i) => [i / (gradient.length - 1), c]);
  return [
    { id: 'live-zone-fill', type: 'fill', source: 'live', filter: ['==', ['get', 'kind'], 'zone'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 } },
    { id: 'live-zone-line', type: 'line', source: 'live', filter: ['==', ['get', 'kind'], 'zone'], paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 } },
    {
      id: 'live-route-glow', type: 'line', source: 'live', filter: ['==', ['get', 'kind'], 'route'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': gradient[1], 'line-opacity': 0.25, 'line-width': 10 },
    },
    {
      id: 'live-route', type: 'line', source: 'live', filter: ['==', ['get', 'kind'], 'route'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 4.5, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], ...stops] as never },
    },
  ];
}

/** Bounding box of the points, padded and stretched to the container's aspect ratio. */
function viewBoxFor(points: Point[], aspect: number): Box {
  if (points.length === 0) return fitAspect({ x: 0, y: 0, w: VENUE.width, h: VENUE.height }, aspect);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const pad = 14;
  // Never closer than a couple of zones across, so there's always something to get your bearings by.
  const w = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 90);
  const h = Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2 + 8, 64); // extra headroom for the pin
  // Centre on the points, so a lone marker sits mid-map rather than hugging the left edge.
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2 - 4;
  return fitAspect({ x: cx - w / 2, y: cy - h / 2, w, h }, aspect);
}

function fitAspect(b: Box, aspect: number): Box {
  if (b.w / b.h > aspect) {
    const h = b.w / aspect;
    return { ...b, y: b.y - (h - b.h) / 2, h };
  }
  const w = b.h * aspect;
  return { ...b, x: b.x - (w - b.w) / 2, w };
}

/** Grow the visible box by the covered fractions, so it lands in the uncovered part of the container. */
function framed(b: Box, frame?: { top: number; bottom: number }): Box {
  if (!frame) return b;
  const h = b.h / (1 - frame.top - frame.bottom);
  return { ...b, y: b.y - frame.top * h, h };
}
