import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';

import { EDGES, FENCE, NODES, VENUE_ZONES, toLngLat, type VenueZone, type ZoneIcon } from '@/data/venue';
import { DECOR, FIELD, GRANDSTAND, OVAL, SERVICE_ROAD, TENNIS, TRACK, TREES, TUNNEL } from '@/data/venue-features';
import type { MapIconName } from './map-icons';

/*
 * The festival drawn as an illustrated site map: real ground (oval, track, courts, trees) under
 * the festival's stages, tents, food trucks and toilets, all to scale in plan metres. Everything
 * is built once per colour scheme into two GeoJSON sources, `site-art` and `site-points`, and
 * drawn by the layers at the bottom of this file.
 */

type P = [number, number];
type Box = { x: number; y: number; w: number; h: number };
type Scheme = 'light' | 'dark';

/** Colours for the drawing. Roofs and badges share hues with the icons. */
const PALETTE = {
  light: {
    mask: '#F1F3F6', maskOpacity: 0.6,
    grass: '#D3EBC4', grove: '#BFE0AC', oval: '#B9DEA0', stripe: '#C6E5AE', line: '#FFFFFF',
    track: '#E8957A', lane: '#FFFFFF', infield: '#C5E4B1', turf: '#79C496', court: '#7BAEDF',
    road: '#DADDE2', tunnel: '#B8BDC6', walk: '#F6E9CC', walkEdge: '#E4D2AA',
    shadow: '#1E2A1E', shadowOpacity: 0.16,
    crowd: '#FFFFFF', crowdOpacity: 0.28,
    deck: '#2B2F38', tower: '#1C1F26', barrier: '#FFFFFF',
    tree: '#62A866', treeLit: '#80BF77', sail: '#FFF8E6', sailEdge: '#E3D3AA',
    stand: '#C7CDD6', standRow: '#AEB6C1', trailer: '#F4F5F7', trailerEdge: '#B9C0CA',
    fence: '#E8664F', fenceCasing: '#FFFFFF', area: '#64748B', areaOpacity: 0.16,
    text: '#1F2937', halo: '#FFFFFF',
  },
  dark: {
    mask: '#13161B', maskOpacity: 0.62,
    grass: '#1A2A1D', grove: '#1F3322', oval: '#1F3A22', stripe: '#234026', line: '#C8D3C9',
    track: '#7B4033', lane: '#C9A79E', infield: '#1F3421', turf: '#1E4A36', court: '#24486E',
    road: '#2A2F38', tunnel: '#3A404B', walk: '#3B3527', walkEdge: '#2C281E',
    shadow: '#000000', shadowOpacity: 0.35,
    crowd: '#C9D6C4', crowdOpacity: 0.08,
    deck: '#0D0F13', tower: '#08090C', barrier: '#C8CDD5',
    tree: '#2E5A33', treeLit: '#3B6E3F', sail: '#5B5648', sailEdge: '#433F34',
    stand: '#3A404B', standRow: '#4A515D', trailer: '#3A404B', trailerEdge: '#555D6A',
    fence: '#E8664F', fenceCasing: '#13161B', area: '#94A3B8', areaOpacity: 0.12,
    text: '#F3F4F6', halo: '#13161B',
  },
} as const;
type Pal = (typeof PALETTE)[Scheme];

/** Roof colours: [lit, shaded]. */
const ROOF = {
  light: {
    stage: ['#F06C96', '#E5487A'], stage2: ['#A07CF0', '#8B5CF6'], info: ['#2BBACF', '#14A3B8'], firstaid: ['#FFFFFF', '#E6E8EC'],
    backstage: ['#8A97A8', '#64748B'], security: ['#475569', '#334155'], bar: ['#B17EEB', '#9B5DE5'], foh: ['#5B6472', '#454D59'],
  },
  dark: {
    stage: ['#D9557F', '#B83A63'], stage2: ['#8A6AD6', '#7049D0'], info: ['#1F9AAD', '#13808F'], firstaid: ['#D9DCE1', '#B7BCC4'],
    backstage: ['#5E6B7C', '#465264'], security: ['#3B4656', '#2A3341'], bar: ['#8B5CC9', '#7442B8'], foh: ['#4B5360', '#3A414C'],
  },
} as const;
const CROSS = '#E5484D';
const TRUCKS = ['#F28C28', '#E5487A', '#14A3B8', '#F2B705', '#2BA36B', '#EF6C57', '#5A67D8'];
const UMBRELLAS = ['#F28C28', '#E5487A', '#14A3B8'];
const TOILET = { light: ['#6F8BE6', '#5A67D8'], dark: ['#4E5DB8', '#3F4AA0'] } as const;
const WATER = { light: ['#7CC6F3', '#1E9BEA'], dark: ['#2B7FB8', '#1A6497'] } as const;

// ---------------------------------------------------------------------------------------------
// Geometry, in plan metres

const ll = ([x, y]: P) => toLngLat({ x, y });
const rect = (b: Box): P[] => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
const shift = (ring: P[], dx: number, dy: number): P[] => ring.map(([x, y]) => [x + dx, y + dy]);
const inset = (b: Box, d: number): Box => ({ x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d });
const centre = (b: Box): P => [b.x + b.w / 2, b.y + b.h / 2];

function circle([cx, cy]: P, r: number, n = 20): P[] {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
}

/** The track's outline at radius `r`, clockwise from the top of the west bend. */
function stadium(r: number, n = 24): P[] {
  const { west, east, y } = TRACK;
  const bend = (cx: number, from: number): P[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = from + (i / n) * Math.PI;
      return [cx + r * Math.cos(a), y + r * Math.sin(a)];
    });
  return [...bend(east, -Math.PI / 2), ...bend(west, Math.PI / 2)];
}

/** The part of `ring` between x0 and x1 (Sutherland–Hodgman against the two edges of a band). */
function clipBand(ring: P[], x0: number, x1: number): P[] {
  const clip = (pts: P[], inside: (p: P) => boolean, edge: number) => {
    const out: P[] = [];
    pts.forEach((cur, i) => {
      const prev = pts[(i + pts.length - 1) % pts.length];
      const cross = (): P => [edge, prev[1] + ((edge - prev[0]) / (cur[0] - prev[0])) * (cur[1] - prev[1])];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross());
        out.push(cur);
      } else if (inside(prev)) out.push(cross());
    });
    return out;
  };
  return clip(clip(ring, (p) => p[0] >= x0, x0), (p) => p[0] <= x1, x1);
}

/** A half-ellipse out from the middle of a stage's front edge: where its audience stands. */
function fan(front: P, out: P, side: P, depth: number, halfWidth: number, n = 24): P[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI;
    const d = depth * Math.cos(a), s = halfWidth * Math.sin(a);
    return [front[0] + out[0] * d + side[0] * s, front[1] + out[1] * d + side[1] * s];
  });
}

// ---------------------------------------------------------------------------------------------
// Features. Every one says which layer draws it (`l`), its order in that layer (`z`) and its colour.

type Props = { l: 'mask' | 'ground' | 'groundLine' | 'walk' | 'thing' | 'thingLine' | 'fence' | 'tunnel' | 'areaLine'; z: number; c: string; o?: number; w?: number; min?: number };
type Feature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, Props>;

const close = (ring: P[]) => [...ring.map(ll), ll(ring[0])];
const fill = (rings: P[][], p: Props): Feature => ({ type: 'Feature', properties: p, geometry: { type: 'Polygon', coordinates: rings.map(close) } });
const stroke = (pts: P[], p: Props): Feature => ({ type: 'Feature', properties: p, geometry: { type: 'LineString', coordinates: pts.map(ll) } });

/** Something standing on the ground: a soft shadow down and to the right, then the thing. */
function standing(ring: P[], c: string, z: number, k: Pal, lift = 0.8): Feature[] {
  return [
    fill([shift(ring, lift, lift * 1.2)], { l: 'thing', z: z - 0.5, c: k.shadow, o: k.shadowOpacity }),
    fill([ring], { l: 'thing', z, c }),
  ];
}

/** A marquee seen from above: four roof panels meeting at the peak, lit from the top left. */
function tent(b: Box, [lit, shaded]: readonly [string, string], z: number, k: Pal, cross = false): Feature[] {
  const [tl, tr, br, bl] = rect(b);
  const c = centre(b);
  const out = [
    ...standing(rect(b), shaded, z, k, 0.9),
    fill([[tl, tr, c]], { l: 'thing', z: z + 0.1, c: lit }),
    fill([[tl, c, bl]], { l: 'thing', z: z + 0.1, c: lit, o: 0.85 }),
    fill([[c, br, bl]], { l: 'thing', z: z + 0.1, c: shaded }),
  ];
  if (cross) {
    const s = Math.min(b.w, b.h) * 0.42, t = s * 0.34;
    out.push(fill([rect({ x: c[0] - s / 2, y: c[1] - t / 2, w: s, h: t })], { l: 'thing', z: z + 0.2, c: CROSS }));
    out.push(fill([rect({ x: c[0] - t / 2, y: c[1] - s / 2, w: t, h: s })], { l: 'thing', z: z + 0.2, c: CROSS }));
  }
  return out;
}

const SIDES = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] } as const satisfies Record<string, P>;

function stage(z: VenueZone & { shape: { kind: 'stage' } }, roof: readonly [string, string], k: Pal): Feature[] {
  const s = z.shape;
  const out = SIDES[s.faces];
  const side: P = [-out[1], out[0]];
  const along = out[0] ? s.h : s.w; // length of the front edge
  const deep = out[0] ? s.w : s.h;
  const [cx, cy] = centre(s);
  const front: P = [cx + (out[0] * deep) / 2, cy + (out[1] * deep) / 2];
  const at = (d: number, t: number): P => [front[0] + out[0] * d + side[0] * t, front[1] + out[1] * d + side[1] * t];
  const span = (d0: number, d1: number, t0: number, t1: number): P[] => [at(d0, t0), at(d0, t1), at(d1, t1), at(d1, t0)];
  return [
    // Audience area, then the pit barrier in front of the stage.
    fill([fan(front, out, side, deep * 5, along * 0.5 + deep * 1.2)], { l: 'ground', z: 20, c: k.crowd, o: k.crowdOpacity }),
    stroke(fan(front, out, side, 4, along / 2 + 1.5, 16), { l: 'thingLine', z: 1, c: k.barrier, w: 0.4, min: 1 }),
    ...standing(rect(s), k.deck, 30, k, 1.2),
    // Roof: shaded over the back, lit towards the front, stopping short of the lip.
    fill([span(-deep + 0.6, -2, -along / 2 + 0.8, along / 2 - 0.8)], { l: 'thing', z: 30.1, c: roof[1] }),
    fill([span(-deep * 0.45, -2, -along / 2 + 0.8, along / 2 - 0.8)], { l: 'thing', z: 30.2, c: roof[0] }),
    // Speaker towers at the front corners.
    ...standing(span(1, 3.2, -along / 2 - 0.4, -along / 2 + 1.8), k.tower, 31, k, 0.6),
    ...standing(span(1, 3.2, along / 2 - 1.8, along / 2 + 0.4), k.tower, 31, k, 0.6),
  ];
}

/** Food trucks parked in a row, serving hatches facing north, with a gap in the middle to walk through. */
function trucks(b: Box, k: Pal): Feature[] {
  const out: Feature[] = [];
  const len = 6, gap = 1.6, n = Math.floor((b.w + gap) / (len + gap));
  const start = b.x + (b.w - (n * (len + gap) - gap)) / 2;
  const mid = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    if (n > 6 && i === mid) continue;
    const x = start + i * (len + gap), c = TRUCKS[i % TRUCKS.length];
    const body = { x, y: b.y + b.h - 2.8, w: len, h: 2.8 };
    out.push(...standing(rect(body), c, 40, k, 0.7));
    out.push(fill([rect({ x: x + len - 1.5, y: body.y + 0.25, w: 1.25, h: 2.3 })], { l: 'thing', z: 40.1, c: '#000000', o: 0.18 })); // cab
    out.push(fill([rect({ x: x + 0.6, y: b.y + b.h - 4, w: 3.8, h: 1.2 })], { l: 'thing', z: 40.2, c: '#FFFFFF', o: 0.92 })); // awning
    out.push(fill([rect({ x: x + 0.6, y: b.y + b.h - 4, w: 3.8, h: 0.4 })], { l: 'thing', z: 40.3, c, o: 0.9 }));
  }
  return out;
}

function toilets(b: Box, rows: 1 | 2, [lit, shaded]: readonly [string, string], k: Pal): Feature[] {
  const out: Feature[] = [];
  const size = 1.35, gap = 0.2, depth = 2.4;
  const n = Math.floor((b.w + gap) / (size + gap));
  for (let r = 0; r < rows; r++) {
    const y = r === 0 ? b.y : b.y + b.h - depth;
    out.push(fill([shift(rect({ x: b.x, y, w: n * (size + gap) - gap, h: depth }), 0.6, 0.7)], { l: 'thing', z: 39.5, c: k.shadow, o: k.shadowOpacity }));
    for (let i = 0; i < n; i++) {
      const cell = { x: b.x + i * (size + gap), y, w: size, h: depth };
      out.push(fill([rect(cell)], { l: 'thing', z: 40, c: shaded }));
      out.push(fill([rect(inset(cell, 0.25))], { l: 'thing', z: 40.1, c: lit }));
    }
  }
  return out;
}

function zoneArt(z: VenueZone, scheme: Scheme, k: Pal, stageIndex: number): Feature[] {
  const s = z.shape;
  const roof = ROOF[scheme];
  switch (s.kind) {
    case 'stage':
      return stage({ ...z, shape: s }, stageIndex === 0 ? roof.stage : roof.stage2, k);
    case 'tent':
      return tent(s, z.icon === 'firstaid' ? roof.firstaid : roof.info, 50, k, z.icon === 'firstaid');
    case 'trucks':
      return trucks(s, k);
    case 'toilets':
      return toilets(s, s.rows, TOILET[scheme], k);
    case 'water':
      return [
        ...standing(circle([s.x, s.y], 2.4), WATER[scheme][1], 45, k, 0.5),
        fill([circle([s.x - 0.4, s.y - 0.4], 1.3)], { l: 'thing', z: 45.1, c: WATER[scheme][0] }),
      ];
    case 'area':
      return z.icon === 'shade'
        ? [fill([s.ring], { l: 'ground', z: 10, c: k.grove })]
        : [
            fill([s.ring], { l: 'ground', z: 25, c: k.area, o: k.areaOpacity }),
            stroke([...s.ring, s.ring[0]], { l: 'areaLine', z: 0, c: k.area, w: 0.3, min: 1.2 }),
          ];
    case 'gate':
      return [];
  }
}

function ground(k: Pal): Feature[] {
  const fence = FENCE.flat() as P[];
  const far = 2500;
  const world: P[] = [[-far, -far], [far, -far], [far, far], [-far, far]];
  const out: Feature[] = [
    // Holes wind the other way from the ring they're cut from.
    fill([world, [...fence].reverse()], { l: 'mask', z: 0, c: k.mask, o: k.maskOpacity }),
    fill([fence], { l: 'ground', z: 0, c: k.grass }),
    // Oval: mown stripes and a white boundary line.
    fill([OVAL], { l: 'ground', z: 1, c: k.oval }),
    stroke([...OVAL, OVAL[0]], { l: 'groundLine', z: 0, c: k.line, w: 0.5, min: 1, o: 0.9 }),
    // Track: red lanes round a grass infield, the hockey turf in the middle.
    fill([stadium(TRACK.outer), stadium(TRACK.inner).reverse()], { l: 'ground', z: 1, c: k.track }),
    fill([stadium(TRACK.inner)], { l: 'ground', z: 1, c: k.infield }),
    fill([rect(FIELD)], { l: 'ground', z: 2, c: k.turf }),
    stroke([...rect(FIELD), rect(FIELD)[0]], { l: 'groundLine', z: 0, c: k.line, w: 0.25, min: 0.8, o: 0.85 }),
    stroke([[FIELD.x + FIELD.w / 2, FIELD.y], [FIELD.x + FIELD.w / 2, FIELD.y + FIELD.h]], { l: 'groundLine', z: 0, c: k.line, w: 0.2, min: 0.6, o: 0.7 }),
    ...[TRACK.inner, TRACK.outer].map((r) => stroke([...stadium(r), stadium(r)[0]], { l: 'groundLine', z: 0, c: k.lane, w: 0.2, min: 0.8, o: 0.9 })),
    ...[0.25, 0.5, 0.75].map((t) => {
      const ring = stadium(TRACK.inner + t * (TRACK.outer - TRACK.inner));
      return stroke([...ring, ring[0]], { l: 'groundLine', z: 0, c: k.lane, w: 0.12, min: 0.5, o: 0.55 });
    }),
    // Tennis courts and the grandstand.
    ...TENNIS.flatMap((b) => [
      fill([rect(b)], { l: 'ground', z: 2, c: k.court }),
      stroke([...rect(inset(b, 1)), rect(inset(b, 1))[0]], { l: 'groundLine', z: 0, c: k.line, w: 0.15, min: 0.6, o: 0.85 }),
      stroke([[b.x, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2]], { l: 'groundLine', z: 0, c: k.line, w: 0.15, min: 0.6, o: 0.85 }),
    ]),
    ...standing(GRANDSTAND, k.stand, 35, k, 1.4),
    ...[0.25, 0.5, 0.75].map((t) => {
      const [a, b, c, d] = GRANDSTAND; // b–c is the back row, a–d the front
      const lerp = (p: P, q: P): P => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      return stroke([lerp(b, a), lerp(c, d)], { l: 'thingLine', z: 0, c: k.standRow, w: 0.35, min: 0.6 });
    }),
    // Service road, and the tunnel it comes up out of.
    stroke(SERVICE_ROAD, { l: 'groundLine', z: -1, c: k.road, w: 6, min: 3 }),
    stroke(TUNNEL, { l: 'tunnel', z: 0, c: k.tunnel, w: 5, min: 2.5 }),
  ];
  for (let x = 50; x < 210; x += 18) {
    const band = clipBand(OVAL, x, x + 9);
    if (band.length > 2) out.push(fill([band], { l: 'ground', z: 1.5, c: k.stripe }));
  }
  return out;
}

function decor(scheme: Scheme, k: Pal): Feature[] {
  const roof = ROOF[scheme];
  const out: Feature[] = [];
  for (const [x, y, r] of TREES) {
    out.push(...standing(circle([x, y], r), k.tree, 60, k, r * 0.25));
    out.push(fill([circle([x - r * 0.28, y - r * 0.3], r * 0.55, 14)], { l: 'thing', z: 60.1, c: k.treeLit }));
  }
  for (const sail of DECOR.sails) {
    out.push(...standing(sail, k.sail, 55, k, 1.6));
    out.push(stroke([...sail, sail[0]], { l: 'thingLine', z: 0, c: k.sailEdge, w: 0.25, min: 0.8 }));
  }
  DECOR.umbrellas.forEach((at, i) => {
    const ring = circle(at, 1.6, 16);
    out.push(fill([shift(ring, 0.6, 0.8)], { l: 'thing', z: 54.5, c: k.shadow, o: k.shadowOpacity }));
    for (let s = 0; s < 8; s++) {
      out.push(fill([[at, ring[s * 2], ring[s * 2 + 1], ring[(s * 2 + 2) % 16]]], { l: 'thing', z: 55, c: s % 2 ? '#FFFFFF' : UMBRELLAS[i % UMBRELLAS.length] }));
    }
  });
  for (const b of DECOR.trailers) {
    out.push(...standing(rect(b), k.trailer, 50, k, 0.6));
    out.push(stroke([...rect(b), rect(b)[0]], { l: 'thingLine', z: 0, c: k.trailerEdge, w: 0.2, min: 0.6 }));
  }
  for (const b of DECOR.medics) out.push(...tent(b, roof.firstaid, 50, k, true));
  for (const b of DECOR.foh) out.push(...tent(b, roof.foh, 50, k));
  out.push(...tent(DECOR.bar, roof.bar, 50, k));
  out.push(...tent(DECOR.security, roof.security, 50, k));
  out.push(...tent(DECOR.booth, roof.security, 50, k));
  for (const line of [...DECOR.lanes, ...DECOR.barriers]) out.push(stroke(line, { l: 'thingLine', z: 1, c: k.barrier, w: 0.35, min: 1 }));
  return out;
}

/** Walkways: the routing network itself, traced along the real paths. Road legs are already drawn. */
function walkways(k: Pal): Feature[] {
  return EDGES.filter((e) => !e.road).flatMap(({ a, b, via = [] }) => {
    const pts: P[] = [[NODES[a].x, NODES[a].y], ...via, [NODES[b].x, NODES[b].y]];
    return [
      stroke(pts, { l: 'walk', z: 0, c: k.walkEdge, w: 4, min: 2.5 }),
      stroke(pts, { l: 'walk', z: 1, c: k.walk, w: 3, min: 1.5 }),
    ];
  });
}

function fence(k: Pal): Feature[] {
  return FENCE.map((line) => stroke(line, { l: 'fence', z: 0, c: k.fence }));
}

// ---------------------------------------------------------------------------------------------
// Icons and names

/** Where a zone's badge goes: the middle of what's drawn for it. */
function iconAt(z: VenueZone): P {
  const s = z.shape;
  if (s.kind === 'water' || s.kind === 'gate') return [s.x, s.y];
  if (s.kind === 'area') {
    const n = s.ring.length;
    return [s.ring.reduce((t, p) => t + p[0], 0) / n, s.ring.reduce((t, p) => t + p[1], 0) / n];
  }
  return centre(s);
}

/** Which badges are placed first when they compete for room. */
const RANK: Record<ZoneIcon, number> = { stage: 0, gate: 1, firstaid: 2, food: 3, info: 4, water: 5, toilets: 6, shade: 7, backstage: 8 };

type PointProps = { icon: MapIconName; label: string; rank: number; decor: boolean };
const point = (at: P, p: PointProps): GeoJSON.Feature<GeoJSON.Point, PointProps> => ({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: ll(at) } });

function points(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...Object.values(VENUE_ZONES).map((z) => point(iconAt(z), { icon: z.icon, label: z.label, rank: RANK[z.icon], decor: false })),
      ...DECOR.medics.map((b) => point(centre(b), { icon: 'medic', label: '', rank: 20, decor: true })),
      point(centre(DECOR.bar), { icon: 'bar', label: 'Bar', rank: 21, decor: true }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Sources and layers

/** The footprint of a zone, for highlighting a destination. Points (gates, water) have none. */
export function zoneFootprint(slug: string | null | undefined): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const s = slug ? VENUE_ZONES[slug]?.shape : undefined;
  if (!s || s.kind === 'water' || s.kind === 'gate') return null;
  const ring = s.kind === 'area' ? s.ring : rect(s);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [close(ring)] } };
}

const built: Partial<Record<Scheme, { art: GeoJSON.FeatureCollection; points: GeoJSON.FeatureCollection }>> = {};

/** The drawing for one colour scheme: built once, then reused. */
export function siteSources(scheme: Scheme) {
  if (!built[scheme]) {
    const k = PALETTE[scheme];
    let stageIndex = 0;
    const zones = Object.values(VENUE_ZONES).flatMap((z) => zoneArt(z, scheme, k, z.shape.kind === 'stage' ? stageIndex++ : 0));
    built[scheme] = {
      art: { type: 'FeatureCollection', features: [...ground(k), ...zones, ...walkways(k), ...decor(scheme, k), ...fence(k)] },
      points: points(),
    };
  }
  return built[scheme]!;
}

/** `w` metres on the ground at any zoom, never thinner than `min` pixels. Pixels per metre here are 2^z / 61855 (512 px tiles). */
const metres: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  15, ['max', ['*', ['get', 'w'], 0.53], ['coalesce', ['get', 'min'], 0]],
  20, ['max', ['*', ['get', 'w'], 16.95], ['coalesce', ['get', 'min'], 0]],
];
const color: ExpressionSpecification = ['get', 'c'];
const opacity: ExpressionSpecification = ['coalesce', ['get', 'o'], 1];
const on = (l: Props['l']): ExpressionSpecification => ['==', ['get', 'l'], l];

/** Layers drawn with the ground: under the base map's street names. */
export function siteGroundLayers(scheme: Scheme): LayerSpecification[] {
  const k = PALETTE[scheme];
  const fillLayer = (id: string, l: Props['l']): LayerSpecification => ({
    id, type: 'fill', source: 'site-art', filter: on(l),
    layout: { 'fill-sort-key': ['get', 'z'] },
    paint: { 'fill-color': color, 'fill-opacity': opacity },
  });
  const lineLayer = (id: string, l: Props['l'], extra: Partial<{ dash: number[] }> = {}): LayerSpecification => ({
    id, type: 'line', source: 'site-art', filter: on(l),
    layout: { 'line-cap': extra.dash ? 'butt' : 'round', 'line-join': 'round', 'line-sort-key': ['get', 'z'] },
    paint: { 'line-color': color, 'line-opacity': opacity, 'line-width': metres, ...(extra.dash ? { 'line-dasharray': extra.dash } : {}) },
  });
  return [
    fillLayer('site-mask', 'mask'),
    fillLayer('site-ground', 'ground'),
    lineLayer('site-ground-line', 'groundLine'),
    lineLayer('site-tunnel', 'tunnel', { dash: [1.2, 0.8] }),
    lineLayer('site-walk', 'walk'),
    lineLayer('site-area-line', 'areaLine', { dash: [2, 1.5] }),
    fillLayer('site-things', 'thing'),
    lineLayer('site-things-line', 'thingLine'),
    {
      id: 'site-fence-casing', type: 'line', source: 'site-art', filter: on('fence'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': k.fenceCasing, 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 18, 5] },
    },
    {
      id: 'site-fence', type: 'line', source: 'site-art', filter: on('fence'),
      layout: { 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.2, 18, 2.6], 'line-dasharray': [2.2, 1.4] },
    },
  ];
}

/** Badges and names: drawn last, so they're placed before the base map's labels. */
export function siteLabelLayers(scheme: Scheme): LayerSpecification[] {
  const k = PALETTE[scheme];
  const size: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 15, 0.55, 16.5, 0.72, 18, 0.92, 19.5, 1];
  return [
    {
      id: 'site-decor-icons', type: 'symbol', source: 'site-points', filter: ['==', ['get', 'decor'], true],
      minzoom: 16,
      layout: {
        'icon-image': ['concat', 'site-', ['get', 'icon']], 'icon-size': size, 'icon-allow-overlap': false, 'symbol-sort-key': ['get', 'rank'],
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 16, 9.5, 18, 11.5],
        'text-anchor': 'top', 'text-offset': ['interpolate', ['linear'], ['zoom'], 16, ['literal', [0, 1]], 18, ['literal', [0, 1.25]]], 'text-optional': true,
      },
      paint: { 'text-color': k.text, 'text-halo-color': k.halo, 'text-halo-width': 1.5 },
    },
    {
      id: 'site-icons', type: 'symbol', source: 'site-points', filter: ['==', ['get', 'decor'], false],
      layout: {
        'icon-image': ['concat', 'site-', ['get', 'icon']], 'icon-size': size, 'icon-allow-overlap': true, 'symbol-sort-key': ['get', 'rank'],
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9.5, 18, 12.5],
        'text-anchor': 'top', 'text-offset': ['interpolate', ['linear'], ['zoom'], 15, ['literal', [0, 0.95]], 18, ['literal', [0, 1.2]]],
        'text-optional': true, 'text-max-width': 8,
      },
      paint: { 'text-color': k.text, 'text-halo-color': k.halo, 'text-halo-width': 1.6 },
    },
  ];
}
