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

const ADJ: Record<string, string[]> = {};
for (const [a, b] of EDGES) {
  (ADJ[a] ??= []).push(b);
  (ADJ[b] ??= []).push(a);
}

/** Dijkstra over the path network. Tiny graph, so a linear scan for the next node is fine. */
function shortestPath(from: string, to: string): WalkNode[] {
  const d: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const open = new Set(Object.keys(NODES));
  while (open.size) {
    let u: string | undefined;
    for (const n of open) if (d[n] != null && (u == null || d[n] < d[u])) u = n;
    if (u == null || u === to) break;
    open.delete(u);
    for (const v of ADJ[u] ?? []) {
      const alt = d[u] + dist(NODES[u], NODES[v]);
      if (d[v] == null || alt < d[v]) {
        d[v] = alt;
        prev[v] = u;
      }
    }
  }
  const path = [to];
  while (path[0] !== from && prev[path[0]]) path.unshift(prev[path[0]]);
  return path[0] === from ? path.map((id) => NODES[id]) : [NODES[from], NODES[to]];
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

  const nodes = shortestPath(from.node, to.node);
  const steps: Step[] = [{ text: `Head toward ${nodes[1].name}`, meters: dist(nodes[0], nodes[1]), turn: 'start' }];
  for (let i = 1; i < nodes.length - 1; i++) {
    const turn = turnAt(nodes[i - 1], nodes[i], nodes[i + 1]);
    const leg = dist(nodes[i], nodes[i + 1]);
    if (turn === 'straight') {
      steps[steps.length - 1].meters += leg;
      continue;
    }
    steps.push({ text: `Turn ${turn} at ${nodes[i].name}`, meters: leg, turn });
  }
  steps.push(arrive);

  const meters = nodes.slice(1).reduce((sum, n, i) => sum + dist(nodes[i], n), 0);
  return { points: nodes, meters, minutes: Math.max(1, Math.round(meters / PACE)), steps, here: false };
}

export const formatMeters = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
