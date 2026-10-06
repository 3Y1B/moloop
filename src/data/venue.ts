/**
 * Site plan for the festival grounds. Units are metres on a 400 × 300 m plan, y pointing down
 * (same as screen space), so the map can draw it directly and routing distances are real-ish.
 * Static today; later this is per-event config loaded with the rest of the lookups.
 * Real GPS slots in by projecting lat/lng onto this plan with a 3-point affine fit.
 */

export type Point = { x: number; y: number };

export type WalkNode = Point & { id: string; /** Spoken landmark, e.g. "the Main Plaza". */ name: string };

type Box = { x: number; y: number; w: number; h: number };
export type ZoneShape =
  | ({ kind: 'stage' } & Box)
  | ({ kind: 'tent' } & Box)
  | ({ kind: 'strip' } & Box)
  | { kind: 'water'; x: number; y: number }
  | { kind: 'gate'; x: number; y: number };

export type VenueZone = {
  slug: string;
  /** Where on the path network you arrive. */
  node: string;
  shape: ZoneShape;
  /** Short label drawn on the map. */
  label: string;
};

export const VENUE = { width: 400, height: 300 } as const;

export const NODES: Record<string, WalkNode> = Object.fromEntries(
  ([
    ['gateA', 200, 284, 'Gate A'],
    ['plaza', 200, 246, 'the Main Plaza'],
    ['info', 232, 232, 'the Info Tent'],
    ['fa', 272, 246, 'the First Aid Post'],
    ['east', 334, 236, 'the East Path'],
    ['gateB', 390, 228, 'Gate B'],
    ['foodW', 166, 190, 'the west end of Food Alley'],
    ['foodM', 228, 188, 'Food Alley'],
    ['foodE', 292, 190, 'the east end of Food Alley'],
    ['w1', 134, 204, 'Water Station 1'],
    ['lawn', 92, 168, 'the Lawn Stage'],
    ['riverJ', 300, 140, 'the River Stage crossing'],
    ['w2', 266, 126, 'Water Station 2'],
    ['river', 330, 112, 'the River Stage'],
    ['back', 362, 156, 'the Backstage gate'],
  ] as const).map(([id, x, y, name]) => [id, { id, x, y, name }]),
);

export const EDGES: [string, string][] = [
  ['gateA', 'plaza'],
  ['plaza', 'info'],
  ['info', 'fa'],
  ['plaza', 'fa'],
  ['fa', 'east'],
  ['east', 'gateB'],
  ['plaza', 'foodW'],
  ['foodW', 'foodM'],
  ['foodM', 'foodE'],
  ['foodM', 'info'],
  ['foodW', 'w1'],
  ['w1', 'lawn'],
  ['foodE', 'riverJ'],
  ['foodE', 'east'],
  ['riverJ', 'w2'],
  ['riverJ', 'river'],
  ['river', 'back'],
  ['back', 'east'],
];

export const VENUE_ZONES: Record<string, VenueZone> = Object.fromEntries(
  ([
    { slug: 'gate-a', node: 'gateA', label: 'Gate A', shape: { kind: 'gate', x: 200, y: 292 } },
    { slug: 'gate-b', node: 'gateB', label: 'Gate B', shape: { kind: 'gate', x: 394, y: 228 } },
    { slug: 'lawn-stage', node: 'lawn', label: 'Lawn Stage', shape: { kind: 'stage', x: 30, y: 92, w: 92, h: 56 } },
    { slug: 'river-stage', node: 'river', label: 'River Stage', shape: { kind: 'stage', x: 300, y: 50, w: 78, h: 46 } },
    { slug: 'water-1', node: 'w1', label: 'Water 1', shape: { kind: 'water', x: 134, y: 204 } },
    { slug: 'water-2', node: 'w2', label: 'Water 2', shape: { kind: 'water', x: 266, y: 126 } },
    { slug: 'first-aid-hq', node: 'fa', label: 'First Aid', shape: { kind: 'tent', x: 258, y: 254, w: 36, h: 22 } },
    { slug: 'food-alley', node: 'foodM', label: 'Food Alley', shape: { kind: 'strip', x: 176, y: 166, w: 108, h: 14 } },
    { slug: 'info-tent', node: 'info', label: 'Info', shape: { kind: 'tent', x: 222, y: 206, w: 30, h: 18 } },
    { slug: 'backstage', node: 'back', label: 'Backstage', shape: { kind: 'tent', x: 346, y: 166, w: 44, h: 24 } },
  ] satisfies VenueZone[]).map((z) => [z.slug, z]),
);

/** Lawn, river and hedges: decoration only. */
export const SCENERY = {
  lawn: { x: 14, y: 70, w: 150, h: 120 },
  river: 'M0 22 C 70 6, 120 40, 200 26 S 330 4, 400 30 L 400 0 L 0 0 Z',
} as const;
