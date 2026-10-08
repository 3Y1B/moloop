import { BARRICADES, DECOR, PLAYGROUND, smooth, type Seat } from './venue-features';

/**
 * Site plan for the festival grounds. Units are metres on a flat plan, y pointing down
 * (same as screen space), so routing distances are real and the map can frame things in plan space.
 * The plan is pinned to the real site by GEO; toLngLat/toPlan convert, so GPS slots straight in.
 * Static today; later this is per-event config loaded with the rest of the lookups.
 */

export type Point = { x: number; y: number };

export type Landmark = Point & { id: string; /** Spoken name, e.g. "the Bar". */ name: string };

type Box = { x: number; y: number; w: number; h: number };
export type ZoneShape =
  /** `faces` is the side the audience is on. `covered`: a marquee over the stage and its audience. */
  | ({ kind: 'stage'; faces: 'n' | 's' | 'e' | 'w'; covered?: boolean } & Box)
  | ({ kind: 'tent' } & Box)
  /** A food court: trucks spread over a terrace, with dining spots between them (see foodCourt). */
  | ({ kind: 'trucks' } & Box)
  /** Rows of portable toilets along the top and bottom of the box. */
  | ({ kind: 'toilets'; rows: 1 | 2 } & Box)
  | { kind: 'area'; ring: [number, number][] }
  /** A permanent building, drawn from its real footprint. */
  | { kind: 'building'; ring: [number, number][] }
  | { kind: 'water'; x: number; y: number }
  | { kind: 'gate'; x: number; y: number };

export type ZoneIcon = 'stage' | 'gate' | 'water' | 'firstaid' | 'food' | 'info' | 'backstage' | 'toilets' | 'shade' | 'pavilion' | 'bar' | 'tickets' | 'shop' | 'supplies' | 'artists';

export type VenueZone = {
  slug: string;
  /** The landmark you arrive at. */
  node: string;
  shape: ZoneShape;
  /**
   * The zone's one name: on the map, in the zone picker, on task cards, and in the database (scripts/seed.ts writes
   * it to zones.name) and the AI's list of places.
   */
  label: string;
  icon: ZoneIcon;
  /** Where the badge goes, if the middle of the shape isn't the place for it. */
  badge?: [number, number];
};

/** The plan's extent: Birrarung Marr from the Fed Square end to the Grove, and from Batman Avenue across the river. */
export const VENUE = { width: 620, height: 310 } as const;

/**
 * Where the plan sits on Earth: Birrarung Marr, on the north bank of the Yarra (the Birrarung) beside Fed Square.
 * The park is a strip about 510 m long running east-south-east along the river, so the plan's x axis runs that way
 * (bearing 120°) and y points south-south-west: Flinders St and Batman Avenue along the top, the river along the
 * bottom. Shapes are placed against the OpenStreetMap outlines. Moving the festival (or testing it somewhere else)
 * is just a new `origin`.
 */
export const GEO = {
  /** Plan (0, 0): north-west corner of the plan, out over the railway behind Fed Square. [lng, lat] */
  origin: [144.971762, -37.816242] as const,
  /** Compass bearing of the plan's +x axis. Screen-up on the map is this minus 90°. */
  bearing: 120,
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
 * The festival fence: the park's edge, clockwise from the Main Entrance's north post. West: the edge along the Fed
 * Square end, past ArtPlay. North: along Batman Avenue's bridge over the railway, with a break for the North Gate.
 * At the William Barak Bridge it runs down both sides of the deck to the Artist Gate at the bottom, so the bridge
 * lands in the gate, inside the crew's barricaded compound (see BARRICADES). North-east: along Batman Avenue, with a
 * break where Tanderrum Bridge crosses (closed: barricaded, emergency only), then round the Grove and the toilets on
 * the riverside path. South: the top of the river bank, all the
 * way back to the Main Entrance. Inside it you can walk anywhere that isn't built on (see lib/route.ts); nothing
 * crosses the river.
 */
export const FENCE: [number, number][][] = [
  [
    [60.1, 249.8], [55.2, 242.4], [34.4, 210.5], [47.5, 194.7], [120.2, 122.5], [122, 124.1], [152.2, 91.2], [156.3, 92.9],
    [182.4, 59.9], [187.1, 53.7], [185.7, 31.8], [195, 32.9], [205, 33.7], [228.2, 34.9], [253, 36.2],
  ],
  [[263, 36.7], [305, 39.4], [315, 40.1], [325.3, 40.9], [345.8, 43.4], [362, 47], [378.7, 54.2], [340.2, 82.7]],
  [[344.4, 88.3], [386.2, 57.1], [447.4, 81.6], [508.2, 139.2], [520.3, 156.3]],
  [
    [523.8, 161.2], [534.1, 175.8], [568, 247.4], [588, 280], [588, 300.5], [517.4, 264.6], [472.1, 248.4], [395.1, 221],
    [288.5, 212.6], [167.9, 228.2], [74.2, 274.2], [70.4, 267.9], [66.1, 259.1],
  ],
];

/**
 * The crew's side of the barricades (BARRICADES): the Artist Gate compound, the crew lane, both backstages and both
 * bridge decks, as one ring: the barricades, joined through the three stages they meet, and back round by the fence.
 */
export function restrictedArea(): [number, number][] {
  const [compound, tanderrum, back] = BARRICADES.map((b) => smooth(b.line));
  const fence = FENCE.flat();
  const from = fence.findIndex(([x, y]) => x === 523.8 && y === 161.2); // the fence just past Tanderrum Bridge, going back round
  const to = fence.findIndex(([x, y]) => x === 315 && y === 40.1); // to just past where the first barricade starts
  return [...compound, ...tanderrum, ...back, ...fence.slice(to, from + 1).reverse()];
}

/** A food truck: 6 m long and 2.8 m deep, parked along x, 1.6 m from the next one nose to tail, 0.4 m back to back. */
export const TRUCK = { len: 6, depth: 2.8, gap: 1.6, back: 0.4 } as const;

/** One truck in a food court: its body, and the side its serving hatch (and awning) opens onto. */
export type Truck = Box & { hatch: 'n' | 's' };

/**
 * Food Alley's stalls, spread over the terrace rather than packed in one block. Each is a truck on its own (`hatch`
 * says which side it serves) or a pair back to back, as [x, y] from the zone's north-west corner. The nodes along the
 * alley (foodW, food, foodE, y 92) run through the gaps, and the badge sits in the open middle.
 */
const STALLS: { at: [number, number]; hatch: 'n' | 's' | 'both' }[] = [
  { at: [3, 5], hatch: 'both' },
  { at: [34, 3], hatch: 'both' },
  { at: [63, 8], hatch: 's' },
  { at: [14, 27], hatch: 'n' },
  { at: [53, 24], hatch: 'both' },
  { at: [26, 37], hatch: 's' },
  { at: [66, 36], hatch: 'n' },
  { at: [3, 50], hatch: 's' },
  { at: [44, 49], hatch: 'both' },
  { at: [22, 54], hatch: 'n' },
  { at: [68, 51], hatch: 's' },
];

/** Where people eat: a spot in the zone (same offsets as STALLS), the shape of the paving under it, and what's on it. */
const DINING: { at: [number, number]; size: [number, number]; seats: [kind: Seat['kind'], dx: number, dy: number, deg: number, umbrella: boolean][] }[] = [
  { at: [24, 14], size: [22, 12], seats: [['cafe', -7.5, -1, 0, true], ['cafe', -2.5, 2.5, 0, false], ['cafe', 2.5, -1.5, 0, true], ['cafe', 7.5, 2, 0, false], ['bench', -3, -5, 0, false], ['bench', 4.5, 5, 0, false]] },
  { at: [58, 18], size: [17, 11], seats: [['picnic', -4.5, -1, 0, true], ['picnic', 4.5, -1, 0, false], ['picnic', 0, 3.5, 0, true], ['bench', 0, -4.2, 0, false]] },
  { at: [12, 36], size: [17, 11], seats: [['cafe', -4.5, 0, 0, true], ['cafe', 1, 2.5, 0, false], ['cafe', 5.5, -1.5, 0, false], ['bench', -1, -4.5, 0, false]] },
  { at: [46, 36], size: [22, 12], seats: [['picnic', -7, -2, 0, true], ['picnic', -1, 1.5, 0, false], ['picnic', 5.5, -2, 0, true], ['picnic', 8, 3, 0, false], ['bench', -4, 5, 0, false]] },
  { at: [34, 47], size: [13, 9], seats: [['cafe', 0, -2, 0, false], ['bench', -3.5, 2.5, 0, false], ['bench', 3.5, 2.5, 0, false]] },
  { at: [60, 45], size: [17, 11], seats: [['cafe', -5, -1.5, 0, false], ['cafe', 0.5, 1.5, 0, true], ['cafe', 5.5, -1.5, 0, false], ['bench', 0, -4.5, 0, false]] },
  { at: [14, 57], size: [17, 9], seats: [['picnic', -4, 0, 0, true], ['picnic', 2.5, 0, 0, false], ['bench', 7, 2, 0, false]] },
  { at: [46, 60], size: [17, 9], seats: [['cafe', -4.5, 0, 0, true], ['cafe', 0, 2, 0, false], ['cafe', 4.5, -0.5, 0, true]] },
];

/**
 * A `trucks` box laid out as a food court, spread out: trucks singly and in back-to-back pairs a good way apart (see
 * STALLS), every hatch onto open ground, with dining spots between them where the paving, tables, chairs and umbrellas
 * are (see DINING). `blocks` are what you walk round (one per stall); `pads` is the paving under the stalls and dining.
 */
export function foodCourt(b: Box) {
  const trucks: Truck[] = [];
  const blocks: Box[] = [];
  const pads: Box[] = [];
  for (const { at: [dx, dy], hatch } of STALLS) {
    const [x, y] = [b.x + dx, b.y + dy];
    if (hatch === 'both') {
      const h = 2 * TRUCK.depth + TRUCK.back;
      trucks.push({ x, y, w: TRUCK.len, h: TRUCK.depth, hatch: 'n' }, { x, y: y + h - TRUCK.depth, w: TRUCK.len, h: TRUCK.depth, hatch: 's' });
      blocks.push({ x, y, w: TRUCK.len, h });
    } else {
      trucks.push({ x, y, w: TRUCK.len, h: TRUCK.depth, hatch });
      blocks.push({ x, y, w: TRUCK.len, h: TRUCK.depth });
    }
  }
  // The apron round each stall, where its queue stands.
  for (const k of blocks) pads.push({ x: k.x - 1.6, y: k.y - 1.8, w: k.w + 3.2, h: k.h + 3.6 });
  const seats: Seat[] = [];
  for (const { at: [dx, dy], size: [w, h], seats: list } of DINING) {
    const [cx, cy] = [b.x + dx, b.y + dy];
    pads.push({ x: cx - w / 2, y: cy - h / 2, w, h });
    for (const [kind, sx, sy, deg, umbrella] of list) seats.push({ x: cx + sx, y: cy + sy, kind, deg, umbrella });
  }
  return { blocks, trucks, seats, pads };
}

/** Where each truck in a single row starts, west to east (the poster's trucks; the app lays a court out with foodCourt). */
export function truckSpots(b: Box): number[] {
  const n = Math.floor((b.w + TRUCK.gap) / (TRUCK.len + TRUCK.gap));
  const start = b.x + (b.w - (n * (TRUCK.len + TRUCK.gap) - TRUCK.gap)) / 2;
  const mid = Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => i).filter((i) => !(n > 6 && i === mid)).map((i) => start + i * (TRUCK.len + TRUCK.gap));
}

/**
 * Named spots: where each zone is reached from, and what a turn is called after when it's near one.
 * Three terraces step down to the river: the upper one along Flinders St (x 35–380, above the Main Yarra Trail, which
 * cuts across it from the Main Entrance up to the William Barak Bridge), the middle one round the main lawn by Batman
 * Avenue (x 300–520), and the lower one along the water, from the Main Entrance to the Grove.
 */
export const NODES: Record<string, Landmark> = Object.fromEntries(
  ([
    ['gateB', 71.5, 249.1, 'the Main Entrance'],
    ['tickets', 51.3, 262, 'the Ticket Office'],
    ['merch', 100, 239.5, 'the Merch & Lounge'],
    ['artplay', 117, 211, 'ArtPlay'],
    ['playground', 72.5, 201, 'the Kids Playground'],
    ['tw', 126.5, 180, 'Toilets West'],
    ['riverBack', 310, 177, 'backstage at the River Stage'],
    ['w1', 172, 133, 'Water 1'],
    ['market', 147.5, 221.7, 'the Market'],
    ['photos', 202.5, 122, 'the photo booths'],
    ['swings', 224.5, 135.5, 'the swing ride'],
    ['river', 276, 183, 'the River Stage'],
    ['landing', 222, 220, 'the Landing'],
    ['angel', 240, 202, 'the Angel sculpture'],
    ['foodW', 216, 92, 'the west end of Food Alley'],
    ['food', 242, 92, 'Food Alley'],
    ['foodE', 268, 92, 'the east end of Food Alley'],
    ['gateA', 258, 46, 'the North Gate'],
    ['info', 285.5, 79, 'Info'],
    ['supplies', 330, 57, 'the supplies store'],
    ['artistGate', 338, 91, 'the Artist Gate'],
    ['barak', 362, 72, 'the William Barak Bridge'],
    ['artists', 500, -27, 'the Artist Village'],
    ['bar', 312, 120, 'the Bar'],
    ['bells', 322, 146, 'the Federation Bells'],
    ['tanderrumFoot', 318, 193, 'the foot of Tanderrum Bridge'],
    ['riverside', 330, 204, 'the riverside path'],
    ['w2', 358, 133, 'Water 2'],
    ['foh', 372, 114, 'the sound desk'],
    ['fa', 392, 99, 'First Aid'],
    ['lawn', 404, 122, 'the Lawn Stage'],
    ['back', 446, 122, 'Backstage'],
    ['groveStage', 411, 186, 'the Grove Stage'],
    ['medic', 470, 210, 'the medic tent'],
    ['w3', 478, 233, 'Water 3'],
    ['corner', 505, 200, 'the Grove'],
    ['te', 550, 268, 'Toilets East'],
  ] as const).map(([id, x, y, name]) => [id, { id, x, y, name }]),
);


export const VENUE_ZONES: Record<string, VenueZone> = Object.fromEntries(
  ([
    { slug: 'gate-a', node: 'gateA', label: 'North Gate', icon: 'gate', shape: { kind: 'gate', x: 258, y: 22 } },
    { slug: 'gate-b', node: 'gateB', label: 'Main Entrance', icon: 'gate', shape: { kind: 'gate', x: 39.6, y: 269.6 } },
    { slug: 'lawn-stage', node: 'lawn', label: 'Lawn Stage', icon: 'stage', shape: { kind: 'stage', faces: 'w', x: 422, y: 104, w: 14, h: 36 } },
    // On the lower terrace at the foot of Tanderrum Bridge's ramp, below the Federation Bells' steps: backed onto the barricade
    // round the ramp (the River Backstage), its crowd out west over the open grass.
    { slug: 'river-stage', node: 'river', label: 'River Stage', icon: 'stage', shape: { kind: 'stage', faces: 'w', x: 291, y: 172, w: 10, h: 22 } },
    { slug: 'water-1', node: 'w1', label: 'Water 1', icon: 'water', shape: { kind: 'water', x: 172, y: 128 } },
    { slug: 'water-2', node: 'w2', label: 'Water 2', icon: 'water', shape: { kind: 'water', x: 358, y: 127 } },
    { slug: 'water-3', node: 'w3', label: 'Water 3', icon: 'water', shape: { kind: 'water', x: 478, y: 227 } },
    { slug: 'first-aid-hq', node: 'fa', label: 'First Aid', icon: 'firstaid', shape: { kind: 'tent', x: 386, y: 86, w: 12, h: 8 } },
    { slug: 'food-alley', node: 'food', label: 'Food Alley', icon: 'food', shape: { kind: 'trucks', x: 204, y: 50, w: 76, h: 62 } },
    { slug: 'info-tent', node: 'info', label: 'Info', icon: 'info', shape: { kind: 'tent', x: 281, y: 69.5, w: 9, h: 5.5 } },
    // At the foot of William Barak Bridge: artists and crew only, in over the bridge from the Artist Village.
    { slug: 'artist-gate', node: 'artistGate', label: 'Artist Gate', icon: 'gate', shape: { kind: 'gate', x: 356.7, y: 74.7 } },
    { slug: 'toilets-west', node: 'tw', label: 'Toilets West', icon: 'toilets', shape: { kind: 'toilets', rows: 1, x: 120, y: 172, w: 13, h: 2.6 } },
    { slug: 'toilets-east', node: 'te', label: 'Toilets East', icon: 'toilets', shape: { kind: 'toilets', rows: 2, x: 556, y: 266, w: 18, h: 14 } },
    {
      // The elms in the south-east corner, south of the backstage barricade down to the river, and the open grass past
      // them to the riverside path: shade sails, picnic tables and umbrellas.
      slug: 'the-grove', node: 'corner', label: 'The Grove', icon: 'shade', badge: [510, 200],
      shape: {
        kind: 'area',
        ring: [[444, 204], [470, 205], [486, 196], [500, 181], [516, 173], [528, 169], [536, 180], [566, 244], [586, 279], [586, 296], [540, 274], [498, 256], [470, 246], [444, 230]],
      },
    },
    {
      // The Grove Stage: a marquee on the grass at the west edge of the elms, for the smaller acts. Covered, so it's
      // shelter in a storm too. The stage is at its east end; the audience is under the same roof.
      slug: 'grove-stage', node: 'groveStage', label: 'Grove Stage', icon: 'stage',
      shape: { kind: 'stage', faces: 'w', covered: true, x: 417, y: 177, w: 26, h: 17 },
    },
    {
      // ArtPlay, the old railway building at the Fed Square end: crew HQ for the day, the storm shelter, and where lost
      // children wait.
      slug: 'pavilion', node: 'artplay', label: 'ArtPlay', icon: 'pavilion',
      shape: { kind: 'building', ring: [[84.9, 203.4], [105.2, 193.8], [111.3, 206.8], [109.4, 207.7], [104.4, 210.1], [90.9, 216.3], [88.3, 210.6]] },
    },
    {
      // The Birrarung Marr Playground, beside ArtPlay at the Fed Square end: open to everyone, swings, a climbing net, a
      // cubby with a slide and a sandpit (see PLAY). Its landmark is just inside the way in from the path past ArtPlay.
      slug: 'playground', node: 'playground', label: 'Kids Playground', icon: 'shade',
      shape: { kind: 'area', ring: PLAYGROUND },
    },
    {
      // Backstage, shared by the Lawn Stage and the Grove Stage: behind the Lawn Stage up to Batman Avenue, and down
      // under Tanderrum Bridge to the back of the Grove Stage's marquee. Inside the barricades (see restrictedArea);
      // the Control Room, the crew's stock and the artists' trailers are in it.
      slug: 'backstage', node: 'back', label: 'Backstage', icon: 'backstage', badge: [466, 168],
      shape: {
        kind: 'area',
        ring: [
          [437, 98], [446, 86], [470, 104], [490, 122.5], [505, 137.5], [515, 150], [520.3, 156.3], [514, 167.5], [500, 173],
          [490, 184], [478, 194], [462, 199], [446, 198], [443, 186], [443, 177], [424, 172], [410, 168], [418, 147], [437, 140],
        ],
      },
    },
    {
      // Behind the River Stage: the foot of Tanderrum Bridge's ramp, inside the barricades (see restrictedArea), with the
      // stage's control shed and stock. Joined along the ramp to Backstage, so crew go between the stages off the crowd.
      slug: 'track-backstage', node: 'riverBack', label: 'River Backstage', icon: 'backstage', badge: [310.5, 175.5],
      shape: { kind: 'area', ring: [[303, 172.2], [309, 171.4], [322, 169.8], [322, 182], [314, 186.4], [308.5, 192.2], [303, 193.6]] },
    },
    {
      // Off the site: over William Barak Bridge in Yarra Park, where artists arrive, change, eat and wait. They come in
      // over the bridge to the Artist Gate. Its landmark is on the bridge, just past the plan's top edge.
      slug: 'artist-village', node: 'artists', label: 'Artist Village', icon: 'artists',
      shape: { kind: 'area', ring: [[535, -75], [530, -88], [521, -92], [478, -74], [475, -65], [480, -52], [489, -48], [532, -66]] },
    },
    {
      // Box office cabins on Princes Walk, outside the Main Entrance: buy or collect tickets here, then in through the lanes
      // (the Ticket Office's landmark is where they start).
      slug: 'ticket-office', node: 'tickets', label: 'Ticket Office', icon: 'tickets',
      shape: { kind: 'building', ring: [[37.7, 245.5], [45.3, 257.2], [40.3, 260.5], [32.7, 248.8]] },
    },
    {
      // A pavilion on the river just inside the Main Entrance: merch shop and seats in the shade.
      slug: 'merch-lounge', node: 'merch', label: 'Merch & Lounge', icon: 'shop',
      shape: { kind: 'building', ring: [[96.6, 246.8], [109.2, 240.7], [111.4, 245.2], [98.8, 251.3]] },
    },
    {
      // Pop-up stalls either side of the gravel path on the lower terrace, from ArtPlay's forecourt to the stairs up to
      // Water 1: merch and makers, glitter and face paint, lockers and phone charging (see MARKET). Drawn as its stalls.
      slug: 'market', node: 'market', label: 'Market', icon: 'shop', badge: [148.9, 221.1],
      shape: {
        kind: 'area',
        ring: [[123.9, 222.6], [144.7, 213.7], [168.9, 201.8], [173.5, 211.2], [147.4, 223.9], [149.9, 229.9], [133.9, 236.8], [128.1, 232.2]],
      },
    },
    {
      // Containers in the Artist Gate compound, at the north-east end of the upper terrace: crew stores (water, ice,
      // sunscreen, radios, spare barriers).
      slug: 'supplies', node: 'supplies', label: 'Supplies', icon: 'supplies',
      shape: { kind: 'building', ring: [[323, 46], [337, 46], [337, 53], [323, 53]] },
    },
    // The bar on the plaza by the Federation Bells: a zone, so "fight by the bar" lands on the map. Routes still walk round it.
    { slug: 'bar', node: 'bar', label: 'Bar', icon: 'bar', shape: { kind: 'tent', ...DECOR.bar } },
  ] satisfies VenueZone[]).map((z) => [z.slug, z]),
);
