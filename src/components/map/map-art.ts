import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';

import { FENCE, GEO, NODES, VENUE_ZONES, foodCourt, restrictedArea, toLngLat, type VenueZone, type ZoneIcon } from '@/data/venue';
import {
  ARTIST_TENTS, ATTRACTIONS, BARRICADES, BRIDGES, LOUNGE, CONTEXT_TREES, CONTROL_SHEDS, DECOR, FEDERATION_BELLS, GATEWAYS, GROVE, LANDING, MAIN_LAWN, MARKET, PATHS, PLACE_NAMES, PLAY, PLAYGROUND,
  PLAZAS, RIPPLES, RIVER, RIVER_LINE, STAIRS, TERRACE_EDGES, TERRACES, TREES, smooth, type Seat,
} from '@/data/venue-features';
import type { MapIconName } from './map-icons';

/*
 * The festival drawn as an illustrated site map: real ground (the river, the park's terraces, its paths, bridges and
 * trees) under the festival's stages, tents, food trucks and toilets, all to scale in plan metres. Everything is
 * built once per colour scheme into two GeoJSON sources, `site-art` and `site-points`, and drawn by the layers at the
 * bottom of this file.
 */

type P = [number, number];
type Box = { x: number; y: number; w: number; h: number };
type Scheme = 'light' | 'dark';

/** Colours for the drawing. Roofs and badges share hues with the icons. */
const PALETTE = {
  light: {
    // A light wash over the streets outside, so the site stands out but the city round it still reads.
    mask: '#F1F3F6', maskOpacity: 0.42,
    grass: '#D6ECC8', upper: '#CFE8BF', middle: '#C8E5B4', lawn: '#BBDFA2', stripe: '#C5E4AF', step: '#8DB97A',
    water: '#A9D3F1', waterEdge: '#86BDE6', ripple: '#FFFFFF', bank: '#E6E1CF', playground: '#E4E6C8',
    // The playground's gear: yellow frames and slide, terracotta rubber soft-fall, the sandpit.
    play: '#F2B705', softfall: '#E9C6AC', sand: '#F2E3B6',
    trail: '#E9EAEE', trailEdge: '#CDD1D8', walk: '#F4E7C8', walkEdge: '#E0CDA2', board: '#E2CBA5', boardEdge: '#C7AB80',
    plaza: '#EEE8DA', plazaEdge: '#DDD4C0', stair: '#C9BEA6',
    shadow: '#1E2A1E', shadowOpacity: 0.16,
    crowd: '#FFFFFF', crowdOpacity: 0.28,
    deck: '#2B2F38', tower: '#1C1F26', barrier: '#FFFFFF', rail: '#6B7585',
    bridge: '#F7F7F8', bridgeRail: '#A3ABB7', bell: '#9C7A45', pier: '#E2CBA5',
    tree: '#62A866', treeLit: '#80BF77', sail: '#FFF8E6', sailEdge: '#E3D3AA',
    canvas: '#FCFAF5', canvasShade: '#E8E2D4', canvasSeam: '#D5CBB5', timber: '#D9BC8F', timberShade: '#B8956A',
    trailer: '#F4F5F7', trailerEdge: '#B9C0CA',
    fence: '#E8664F', fenceCasing: '#FFFFFF', area: '#64748B', areaOpacity: 0.16,
    text: '#1F2937', halo: '#FFFFFF', placeText: '#7A8494', waterText: '#4F82B0',
  },
  dark: {
    // No wash in the dark: the base map is quiet enough as it is.
    mask: '#13161B', maskOpacity: 0,
    grass: '#1A2A1D', upper: '#1C2E1F', middle: '#1E3321', lawn: '#1F3A22', stripe: '#234026', step: '#0E1710',
    water: '#183553', waterEdge: '#24496F', ripple: '#5F86AE', bank: '#2E2C25', playground: '#2C3124',
    play: '#B8890A', softfall: '#4A3830', sand: '#4A4331',
    trail: '#2C313A', trailEdge: '#20242B', walk: '#3B3527', walkEdge: '#2C281E', board: '#433A2A', boardEdge: '#30291D',
    plaza: '#34352F', plazaEdge: '#2A2B26', stair: '#4A4436',
    shadow: '#000000', shadowOpacity: 0.35,
    crowd: '#C9D6C4', crowdOpacity: 0.08,
    deck: '#0D0F13', tower: '#08090C', barrier: '#C8CDD5', rail: '#AEB6C2',
    bridge: '#3A404B', bridgeRail: '#5A6270', bell: '#B08A52', pier: '#433A2A',
    tree: '#2E5A33', treeLit: '#3B6E3F', sail: '#5B5648', sailEdge: '#433F34',
    canvas: '#7A776D', canvasShade: '#605D55', canvasSeam: '#4C4943', timber: '#6B5A40', timberShade: '#54462F',
    trailer: '#3A404B', trailerEdge: '#555D6A',
    fence: '#E8664F', fenceCasing: '#13161B', area: '#94A3B8', areaOpacity: 0.12,
    text: '#F3F4F6', halo: '#13161B', placeText: '#8B94A3', waterText: '#7FA6CC',
  },
} as const;
type Pal = (typeof PALETTE)[Scheme];

/** Roof colours: [lit, shaded]. */
const ROOF = {
  light: {
    stage: ['#F06C96', '#E5487A'], stage2: ['#A07CF0', '#8B5CF6'], stage3: ['#F28C6B', '#E06A4A'], info: ['#2BBACF', '#14A3B8'], firstaid: ['#FFFFFF', '#E6E8EC'],
    backstage: ['#8A97A8', '#64748B'], security: ['#475569', '#334155'], bar: ['#B17EEB', '#9B5DE5'], foh: ['#5B6472', '#454D59'],
    pavilion: ['#E3A47F', '#C9774F'], tickets: ['#F4C77A', '#DDA24A'], shop: ['#7FD3C6', '#4DB6A6'], supplies: ['#C9D19A', '#A9B46E'], artists: ['#D88AD2', '#B03FA8'], control: ['#8E98EC', '#6370D1'],
  },
  dark: {
    stage: ['#D9557F', '#B83A63'], stage2: ['#8A6AD6', '#7049D0'], stage3: ['#D0704F', '#B5563A'], info: ['#1F9AAD', '#13808F'], firstaid: ['#D9DCE1', '#B7BCC4'],
    backstage: ['#5E6B7C', '#465264'], security: ['#3B4656', '#2A3341'], bar: ['#8B5CC9', '#7442B8'], foh: ['#4B5360', '#3A414C'],
    pavilion: ['#A86A4A', '#8A5236'], tickets: ['#A5793A', '#87612B'], shop: ['#2F7F75', '#24665E'], supplies: ['#58622F', '#454D24'], artists: ['#9C4A97', '#7D3578'], control: ['#4C57A8', '#3A4390'],
  },
} as const;
const CROSS = '#E5484D';
const TRUCKS = ['#F28C28', '#E5487A', '#14A3B8', '#F2B705', '#2BA36B', '#EF6C57', '#5A67D8'];
const UMBRELLAS = ['#F28C28', '#E5487A', '#14A3B8'];
const TOILET = { light: ['#6F8BE6', '#5A67D8'], dark: ['#4E5DB8', '#3F4AA0'] } as const;
const WATER = { light: ['#7CC6F3', '#1E9BEA'], dark: ['#2B7FB8', '#1A6497'] } as const;

// ---------------------------------------------------------------------------------------------
// Geometry, in plan metres

/** To [lng, lat], to 10 cm: the style is sent whole to the native map, and full precision nearly doubles its size. */
const ll = ([x, y]: P): P => toLngLat({ x, y }).map((v) => Math.round(v * 1e6) / 1e6) as P;
const rect = (b: Box): P[] => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
const shift = (ring: P[], dx: number, dy: number): P[] => ring.map(([x, y]) => [x + dx, y + dy]);
const inset = (b: Box, d: number): Box => ({ x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d });
const centre = (b: Box): P => [b.x + b.w / 2, b.y + b.h / 2];

function circle([cx, cy]: P, r: number, n = 20): P[] {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
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

/** A line `w` wide as a polygon: its two sides, joined at each bend. */
function ribbon(line: P[], w: number): P[] {
  const side = (s: number) =>
    line.map((p, i): P => {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [p[0] - (dy / l) * (w / 2) * s, p[1] + (dx / l) * (w / 2) * s];
    });
  return [...side(1), ...side(-1).reverse()];
}

/** A line moved `d` to its right (y down), for the rails along a bridge deck. */
const beside = (line: P[], d: number): P[] => ribbon(line, 2 * d).slice(0, line.length);

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

type Props = {
  l: 'mask' | 'ground' | 'bank' | 'water' | 'waterLine' | 'groundLine' | 'walk' | 'thing' | 'thingLine' | 'canopyShade' | 'canopy' | 'canopyLine' | 'fence' | 'areaLine' | 'barricade' | 'barricadeFoot';
  z: number; c: string; o?: number; w?: number; min?: number;
};
type Feature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, Props>;

const close = (ring: P[]) => [...ring.map(ll), ll(ring[0])];
const fill = (rings: P[][], p: Props): Feature => ({ type: 'Feature', properties: p, geometry: { type: 'Polygon', coordinates: rings.map(close) } });
const stroke = (pts: P[], p: Props): Feature => ({ type: 'Feature', properties: p, geometry: { type: 'LineString', coordinates: pts.map(ll) } });

/** Something standing on the ground: a soft shadow down and to the right, then the thing. */
function standing(ring: P[], c: string, z: number, k: Pal, lift = 0.8, l: Props['l'] = 'thing'): Feature[] {
  return [
    fill([shift(ring, lift, lift * 1.2)], { l: l === 'canopy' ? 'canopyShade' : l, z: z - 0.5, c: k.shadow, o: k.shadowOpacity }),
    fill([ring], { l, z, c }),
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
type Side = keyof typeof SIDES;

/**
 * A covered stage: one marquee over the stage and its audience, seen from above. A long hipped canvas roof, seamed into
 * bays and lit from the top left like tent(), with the stage's end (opposite `faces`) in the stage's colour. No crowd
 * fan or speaker towers: they're under the roof.
 */
function marquee(s: Box & { faces: Side }, accent: readonly [string, string], k: Pal): Feature[] {
  const [x0, y0, x1, y1] = [s.x, s.y, s.x + s.w, s.y + s.h];
  const [cx, cy] = centre(s);
  const flat = s.w >= s.h; // the ridge runs along x
  const hip = (flat ? s.h : s.w) * 0.3;
  const r0: P = flat ? [x0 + hip, cy] : [cx, y0 + hip];
  const r1: P = flat ? [x1 - hip, cy] : [cx, y1 - hip];
  const [nw, ne, se, sw]: P[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const panels: Record<Side, P[]> = flat
    ? { n: [nw, ne, r1, r0], s: [sw, r0, r1, se], w: [nw, r0, sw], e: [ne, se, r1] }
    : { w: [nw, r0, r1, sw], e: [ne, se, r1, r0], n: [nw, ne, r0], s: [sw, r1, se] };
  const back = ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[s.faces];
  const lit = (side: Side) => side === 'n' || side === 'w';
  const out = standing(rect(s), k.canvasShade, 30, k, 1.2);
  for (const side of ['n', 'w', 's', 'e'] as const) {
    const c = side === back ? accent[lit(side) ? 0 : 1] : lit(side) ? k.canvas : k.canvasShade;
    out.push(fill([panels[side]], { l: 'thing', z: 30.1, c, o: side === 'w' && side !== back ? 0.85 : 1 }));
  }
  // Seams: the ridge, the hips, and a frame truss across the roof every bay or so.
  const seam = (pts: P[]) => stroke(pts, { l: 'thingLine', z: 0.5, c: k.canvasSeam, w: 0.18, min: 0.5 });
  out.push(seam([nw, r0, sw]), seam([ne, r1, se]), seam([r0, r1]), seam([nw, ne, se, sw, nw]));
  const run = flat ? r1[0] - r0[0] : r1[1] - r0[1];
  const bays = Math.max(1, Math.round(run / 3.6));
  for (let i = 0; i <= bays; i++) {
    const v = (flat ? r0[0] : r0[1]) + (run * i) / bays;
    out.push(seam(flat ? [[v, y0], [v, y1]] : [[x0, v], [x1, v]]));
  }
  return out;
}

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
  if (s.covered) return marquee(s, roof, k);
  return [
    // Audience area, then the pit barrier in front of the stage. The river is drawn over it, so a crowd by the water stops at the bank.
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

/** A beach umbrella from above: eight panels, every other one white. */
function umbrella(at: P, c: string, k: Pal, r = 1.6): Feature[] {
  const ring = circle(at, r, 16);
  return [
    fill([shift(ring, 0.6, 0.8)], { l: 'thing', z: 54.5, c: k.shadow, o: k.shadowOpacity }),
    ...Array.from({ length: 8 }, (_, s) => fill([[at, ring[s * 2], ring[s * 2 + 1], ring[(s * 2 + 2) % 16]]], { l: 'thing', z: 55, c: s % 2 ? '#FFFFFF' : c })),
  ];
}

/** Paving as a rounded rectangle. */
function paving(p: Box, r: number): P[] {
  r = Math.min(r, p.w / 3, p.h / 3);
  const corners: P[] = [[p.x + r, p.y + r], [p.x + p.w - r, p.y + r], [p.x + p.w - r, p.y + p.h - r], [p.x + r, p.y + p.h - r]];
  return corners.flatMap(([cx, cy], q) =>
    Array.from({ length: 5 }, (_, i): P => {
      const a = ((q + 2 + i / 4) * Math.PI) / 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
  );
}

/**
 * Somewhere to sit, from above: a picnic table between its two benches, a café table ringed with four chairs, or a
 * bench. Turned to its heading, with an umbrella over it if it has one.
 */
function seat(s: Seat, i: number, k: Pal): Feature[] {
  const [ux, uy] = [Math.cos((s.deg * Math.PI) / 180), Math.sin((s.deg * Math.PI) / 180)];
  const at = (p: number, q: number): P => [s.x + ux * p - uy * q, s.y + uy * p + ux * q];
  const plank = (hw: number, hh: number, p = 0, q = 0): P[] => ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as P[]).map(([a, b]) => at(p + a, q + b));
  const out: Feature[] = [];
  if (s.kind === 'picnic') {
    out.push(...standing(plank(0.9, 0.4), k.timber, 52, k, 0.35));
    for (const q of [-0.75, 0.75]) out.push(fill([plank(0.9, 0.14, 0, q)], { l: 'thing', z: 52, c: k.timberShade }));
  } else if (s.kind === 'cafe') {
    for (const [p, q] of [[-1.45, 0], [1.45, 0], [0, -1.45], [0, 1.45]]) out.push(fill([plank(0.28, 0.28, p, q)], { l: 'thing', z: 52, c: k.timberShade }));
    out.push(...standing(circle(at(0, 0), 0.65, 10), k.timber, 52.1, k, 0.35));
  } else {
    out.push(...standing(plank(1.1, 0.28), k.timber, 52, k, 0.3));
  }
  if (s.umbrella) out.push(...umbrella(at(0, 0), UMBRELLAS[i % UMBRELLAS.length], k));
  return out;
}

/**
 * The food court (see foodCourt): trucks spread over the terrace, singly and in back-to-back pairs, each under a striped
 * awning on its hatch side with the cab at the front end (they park kerb side to the hatch), paving under each stall
 * and under the places to eat between them, and seating on it.
 */
function trucks(b: Box, k: Pal): Feature[] {
  const { trucks: all, seats, pads } = foodCourt(b);
  const out: Feature[] = [];
  for (const p of pads) {
    const ring = paving(p, 2.5);
    out.push(fill([ring], { l: 'ground', z: 3, c: k.plaza }), stroke([...ring, ring[0]], { l: 'groundLine', z: -2, c: k.plazaEdge, w: 0.3, min: 0.6 }));
  }
  all.forEach((t, i) => {
    const c = TRUCKS[(i * 3) % TRUCKS.length];
    const n = t.hatch === 'n';
    const awning = { x: t.x + (n ? 0.6 : 1.6), y: n ? t.y - 1.2 : t.y + t.h, w: 3.8, h: 1.2 };
    out.push(...standing(rect(t), c, 40, k, 0.7));
    out.push(fill([rect({ x: n ? t.x + t.w - 1.5 : t.x + 0.25, y: t.y + 0.25, w: 1.25, h: t.h - 0.5 })], { l: 'thing', z: 40.1, c: '#000000', o: 0.18 })); // cab
    out.push(fill([rect(awning)], { l: 'thing', z: 40.2, c: '#FFFFFF', o: 0.92 }));
    out.push(fill([rect({ ...awning, y: n ? awning.y : awning.y + 0.8, h: 0.4 })], { l: 'thing', z: 40.3, c, o: 0.9 }));
  });
  seats.forEach((s, i) => out.push(...seat(s, i, k)));
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

/** A flat-roofed building: walls (the shaded edge), then the roof set in towards its middle. */
function building(ring: P[], [lit, shaded]: readonly [string, string], k: Pal): Feature[] {
  const n = ring.length;
  const [cx, cy] = [ring.reduce((t, p) => t + p[0], 0) / n, ring.reduce((t, p) => t + p[1], 0) / n];
  const roof = ring.map(([x, y]): P => [cx + (x - cx) * 0.9, cy + (y - cy) * 0.9]);
  return [...standing(ring, shaded, 34, k, 1.8), fill([roof], { l: 'thing', z: 34.1, c: lit })];
}

const edgeKey = (a: P, b: P) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${a}|${b}` : `${b}|${a}`);

/** An area's outline, minus the edges it shares with a neighbouring area, so touching zones read as one. */
function outline(ring: P[]): P[][] {
  const count = new Map<string, number>();
  for (const z of Object.values(VENUE_ZONES)) {
    if (z.shape.kind !== 'area' || z.icon === 'shade') continue;
    const r = z.shape.ring;
    r.forEach((p, i) => { const key = edgeKey(p, r[(i + 1) % r.length]); count.set(key, (count.get(key) ?? 0) + 1); });
  }
  const lines: P[][] = [];
  let run: P[] = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    if (count.get(edgeKey(p, q)) === 1) {
      if (!run.length) run.push(p);
      run.push(q);
    } else if (run.length) {
      lines.push(run);
      run = [];
    }
  });
  if (run.length) lines.push(run);
  return lines;
}

function zoneArt(z: VenueZone, scheme: Scheme, k: Pal, stageIndex: number): Feature[] {
  const s = z.shape;
  const roof = ROOF[scheme];
  switch (s.kind) {
    case 'stage':
      return stage({ ...z, shape: s }, stageIndex === 0 ? roof.stage : stageIndex === 1 ? roof.stage2 : roof.stage3, k);
    case 'tent':
      return tent(s, z.icon === 'firstaid' ? roof.firstaid : z.icon === 'bar' ? roof.bar : roof.info, 50, k, z.icon === 'firstaid');
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
      // The Grove is its elms (see decor) and the Kids Playground its gear (see playground()), both open to everyone, so
      // no tint; so is the Market, drawn as its stalls (see amenities()); the
      // Artist Village is off the site; other areas are staff-only, shaded grey with a dashed edge.
      if (z.icon === 'artists') return village(s.ring, scheme, k);
      // Both backstages are inside the barricades: their ground is the restricted area's tint (see barricades).
      return z.icon === 'shade' || z.icon === 'shop' || z.icon === 'backstage'
        ? []
        : [
            fill([s.ring], { l: 'ground', z: 25, c: k.area, o: k.areaOpacity }),
            ...outline(s.ring).map((line) => stroke(line, { l: 'areaLine', z: 0, c: k.area, w: 0.3, min: 1.2 })),
          ];
    case 'building':
      return building(s.ring, z.icon === 'tickets' || z.icon === 'shop' || z.icon === 'supplies' ? roof[z.icon] : roof.pavilion, k);
    case 'gate':
      return [];
  }
}

/**
 * The ground: grass inside the fence, the terraces stepping down to the river, the main lawn's mown stripes, and the
 * river with its stone bank. Outside the fence the street map shows through a light wash.
 */
function ground(k: Pal): Feature[] {
  const fence = FENCE.flat() as P[];
  const far = 3000;
  const world: P[] = [[-far, -far], [far, -far], [far, far], [-far, far]];
  const out: Feature[] = [
    // Holes wind the other way from the ring they're cut from.
    ...(k.maskOpacity > 0 ? [fill([world, [...fence].reverse()], { l: 'mask', z: 0, c: k.mask, o: k.maskOpacity })] : []),
    // The lower terrace is the grass under everything; the upper and middle ones sit on it.
    fill([fence], { l: 'ground', z: 0, c: k.grass }),
    fill([TERRACES.upper], { l: 'ground', z: 1, c: k.upper }),
    fill([TERRACES.middle], { l: 'ground', z: 1, c: k.middle }),
    fill([MAIN_LAWN], { l: 'ground', z: 2, c: k.lawn }),
    fill([PLAYGROUND], { l: 'ground', z: 2, c: k.playground }),
    ...PLAZAS.flatMap((ring) => [
      fill([ring], { l: 'ground', z: 3, c: k.plaza }),
      stroke([...ring, ring[0]], { l: 'groundLine', z: -2, c: k.plazaEdge, w: 0.3, min: 0.6 }),
    ]),
    // Each drop to the next terrace: a soft shadow along its foot, and a crisp edge on top.
    ...TERRACE_EDGES.flatMap((line) => [
      stroke(beside(line, 1.6), { l: 'groundLine', z: -3, c: k.step, w: 3, min: 1, o: 0.22 }),
      stroke(line, { l: 'groundLine', z: -2.5, c: k.step, w: 0.35, min: 0.8, o: 0.55 }),
    ]),
    // The river: a stone bank (half of it is under the water), the water, and a few lines out on it.
    stroke([...RIVER, RIVER[0]], { l: 'bank', z: 0, c: k.bank, w: 6, min: 2 }),
    fill([RIVER], { l: 'water', z: 0, c: k.water }),
    ...RIPPLES.map((line, i) => stroke(line, { l: 'waterLine', z: 0, c: k.ripple, w: 0.5, min: 0.8, o: i ? 0.25 : 0.4 })),
    stroke([...RIVER, RIVER[0]], { l: 'waterLine', z: 1, c: k.waterEdge, w: 0.35, min: 0.8 }),
  ];
  // Mown stripes across the main lawn, square to the river.
  for (let x = 330; x < 475; x += 14) {
    const band = clipBand(MAIN_LAWN, x, x + 7);
    if (band.length > 2) out.push(fill([band], { l: 'ground', z: 2.5, c: k.stripe }));
  }
  return out;
}

/** The paths: the trail, the gravel by the river, the boardwalk at the water and the rest, under the trucks and tents. */
function footpaths(k: Pal): Feature[] {
  const look = {
    trail: { edge: k.trailEdge, top: k.trail, w: 4.5, z: 2 },
    gravel: { edge: k.walkEdge, top: k.walk, w: 3.4, z: 1 },
    boardwalk: { edge: k.boardEdge, top: k.board, w: 3, z: 1 },
    path: { edge: k.walkEdge, top: k.walk, w: 2, z: 0 },
  };
  const out = PATHS.flatMap(({ kind, line }) => {
    const s = look[kind];
    return [
      stroke(line, { l: 'walk', z: s.z, c: s.edge, w: s.w + 0.6, min: 1.2 }),
      stroke(line, { l: 'walk', z: s.z + 0.5, c: s.top, w: s.w, min: 0.8 }),
    ];
  });
  // Stairs: a tread every 0.8 m across the flight.
  for (const line of STAIRS) {
    for (let i = 0; i < line.length - 1; i++) {
      const [a, b] = [line[i], line[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      out.push(fill([ribbon([a, b], 3)], { l: 'ground', z: 4, c: k.plaza }));
      for (let t = 0.4; t < len; t += 0.8) {
        const [x, y] = [a[0] + ux * t, a[1] + uy * t];
        out.push(stroke([[x - uy * 1.5, y + ux * 1.5], [x + uy * 1.5, y - ux * 1.5]], { l: 'groundLine', z: 0, c: k.stair, w: 0.15, min: 0.5 }));
      }
    }
  }
  return out;
}

/** The footbridges: a deck standing over everything under it, a rail down each side, running on off the site. */
function bridges(k: Pal): Feature[] {
  return BRIDGES.flatMap(({ line, width }) => [
    ...standing(ribbon(line, width), k.bridge, 64, k, 2.2),
    ...[-1, 1].map((s) => stroke(beside(line, (s * width) / 2 - s * 0.3), { l: 'thingLine', z: 2, c: k.bridgeRail, w: 0.3, min: 0.8 })),
  ]);
}

function decor(scheme: Scheme, k: Pal): Feature[] {
  const roof = ROOF[scheme];
  const out: Feature[] = [];
  // Trees. Few corners each: there are hundreds, and the style is sent whole to the native map.
  for (const [x, y, r] of TREES) {
    out.push(fill([shift(circle([x, y], r, 14), r * 0.25, r * 0.3)], { l: 'canopyShade', z: 59.5, c: k.shadow, o: k.shadowOpacity }));
    out.push(fill([circle([x, y], r, 14)], { l: 'canopy', z: 60, c: k.tree }));
    out.push(fill([circle([x - r * 0.28, y - r * 0.3], r * 0.55, 10)], { l: 'canopy', z: 60.1, c: k.treeLit }));
  }
  // The ones off the site just a faded canopy, like the streets under the wash.
  for (const [x, y, r] of CONTEXT_TREES) out.push(fill([circle([x, y], r, 9)], { l: 'canopy', z: 59, c: k.tree, o: 0.4 }));
  // Sails hang above the planting, so a canopy never covers their edge.
  for (const sail of DECOR.sails) {
    out.push(...standing(sail, k.sail, 61, k, 1.6, 'canopy'));
    out.push(stroke([...sail, sail[0]], { l: 'canopyLine', z: 0, c: k.sailEdge, w: 0.25, min: 0.8 }));
  }
  DECOR.seating.forEach((st, i) => out.push(...seat(st, i, k)));
  // The Federation Bells, each a bronze dot on its pole; Birrarung Marr Landing on the water.
  for (const at of FEDERATION_BELLS) out.push(fill([circle(at, 0.55, 8)], { l: 'thing', z: 46, c: k.bell }));
  out.push(...standing(LANDING.pier, k.pier, 33, k, 0.6));
  out.push(stroke(LANDING.gangway, { l: 'thingLine', z: 0, c: k.pier, w: 1.4, min: 1.5 }));
  // The Artist Gate compound: the Green Room marquee and the artists' vans.
  for (const t of ARTIST_TENTS) out.push(...tent(t.box, roof.artists, 50, k));
  for (const ring of DECOR.cabins) {
    const cx = ring.reduce((t, p) => t + p[0], 0) / 4, cy = ring.reduce((t, p) => t + p[1], 0) / 4;
    out.push(...standing(ring, roof.artists[1], 50, k, 0.7));
    out.push(fill([ring.map(([x, y]): P => [cx + (x - cx) * 0.78, cy + (y - cy) * 0.78])], { l: 'thing', z: 50.1, c: roof.artists[0] }));
  }
  for (const ring of DECOR.vans) {
    out.push(...standing(ring, k.trailer, 50, k, 0.7));
    out.push(stroke([...ring, ring[0]], { l: 'thingLine', z: 0, c: k.trailerEdge, w: 0.2, min: 0.6 }));
  }
  // The Control Rooms: the sheds, and the stock containers beside them.
  for (const ring of CONTROL_SHEDS) out.push(...building(ring, roof.control, k));
  for (const b of DECOR.stores) {
    out.push(...standing(rect(b), roof.supplies[1], 50, k, 0.7));
    out.push(fill([rect(inset(b, 0.35))], { l: 'thing', z: 50.1, c: roof.supplies[0] }));
  }
  for (const b of DECOR.trailers) {
    out.push(...standing(rect(b), k.trailer, 50, k, 0.6));
    out.push(stroke([...rect(b), rect(b)[0]], { l: 'thingLine', z: 0, c: k.trailerEdge, w: 0.2, min: 0.6 }));
  }
  for (const b of DECOR.medics) out.push(...tent(b, roof.firstaid, 50, k, true));
  for (const b of DECOR.foh) out.push(...tent(b, roof.foh, 50, k));
  for (const b of DECOR.security) out.push(...tent(b, roof.security, 50, k));
  // Queue rails: darker than the pit barriers, so they show on the pale ground outside the fence.
  for (const line of [...DECOR.lanes, ...DECOR.barriers]) out.push(stroke(line, { l: 'thingLine', z: 3, c: k.rail, w: 0.35, min: 1 }));
  return out;
}

/** The Grove: sails, picnic tables and umbrellas round the Grove Stage's marquee. */
function grove(scheme: Scheme, k: Pal): Feature[] {
  const out: Feature[] = [];
  // Picnic tables: a top between its two benches, turned to its heading.
  for (const [x, y, deg] of GROVE.tables) {
    const [ux, uy] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
    const plank = (half: number, thick: number, off: number): P[] =>
      ([[-half, -thick], [half, -thick], [half, thick], [-half, thick]] as P[]).map(([p, q]): P => [x + ux * p - uy * (q + off), y + uy * p + ux * (q + off)]);
    out.push(...standing(plank(0.9, 0.4, 0), k.timber, 52, k, 0.35));
    for (const off of [-0.75, 0.75]) out.push(fill([plank(0.9, 0.14, off)], { l: 'thing', z: 52, c: k.timberShade }));
  }
  // Umbrellas: the Grove Stage's colour and white, like the ones by Food Alley.
  const accent = ROOF[scheme].stage3[1];
  for (const at of GROVE.umbrellas) {
    const ring = circle(at, 1.6, 16);
    out.push(fill([shift(ring, 0.6, 0.8)], { l: 'thing', z: 54.5, c: k.shadow, o: k.shadowOpacity }));
    for (let s = 0; s < 8; s++) out.push(fill([[at, ring[s * 2], ring[s * 2 + 1], ring[(s * 2 + 2) % 16]]], { l: 'thing', z: 55, c: s % 2 ? '#FFFFFF' : accent }));
  }
  // Sails hang above the elms, so a canopy never covers their edge. Each edge curves in towards the middle.
  for (const corners of GROVE.sails) out.push(...sail(corners, k));
  return out;
}

/** A shade sail from its corners, hung above the planting: each edge curves in towards the middle, like a real sail's. */
function sail(corners: P[], k: Pal): Feature[] {
  const [mx, my] = [corners.reduce((t, p) => t + p[0], 0) / corners.length, corners.reduce((t, p) => t + p[1], 0) / corners.length];
  const ring = corners.flatMap((a, i): P[] => {
    const b = corners[(i + 1) % corners.length];
    return [0, 0.25, 0.5, 0.75].map((t): P => {
      const [x, y] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const pull = 0.5 * t * (1 - t); // 12% of the way to the middle at the edge's midpoint
      return [x + (mx - x) * pull, y + (my - y) * pull];
    });
  });
  return [...standing(ring, k.sail, 61, k, 1.6, 'canopy'), stroke([...ring, ring[0]], { l: 'canopyLine', z: 0, c: k.sailEdge, w: 0.25, min: 0.8 })];
}

const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * A pop-up gazebo from above, turned square to whatever it faces: like tent(), four canvas panels meeting at the peak,
 * each lit by how far it faces the top left, with the valance over its counter (the ring's third edge, see MARKET)
 * in `accent`.
 */
function gazebo(ring: P[], accent: string, k: Pal): Feature[] {
  const c: P = [ring.reduce((t, p) => t + p[0], 0) / 4, ring.reduce((t, p) => t + p[1], 0) / 4];
  const out = standing(ring, k.canvasShade, 50, k, 0.7);
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % 4], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const [nx, ny] = [(b[1] - a[1]) / l, (a[0] - b[0]) / l]; // the edge's outward normal (the ring runs clockwise)
    const lit = -nx - ny > -0.3; // facing the light from the top left
    out.push(fill([[a, b, c]], { l: 'thing', z: 50.1, c: lit ? k.canvas : k.canvasShade, o: lit && nx < ny ? 0.85 : 1 }));
  });
  const [, , fr, fl] = ring;
  out.push(fill([[fr, fl, lerp(fl, ring[0], 0.15), lerp(fr, ring[1], 0.15)]], { l: 'thing', z: 50.2, c: accent }));
  return out;
}

/** A cabin from above, like the artists' trailers: a pale roof with its edge drawn. */
function cabin(ring: P[], k: Pal): Feature[] {
  return [...standing(ring, k.trailer, 50, k, 0.6), stroke([...ring, ring[0]], { l: 'thingLine', z: 0, c: k.trailerEdge, w: 0.2, min: 0.6 })];
}

/**
 * The festival's amenities: the Market (MARKET) along the gravel path, gazebos with their counters in the shop's
 * colour, the lockers and the phone-charging bar; the hammocks, bean bags and sail east of it (LOUNGE); and the
 * upper terrace's attractions (ATTRACTIONS): the photo booths on their pad, the chair swing ride, the lawn games and
 * the silent disco's marquee. Bean bags and hammocks take the umbrellas' colours; the attractions share the Grove's.
 */
function amenities(scheme: Scheme, k: Pal): Feature[] {
  const roof = ROOF[scheme];
  const out: Feature[] = [];
  // The Market: every gazebo the same, the glitter one with its stools out front.
  for (const ring of [...MARKET.stalls, MARKET.glitter]) out.push(...gazebo(ring as P[], roof.shop[1], k));
  for (const at of MARKET.stools) out.push(...standing(circle(at, 0.25, 8), k.timberShade, 52, k, 0.2));
  // Lockers: one long bank, a seam between each column of doors.
  const lockers = MARKET.lockers as P[];
  out.push(...cabin(lockers, k));
  for (const t of [0.2, 0.4, 0.6, 0.8]) out.push(stroke([lerp(lockers[0], lockers[1], t), lerp(lockers[3], lockers[2], t)], { l: 'thingLine', z: 0, c: k.trailerEdge, w: 0.12, min: 0.5 }));
  // The charging bar: a cabin, with a timber counter along its front.
  const [b0, b1, b2, b3] = MARKET.charging as P[];
  const ahead = (p: P, q: P): P => lerp(p, q, -0.5 / Math.hypot(q[0] - p[0], q[1] - p[1])); // half a metre on past p, away from q
  out.push(...cabin([b0, b1, b2, b3], k), ...standing([b2, b3, ahead(b3, b0), ahead(b2, b1)], k.timber, 50.5, k, 0.3));
  // Hammocks on their stands, bean bags, and the sail over them.
  LOUNGE.hammocks.forEach((r, i) => {
    const [h0, h1, h2, h3] = r as P[];
    const [a, b] = [lerp(h0, h3, 0.5), lerp(h1, h2, 0.5)];
    const across: P = [(h3[0] - h0[0]) / 2, (h3[1] - h0[1]) / 2];
    const side = (s: number) => Array.from({ length: 9 }, (_, j): P => {
      const t = 0.08 + (0.84 * j) / 8, w = 0.8 * Math.sin(Math.PI * ((t - 0.08) / 0.84)) * s;
      const m = lerp(a, b, t);
      return [m[0] + across[0] * w, m[1] + across[1] * w];
    });
    out.push(stroke([a, b], { l: 'thingLine', z: 0, c: k.timberShade, w: 0.18, min: 0.6 }));
    for (const [p, q] of [[h0, h3], [h1, h2]]) out.push(stroke([p, q], { l: 'thingLine', z: 0, c: k.timberShade, w: 0.15, min: 0.6 }));
    out.push(...standing([...side(1), ...side(-1).reverse()], UMBRELLAS[i % UMBRELLAS.length], 52, k, 0.3));
  });
  LOUNGE.beanbags.forEach((at, i) => out.push(...standing(circle(at, 0.55, 10), UMBRELLAS[(i + 1) % UMBRELLAS.length], 52, k, 0.3)));
  for (const corners of LOUNGE.sails) out.push(...sail(corners, k));
  // The attractions.
  const accent = roof.stage3[1];
  const A = ATTRACTIONS;
  const pad = paving(A.pad, 1.5);
  out.push(fill([pad], { l: 'ground', z: 3, c: k.plaza }), stroke([...pad, pad[0]], { l: 'groundLine', z: -2, c: k.plazaEdge, w: 0.3, min: 0.6 }));
  for (const b of A.booths) out.push(...cabin(rect(b), k), fill([rect({ x: b.x + 0.3, y: b.y + b.h - 0.4, w: b.w - 0.6, h: 0.4 })], { l: 'thing', z: 50.1, c: accent }));
  out.push(...standing(rect(A.wall), k.treeLit, 50, k, 0.5));
  // The swing ride: its round floor, the fence with its way in, the chairs swung out, and the canopy over the mast.
  const { at, canopy, chairs, fence } = A.swings;
  const floor = circle(at, chairs + 1.2, 28);
  out.push(fill([floor], { l: 'ground', z: 3, c: k.plaza }), stroke([...floor, floor[0]], { l: 'groundLine', z: -2, c: k.plazaEdge, w: 0.3, min: 0.6 }));
  const gap = (135 * Math.PI) / 180; // the way in, south-west
  out.push(stroke(Array.from({ length: 33 }, (_, i): P => {
    const a = gap + 0.3 + ((2 * Math.PI - 0.6) * i) / 32;
    return [at[0] + fence * Math.cos(a), at[1] + fence * Math.sin(a)];
  }), { l: 'thingLine', z: 3, c: k.rail, w: 0.3, min: 1 }));
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    out.push(...standing(circle([at[0] + chairs * Math.cos(a), at[1] + chairs * Math.sin(a)], 0.35, 6), accent, 52, k, 0.3));
  }
  out.push(...umbrella(at, accent, k, canopy));
  // Lawn games: the chess board's dark squares on a pale mat, cornhole boards with their holes at the far ends, Jenga, Connect Four.
  out.push(fill([rect(A.chess)], { l: 'thing', z: 49, c: k.canvas }));
  const sq = A.chess.w / 8;
  for (let r = 0; r < 8; r++) for (let c = (r + 1) % 2; c < 8; c += 2) out.push(fill([rect({ x: A.chess.x + c * sq, y: A.chess.y + r * sq, w: sq, h: sq })], { l: 'thing', z: 49.1, c: k.timberShade }));
  A.cornhole.forEach((b, i) => {
    out.push(...standing(rect(b), k.timber, 50, k, 0.25));
    out.push(fill([circle([i % 2 ? b.x + b.w - 0.3 : b.x + 0.3, b.y + b.h / 2], 0.12, 8)], { l: 'thing', z: 50.1, c: k.deck }));
  });
  out.push(...standing(rect(A.jenga), k.timber, 50, k, 0.6), ...standing(rect(A.connect), WATER[scheme][1], 50, k, 0.4));
  out.push(...tent(A.disco, [k.canvas, k.canvasShade], 50, k));
  return out;
}

/**
 * The Kids Playground's gear, from above (see PLAY): rubber soft-fall and the timber-edged sandpit on the ground, the
 * swing frame and its seats, the rope net round its mast, the cubby tower with its slide, benches, and the low fence
 * along the path with its way in.
 */
function playground(k: Pal): Feature[] {
  const out: Feature[] = [];
  for (const ring of [...PLAY.softfall.map((b) => paving(b, 2)), circle(PLAY.net.at, PLAY.net.pad, 24)]) out.push(fill([ring], { l: 'ground', z: 3.5, c: k.softfall }));
  const sand = paving(PLAY.sandpit, 1.5);
  out.push(fill([sand], { l: 'ground', z: 3.6, c: k.sand }), stroke([...sand, sand[0]], { l: 'groundLine', z: -1, c: k.timberShade, w: 0.3, min: 0.6 }));
  // The swings: the beam on its three A-frames, a shadow under it, two flat seats and the basket.
  const { beam, seats, basket } = PLAY.swings;
  const line = (pts: P[], c: string, w: number, z: number, o?: number): Feature => stroke(pts, { l: 'thingLine', z, c, w, min: 0.6, o });
  out.push(line(shift(beam as P[], 0.5, 0.6), k.shadow, 0.3, 3, k.shadowOpacity));
  for (const x of [beam[0][0], (beam[0][0] + beam[1][0]) / 2, beam[1][0]]) out.push(line([[x, beam[0][1] - 1.4], [x, beam[0][1] + 1.4]], k.play, 0.18, 4));
  out.push(line(beam as P[], k.play, 0.3, 4.5));
  for (const [x, y] of seats) out.push(fill([rect({ x: x - 0.25, y: y - 0.11, w: 0.5, h: 0.22 })], { l: 'thing', z: 51, c: k.rail }));
  out.push(line([...circle(basket, 0.55, 12), circle(basket, 0.55, 12)[0]], k.rail, 0.12, 5));
  // The climbing net: ropes from the mast to each pole, round the poles, and two rounds between.
  const { at, r } = PLAY.net;
  const poles = circle(at, r, 6);
  for (const p of poles) out.push(line([at, p], k.rail, 0.1, 5));
  for (const f of [1 / 3, 2 / 3, 1]) {
    const round = circle(at, r * f, 6);
    out.push(line([...round, round[0]], k.rail, 0.1, 5));
  }
  for (const p of poles) out.push(fill([circle(p, 0.18, 8)], { l: 'thing', z: 51, c: k.timberShade }));
  out.push(...standing(circle(at, 0.3, 10), k.play, 51, k, 0.4));
  // The slide, lit down its middle, under the cubby it comes off; the cubby's roof is pitched like a little marquee.
  out.push(...standing(ribbon(PLAY.slide as P[], 0.9), k.play, 49, k, 0.5));
  out.push(fill([ribbon(PLAY.slide as P[], 0.4)], { l: 'thing', z: 49.1, c: '#FFFFFF', o: 0.35 }));
  out.push(...tent(PLAY.tower, [k.timber, k.timberShade], 50, k));
  PLAY.benches.forEach((s, i) => out.push(...seat(s, i, k)));
  // The fence: a low timber rail with a post every 2.4 m.
  for (const run of PLAY.fence as P[][]) {
    out.push(line(run, k.timberShade, 0.16, 3));
    for (const { at: [x, y], u: [ux, uy] } of every(run, 2.4, 0)) out.push(line([[x - ux * 0.1, y - uy * 0.1], [x + ux * 0.1, y + uy * 0.1]], k.timberShade, 0.35, 3.1));
  }
  return out;
}

/** Points every `step` metres along a line, from `start` in, each with the line's direction there. */
function every(line: P[], step: number, start = step / 2): { at: P; u: P }[] {
  const out: { at: P; u: P }[] = [];
  let next = start;
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) continue;
    const u: P = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    for (; next <= len; next += step) out.push({ at: [a[0] + u[0] * next, a[1] + u[1] * next], u });
    next -= len;
  }
  return out;
}

/** A crowd barrier along `line`: a slate rail on a pale casing, with a post at every other panel joint (4.8 m). */
function barrier(line: P[], k: Pal): Feature[] {
  return [
    stroke(line, { l: 'barricade', z: 0, c: k.fenceCasing, w: 0.95, min: 3 }),
    stroke(line, { l: 'barricade', z: 1, c: k.rail, w: 0.28, min: 1.3 }),
    // A dot: a line shorter than it is wide, with its round caps (long enough to survive the rounding to 10 cm).
    ...every(line, 4.8, 0).map(({ at: [x, y], u: [ux, uy] }) =>
      stroke([[x - ux * 0.12, y - uy * 0.12], [x + ux * 0.12, y + uy * 0.12]], { l: 'barricadeFoot', z: 0, c: k.rail, w: 0.55, min: 2.4 })),
  ];
}

/** Chevrons along a line, pointing the way it runs. */
function chevrons(line: P[], step: number, c: string): Feature[] {
  return every(line, step).map(({ at: [x, y], u: [ux, uy] }) =>
    stroke([[x - ux * 0.9 + uy * 1.3, y - uy * 0.9 - ux * 1.3], [x + ux * 0.6, y + uy * 0.6], [x - ux * 0.9 - uy * 1.3, y - uy * 0.9 + ux * 1.3]], { l: 'thingLine', z: 6, c, w: 0.4, min: 1.4 }));
}

/**
 * The barricades that close both bridges to festival-goers (BARRICADES), the crew's side behind them in backstage grey
 * (the Artist Gate compound, the crew lane, Backstage and both decks, as one area), and the artists' way in over
 * William Barak Bridge from the Artist Village.
 */
function barricades(scheme: Scheme, k: Pal): Feature[] {
  // One crew-grey tint over all of it: the compound, the crew lane, Backstage and both decks inside the park.
  const out: Feature[] = [fill([restrictedArea()], { l: 'ground', z: 25, c: k.area, o: k.areaOpacity })];
  // The runs end inside the stages they meet; drawn, each stops at the stage's edge.
  const stages = Object.values(VENUE_ZONES).flatMap((z) => (z.shape.kind === 'stage' ? [z.shape] : []));
  const inStage = ([x, y]: P) => stages.some((b) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h);
  const trim = (line: P[]): P[] => {
    let pts = line;
    for (let end = 0; end < 2; end++) {
      let i = 0;
      while (i < pts.length - 1 && inStage(pts[i])) i++;
      if (i > 0) {
        // Halve back to the edge between the last point inside and the first outside.
        let [a, b] = [pts[i - 1], pts[i]];
        for (let n = 0; n < 16; n++) {
          const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (inStage(m)) a = m;
          else b = m;
        }
        pts = [b, ...pts.slice(i)];
      }
      pts = [...pts].reverse();
    }
    return pts;
  };
  for (const b of BARRICADES) out.push(...barrier(trim(smooth(b.line, b.closed) as P[]), k));
  // The crew gate: the gap between the Lawn Stage's south-west corner and the start of the Tanderrum run, the one way
  // into Backstage. Drawn shut, in line with the barricade either side, with a post at each end.
  const lawn = VENUE_ZONES['lawn-stage']?.shape;
  if (lawn?.kind === 'stage') {
    const a = BARRICADES[1].line[0] as P;
    const corner: P = [lawn.x, lawn.y + lawn.h];
    const len = Math.hypot(corner[0] - a[0], corner[1] - a[1]);
    const g: P = [(corner[0] - a[0]) / len, (corner[1] - a[1]) / len];
    const b: P = [corner[0] - g[0] * 0.6, corner[1] - g[1] * 0.6];
    out.push(...barrier([a, b], k).slice(0, 2));
    for (const p of [a, b]) {
      const dot: P[] = [[p[0] - g[0] * 0.12, p[1] - g[1] * 0.12], [p[0] + g[0] * 0.12, p[1] + g[1] * 0.12]];
      out.push(stroke(dot, { l: 'barricade', z: 3, c: k.fenceCasing, w: 1.2, min: 4.5 }), stroke(dot, { l: 'barricade', z: 4, c: k.rail, w: 0.75, min: 3 }));
    }
  }
  // The artists' way in: from the Artist Village down onto William Barak Bridge and along the deck to the Artist Gate,
  // stopping short of the gate's badge.
  const village = VENUE_ZONES['artist-village']?.shape;
  const node = NODES[VENUE_ZONES['artist-village']?.node ?? ''];
  const deck = BRIDGES[0].line as P[];
  if (village?.kind === 'area' && node) {
    const at: P = [node.x, node.y];
    const near = (r: P[]): P => {
      let best: P = r[0], d = Infinity;
      r.forEach((a, i) => {
        const b = r[(i + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (dx * dx + dy * dy)));
        const p: P = [a[0] + dx * t, a[1] + dy * t], dd = Math.hypot(p[0] - at[0], p[1] - at[1]);
        if (dd < d) [best, d] = [p, dd];
      });
      return best;
    };
    // The deck from the node back to the landing, less the last 26 m (the gate and its badge).
    const down = [...deck].reverse().filter(([x]) => x < at[0]);
    const way: P[] = [near(village.ring), at, ...down];
    let left = way.slice(0, -1).reduce((t, p, i) => t + Math.hypot(way[i + 1][0] - p[0], way[i + 1][1] - p[1]), 0) - 26;
    const cut: P[] = [way[0]];
    for (let i = 1; i < way.length && left > 0; i++) {
      const [a, b] = [way[i - 1], way[i]], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      cut.push(len <= left ? b : [a[0] + ((b[0] - a[0]) * left) / len, a[1] + ((b[1] - a[1]) * left) / len]);
      left -= len;
    }
    out.push(...chevrons(cut, 9, ROOF[scheme].artists[scheme === 'light' ? 1 : 0]));
  }
  return out;
}

/** The Artist Village, off the site over William Barak Bridge: dimmed like the city round the site, two faded marquees. */
function village(ring: P[], scheme: Scheme, k: Pal): Feature[] {
  const n = ring.length;
  const c: P = [ring.reduce((t, p) => t + p[0], 0) / n, ring.reduce((t, p) => t + p[1], 0) / n];
  const deck = BRIDGES[0].line as P[];
  const [a, b] = deck.slice(-2);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u: P = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], v: P = [u[1], -u[0]];
  const [lit, shaded] = ROOF[scheme].artists;
  const marquee = (along: number, w: number, h: number): Feature[] => {
    const at = (p: number, q: number): P => [c[0] + u[0] * (along + p) + v[0] * q, c[1] + u[1] * (along + p) + v[1] * q];
    const [tl, tr, br, bl, m] = [at(-w / 2, h / 2), at(w / 2, h / 2), at(w / 2, -h / 2), at(-w / 2, -h / 2), at(0, 0)];
    return [
      fill([[tl, tr, m]], { l: 'thing', z: 49, c: lit, o: 0.4 }),
      fill([[tl, m, bl]], { l: 'thing', z: 49, c: lit, o: 0.34 }),
      fill([[tr, br, m]], { l: 'thing', z: 49, c: shaded, o: 0.4 }),
      fill([[m, br, bl]], { l: 'thing', z: 49, c: shaded, o: 0.4 }),
    ];
  };
  return [
    fill([ring], { l: 'ground', z: 25, c: k.area, o: k.areaOpacity * 0.7 }),
    stroke([...ring, ring[0]], { l: 'areaLine', z: 0, c: k.area, w: 0.3, min: 1.2, o: 0.6 }),
    ...marquee(-19, 12, 8),
    ...marquee(19, 12, 8),
  ];
}

function fence(k: Pal): Feature[] {
  // A post wherever the fence stops for a gate.
  const posts = FENCE.flatMap((line) => [line[0], line[line.length - 1]]).flatMap((end) => standing(circle(end, 0.9, 12), k.fence, 70, k, 0.4));
  return [...FENCE.map((line) => stroke(line, { l: 'fence', z: 0, c: k.fence })), ...posts];
}

// ---------------------------------------------------------------------------------------------
// Icons and names

/** Where a zone's badge goes: the middle of what's drawn for it. */
function iconAt(z: VenueZone): P {
  const s = z.shape;
  if (z.badge) return z.badge;
  if (s.kind === 'water' || s.kind === 'gate') return [s.x, s.y];
  if (s.kind === 'building') {
    // Area centroid: a footprint's corners bunch up along its fiddly sides.
    let a = 0, x = 0, y = 0;
    s.ring.forEach((p, i) => {
      const q = s.ring[(i + 1) % s.ring.length], c = p[0] * q[1] - q[0] * p[1];
      a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c;
    });
    return [x / (3 * a), y / (3 * a)];
  }
  if (s.kind === 'area') {
    const n = s.ring.length;
    return [s.ring.reduce((t, p) => t + p[0], 0) / n, s.ring.reduce((t, p) => t + p[1], 0) / n];
  }
  return centre(s);
}

/** Which badges are placed first when they compete for room. */
const RANK: Record<ZoneIcon, number> = { stage: 0, gate: 1, firstaid: 2, food: 3, info: 4, water: 5, toilets: 6, shade: 7, backstage: 8, pavilion: 9, bar: 10, tickets: 11, shop: 12, supplies: 13, artists: 14 };

/** Zones whose name goes above the badge: something below it (the river, the trucks) would hide a name there. */
const NAME_ABOVE = new Set(['merch-lounge', 'info-tent', 'toilets-west', 'gate-a', 'playground']);

/** Compass bearing of a direction in plan space. */
const bearingOf = ([dx, dy]: P) => (Math.atan2(dx, -dy) * 180) / Math.PI + GEO.bearing - 90;

type PointProps = {
  icon?: MapIconName; label: string; rank: number;
  /**
   * A zone's badge, a decor badge, a gate's in/out arrows, a landmark's name (no badge), a place off the site, or
   * a name along a line (the river, a bridge).
   */
  kind: 'zone' | 'decor' | 'way' | 'landmark' | 'place' | 'line' | 'water';
  above?: boolean;
  /** Arrows only: compass bearing of the way in. */
  rotate?: number;
};
type NamedFeature = GeoJSON.Feature<GeoJSON.Point | GeoJSON.LineString, PointProps>;
const point = (at: P, p: PointProps): NamedFeature => ({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: ll(at) } });
const along = (line: P[], p: PointProps): NamedFeature => ({ type: 'Feature', properties: p, geometry: { type: 'LineString', coordinates: line.map(ll) } });

function points(): GeoJSON.FeatureCollection {
  const middle = (pts: P[]): P => [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
  return {
    type: 'FeatureCollection',
    features: [
      ...Object.values(VENUE_ZONES).map((z) =>
        point(iconAt(z), { icon: z.icon, label: z.label, rank: RANK[z.icon], kind: 'zone', above: NAME_ABOVE.has(z.slug) }),
      ),
      ...DECOR.medics.map((b) => point(centre(b), { icon: 'medic', label: '', rank: 20, kind: 'decor' })),
      point([485, 124.8], { icon: 'supplies', label: 'Storage', rank: 22, kind: 'decor' }),
      point([305.8, 176], { icon: 'supplies', label: 'Storage', rank: 22, kind: 'decor' }),
      ...CONTROL_SHEDS.map((ring) => point([(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2], { icon: 'control', label: 'Control Room', rank: 22, kind: 'decor' })),
      ...ARTIST_TENTS.map((t) => point(centre(t.box), { icon: t.icon, label: t.name, rank: 22, kind: 'decor' })),
      ...GATEWAYS.map((g) => point(g.at, { icon: 'way', label: '', rank: 30, kind: 'way', rotate: bearingOf(g.in) })),
      point(middle(FEDERATION_BELLS), { label: 'Federation Bells', rank: 40, kind: 'landmark' }),
      point(centre(ATTRACTIONS.pad), { icon: 'photo', label: 'Photo Booths', rank: 23, kind: 'decor' }),
      point(ATTRACTIONS.swings.at, { icon: 'ride', label: 'Swing Ride', rank: 23, kind: 'decor' }),
      point(centre(ATTRACTIONS.disco), { icon: 'disco', label: 'Silent Disco', rank: 23, kind: 'decor' }),
      point(middle([ATTRACTIONS.chess, ...ATTRACTIONS.cornhole, ATTRACTIONS.jenga, ATTRACTIONS.connect].map(centre)), { icon: 'games', label: 'Lawn Games', rank: 24, kind: 'decor' }),
      point(middle(LANDING.pier), { label: 'The Landing', rank: 41, kind: 'landmark', above: false }),
      ...PLACE_NAMES.map((p) => point(p.at, { label: p.name, rank: 50, kind: 'place' })),
      ...BRIDGES.map((b) => along(b.line, { label: b.name, rank: 45, kind: 'line' })),
      along(RIVER_LINE, { label: 'Birrarung · Yarra River', rank: 44, kind: 'water' }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Sources and layers

/** The footprint of a zone, for highlighting a destination. Points (gates, water) have none. */
export function zoneFootprint(slug: string | null | undefined): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const s = slug ? VENUE_ZONES[slug]?.shape : undefined;
  if (!s || s.kind === 'water' || s.kind === 'gate') return null;
  const ring = s.kind === 'area' || s.kind === 'building' ? s.ring : rect(s);
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
      art: { type: 'FeatureCollection', features: [...ground(k), ...footpaths(k), ...zones, ...decor(scheme, k), ...grove(scheme, k), ...amenities(scheme, k), ...playground(k), ...bridges(k), ...barricades(scheme, k), ...fence(k)] },
      points: points(),
    };
  }
  return built[scheme]!;
}

/** `w` metres on the ground at any zoom, never thinner than `min` pixels. Pixels per metre here are 2^z / 61840 (512 px tiles). */
const metres: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  14, ['max', ['*', ['get', 'w'], 0.265], ['coalesce', ['get', 'min'], 0]],
  21, ['max', ['*', ['get', 'w'], 33.91], ['coalesce', ['get', 'min'], 0]],
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
    // The bank goes under the water, which covers its outer half (and any crowd that reaches the river).
    lineLayer('site-bank', 'bank'),
    fillLayer('site-water', 'water'),
    lineLayer('site-water-line', 'waterLine'),
    lineLayer('site-ground-line', 'groundLine'),
    lineLayer('site-walk', 'walk'),
    lineLayer('site-area-line', 'areaLine', { dash: [2, 1.5] }),
    fillLayer('site-things', 'thing'),
    lineLayer('site-things-line', 'thingLine'),
    // Trees and sails get their own layers, shadows under canopies: a fill layer draws every polygon's antialiased edge after all its fills, which would show a building's (or a shadow's) edge through a canopy.
    fillLayer('site-canopy-shade', 'canopyShade'),
    fillLayer('site-canopy', 'canopy'),
    lineLayer('site-canopy-line', 'canopyLine'),
    // Barricades over the elms, so the line round the bridges reads whole; their posts only close in.
    lineLayer('site-barricade', 'barricade'),
    { ...lineLayer('site-barricade-feet', 'barricadeFoot'), minzoom: 17 } as LayerSpecification,
    {
      id: 'site-fence-casing', type: 'line', source: 'site-art', filter: on('fence'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': k.fenceCasing, 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 16, 3, 18, 5] },
    },
    {
      id: 'site-fence', type: 'line', source: 'site-art', filter: on('fence'),
      layout: { 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 16, 1.5, 18, 2.6], 'line-dasharray': [2.2, 1.4] },
    },
  ];
}

/** Badges and names: drawn last, so they're placed before the base map's labels. */
export function siteLabelLayers(scheme: Scheme): LayerSpecification[] {
  const k = PALETTE[scheme];
  const size: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 14, 0.5, 15.5, 0.68, 17, 0.9, 18.5, 1];
  const above: ExpressionSpecification = ['==', ['get', 'above'], true];
  const kind = (...kinds: PointProps['kind'][]): ExpressionSpecification => ['match', ['get', 'kind'], kinds, true, false];
  return [
    {
      // The river's and the bridges' names, along them. Placed after the badges, so they give way.
      id: 'site-line-names', type: 'symbol', source: 'site-points', filter: kind('line', 'water'),
      minzoom: 15,
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': ['get', 'label'], 'text-max-angle': 30,
        'text-font': ['case', kind('water'), ['literal', ['Noto Sans Italic']], ['literal', ['Noto Sans Regular']]],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, ['case', kind('water'), 11, 9.5], 18, ['case', kind('water'), 15, 12]],
        'text-letter-spacing': ['case', kind('water'), 0.12, 0.04], 'text-padding': 4,
      },
      paint: { 'text-color': ['case', kind('water'), k.waterText, k.placeText], 'text-halo-color': k.halo, 'text-halo-width': ['case', kind('water'), 0, 1.4] },
    },
    {
      // What's past each edge, and landmarks without a badge: quiet, so the site's own names lead.
      id: 'site-place-names', type: 'symbol', source: 'site-points', filter: kind('place', 'landmark'),
      minzoom: 14.5,
      layout: {
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'symbol-sort-key': ['get', 'rank'], 'text-max-width': 7,
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, ['case', kind('place'), 10.5, 9.5], 18, ['case', kind('place'), 13, 12]],
        'text-letter-spacing': ['case', kind('place'), 0.06, 0.02],
      },
      paint: { 'text-color': k.placeText, 'text-halo-color': k.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'site-ways', type: 'symbol', source: 'site-points', filter: kind('way'),
      minzoom: 15.5,
      layout: {
        'icon-image': 'site-way', 'icon-size': ['interpolate', ['linear'], ['zoom'], 15.5, 0.6, 17, 0.85, 18.5, 1.05],
        'icon-rotate': ['get', 'rotate'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
    },
    {
      id: 'site-decor-icons', type: 'symbol', source: 'site-points', filter: kind('decor'),
      minzoom: 15.5,
      layout: {
        'icon-image': ['concat', 'site-', ['get', 'icon']], 'icon-size': size, 'icon-allow-overlap': false, 'symbol-sort-key': ['get', 'rank'],
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 9.5, 17.5, 11.5],
        'text-anchor': 'top', 'text-offset': ['interpolate', ['linear'], ['zoom'], 15.5, ['literal', [0, 1]], 17.5, ['literal', [0, 1.25]]], 'text-optional': true,
      },
      paint: { 'text-color': k.text, 'text-halo-color': k.halo, 'text-halo-width': 1.5 },
    },
    {
      id: 'site-icons', type: 'symbol', source: 'site-points', filter: kind('zone'),
      layout: {
        'icon-image': ['concat', 'site-', ['get', 'icon']], 'icon-size': size, 'icon-allow-overlap': true, 'symbol-sort-key': ['get', 'rank'],
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 17, 12.5],
        'text-anchor': ['case', above, 'bottom', 'top'],
        'text-offset': [
          'interpolate', ['linear'], ['zoom'],
          14, ['case', above, ['literal', [0, -0.95]], ['literal', [0, 0.95]]],
          17, ['case', above, ['literal', [0, -1.2]], ['literal', [0, 1.2]]],
        ],
        'text-optional': true, 'text-max-width': 8,
      },
      paint: { 'text-color': k.text, 'text-halo-color': k.halo, 'text-halo-width': 1.6 },
    },
  ];
}
