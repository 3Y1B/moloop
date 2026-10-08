/**
 * Builds the data for the demo's opening cutscene (docs/cutscene/problem.html): the app's own festival drawing
 * (src/components/map/map-art.ts, light scheme) as SVG in plan metres, the fence ring with its area and length, the
 * zone badges, and where the crew stand: every volunteer from supabase/crew.json (crew.example.json if there's no
 * local roster) dropped near their zone, plus Mo and the team leads.
 *
 *   bun scripts/cutscene-map.ts
 */
import { siteSources } from '../src/components/map/map-art';
import { TEAMS } from '../src/data/teams';
import { FENCE, NODES, VENUE_ZONES, toPlan } from '../src/data/venue';

declare const Bun: {
  file(path: URL): { exists(): Promise<boolean>; json(): Promise<unknown>; text(): Promise<string> };
  write(to: URL, text: string): Promise<number>;
};

type P = [number, number];
type Crew = { name: string; role: 'volunteer' | 'team_lead' | 'coordinator'; team: string | null; zone: string | null };

const OUT = new URL('../docs/cutscene/venue.js', import.meta.url);
const ICONS = new URL('../assets/images/map/svg/', import.meta.url);

/** The stage is 16:9; the view is this many metres wide, centred on the fence. */
const VIEW_W = 640;
/** Pixels per metre the drawing is tuned for: the stage is 1920 px wide. Line minimums are in pixels. */
const PX_PER_M = 1920 / VIEW_W;
/** A badge, in metres across. */
const BADGE = 10;

const n = (v: number) => +v.toFixed(2);
const toP = (c: number[]): P => {
  const p = toPlan([c[0], c[1]]);
  return [n(p.x), n(p.y)];
};

// ---------------------------------------------------------------------------------------------------------------------
// The drawing, layer by layer in the map style's order, each layer sorted by z like its sort key.

const ORDER = [
  'ground', 'bank', 'water', 'waterLine', 'groundLine', 'walk', 'areaLine', 'thing', 'thingLine',
  'canopyShade', 'canopy', 'canopyLine', 'barricade', 'barricadeFoot', 'fence',
] as const;

/** What map-art puts on each shape and badge. Its sources are typed as plain GeoJSON, so say it here. */
type Art = {
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'LineString'; coordinates: number[][] };
  properties: { l: string; z: number; c: string; o?: number; w?: number; min?: number };
};
type Badge = { geometry: { type: string; coordinates: number[] }; properties: { kind: string; icon?: string } };

const points = siteSources('light').points.features as unknown as Badge[];

/** One scheme's drawing as SVG elements. */
function drawing(scheme: 'light' | 'dark') {
  const features = (siteSources(scheme).art.features as unknown as Art[])
    .filter((f) => (ORDER as readonly string[]).includes(f.properties.l))
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const la = ORDER.indexOf(a.f.properties.l as (typeof ORDER)[number]), lb = ORDER.indexOf(b.f.properties.l as (typeof ORDER)[number]);
      return la - lb || a.f.properties.z - b.f.properties.z || a.i - b.i;
    })
    .map(({ f }) => f);

  const svg: string[] = [];
  for (const f of features) {
    const p = f.properties;
    const op = p.o !== undefined && p.o !== 1 ? ` opacity="${p.o}"` : '';
    if (f.geometry.type === 'Polygon') {
      const rings = f.geometry.coordinates;
      const d = rings.map((ring) => 'M' + ring.slice(0, -1).map((c) => toP(c).join(' ')).join('L') + 'Z').join('');
      svg.push(`<path d="${d}" fill="${p.c}"${op}${rings.length > 1 ? ' fill-rule="evenodd"' : ''}/>`);
      continue;
    }
    const d = 'M' + f.geometry.coordinates.map((c) => toP(c).join(' ')).join('L');
    if (p.l === 'fence') {
      svg.push(`<path d="${d}" fill="none" stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="${n(3 / PX_PER_M)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      svg.push(`<path d="${d}" fill="none" stroke="${p.c}" stroke-width="${n(1.6 / PX_PER_M)}" stroke-dasharray="${n(3.5 / PX_PER_M)} ${n(2.2 / PX_PER_M)}" stroke-linejoin="round"/>`);
      continue;
    }
    const w = n(Math.max(p.w ?? 1, (p.min ?? 0) / PX_PER_M));
    const dash = p.l === 'areaLine' ? ` stroke-dasharray="${n(w * 2)} ${n(w * 1.5)}"` : '';
    svg.push(`<path d="${d}" fill="none" stroke="${p.c}" stroke-width="${w}"${op}${dash} stroke-linecap="${dash ? 'butt' : 'round'}" stroke-linejoin="round"/>`);
  }
  return { shapes: features.length, svg: svg.join('') };
}
const light = drawing('light'), dark = drawing('dark');

// Badges: the zones' own, as the map draws them.
const used = new Set<string>();
const badges: string[] = [];
for (const f of points) {
  const p = f.properties;
  if (p.kind !== 'zone' || !p.icon || f.geometry.type !== 'Point') continue;
  used.add(p.icon);
  const [x, y] = toP(f.geometry.coordinates);
  badges.push(`<use href="#i-${p.icon}" x="${n(x - BADGE / 2)}" y="${n(y - BADGE / 2)}" width="${BADGE}" height="${BADGE}"/>`);
}
const symbols: string[] = [];
for (const icon of used) {
  const raw = await Bun.file(new URL(`${icon}.svg`, ICONS)).text();
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replaceAll('id="s"', `id="s-${icon}"`).replaceAll('url(#s)', `url(#s-${icon})`);
  symbols.push(`<symbol id="i-${icon}" viewBox="0 0 32 32">${inner.trim()}</symbol>`);
}

// ---------------------------------------------------------------------------------------------------------------------
// The fence as one ring: the gates' gaps closed, so it can be traced and measured.

const ring: P[] = FENCE.flat().map(([x, y]) => [n(x), n(y)]);
let twice = 0, length = 0;
ring.forEach(([x0, y0], i) => {
  const [x1, y1] = ring[(i + 1) % ring.length];
  twice += x0 * y1 - x1 * y0;
  length += Math.hypot(x1 - x0, y1 - y0);
});
const area = Math.abs(twice) / 2;
const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
const centre: P = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
const view = { x: n(centre[0] - VIEW_W / 2), y: n(centre[1] - (VIEW_W * 9) / 16 / 2), w: VIEW_W, h: n((VIEW_W * 9) / 16) };

function inside([x, y]: P) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// The stages' and tents' footprints: nobody stands on a roof.
const roofs = Object.values(VENUE_ZONES).flatMap((z) =>
  'w' in z.shape && 'h' in z.shape ? [{ x: z.shape.x, y: z.shape.y, w: z.shape.w, h: z.shape.h }] : [],
);
const onRoof = ([x, y]: P) => roofs.some((b) => x > b.x - 1 && x < b.x + b.w + 1 && y > b.y - 1 && y < b.y + b.h + 1);

// ---------------------------------------------------------------------------------------------------------------------
// The crew, near their zones. Seeded, so every build puts them in the same places.

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

const rosterFile = Bun.file(new URL('../supabase/crew.json', import.meta.url));
const crew = (await ((await rosterFile.exists()) ? rosterFile : Bun.file(new URL('../supabase/crew.example.json', import.meta.url))).json()) as Crew[];
const colour = Object.fromEntries(TEAMS.map((t) => [t.slug, t.color]));
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const nodeOf = (zone: string | null): P => {
  const z = zone ? VENUE_ZONES[zone] : undefined;
  const at = z ? NODES[z.node] : { x: centre[0], y: centre[1] };
  return [at.x, at.y];
};

const placed: P[] = [];
function spot(zone: string | null, spread: number): P {
  const home = nodeOf(zone);
  const fenced = inside(home);
  for (let tries = 0; tries < 400; tries++) {
    // A third wander off anywhere on the site; the rest stay round their zone.
    const roam = tries < 200 && rand() < 0.33;
    const p: P = roam
      ? [n(box.x0 + rand() * (box.x1 - box.x0)), n(box.y0 + rand() * (box.y1 - box.y0))]
      : [n(home[0] + gauss() * spread), n(home[1] + gauss() * spread)];
    if ((fenced || roam) && !inside(p)) continue;
    if (onRoof(p)) continue;
    if (placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 5.2)) continue;
    placed.push(p);
    return p;
  }
  placed.push(home);
  return home;
}

const mo = crew.find((c) => c.role === 'coordinator');
// Just below the zone's badge, so the two don't sit on each other.
const moAt: P = [nodeOf(mo?.zone ?? 'info-tent')[0], nodeOf(mo?.zone ?? 'info-tent')[1] + 11];
placed.push(moAt);
const leads = crew.filter((c) => c.role === 'team_lead').map((c) => ({ name: c.name, initials: initials(c.name), color: colour[c.team ?? ''] ?? '#6B7280', team: c.team, at: spot(c.zone, 6) }));
const volunteers = crew.filter((c) => c.role === 'volunteer').map((c) => ({ name: c.name, i: initials(c.name), c: colour[c.team ?? ''] ?? '#6B7280', at: spot(c.zone, 14) }));

/** Named places, for where a message comes from. */
const places = Object.fromEntries(Object.values(VENUE_ZONES).map((z) => [z.slug, nodeOf(z.slug)]));

const data = {
  view,
  defs: symbols.join(''),
  art: { light: light.svg, dark: dark.svg },
  badges: badges.join(''),
  fence: ring,
  area: Math.round(area),
  length: Math.round(length),
  span: Math.round(box.x1 - box.x0),
  centre,
  mo: { name: mo?.name ?? 'Mo', at: moAt },
  leads,
  volunteers,
  places,
};

await Bun.write(OUT, `// Generated by scripts/cutscene-map.ts. Don't edit; run \`bun scripts/cutscene-map.ts\`.\nwindow.VENUE = ${JSON.stringify(data)};\n`);
console.log(`wrote ${OUT.pathname}: ${light.shapes} shapes, ${volunteers.length} volunteers, area ${(area / 10000).toFixed(2)} ha, fence ${Math.round(length)} m`);
