/**
 * Site plan for the festival grounds. Units are metres on a flat plan, y pointing down
 * (same as screen space), so routing distances are real and the map can frame things in plan space.
 * The plan is pinned to the real site by GEO; toLngLat/toPlan convert, so GPS slots straight in.
 * Static today; later this is per-event config loaded with the rest of the lookups.
 */

export type Point = { x: number; y: number };

export type WalkNode = Point & { id: string; /** Spoken landmark, e.g. "the Info Tent". */ name: string };

/** A walkway between two nodes. `via` traces the real path's bends, from `a` to `b`. */
export type WalkEdge = {
  a: string;
  b: string;
  via?: [number, number][];
  /** Runs along the service road, which the map draws already. */
  road?: true;
};

type Box = { x: number; y: number; w: number; h: number };
export type ZoneShape =
  /** `faces` is the side the audience is on. */
  | ({ kind: 'stage'; faces: 'n' | 's' | 'e' | 'w' } & Box)
  | ({ kind: 'tent' } & Box)
  /** Food trucks parked in a row. */
  | ({ kind: 'trucks' } & Box)
  /** Rows of portable toilets along the top and bottom of the box. */
  | ({ kind: 'toilets'; rows: 1 | 2 } & Box)
  | { kind: 'area'; ring: [number, number][] }
  /** A permanent building, drawn from its real footprint. */
  | { kind: 'building'; ring: [number, number][] }
  | { kind: 'water'; x: number; y: number }
  | { kind: 'gate'; x: number; y: number };

export type ZoneIcon = 'stage' | 'gate' | 'water' | 'firstaid' | 'food' | 'info' | 'backstage' | 'toilets' | 'shade' | 'pavilion';

export type VenueZone = {
  slug: string;
  /** Where on the path network you arrive. */
  node: string;
  shape: ZoneShape;
  /** Short label drawn on the map. */
  label: string;
  icon: ZoneIcon;
};

/** The plan's extent: University Oval and the athletics track, from Trinity College to the tennis courts, Queen's College to Tin Alley. */
export const VENUE = { width: 265, height: 325 } as const;

/**
 * Where the plan sits on Earth: University Oval and Beaurepaire track, University of Melbourne
 * (Parkville). The campus grid runs about 8° east of north, so the plan's x axis runs along the
 * track's straights (bearing 98°) and y points south, with the oval above the track and the
 * sports centres along the bottom. Shapes are placed against the OpenStreetMap outlines.
 * Moving the festival (or testing it somewhere else) is just a new `origin`.
 */
export const GEO = {
  /** Plan (0, 0): north-west corner of the site, out past Trinity College. [lng, lat] */
  origin: [144.960418, -37.793316] as const,
  /** Compass bearing of the plan's +x axis. Screen-up on the map is this minus 90°. */
  bearing: 98,
};

const M_PER_DEG_LAT = 110_960;
const M_PER_DEG_LNG = 111_320 * Math.cos((GEO.origin[1] * Math.PI) / 180);
const THETA = ((GEO.bearing - 90) * Math.PI) / 180;

/** Plan metres to [lng, lat]. */
export function toLngLat(p: Point): [number, number] {
  const east = p.x * Math.cos(THETA) - p.y * Math.sin(THETA);
  const south = p.x * Math.sin(THETA) + p.y * Math.cos(THETA);
  return [GEO.origin[0] + east / M_PER_DEG_LNG, GEO.origin[1] - south / M_PER_DEG_LAT];
}

/** [lng, lat] to plan metres; the inverse of toLngLat. */
export function toPlan([lng, lat]: readonly [number, number]): Point {
  const east = (lng - GEO.origin[0]) * M_PER_DEG_LNG;
  const south = (GEO.origin[1] - lat) * M_PER_DEG_LAT;
  return { x: east * Math.cos(THETA) + south * Math.sin(THETA), y: -east * Math.sin(THETA) + south * Math.cos(THETA) };
}

/**
 * The festival fence, clockwise from Gate B's west post. It breaks for Gate A, where the Tin Alley
 * tunnel comes up beside Nona Lee Sports Centre, and for Gate B, the walkway between Nona Lee and
 * the Beaurepaire Centre. West: the path along Trinity College. North: the Pavilion's back wall,
 * which the fence runs into and out of. East: Newman Drive, taking in the tennis courts. South:
 * the two sports centres.
 */
export const FENCE: [number, number][][] = [
  [
    [141, 281], [116, 281], [80, 281], [40, 279], [27, 280], [22, 268], [21, 241], [19, 216], [18, 197], [17, 184],
    [17, 166], [18, 156], [19, 148], [25, 120], [28, 101], [30, 88], [35, 71], [43, 57], [52, 49], [66, 44], [76, 38],
    [80.5, 20],
  ],
  [
    [126, 27.8], [130, 22], [148, 12], [166, 17], [184, 21], [204, 33], [214, 43], [219, 50],
    [225, 61], [231, 78], [238, 100], [246, 130], [247, 160], [247, 190], [246, 225], [243, 243], [239, 262], [237, 281],
  ],
  [[228, 281], [227, 262], [227, 243], [203, 243], [203, 277], [198, 280], [194, 282], [163, 284]],
];

// The oval is x 50–208, y 33–171; the track x 27–205, y 184–266. Food Alley runs between them, the
// service road (Newman Drive) down the east side, the south walk between the track and the sports centres.
export const NODES: Record<string, WalkNode> = Object.fromEntries(
  ([
    ['gateA', 214, 231, 'Gate A'],
    ['ramp', 190, 257, 'the ramp by the Sports Centre'],
    ['rampFoot', 163, 274, 'the bottom of the ramp'],
    ['gateB', 150, 286, 'Gate B'],
    ['info', 124, 273, 'the Info Tent'],
    ['trackS', 108, 272, 'the south gate of the track'],
    ['fa', 56, 280, 'the First Aid Post'],
    ['westS', 24, 280, 'the corner by Trinity College'],
    ['tw', 25, 170, 'Toilets West'],
    ['w1', 52, 174, 'Water Station 1'],
    ['grove', 39, 134, 'the Grove'],
    ['stand', 48, 108, 'the grandstand'],
    ['pavilion', 97, 43, 'the Pavilion'],
    ['foodW', 72, 174, 'the west end of Food Alley'],
    ['food', 115, 174, 'Food Alley'],
    ['trackN', 115, 186, 'the north gate of the track'],
    ['trackStage', 96, 224, 'the Track Stage'],
    ['foodE', 158, 177, 'the east end of Food Alley'],
    ['w2', 184, 186, 'Water Station 2'],
    ['foh', 130, 110, 'the sound desk'],
    ['oval', 170, 102, 'the Oval Stage'],
    ['medic', 184, 142, 'the medic tent'],
    ['te', 207, 208, 'Toilets East'],
    ['back', 202, 162, 'the Backstage gate'],
  ] as const).map(([id, x, y, name]) => [id, { id, x, y, name }]),
);

export const EDGES: WalkEdge[] = [
  { a: 'gateB', b: 'rampFoot', via: [[157, 278]] },
  { a: 'gateB', b: 'info', via: [[147, 279], [141, 273]] },
  { a: 'info', b: 'rampFoot', via: [[141, 273]] },
  { a: 'rampFoot', b: 'ramp', via: [[173, 274], [181, 269]] },
  { a: 'ramp', b: 'gateA', via: [[196, 251], [200, 244], [209, 227]] },
  { a: 'gateA', b: 'te', via: [[208, 225], [208, 216]], road: true },
  { a: 'te', b: 'back', via: [[207, 190], [203, 183], [202, 172]], road: true },
  { a: 'te', b: 'w2', via: [[202, 206], [199, 201], [194, 194], [190, 190]] },
  { a: 'w2', b: 'foodE', via: [[176, 182], [167, 180]] },
  { a: 'w2', b: 'medic' },
  { a: 'medic', b: 'oval' },
  { a: 'foodE', b: 'food' },
  { a: 'food', b: 'foodW' },
  { a: 'food', b: 'trackN' },
  { a: 'trackN', b: 'trackStage' },
  { a: 'trackS', b: 'trackStage' },
  { a: 'food', b: 'foh' },
  { a: 'foh', b: 'oval' },
  { a: 'stand', b: 'foh' },
  { a: 'foodW', b: 'w1' },
  { a: 'w1', b: 'tw' },
  { a: 'tw', b: 'grove', via: [[33, 150]] },
  { a: 'grove', b: 'stand', via: [[47, 115]] },
  { a: 'stand', b: 'pavilion', via: [[55, 97], [58, 82], [62, 70], [68, 58], [77, 49], [87, 44]] },
  { a: 'pavilion', b: 'foh' },
  { a: 'tw', b: 'westS', via: [[19, 184], [20, 197], [20, 216], [21, 233], [22, 241], [23, 268]] },
  { a: 'westS', b: 'fa', via: [[43, 282]] },
  { a: 'fa', b: 'trackS', via: [[76, 282], [76, 273]] },
  { a: 'trackS', b: 'info' },
];

export const VENUE_ZONES: Record<string, VenueZone> = Object.fromEntries(
  ([
    { slug: 'gate-a', node: 'gateA', label: 'Gate A', icon: 'gate', shape: { kind: 'gate', x: 232, y: 262 } },
    { slug: 'gate-b', node: 'gateB', label: 'Gate B', icon: 'gate', shape: { kind: 'gate', x: 150, y: 293 } },
    { slug: 'lawn-stage', node: 'oval', label: 'Oval Stage', icon: 'stage', shape: { kind: 'stage', faces: 'w', x: 188, y: 85, w: 14, h: 34 } },
    { slug: 'river-stage', node: 'trackStage', label: 'Track Stage', icon: 'stage', shape: { kind: 'stage', faces: 'e', x: 69, y: 209, w: 12, h: 32 } },
    { slug: 'water-1', node: 'w1', label: 'Water 1', icon: 'water', shape: { kind: 'water', x: 54, y: 166 } },
    { slug: 'water-2', node: 'w2', label: 'Water 2', icon: 'water', shape: { kind: 'water', x: 191, y: 179 } },
    { slug: 'first-aid-hq', node: 'fa', label: 'First Aid', icon: 'firstaid', shape: { kind: 'tent', x: 40, y: 270.5, w: 12, h: 8 } },
    { slug: 'food-alley', node: 'food', label: 'Food Alley', icon: 'food', shape: { kind: 'trucks', x: 71, y: 177, w: 88, h: 5 } },
    { slug: 'info-tent', node: 'info', label: 'Info', icon: 'info', shape: { kind: 'tent', x: 117, y: 275, w: 9, h: 5.5 } },
    { slug: 'backstage', node: 'back', label: 'Backstage', icon: 'backstage', shape: { kind: 'area', ring: [[191, 134], [211, 134], [211, 156], [191, 156]] } },
    { slug: 'toilets-west', node: 'tw', label: 'Toilets West', icon: 'toilets', shape: { kind: 'toilets', rows: 1, x: 28, y: 174, w: 13, h: 2.6 } },
    { slug: 'toilets-east', node: 'te', label: 'Toilets East', icon: 'toilets', shape: { kind: 'toilets', rows: 2, x: 216, y: 197, w: 18, h: 14 } },
    {
      slug: 'the-grove', node: 'grove', label: 'The Grove', icon: 'shade',
      shape: { kind: 'area', ring: [[24, 106], [44, 103], [50, 118], [57, 136], [52, 152], [40, 165], [27, 166], [21, 140]] },
    },
    {
      // Ernie Cropley Sports Pavilion, on the oval's north edge: crew HQ for the day.
      slug: 'pavilion', node: 'pavilion', label: 'Pavilion', icon: 'pavilion',
      shape: {
        kind: 'building',
        ring: [
          [80.2, 16.6], [91.7, 12.5], [115.6, 6.5], [126, 27.8], [122.4, 28.8], [121.4, 31.3], [103.4, 35.2], [93.9, 40.8],
          [91.8, 37.4], [95.3, 33], [97.8, 29.6], [96.9, 26.3], [93.4, 27.5], [94.6, 31.6], [85.4, 34.8], [82.4, 31.5], [83, 28.9], [80.8, 22.6],
        ],
      },
    },
  ] satisfies VenueZone[]).map((z) => [z.slug, z]),
);
