/**
 * What the festival map draws besides the zones: the real ground under the festival (from
 * OpenStreetMap, in plan metres, see venue.ts) and the small things that make it read as a
 * festival (medic tents, sound desks, shade sails). None of these are places you can be sent to.
 */

type Ring = [number, number][];
type Box = { x: number; y: number; w: number; h: number };

/** University Oval's boundary. */
export const OVAL: Ring = [
  [152, 168], [143, 170], [130, 171], [115, 170], [106, 169], [96, 167], [85, 164], [78, 160], [70, 152], [61, 143],
  [57, 135], [53, 126], [50, 116], [50, 105], [52, 94], [56, 82], [59, 75], [66, 65], [73, 57], [83, 49], [92, 43],
  [102, 39], [113, 36], [123, 34], [135, 33], [148, 34], [164, 39], [174, 43], [183, 48], [191, 55], [198, 62],
  [205, 77], [208, 93], [208, 103], [206, 113], [203, 125], [197, 134], [189, 145], [181, 152], [173, 159], [164, 163],
];

/** The athletics track: a stadium round two centres on y, lanes between `inner` and `outer`. */
export const TRACK = { west: 67, east: 164, y: 225, inner: 30, outer: 40.5 } as const;

/** The hockey field in the middle of the track. */
export const FIELD: Box = { x: 67, y: 197, w: 92, h: 55 };

export const TENNIS: Box[] = [
  { x: 214, y: 159, w: 11, h: 24 },
  { x: 228, y: 159, w: 11, h: 24 },
  { x: 214, y: 193, w: 11, h: 24 },
  { x: 228, y: 193, w: 11, h: 24 },
];

/** University Grandstand, on the west side of the oval. */
export const GRANDSTAND: Ring = [[48, 99], [37, 96], [44, 76], [55, 79]];

/** Newman Drive, the service road up the east side, from the tunnel mouth round to the north of the oval. */
export const SERVICE_ROAD: Ring = [
  [232, 281], [232, 248], [231, 240], [228, 237], [220, 234], [212, 230], [208, 225], [208, 211], [207, 190], [203, 183],
  [202, 172], [201, 145], [204, 134], [207, 122], [209, 113], [212, 104], [218, 96], [225, 86], [227, 79], [221, 62],
  [215, 51], [211, 45], [201, 36], [182, 24], [165, 20], [148, 15],
];

/** The Tin Alley tunnel, under Nona Lee Sports Centre. */
export const TUNNEL: Ring = [[232, 306], [232, 281]];

/** The car park behind the Pavilion, where Newman Drive ends. */
export const CAR_PARK: Ring = [[120, 14], [125, 24], [128, 22], [135, 19], [137, 17], [139, 17], [139, 4], [127, 5], [127, 10]];

/** Ormond College's car park, now the Artist Village's yard. */
export const YARD: Ring = [[240, 49], [245, 34], [259, 33], [269, 37], [281, 50], [288, 57], [285, 67], [272, 72], [256, 75], [239, 75], [237, 62]];

/** Ormond's buildings round the yard, from OpenStreetMap, which the artists have taken over. `at` is where the badge goes. */
export const ARTIST_BUILDINGS: { name: string; icon: 'backstage' | 'food' | 'artists'; at: [number, number]; ring: Ring }[] = [
  {
    name: 'Green Room', icon: 'backstage', at: [209, 17],
    ring: [
      [209.9, 7.4], [213.9, 10.3], [216.6, 12.4], [214.4, 15.6], [222.2, 21.7], [218.5, 27.1], [213.8, 23.9], [212.5, 25.8], [206.7, 26.8],
      [205.7, 26.1], [204.8, 27.2], [199, 23.2], [202.2, 18.4], [200.9, 17.5], [202.5, 15.2], [195.3, 9.6], [199, 4.4], [207.2, 10.4],
    ],
  },
  { name: 'Dressing', icon: 'artists', at: [163.5, 12.5], ring: [[154.5, 6], [152.5, 11.7], [172.5, 18.9], [174.6, 13.1]] },
  { name: 'Catering', icon: 'food', at: [241, 25], ring: [[242.9, 8], [226.6, 30.6], [240.3, 40.9], [243.9, 36], [251.1, 25.9], [256.7, 18.1]] },
];

/**
 * The real footpaths inside the fence, from OpenStreetMap. Just paving: you can walk anywhere on the
 * grass too, so routes don't follow them.
 */
export const PATHS: Ring[] = [
  // Round the oval, outside its boundary fence
  [
    [47, 115], [49, 101], [53, 87], [57, 75], [61, 68], [65, 62], [70, 58], [75, 53], [86, 46], [95, 41], [108, 36],
    [118, 34], [130, 32], [138, 32], [148, 33], [169, 39], [179, 44], [184, 47], [190, 51], [196, 57], [201, 64],
    [204, 69], [207, 77], [208, 82], [209, 87], [210, 98], [209, 101], [207, 113], [204, 122], [201, 130], [198, 135],
    [192, 142], [185, 150], [180, 154], [172, 160], [165, 164], [155, 168], [148, 170], [141, 171], [132, 172], [119, 171],
    [110, 170], [100, 169], [92, 167], [86, 165], [78, 161], [74, 157], [68, 153], [63, 147], [59, 141], [56, 135],
    [53, 129], [51, 123], [50, 118], [47, 115],
  ],
  // Along Trinity College, up the west side and round behind the Pavilion
  [
    [23, 276], [23, 268], [22, 241], [21, 233], [20, 216], [20, 197], [19, 184], [19, 166], [20, 156], [21, 148],
    [27, 120], [30, 101], [32, 88], [37, 71], [38, 68], [46, 57], [51, 52], [62, 39], [75, 32], [74, 25], [75, 22],
    [78, 19], [80, 16], [91, 12], [112, 6], [125, 4], [131, 3],
  ],
  [[75, 32], [79, 34], [85, 37], [88, 37], [95, 33]],
  [[88, 37], [75, 53]],
  // Across the Grove
  [[19, 184], [33, 150], [39, 132], [47, 115], [38, 102]],
  [[32, 88], [35, 94], [38, 102], [38, 114], [39, 132]],
  // South walk, between the track and the sports centres, and the ramp up to the VIP Gate
  [[22, 241], [32, 257], [47, 274], [54, 273], [76, 273], [141, 273], [163, 273]],
  [[148, 286], [148, 282], [147, 278], [141, 273]],
  [[148, 286], [157, 278], [163, 273], [173, 274], [181, 269], [189, 258], [196, 251], [200, 244], [209, 227]],
];

/** Trees: x, y, canopy radius. Mapped ones from OpenStreetMap, plus the planting in the Grove. */
export const TREES: [number, number, number][] = [
  // Grove and the west side of the oval
  [38, 144, 4], [32, 123, 4], [23, 129, 3.5], [34, 111, 3.5], [28, 150, 3.5], [46, 158, 3.5], [23, 158, 3], [51, 128, 3],
  [53, 169, 3], [40, 82, 3.5], [39, 63, 3.5], [53, 58, 4], [62, 53, 3.5], [70, 46, 3],
  // North-west, between the oval and Ormond College
  [54, 40, 3.5], [64, 31, 3.5], [42, 40, 3], [44, 47, 3],
  // North-east, between the oval and Newman Drive
  [142, 25, 4.5], [156, 27, 4.5], [176, 33, 4.5], [193, 41, 4.5], [203, 48, 4], [208, 55, 4], [216, 89, 4], [192, 160, 3.5],
  // South walk
  [62, 278, 3], [92, 278, 3], [103, 278, 3],
  // Artist Village: the lawn by the Green Room, round the Catering courtyard and by the netball court
  [188, 11, 5.8], [228, 5, 6.7], [226, 17, 5.4], [228, 35, 5], [253, 24, 3.3],
];

/** A w × h rectangle centred on (cx, cy), turned `deg` clockwise on the plan. */
function turned(cx: number, cy: number, w: number, h: number, deg: number): Ring {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return ([[-w, -h], [w, -h], [w, h], [-w, h]] as const).map(([x, y]) => [+(cx + (x * c - y * s) / 2).toFixed(2), +(cy + (x * s + y * c) / 2).toFixed(2)]);
}

/** `n` rooms of w × h in a row, `gap` apart, the first starting at (x, y) and the row running `deg` clockwise from east. */
function row(x: number, y: number, deg: number, n: number, w: number, h: number, gap = 0.8): Ring[] {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return Array.from({ length: n }, (_, i) => {
    const d = w / 2 + i * (w + gap);
    return turned(x + d * c, y + d * s, w, h, deg);
  });
}

/** Ormond's buildings run 37° off the plan's grid; what the artists have put in the yard lines up with them. */
const YARD_GRID = 37;

/** The ways through the fence: the middle of each gate's opening, and which way is in. */
export const GATEWAYS: { at: [number, number]; in: [number, number] }[] = [
  { at: [233.3, 281.2], in: [0, -1] }, // the VIP Gate (Gate A), at the top of the tunnel
  { at: [152, 281], in: [0, -1] }, // the Main Entrance (Gate B)
  { at: [287, 58.5], in: [-0.93, -0.38] }, // the Artist Gate, across the yard's road
];

/** First aid room in the east end of the Pavilion, well back from the Oval Stage's crowd. */
export const FIRST_AID_ROOM: [number, number] = [114, 17];

/** Toilets in the west end of the Pavilion. */
export const PAVILION_TOILETS: [number, number] = [91, 20];

/** The control sheds: the Oval Stage's on the concrete pad inside the compound off Newman Drive, the Track Stage's in the track's west bend behind it. */
export const CONTROL_SHEDS: Ring[] = [
  [[226.5, 98], [235.5, 98], [235.5, 105], [226.5, 105]],
  [[48, 206], [57, 206], [57, 212], [48, 212]],
];

export const DECOR = {
  /** Medic points: at the Oval Stage, in the Grove, beside the Track Stage and on the south walk. First aid is also in the Pavilion (`FIRST_AID_ROOM`). */
  medics: [
    { x: 186, y: 128, w: 5, h: 5 },
    { x: 44, y: 137, w: 5, h: 5 },
    { x: 69, y: 200, w: 5, h: 5 },
    { x: 84, y: 275, w: 5, h: 4.5 },
  ] satisfies Box[],
  /** Sound desks, out in front of each stage. */
  foh: [
    { x: 127, y: 99, w: 6, h: 6 },
    { x: 114, y: 222, w: 5, h: 5 },
  ] satisfies Box[],
  bar: { x: 217, y: 162, w: 18, h: 13 } satisfies Box,
  /** Bag check at every gate, where the queue lanes end: beside the top of the tunnel road at the VIP Gate, just inside the Main Entrance, and in the yard inside the Artist Gate. */
  security: [
    { x: 235, y: 229, w: 7, h: 6 },
    { x: 156, y: 274.5, w: 6, h: 5 },
    { x: 276, y: 63, w: 5, h: 4 },
  ] satisfies Box[],
  /** Queue lanes, two at each gate: up the tunnel road to the VIP Gate, out in the walkway at the Main Entrance, and outside the Artist Gate. */
  lanes: [
    [[230.5, 250], [230.5, 278]],
    [[232.5, 250], [232.5, 278]],
    [[234.5, 250], [234.5, 278]],
    [[146, 283], [146, 299]],
    [[150, 283], [150, 299]],
    [[154, 283], [154, 299]],
    [[287.5, 61.4], [293.5, 63.9]],
    [[288.4, 59.1], [294.4, 61.5]],
    [[289.4, 56.8], [295.4, 59.2]],
  ] satisfies Ring[],
  /** Crowd barriers from the Main Entrance's lanes out to the buildings either side, so the way in is through the lanes. */
  barriers: [
    [[141, 287], [146, 287]],
    [[154, 287], [163.5, 287.5]],
  ] satisfies Ring[],
  /** Shade sails in the Grove, in the gaps between the trees so no canopy pokes out from under one. */
  sails: [
    [[36.3, 117.9], [45.7, 110], [48.1, 121.5]],
    [[28.9, 160.5], [35.5, 151.1], [40.4, 160.8]],
    [[28.5, 134.2], [27.8, 142.4], [21.3, 138.1]],
  ] satisfies Ring[],
  /** Picnic umbrellas between the Grove and Food Alley. */
  umbrellas: [[64, 160], [71, 166], [61, 168]] satisfies [number, number][],
  /** Dressing cabins in the Artist Village yard: two rows beside Jack Clarke. */
  cabins: [...row(246.2, 47.3, YARD_GRID, 4, 6, 2.6), ...row(250, 42, YARD_GRID, 4, 6, 2.6)] satisfies Ring[],
  /** Artists' coaches parked along the yard's north side. */
  coaches: [...row(254.5, 36.2, YARD_GRID, 2, 11, 3, 1.5)] satisfies Ring[],
  /** Stock containers beside each control shed: on the lawn off Newman Drive, and in the track's west bend. */
  stores: [
    { x: 224, y: 112, w: 6, h: 2.4 },
    { x: 224, y: 115.6, w: 6, h: 2.4 },
    { x: 232, y: 112, w: 6, h: 2.4 },
    { x: 47, y: 238, w: 6, h: 2.4 },
    { x: 47, y: 241.6, w: 6, h: 2.4 },
    { x: 55, y: 238, w: 6, h: 2.4 },
  ] satisfies Box[],
  /** Artist trailers in the compound, south of the Control Room. */
  trailers: [
    { x: 227, y: 132, w: 7, h: 3 },
    { x: 227, y: 138, w: 7, h: 3 },
    { x: 237, y: 133, w: 5, h: 5 },
  ] satisfies Box[],
};
