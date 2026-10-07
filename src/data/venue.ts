/**
 * Site plan for the festival grounds. Units are metres on a flat plan, y pointing down
 * (same as screen space), so routing distances are real and the map can frame things in plan space.
 * The plan is pinned to the real site by GEO; toLngLat/toPlan convert, so GPS slots straight in.
 * Static today; later this is per-event config loaded with the rest of the lookups.
 */

export type Point = { x: number; y: number };

export type Landmark = Point & { id: string; /** Spoken name, e.g. "the Info Tent". */ name: string };

type Box = { x: number; y: number; w: number; h: number };
export type ZoneShape =
  /** `faces` is the side the audience is on. */
  | ({ kind: 'stage'; faces: 'n' | 's' | 'e' | 'w' } & Box)
  | ({ kind: 'tent' } & Box)
  /** Food trucks parked in a row (see truckSpots). */
  | ({ kind: 'trucks' } & Box)
  /** Rows of portable toilets along the top and bottom of the box. */
  | ({ kind: 'toilets'; rows: 1 | 2 } & Box)
  | { kind: 'area'; ring: [number, number][] }
  /** A permanent building, drawn from its real footprint. */
  | { kind: 'building'; ring: [number, number][] }
  | { kind: 'water'; x: number; y: number }
  | { kind: 'gate'; x: number; y: number };

export type ZoneIcon = 'stage' | 'gate' | 'water' | 'firstaid' | 'food' | 'info' | 'backstage' | 'toilets' | 'shade' | 'pavilion' | 'tickets' | 'shop' | 'supplies' | 'artists';

export type VenueZone = {
  slug: string;
  /** The landmark you arrive at. */
  node: string;
  shape: ZoneShape;
  /** Short label drawn on the map. */
  label: string;
  icon: ZoneIcon;
  /** Where the badge goes, if the middle of the shape isn't the place for it. */
  badge?: [number, number];
};

/** The plan's extent: University Oval and the athletics track, from Trinity College to the tennis courts, Queen's College to Tin Alley, and east to the Artist Village by Ormond College. */
export const VENUE = { width: 300, height: 325 } as const;

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
 * The festival fence, clockwise from the Main Entrance's west post. It breaks for the VIP Gate (Gate A), where
 * the Tin Alley tunnel comes up beside Nona Lee Sports Centre, and for the Main Entrance (Gate B), the walkway
 * between Nona Lee and the Beaurepaire Centre. West: the path along Trinity College. North: round the back of the
 * Pavilion, along the path below Ormond College and McCaughey Court and past the car park, so all
 * the ground around the oval is in. North-east: out round Morrison Close's east side to take in the
 * Artist Village, along the walls of Kernick, Eakins Hall and the netball court (the break at the east end is the Artist Gate, square to the yard's road). East: Newman Drive, taking in the tennis courts. South: along the
 * walls of the Beaurepaire Centre and Nona Lee, so there's no gap between fence and building. Inside it you can walk anywhere that isn't built on (see lib/route.ts).
 */
export const FENCE: [number, number][][] = [
  [
    [140.8, 281.5], [78.9, 281.5], [78.9, 284.8], [38.6, 284.8], [38.6, 280.1], [28.3, 280.2], [22, 268], [21, 241], [19, 216], [18, 197], [17, 184],
    [17, 166], [18, 156], [19, 148], [25, 120], [28, 101], [30, 88], [35, 71], [35.5, 52], [31, 45.5], [38, 36],
    [47, 28], [56, 19], [64, 13.5], [71, 8], [78, 3.5], [84, 7], [91, 9.5], [106, 6.8], [112, 4.6], [125, 2.8],
    [140, 2.5], [153, 4.5], [162.8, 4.2], [170.5, 9.9], [182.1, -5.5], [198, 0], [217, 1.5], [227.8, -3.2], [242.9, 8], [256.7, 18.1],
    [264.8, 24.1], [262.9, 32.2], [271.7, 38.9], [284, 48.3], [289.1, 53.4],
  ],
  [
    [284.9, 63.6], [277, 72], [263, 75], [250, 78], [240, 81], [238, 100], [246, 130], [247, 160], [247, 190], [246, 225], [243, 243], [239, 262], [237, 281],
  ],
  [
    [229.7, 281.4], [229.4, 262.6], [227.3, 262.4], [227.1, 242.6], [203.2, 243], [203.1, 277.2], [198.3, 277.4], [198.3, 280.1],
    [193.7, 280.1], [193.8, 282.1], [163.5, 282.5],
  ],
];

/** Trucks in a `trucks` row: 6 m long, 1.6 m apart. A long row leaves its middle spot empty to walk through. */
export const TRUCK = { len: 6, gap: 1.6 } as const;

/** Where each truck in a row starts, west to east. */
export function truckSpots(b: Box): number[] {
  const n = Math.floor((b.w + TRUCK.gap) / (TRUCK.len + TRUCK.gap));
  const start = b.x + (b.w - (n * (TRUCK.len + TRUCK.gap) - TRUCK.gap)) / 2;
  const mid = Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => i).filter((i) => !(n > 6 && i === mid)).map((i) => start + i * (TRUCK.len + TRUCK.gap));
}

/**
 * Named spots: where each zone is reached from, and what a turn is called after when it's near one.
 * The oval is x 50–208, y 33–171; the track x 27–205, y 184–266. Food Alley runs between them, the
 * service road (Newman Drive) down the east side, the south walk between the track and the sports centres.
 */
export const NODES: Record<string, Landmark> = Object.fromEntries(
  ([
    ['gateA', 214, 231, 'the VIP Gate'],
    ['ramp', 190, 257, 'the ramp by the Sports Centre'],
    ['rampFoot', 163, 274, 'the bottom of the ramp'],
    ['gateB', 150, 286, 'the Main Entrance'],
    ['tickets', 160, 292, 'the Ticket Office'],
    ['merch', 144, 292, 'the Merch & Lounge'],
    ['supplies', 46, 281, 'the supplies store'],
    ['info', 124, 273, 'the Info Tent'],
    ['trackS', 108, 272, 'the south side of the track'],
    ['fa', 57, 276, 'the First Aid Post'],
    ['westS', 27, 274, 'the corner by Trinity College'],
    ['tw', 25, 170, 'Toilets West'],
    ['w1', 51, 153, 'Water Station 1'],
    ['grove', 39, 134, 'the Grove'],
    ['stand', 48, 108, 'the grandstand'],
    ['pavilion', 97, 43, 'the Pavilion'],
    ['foodW', 72, 174, 'the west end of Food Alley'],
    ['food', 115, 174, 'Food Alley'],
    ['trackN', 115, 186, 'the north side of the track'],
    ['trackStage', 96, 224, 'the Track Stage'],
    ['trackBack', 42, 225, 'backstage at the Track Stage'],
    ['foodE', 158, 177, 'the east end of Food Alley'],
    ['w2', 184, 186, 'Water Station 2'],
    ['foh', 130, 110, 'the sound desk'],
    ['oval', 170, 102, 'the Oval Stage'],
    ['medic', 184, 142, 'the medic tent'],
    ['te', 207, 208, 'Toilets East'],
    ['back', 224, 126, 'the Oval Stage backstage'],
    ['artists', 252, 70, 'the Artist Village'],
    ['artistGate', 282, 58, 'the Artist Gate'],
  ] as const).map(([id, x, y, name]) => [id, { id, x, y, name }]),
);


export const VENUE_ZONES: Record<string, VenueZone> = Object.fromEntries(
  ([
    { slug: 'gate-a', node: 'gateA', label: 'VIP Gate', icon: 'gate', shape: { kind: 'gate', x: 232, y: 262 } },
    { slug: 'gate-b', node: 'gateB', label: 'Main Entrance', icon: 'gate', shape: { kind: 'gate', x: 150, y: 304 } },
    { slug: 'lawn-stage', node: 'oval', label: 'Oval Stage', icon: 'stage', shape: { kind: 'stage', faces: 'w', x: 188, y: 85, w: 14, h: 34 } },
    { slug: 'river-stage', node: 'trackStage', label: 'Track Stage', icon: 'stage', shape: { kind: 'stage', faces: 'e', x: 69, y: 209, w: 12, h: 32 } },
    { slug: 'water-1', node: 'w1', label: 'Water 1', icon: 'water', shape: { kind: 'water', x: 51, y: 150 } },
    { slug: 'water-2', node: 'w2', label: 'Water 2', icon: 'water', shape: { kind: 'water', x: 191, y: 179 } },
    { slug: 'first-aid-hq', node: 'fa', label: 'First Aid', icon: 'firstaid', shape: { kind: 'tent', x: 40, y: 270.5, w: 12, h: 8 } },
    { slug: 'food-alley', node: 'food', label: 'Food Alley', icon: 'food', shape: { kind: 'trucks', x: 71, y: 177, w: 88, h: 5 } },
    { slug: 'info-tent', node: 'info', label: 'Info', icon: 'info', shape: { kind: 'tent', x: 117, y: 275, w: 9, h: 5.5 } },
    { slug: 'artist-gate', node: 'artistGate', label: 'Artist Gate', icon: 'gate', shape: { kind: 'gate', x: 296, y: 62 } },
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
    {
      // Oval Backstage: everything behind the Oval Stage. From the back of the stage across Newman Drive to the
      // fence, and up the road and the strip beside the oval to Dressing. In it, the fenced yard north of the
      // tennis courts with the Control Room (the shed, and the crew's stock in containers on the grass) and the
      // artists' trailers. Staff only, like the Artist Village it shares an edge with, so the two read as one grey zone.
      slug: 'backstage', node: 'back', label: 'Oval Backstage', icon: 'backstage', badge: [226, 126],
      shape: {
        kind: 'area',
        ring: [
          [149.1, 11.4], [152.2, 12.3], [159.6, 14.5], [168.2, 16.8], [176.9, 18.9], [186.1, 22.5], [195.9, 28.3], [204.1, 34],
          [209.9, 38.9], [214.1, 43.1], [216.6, 46.6], [219.2, 50.8], [222.1, 56.2], [225.2, 63], [228.3, 71.3], [230.6, 77.7],
          [239.5, 79.3], [238.5, 85], [237, 98], [242.5, 121], [244.5, 143], [245, 153], [240, 157], [222, 157.5], [206.5, 157],
          [198, 154.5], [196.5, 144.5], [199.6, 132.9], [201.5, 122], [202, 119], [202, 85], [201, 75], [195, 64], [188, 53],
          [182.1, 49.2], [173.4, 44.4], [163.5, 40.4], [147.7, 35.5],
        ],
      },
    },
    {
      // Behind the Track Stage: the track's west bend, from the back of the stage out to the fence. Crew and
      // artists only; the stage's audience is all east of it.
      slug: 'track-backstage', node: 'trackBack', label: 'Track Backstage', icon: 'backstage', badge: [42, 225],
      shape: {
        kind: 'area',
        ring: [
          [18, 189], [18.5, 186.7], [19.8, 184.8], [21.7, 183.5], [24, 183], [59, 183], [62.8, 183.8], [66.1, 185.9], [68.2, 189.2],
          [69, 193], [69, 258], [68.2, 261.8], [66.1, 265.1], [62.8, 267.2], [59, 268], [29, 268], [26.7, 267.5], [24.8, 266.2],
          [23.5, 264.3], [23, 262], [22, 241], [20, 216], [19, 197],
        ],
      },
    },
    {
      // Ormond College's car park and the buildings round it, off Morrison Close: where artists arrive,
      // change, eat and wait. Dressing cabins and coaches in the car park (see venue-features.ts). Its
      // outline runs just inside the fence, and along the east edge of the road.
      slug: 'artist-village', node: 'artists', label: 'Artist Village', icon: 'artists', badge: [272, 52],
      shape: {
        kind: 'area',
        ring: [
          [153.1, 6.3], [162.2, 6], [170.9, 12.4], [182.7, -3.4], [197.6, 1.8], [217.3, 3.3], [227.6, -1.1], [241.8, 9.4],
          [255.6, 19.5], [262.8, 24.8], [260.9, 32.9], [270.6, 40.3], [282.4, 49.4], [285, 58.1], [276, 70.4], [262.6, 73.2],
          [249.5, 76.3], [239.5, 79.3], [230.6, 77.7], [228.3, 71.3], [225.2, 63], [222.1, 56.2], [219.2, 50.8], [216.6, 46.6],
          [214.1, 43.1], [209.9, 38.9], [204.1, 34], [195.9, 28.3], [186.1, 22.5], [176.9, 18.9], [168.2, 16.8], [159.6, 14.5],
          [152.2, 12.3], [149.1, 11.4],
        ],
      },
    },
    {
      // Nona Lee Sports Centre, between the gates, just outside the fence: buy or collect tickets
      // here, then in at the Main Entrance. The east end over the Tin Alley tunnel is left off so the way up
      // to Gate A stays visible.
      slug: 'ticket-office', node: 'tickets', label: 'Ticket Office', icon: 'tickets',
      shape: {
        kind: 'building',
        ring: [
          [203.2, 243], [227.1, 242.6], [227.3, 262.4], [229.4, 262.6], [229.7, 281.4], [230.1, 306.4], [164.5, 306.9], [164.2, 294.5],
          [163.5, 282.5], [193.8, 282.1], [193.7, 280.1], [198.3, 280.1], [198.3, 277.4], [203.1, 277.2], [203.2, 262.6], [202, 262.7],
          [202, 249.5], [203.2, 249.5],
        ],
      },
    },
    {
      // Beaurepaire Centre's east block, along the south side of the track just west of Gate B: merch
      // shop and indoor seating, out of the sun.
      slug: 'merch-lounge', node: 'merch', label: 'Merch & Lounge', icon: 'shop',
      shape: { kind: 'building', ring: [[78.9, 281.5], [140.8, 281.5], [140.8, 299.2], [79, 299.2]] },
    },
    {
      // Beaurepaire Centre's west block, behind First Aid: crew stores (water, ice, sunscreen, radios,
      // spare barriers).
      slug: 'supplies', node: 'supplies', label: 'Supplies', icon: 'supplies',
      shape: {
        kind: 'building',
        ring: [
          [28.3, 280.2], [38.6, 280.1], [38.6, 284.8], [78.9, 284.8], [79, 308.2], [48.3, 308.2], [48.3, 291.4], [38.7, 291.4],
          [38.6, 295.3], [28.3, 295.4],
        ],
      },
    },
  ] satisfies VenueZone[]).map((z) => [z.slug, z]),
);
