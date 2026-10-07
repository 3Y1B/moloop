import { EDGES, NODES, VENUE_ZONES, type Point, type WalkNode } from '@/data/venue';

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

/** Each node's neighbours, with the walkway to them traced along the real path. */
const ADJ: Record<string, { to: string; line: Point[]; meters: number }[]> = {};
for (const { a, b, via = [] } of EDGES) {
  const line = [NODES[a], ...via.map(([x, y]) => ({ x, y })), NODES[b]];
  (ADJ[a] ??= []).push({ to: b, line, meters: length(line) });
  (ADJ[b] ??= []).push({ to: a, line: [...line].reverse(), meters: length(line) });
}

/** Dijkstra over the path network, as the walkways taken. Tiny graph, so a linear scan for the next node is fine. */
function shortestPath(from: string, to: string): Point[][] {
  const d: Record<string, number> = { [from]: 0 };
  const prev: Record<string, { from: string; line: Point[] }> = {};
  const open = new Set(Object.keys(NODES));
  while (open.size) {
    let u: string | undefined;
    for (const n of open) if (d[n] != null && (u == null || d[n] < d[u])) u = n;
    if (u == null || u === to) break;
    open.delete(u);
    for (const { to: v, line, meters } of ADJ[u] ?? []) {
      const alt = d[u] + meters;
      if (d[v] == null || alt < d[v]) {
        d[v] = alt;
        prev[v] = { from: u, line };
      }
    }
  }
  const legs: Point[][] = [];
  for (let at = to; at !== from && prev[at]; at = prev[at].from) legs.unshift(prev[at].line);
  return legs.length && legs[0][0] === NODES[from] ? legs : [[NODES[from], NODES[to]]];
}

function turnAt(a: Point, b: Point, c: Point): Step['turn'] {
  const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
  const angle = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * (180 / Math.PI);
  // y points down, so a positive cross product is a clockwise (right) turn.
  return Math.abs(angle) < 35 ? 'straight' : angle > 0 ? 'right' : 'left';
}

/** Walking route between two zones, with spoken-style turn-by-turn steps. */
export function routeBetween(fromZone: string | null, toZone: string | null, hint?: string | null): Route | null {
  const from = fromZone ? VENUE_ZONES[fromZone] : undefined;
  const to = toZone ? VENUE_ZONES[toZone] : undefined;
  if (!from || !to) return null;

  const arrive: Step = { text: hint ?? `You’re at ${NODES[to.node].name}`, meters: 0, turn: 'arrive' };
  if (from.node === to.node) return { points: [NODES[to.node]], meters: 0, minutes: 0, steps: [arrive], here: true };

  // Each leg runs node to node; turns are judged where one walkway meets the next.
  const legs = shortestPath(from.node, to.node);
  const nodeAt = (leg: Point[]) => leg[leg.length - 1] as WalkNode;
  const steps: Step[] = [{ text: `Head toward ${nodeAt(legs[0]).name}`, meters: length(legs[0]), turn: 'start' }];
  for (let i = 1; i < legs.length; i++) {
    const inbound = legs[i - 1], outbound = legs[i];
    const turn = turnAt(inbound[inbound.length - 2], outbound[0], outbound[1]);
    if (turn === 'straight') {
      steps[steps.length - 1].meters += length(outbound);
      continue;
    }
    steps.push({ text: `Turn ${turn} at ${nodeAt(inbound).name}`, meters: length(outbound), turn });
  }
  steps.push(arrive);

  const points = legs.flatMap((leg, i) => (i === 0 ? leg : leg.slice(1)));
  const meters = length(points);
  return { points, meters, minutes: Math.max(1, Math.round(meters / PACE)), steps, here: false };
}

export const formatMeters = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
