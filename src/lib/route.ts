import { FENCE, NODES, VENUE_ZONES, foodCourt, type Point } from '@/data/venue';
import { ARTIST_TENTS, ATTRACTIONS, BARRICADES, BRIDGES, CONTROL_SHEDS, DECOR, MARKET, smooth } from '@/data/venue-features';

/*
 * Walking routes across open ground. Inside the fence you can walk anywhere (the lawns, the paths,
 * the slopes between the terraces) except through what's built on it: stages, tents, truck rows,
 * toilets, ArtPlay, the cabins. The fence runs along the top of the river bank, so no route goes
 * near the water. Both bridges are inside one barricaded crew area (restrictedArea in data/venue.ts): Tanderrum Bridge
 * is closed, and William Barak Bridge is the crew's and artists' way in from the Artist Village. A festival-goer's
 * route goes round it; only routes to or from the crew's side go in. The shortest way round what's
 * built only ever bends at its corners, so the route is a shortest path over a visibility graph:
 * every corner (pushed out a little, so routes pass beside things rather than scrape them) joined
 * to every other corner it can see.
 */

/** Festival walking pace through a crowd, metres per minute. */
const PACE = 60;

export type Step = { text: string; meters: number; turn: 'start' | 'left' | 'right' | 'straight' | 'arrive' };

export type Route = {
  points: Point[];
  meters: number;
  minutes: number;
  steps: Step[];
  /** Already at (or inside) the destination zone. */
  here: boolean;
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const length = (line: Point[]) => line.slice(1).reduce((sum, p, i) => sum + dist(line[i], p), 0);
const pt = ([x, y]: [number, number]): Point => ({ x, y });

// ---------------------------------------------------------------------------------------------
// What's in the way

type Box = { x: number; y: number; w: number; h: number };
/** Something you walk round. `name` is what a turn at its corner is called after. */
type Obstacle = { ring: Point[]; name?: string };

/** How far routes keep from things, in metres. Corners are pushed out this far; walls block a little inside it. */
const CLEARANCE = 1.5;
const WALL = 0.9;

const boxRing = (b: Box): Point[] => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
const named = (node: string) => NODES[node]?.name;

function obstacles(): Obstacle[] {
  const out: Obstacle[] = [];
  for (const z of Object.values(VENUE_ZONES)) {
    const s = z.shape;
    if (s.kind === 'stage' || s.kind === 'tent' || s.kind === 'toilets') out.push({ ring: boxRing(s), name: named(z.node) });
    else if (s.kind === 'building') out.push({ ring: s.ring.map(pt), name: named(z.node) });
    else if (s.kind === 'trucks') {
      // Each block of four trucks, so routes walk the aisles between them.
      // Unnamed: the nearest landmark ("the west end of Food Alley") says more.
      for (const b of foodCourt(s).blocks) out.push({ ring: boxRing(b) });
    }
  }
  for (const b of DECOR.medics) out.push({ ring: boxRing(b), name: 'the medic tent' });
  for (const b of DECOR.foh) out.push({ ring: boxRing(b), name: 'the sound desk' });
  out.push({ ring: boxRing(DECOR.bar), name: 'the bar' });
  for (const b of DECOR.security) out.push({ ring: boxRing(b), name: 'bag check' });
  for (const t of ARTIST_TENTS) out.push({ ring: boxRing(t.box), name: `the ${t.name}` });
  for (const ring of CONTROL_SHEDS) out.push({ ring: ring.map(pt), name: 'the Control Room' });
  for (const b of DECOR.stores) out.push({ ring: boxRing(b), name: 'the stock containers' });
  for (const ring of DECOR.cabins) out.push({ ring: ring.map(pt), name: 'the dressing cabins' });
  for (const ring of DECOR.vans) out.push({ ring: ring.map(pt), name: 'the artists’ vans' });
  for (const b of DECOR.trailers) out.push({ ring: boxRing(b), name: 'the artists’ trailers' });
  // The Market's gazebos, its lockers and charging bar, the photo booths, the swing ride's fence and the silent disco.
  for (const ring of [...MARKET.stalls, MARKET.glitter]) out.push({ ring: ring.map(pt), name: 'the market stalls' });
  out.push({ ring: MARKET.lockers.map(pt), name: 'the lockers' }, { ring: MARKET.charging.map(pt), name: 'the charging bar' });
  for (const b of ATTRACTIONS.booths) out.push({ ring: boxRing(b), name: 'the photo booths' });
  const { at: [sx, sy], fence } = ATTRACTIONS.swings;
  out.push({ ring: Array.from({ length: 12 }, (_, i) => ({ x: sx + fence * Math.cos((i * Math.PI) / 6), y: sy + fence * Math.sin((i * Math.PI) / 6) })), name: 'the swing ride' });
  out.push({ ring: boxRing(ATTRACTIONS.disco), name: 'the silent disco' });
  return out;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull, counter-clockwise in maths orientation (positive area). */
function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** A convex ring grown outward by `d`. */
function grow(ring: Point[], d: number): Point[] {
  const n = ring.length;
  const normal = (a: Point, b: Point) => {
    const l = dist(a, b) || 1;
    return { x: (b.y - a.y) / l, y: -(b.x - a.x) / l }; // outward for a positive-area ring
  };
  return ring.map((v, i) => {
    const n1 = normal(ring[(i + n - 1) % n], v), n2 = normal(v, ring[(i + 1) % n]);
    const mx = n1.x + n2.x, my = n1.y + n2.y, ml = Math.hypot(mx, my) || 1;
    const k = d / Math.max(0.3, (mx * n1.x + my * n1.y) / ml);
    return { x: v.x + (mx / ml) * k, y: v.y + (my / ml) * k };
  });
}

/** Points either side of each bend in a line, and round its ends: where a route turns to get past it. */
function lineCorners(line: Point[], d: number): Point[] {
  const out: Point[] = [];
  line.forEach((v, i) => {
    const a = line[i - 1] ?? v, b = line[i + 1] ?? v;
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l; // along the line here
    const end = i === 0 ? -1 : i === line.length - 1 ? 1 : 0;
    for (const side of [-1, 1]) out.push({ x: v.x - uy * d * side + ux * d * end, y: v.y + ux * d * side + uy * d * end });
  });
  return out;
}

function inside(p: Point, ring: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** The two segments cross properly (touching doesn't count). */
function crosses(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** a→b passes through v (a bend in a line p, v, q) from one side of the line to the other. */
function through(a: Point, b: Point, p: Point, v: Point, q: Point): boolean {
  const l = dist(a, b);
  if (Math.abs(cross(a, b, v)) > 1e-6 * l) return false;
  const t = ((v.x - a.x) * (b.x - a.x) + (v.y - a.y) * (b.y - a.y)) / (l * l);
  return t > 1e-9 && t < 1 - 1e-9 && cross(a, b, p) * cross(a, b, q) < 0;
}

type Wall = { pts: Point[]; closed: boolean; box: Box };
type Corner = Point & { name?: string };

const bounds = (pts: Point[]): Box => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

/** Everything a route can't pass through, and the corners it can turn at. Built on first use. */
let world: { walls: Wall[]; corners: Corner[]; seen: number[][] } | null = null;

/** A line run on `d` metres past each end, so a barricade meeting the fence (or a stage) leaves no gap to slip through. */
function overrun(line: Point[], d: number): Point[] {
  const ext = (p: Point, q: Point) => {
    const l = dist(p, q) || 1;
    return { x: p.x + ((p.x - q.x) / l) * d, y: p.y + ((p.y - q.y) / l) * d };
  };
  return [ext(line[0], line[1]), ...line, ext(line[line.length - 1], line[line.length - 2])];
}

/**
 * The crew's way over William Barak Bridge: down the middle of the deck from the Artist Village to the Artist Gate,
 * and a step past it into the compound. Off the site, so these are added as corners as they are.
 */
function deckCorners(): Corner[] {
  const deck = BRIDGES[0].line.slice(0, 5).map(pt).reverse(); // from out past the edge, down to the landing
  const [a, b] = deck.slice(-2);
  const l = dist(a, b) || 1;
  return [...deck, { x: b.x + ((b.x - a.x) / l) * 4, y: b.y + ((b.y - a.y) / l) * 4 }].map((p) => ({ ...p, name: 'the William Barak Bridge' }));
}

/**
 * The bridge's rails, from where the fence meets the deck out past the Artist Village's landmark: the crew's way off
 * the site is along the deck, not round the outside of the fence.
 */
function deckRails(): Point[][] {
  const deck = BRIDGES[0].line.slice(1, 6).map(pt);
  const end = deck.length - 1;
  const t = 60 / dist(deck[end - 1], deck[end]); // 60 m on along the last stretch is well past the landmark
  deck[end] = { x: deck[end - 1].x + (deck[end].x - deck[end - 1].x) * t, y: deck[end - 1].y + (deck[end].y - deck[end - 1].y) * t };
  const side = (s: number) =>
    deck.map((p, i) => {
      const a = deck[Math.max(0, i - 1)], b = deck[Math.min(end, i + 1)], l = dist(a, b) || 1;
      return { x: p.x - ((b.y - a.y) / l) * 2.5 * s, y: p.y + ((b.x - a.x) / l) * 2.5 * s };
    });
  // Each rail starts at the fence post where that side of the deck comes in, about 50 m up from the landing.
  const [l0, l1] = BRIDGES[0].line.map(pt);
  const u = { x: (l1.x - l0.x) / dist(l0, l1), y: (l1.y - l0.y) / dist(l0, l1) };
  const posts = FENCE.flat().map(pt);
  return [1, -1].map((s) => {
    const rail = side(s);
    const at = { x: l0.x + u.x * 50 - u.y * 2.5 * s, y: l0.y + u.y * 50 + u.x * 2.5 * s };
    const post = posts.reduce((best, p) => (dist(p, at) < dist(best, at) ? p : best));
    return [post, ...rail];
  });
}

function build() {
  const things = obstacles().map((o) => ({ ...o, hull: hull(o.ring) }));
  const pens = BARRICADES.filter((b) => b.closed).map((b) => ({ ring: smooth(b.line, true).map(pt), name: b.name }));
  const runs = BARRICADES.filter((b) => !b.closed).map((b) => smooth(b.line).map(pt));
  const walls: Wall[] = [
    ...[...things, ...pens.map((p) => ({ ...p, hull: hull(p.ring) }))].map((o) => {
      const pts = grow(o.hull, WALL);
      return { pts, closed: true, box: bounds(pts) };
    }),
    ...[...FENCE.map((l) => l.map(pt)), ...DECOR.barriers.map((l) => l.map(pt)), ...runs.map((l) => overrun(l, 2)), ...deckRails()].map((pts) => ({ pts, closed: false, box: bounds(pts) })),
  ];
  // The site, with its gates closed off: routes only turn inside it.
  const site = FENCE.flat().map(pt);
  const candidates: Corner[] = [
    ...[...things, ...pens.map((p) => ({ ...p, hull: hull(p.ring) }))].flatMap((o) => grow(o.hull, CLEARANCE).map((p) => ({ ...p, name: o.name }))),
    ...FENCE.flatMap((l) => lineCorners(l.map(pt), CLEARANCE)),
    // Every third stretch of a barricade's curve is plenty to get round it. Taken mid-stretch, so the way between
    // the two corners either side crosses the barricade outright rather than through one of its bends.
    ...runs.flatMap((l) => lineCorners(l.slice(0, -1).flatMap((p, i) => (i % 3 ? [] : [{ x: (p.x + l[i + 1].x) / 2, y: (p.y + l[i + 1].y) / 2 }])), CLEARANCE)),
  ];
  const corners = [
    ...candidates.filter((p) => inside(p, site) && !walls.some((w) => w.closed && inside(p, w.pts))),
    ...deckCorners(),
  ];
  const seen = corners.map(() => [] as number[]);
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      if (clear(corners[i], corners[j], walls)) {
        seen[i].push(j);
        seen[j].push(i);
      }
    }
  }
  return { walls, corners, seen };
}

/** Nothing in the way from a to b. Walls in `skip` are ignored (one you're standing in, say). */
function clear(a: Point, b: Point, walls: Wall[], skip?: Set<Wall>): boolean {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  for (const w of walls) {
    if (skip?.has(w) || x1 < w.box.x || x0 > w.box.x + w.box.w || y1 < w.box.y || y0 > w.box.y + w.box.h) continue;
    const n = w.pts.length;
    for (let i = 0; i < (w.closed ? n : n - 1); i++) if (crosses(a, b, w.pts[i], w.pts[(i + 1) % n])) return false;
    // Straight through one of a line's bends crosses neither stretch outright, but it's still through the line.
    if (!w.closed) for (let i = 1; i < n - 1; i++) if (through(a, b, w.pts[i - 1], w.pts[i], w.pts[i + 1])) return false;
    // Corner to corner across a single wall's inside crosses none of its edges.
    if (w.closed && inside(mid, w.pts)) return false;
  }
  return true;
}

/** Shortest walk from a to b: the points it turns at, with what each turn is called after. */
function walk(a: Point, b: Point): Corner[] {
  world ??= build();
  const { walls, corners, seen } = world;
  // Don't let the spot you start or end on be fenced in by the thing it's next to.
  const skip = new Set(walls.filter((w) => w.closed && (inside(a, w.pts) || inside(b, w.pts))));
  if (clear(a, b, walls, skip)) return [a, b];

  // Dijkstra: corners are 0..n-1, then a, then b. Small graph, so a linear scan for the next node is fine.
  const n = corners.length, A = n, B = n + 1;
  const at = (i: number): Corner => (i === A ? a : i === B ? b : corners[i]);
  const fromA: number[] = [], toB = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (clear(a, corners[i], walls, skip)) fromA.push(i);
    if (clear(corners[i], b, walls, skip)) toB.add(i);
  }
  const next = (i: number) => [...(i === A ? fromA : seen[i]), ...(toB.has(i) ? [B] : [])];
  const d = new Map<number, number>([[A, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  for (;;) {
    let u: number | undefined;
    for (const [k, v] of d) if (!done.has(k) && (u == null || v < d.get(u)!)) u = k;
    if (u == null || u === B) break;
    done.add(u);
    for (const v of next(u)) {
      const alt = d.get(u)! + dist(at(u), at(v));
      if (alt < (d.get(v) ?? Infinity)) {
        d.set(v, alt);
        prev.set(v, u);
      }
    }
  }
  if (!prev.has(B)) return [a, b]; // walled off: shouldn't happen inside the site
  const path: Corner[] = [];
  for (let i: number | undefined = B; i != null; i = prev.get(i)) path.unshift(at(i));
  return path;
}

// ---------------------------------------------------------------------------------------------
// Turn by turn

function turnAt(a: Point, b: Point, c: Point): Step['turn'] {
  const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
  const angle = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * (180 / Math.PI);
  // y points down, so a positive cross product is a clockwise (right) turn.
  return Math.abs(angle) < 35 ? 'straight' : angle > 0 ? 'right' : 'left';
}

/** What a turn is called after: the nearest landmark if one's close (not the one you set off from), else the thing it goes round. */
function placeName(p: Corner, start: string | undefined): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const n of Object.values(NODES)) {
    const d = dist(n, p);
    if (n.id === start) continue;
    if (d < 20 && (!best || d < best.d)) best = { name: n.name, d };
  }
  return best?.name ?? p.name;
}

/** One end of a walk: a zone (by slug), or a spot on the plan, such as where someone's phone says they are. */
export type Spot = string | Point | null | undefined;

/** Closer than this to where you're going and you're there. GPS on a phone is good to a few metres. */
const ARRIVED_M = 12;

/** A spot as a point, and the landmark it's at (so the first step isn't "head toward" where you're standing). */
function resolve(spot: Spot): { at: Point; node?: string; zone?: boolean } | null {
  if (spot == null) return null;
  if (typeof spot === 'string') {
    const zone = VENUE_ZONES[spot];
    return zone ? { at: NODES[zone.node], node: zone.node, zone: true } : null;
  }
  const near = Object.values(NODES).find((n) => dist(n, spot) < ARRIVED_M);
  return { at: spot, node: near?.id };
}

const walks = new Map<string, Corner[]>();

/**
 * Walking route between two spots, with spoken-style turn-by-turn steps. Zone to zone is worked out once and
 * kept; from a live position it's worked out each time, which is quick enough to follow someone walking.
 */
export function routeBetween(fromSpot: Spot, toSpot: Spot, hint?: string | null): Route | null {
  const from = resolve(fromSpot);
  const to = resolve(toSpot);
  if (!from || !to) return null;

  const toName = to.node ? NODES[to.node].name : 'them';
  const arrive: Step = { text: hint ?? (to.node ? `You’re at ${toName}` : 'You’re there'), meters: 0, turn: 'arrive' };
  if ((from.node && from.node === to.node && (from.zone || to.zone)) || dist(from.at, to.at) < ARRIVED_M) {
    return { points: [to.at], meters: 0, minutes: 0, steps: [arrive], here: true };
  }

  let points: Corner[];
  if (from.zone && to.zone) {
    const key = `${from.node}>${to.node}`;
    if (!walks.has(key)) walks.set(key, walk(from.at, to.at));
    points = walks.get(key)!;
  } else {
    points = walk(from.at, to.at);
  }

  const toward = (i: number) => (i === points.length - 1 ? toName : placeName(points[i], from.node) ?? toName);
  const steps: Step[] = [{ text: `Head toward ${toward(1)}`, meters: dist(points[0], points[1]), turn: 'start' }];
  for (let i = 1; i < points.length - 1; i++) {
    const turn = turnAt(points[i - 1], points[i], points[i + 1]);
    const meters = dist(points[i], points[i + 1]);
    if (turn === 'straight') {
      steps[steps.length - 1].meters += meters;
      continue;
    }
    const place = placeName(points[i], from.node);
    steps.push({ text: place ? `Turn ${turn} at ${place}` : `Turn ${turn}`, meters, turn });
  }
  steps.push(arrive);

  const meters = length(points);
  return { points: points.map(({ x, y }) => ({ x, y })), meters, minutes: Math.max(1, Math.round(meters / PACE)), steps, here: false };
}

export const formatMeters = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
