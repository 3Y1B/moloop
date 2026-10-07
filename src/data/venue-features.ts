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
  // South walk, between the track and the sports centres, and the ramp up to Gate A
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
];

export const DECOR = {
  /** Medic points: at the Oval Stage, beside the Track Stage and on the south walk. */
  medics: [
    { x: 186, y: 128, w: 5, h: 5 },
    { x: 69, y: 200, w: 5, h: 5 },
    { x: 84, y: 275, w: 5, h: 4.5 },
  ] satisfies Box[],
  /** Sound desks, out in front of each stage. */
  foh: [
    { x: 127, y: 99, w: 6, h: 6 },
    { x: 114, y: 222, w: 5, h: 5 },
  ] satisfies Box[],
  bar: { x: 217, y: 162, w: 18, h: 13 } satisfies Box,
  /** Bag check at Gate A, beside the top of the tunnel road. */
  security: { x: 235, y: 229, w: 7, h: 6 } satisfies Box,
  /** Ticket booth at Gate B. */
  booth: { x: 157, y: 288, w: 4, h: 3 } satisfies Box,
  /** Queue lanes up the tunnel road. */
  lanes: [
    [[230.5, 250], [230.5, 278]],
    [[232.5, 250], [232.5, 278]],
    [[234.5, 250], [234.5, 278]],
  ] satisfies Ring[],
  /** Crowd barriers either side of the way in at Gate B. */
  barriers: [
    [[141, 287], [147, 287]],
    [[153, 287], [163, 287.5]],
  ] satisfies Ring[],
  /** Shade sails in the Grove. */
  sails: [
    [[29, 126], [42, 121], [37, 134]],
    [[40, 141], [53, 145], [43, 153]],
    [[25, 148], [36, 146], [31, 159]],
  ] satisfies Ring[],
  /** Picnic umbrellas between Water 1 and Food Alley. */
  umbrellas: [[64, 160], [71, 166], [61, 168]] satisfies [number, number][],
  /** Artist trailers in the backstage compound. */
  trailers: [
    { x: 193, y: 137, w: 7, h: 3 },
    { x: 193, y: 143, w: 7, h: 3 },
    { x: 204.5, y: 147, w: 5, h: 5 },
  ] satisfies Box[],
};
