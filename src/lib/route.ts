import { FENCE, NODES, VENUE_ZONES, truckSpots, type Point } from '@/data/venue';
import { DECOR, GRANDSTAND } from '@/data/venue-features';

/*
 * Walking routes across open ground. Inside the fence you can walk anywhere (grass, the track, the
 * turf, the road) except through what's built on it: stages, tents, truck rows, toilets, the
 * grandstand, the Pavilion, backstage. The shortest way round those only ever bends at their
 * corners, so the route is a shortest path over a visibility graph: every corner (pushed out a
 * little, so routes pass beside things rather than scrape them) joined to every other corner it
 * can see.
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
    else if (s.kind === 'area' && z.icon === 'backstage') out.push({ ring: s.ring.map(pt), name: 'Backstage' });
    else if (s.kind === 'trucks') {
      // One block per unbroken run of trucks, so the gap left in the row is a way through.
      // Unnamed: the nearest landmark ("the west end of Food Alley") says more.
      const spots = truckSpots(s);
      let from = spots[0];
      spots.forEach((x, i) => {
        const next = spots[i + 1];
        if (next != null && next - x < 8) return;
        out.push({ ring: boxRing({ x: from, y: s.y, w: x + 6 - from, h: s.h }) });
        from = next;
      });
    }
  }
  out.push({ ring: GRANDSTAND.map(pt), name: 'the grandstand' });
  for (const b of DECOR.medics) out.push({ ring: boxRing(b), name: 'the medic tent' });
  for (const b of DECOR.foh) out.push({ ring: boxRing(b), name: 'the sound desk' });
  out.push({ ring: boxRing(DECOR.bar), name: 'the bar' });
  out.push({ ring: boxRing(DECOR.security), name: 'bag check' });
  out.push({ ring: boxRing(DECOR.booth), name: 'the ticket booth' });
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

type Wall = { pts: Point[]; closed: boolean; box: Box };
type Corner = Point & { name?: string };

const bounds = (pts: Point[]): Box => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

/** Everything a route can't pass through, and the corners it can turn at. Built on first use. */
let world: { walls: Wall[]; corners: Corner[]; seen: number[][] } | null = null;

function build() {
  const things = obstacles().map((o) => ({ ...o, hull: hull(o.ring) }));
  const walls: Wall[] = [
    ...things.map((o) => {
      const pts = grow(o.hull, WALL);
      return { pts, closed: true, box: bounds(pts) };
    }),
    ...[...FENCE.map((l) => l.map(pt)), ...DECOR.barriers.map((l) => l.map(pt))].map((pts) => ({ pts, closed: false, box: bounds(pts) })),
  ];
  // The site, with its gates closed off: routes only turn inside it.
  const site = FENCE.flat().map(pt);
  const candidates: Corner[] = [
    ...things.flatMap((o) => grow(o.hull, CLEARANCE).map((p) => ({ ...p, name: o.name }))),
    ...FENCE.flatMap((l) => lineCorners(l.map(pt), CLEARANCE)),
  ];
  const corners = candidates.filter((p) => inside(p, site) && !walls.some((w) => w.closed && inside(p, w.pts)));
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
function placeName(p: Corner, start: string): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const n of Object.values(NODES)) {
    const d = dist(n, p);
    if (n.id === start) continue;
    if (d < 20 && (!best || d < best.d)) best = { name: n.name, d };
  }
  return best?.name ?? p.name;
}

const walks = new Map<string, Corner[]>();

/** Walking route between two zones, with spoken-style turn-by-turn steps. */
export function routeBetween(fromZone: string | null, toZone: string | null, hint?: string | null): Route | null {
  const from = fromZone ? VENUE_ZONES[fromZone] : undefined;
  const to = toZone ? VENUE_ZONES[toZone] : undefined;
  if (!from || !to) return null;

  const arrive: Step = { text: hint ?? `You’re at ${NODES[to.node].name}`, meters: 0, turn: 'arrive' };
  if (from.node === to.node) return { points: [NODES[to.node]], meters: 0, minutes: 0, steps: [arrive], here: true };

  const key = `${from.node}>${to.node}`;
  if (!walks.has(key)) walks.set(key, walk(NODES[from.node], NODES[to.node]));
  const points = walks.get(key)!;

  const toward = (i: number) => (i === points.length - 1 ? NODES[to.node].name : placeName(points[i], from.node) ?? NODES[to.node].name);
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
