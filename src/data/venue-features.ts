/**
 * What the festival map draws besides the zones: the real ground under the festival (from
 * OpenStreetMap, in plan metres, see venue.ts) and the small things that make it read as a
 * festival (medic tents, sound desks, bars, cabins). None of these are places you can be sent to.
 */

type Ring = [number, number][];
type Box = { x: number; y: number; w: number; h: number };

/** Somewhere to sit: a picnic table with its two benches, a café table with four chairs, or a bench. `deg` turns it clockwise on the plan; `umbrella` puts one over it. */
export type Seat = { x: number; y: number; kind: 'picnic' | 'cafe' | 'bench'; deg: number; umbrella: boolean };

/** The Yarra (the Birrarung): its water from the Fed Square end to past the Grove, both banks, with room to pan. */
export const RIVER: Ring = [
  [-328.8, 573], [-323.1, 567.5], [-318.5, 563.5], [-315, 560.8], [-312.4, 559.4], [-310.9, 559.4], [-309.8, 559],
  [-309.1, 558.3], [-308.7, 557.2], [-308.6, 555.7], [-305, 551.3], [-297.8, 544.1], [-287.1, 533.9],
  [-272.7, 520.9], [-259.1, 508.7], [-246.2, 497.4], [-233.9, 487.1], [-222.4, 477.6], [-210.8, 468.3],
  [-199.1, 459.2], [-187.3, 450.4], [-175.4, 441.8], [-166.1, 434.9], [-159.2, 429.6], [-154.9, 426],
  [-153.2, 424.1], [-150.1, 421.4], [-145.8, 418], [-140.1, 413.9], [-133.2, 409.1], [-126.9, 404.9],
  [-121.1, 401.5], [-115.9, 398.7], [-111.2, 396.7], [-103.5, 392.4], [-92.6, 386], [-78.7, 377.4], [-61.6, 366.6],
  [-44.7, 356], [-27.9, 345.5], [-11.2, 335.2], [5.4, 325.1], [18.1, 316.9], [27, 310.7], [32, 306.5], [33.1, 304.2],
  [36.5, 301], [42.1, 296.8], [50, 291.7], [60.1, 285.6], [73.5, 278.1], [90.3, 269.3], [110.3, 259.2],
  [133.6, 247.7], [158.6, 238.1], [185.3, 230.5], [213.6, 224.7], [243.6, 220.9], [272.7, 218.5], [301, 217.6],
  [328.3, 218.2], [354.8, 220.3], [382.3, 224.6], [410.7, 231], [440.2, 239.7], [470.7, 250.6], [499.1, 261.6],
  [525.4, 272.6], [549.7, 283.8], [571.9, 295.1], [592.2, 305.1], [610.6, 314], [627, 321.6], [641.6, 327.9],
  [655.4, 333.8], [668.5, 339.2], [680.9, 344.1], [692.7, 348.6], [704.2, 353.1], [715.5, 357.6], [726.7, 362.3],
  [737.6, 367], [751.2, 372.1], [767.4, 377.4], [786.2, 383.1], [807.5, 389.2], [828.6, 395.7], [849.3, 402.9],
  [869.8, 410.5], [889.8, 418.8], [909.5, 427], [928.7, 435.2], [947.5, 443.4], [965.9, 451.7], [986.3, 461.3],
  [1008.8, 472.4], [1033.4, 484.8], [1060.1, 498.7], [1083.4, 510.4], [1103.4, 520], [1120, 527.4], [1133.3, 532.6],
  [1145.5, 537.1], [1156.5, 540.9], [1166.4, 543.9], [1175.1, 546.2], [1183.2, 548.2], [1190.7, 550],
  [1197.7, 551.6], [1204, 552.9], [1212.3, 554.3], [1222.6, 556], [1234.9, 557.8], [1249.3, 559.9], [1261.5, 561.5],
  [1271.8, 562.6], [1279.9, 563.3], [1285.9, 563.6], [1295.1, 563.6], [1307.3, 563.2], [1322.6, 562.6],
  [1341, 561.7], [1357.1, 560.7], [1370.8, 559.5], [1382.1, 558.3], [1391.2, 556.9], [1400, 555.4], [1408.6, 553.8],
  [1417.1, 552], [1425.3, 550.1], [1433.5, 548.2], [1441.5, 546.1], [1449.5, 543.9], [1457.3, 541.6],
  [1465.1, 539.2], [1472.9, 536.8], [1480.7, 534.2], [1488.4, 531.5], [1494.2, 452.8], [1498.1, 298], [1500, 67.2],
  [1500, -239.7], [1500, -388.8], [1500, -380], [1500, -213.5], [1500, 110.9], [1498.3, 354.7], [1494.8, 517.9],
  [1489.7, 600.6], [1482.8, 602.8], [1475.6, 604.9], [1468.1, 607], [1460.2, 609.2], [1451.9, 611.2],
  [1442.6, 613.5], [1432, 615.8], [1420.4, 618.3], [1407.5, 620.9], [1396.7, 623], [1387.9, 624.6], [1381.1, 625.6],
  [1376.2, 626.2], [1368.4, 626.7], [1357.6, 627.1], [1343.9, 627.5], [1327.1, 627.8], [1312.3, 627.9],
  [1299.4, 627.9], [1288.3, 627.8], [1279.2, 627.5], [1270.4, 627.1], [1261.9, 626.7], [1253.7, 626.2],
  [1245.8, 625.6], [1236.5, 624.8], [1225.8, 623.6], [1213.8, 622.1], [1200.4, 620.4], [1188.8, 618.7],
  [1178.9, 617.3], [1170.9, 616], [1164.6, 614.8], [1158, 613.4], [1151, 611.6], [1143.6, 609.6], [1135.9, 607.3],
  [1128.5, 604.9], [1121.5, 602.4], [1114.9, 599.9], [1108.6, 597.3], [1095.8, 591.4], [1076.5, 582.2],
  [1050.6, 569.7], [1018.3, 554], [993.9, 542], [977.6, 533.7], [969.3, 529.2], [969, 528.5], [967.1, 527.2],
  [963.4, 525.1], [958.1, 522.4], [951.1, 519.1], [945.7, 516.6], [941.8, 515], [939.5, 514.4], [938.8, 514.6],
  [936.9, 514.1], [933.8, 513], [929.5, 511], [924, 508.4], [919.7, 506.2], [916.8, 504.4], [915.2, 503.2],
  [914.8, 502.3], [912.8, 501], [909.1, 499.2], [903.7, 496.8], [896.7, 494], [891.2, 491.9], [887.2, 490.7],
  [884.8, 490.3], [884, 490.7], [877, 488.8], [864, 484.7], [844.8, 478.2], [819.5, 469.5], [798, 461.9],
  [780.2, 455.3], [766.1, 449.9], [755.8, 445.5], [745.1, 441.1], [734, 436.7], [722.5, 432.2], [710.6, 427.7],
  [697.6, 422.6], [683.6, 416.9], [668.5, 410.7], [652.2, 404], [638.1, 398], [626.1, 392.8], [616.2, 388.5],
  [608.3, 384.9], [598.9, 380.5], [587.8, 375.1], [575.1, 368.9], [560.8, 361.7], [549.9, 356.5], [542.5, 353.3],
  [538.6, 352.1], [538.2, 352.8], [532.1, 350.6], [520.4, 345.3], [503.1, 337.1], [480.1, 325.9], [460.2, 316.6],
  [443.2, 309.1], [429.2, 303.4], [418.3, 299.7], [408.2, 296.4], [399.1, 293.6], [390.9, 291.3], [383.6, 289.4],
  [375.8, 287.8], [367.5, 286.4], [358.6, 285.1], [349.2, 284], [341.1, 283.1], [334.3, 282.5], [328.9, 282],
  [324.7, 281.8], [320.5, 281.6], [316.2, 281.5], [311.9, 281.6], [307.4, 281.7], [303, 281.8], [298.7, 281.9],
  [294.4, 282.1], [290.1, 282.4], [285.6, 282.7], [281.1, 283.1], [276.4, 283.7], [271.6, 284.3], [265.8, 285.2],
  [259.1, 286.2], [251.3, 287.5], [242.6, 289], [235, 290.3], [228.6, 291.5], [223.3, 292.6], [219.2, 293.6],
  [215, 294.6], [210.8, 295.7], [206.5, 297], [202.2, 298.2], [197.7, 299.8], [193, 301.6], [188.1, 303.6],
  [183, 305.8], [179, 307.4], [176.1, 308.4], [174.2, 308.8], [173.5, 308.5], [171.6, 309.1], [168.6, 310.4],
  [164.5, 312.6], [159.3, 315.5], [147.5, 323.3], [129.2, 335.8], [104.2, 353], [72.7, 375.1], [49, 391.9],
  [33.1, 403.4], [24.9, 409.8], [24.6, 410.9], [22.2, 413.2], [17.5, 416.7], [10.7, 421.3], [1.6, 427.2],
  [-5.4, 431.6], [-10.4, 434.7], [-13.4, 436.4], [-14.5, 436.8], [-16.5, 437.9], [-19.5, 439.8], [-23.4, 442.4],
  [-28.4, 445.8], [-32.2, 448.5], [-35, 450.5], [-36.7, 451.8], [-37.3, 452.5], [-37.8, 453.2], [-38.1, 454],
  [-38.2, 454.9], [-38.3, 455.8], [-40.6, 458.2], [-45.3, 461.8], [-52.4, 466.8], [-61.7, 473.2], [-68.7, 478.1],
  [-73.4, 481.5], [-75.6, 483.4], [-75.5, 483.9], [-75.8, 484.3], [-76.3, 484.6], [-77.2, 484.8], [-78.3, 484.8],
  [-79.9, 485.3], [-81.7, 486.1], [-84, 487.4], [-86.5, 489.1], [-88.6, 490.2], [-90.2, 490.9], [-91.2, 491],
  [-91.8, 490.5], [-92.4, 490.3], [-93.1, 490.2], [-93.8, 490.2], [-94.6, 490.4], [-100.4, 494.3], [-111.1, 502],
  [-126.8, 513.3], [-147.4, 528.4], [-164.8, 541.2], [-178.8, 551.8], [-189.4, 560.1], [-196.8, 566.2],
  [-205, 573.2], [-214.2, 581.1], [-224.3, 589.9], [-235.4, 599.6], [-247.3, 610.4], [-260.1, 622.3],
  [-273.7, 635.2], [-288.3, 649.2], [-300.1, 660.6], [-309.1, 669.5], [-315.5, 675.8], [-319, 679.6],
  [-321.8, 682.6], [-323.8, 684.8], [-324.9, 686.2], [-325.2, 686.9], [-326.2, 680.8], [-327.8, 667.8],
  [-330, 647.9], [-332.9, 621.2], [-333.6, 599.8], [-332.3, 583.7],
];

/** Lines on the water a few metres out from the park's bank, drawn faintly so the river reads as water. */
export const RIPPLES: Ring[] = [
  [
    [-37, 336.3], [62.5, 289.9], [136.4, 254.2], [160.8, 244.9], [186.9, 237.4], [214.7, 231.7], [244.3, 227.9],
    [273.1, 225.5], [301, 224.6], [328, 225.2], [354.1, 227.3], [378.4, 230.5], [400.8, 234.9], [421.3, 240.4],
    [497, 267.4], [527.2, 280.7], [614.4, 323.6], [697.1, 361.4],
  ],
  [
    [-33.7, 343.6], [65.9, 297.1], [139.6, 261.5], [163.4, 252.5], [188.8, 245.1], [216.1, 239.6], [245.2, 235.8],
    [273.6, 233.5], [301, 232.6], [327.6, 233.2], [353.3, 235.3], [377.1, 238.4], [399, 242.7], [418.9, 248.1],
    [494.1, 274.9], [523.8, 287.9], [611, 330.8], [693.8, 368.7],
  ],
];

/** Down the middle of the river, for its name. */
export const RIVER_LINE: Ring = [
  [125.2, 289.8], [147.2, 279], [169.4, 270.5], [193.4, 263.6], [219.2, 258.3], [247.2, 254.7], [274.6, 252.5],
  [301.1, 251.7], [326.6, 252.2], [351.3, 254.2], [374, 257.2], [394.7, 261.2], [413.2, 266.2], [487.2, 292.6],
  [515.7, 305.1],
];

/**
 * The park steps down to the river in three terraces. The upper one along Flinders St, above the Main Yarra Trail;
 * the middle one round the main lawn, up by Batman Avenue; the lower one is the rest, along the water. Each ring
 * follows the fence where it meets it.
 */
export const TERRACES: { upper: Ring; middle: Ring } = {
  upper: [
    [60.1, 249.8], [55.2, 242.4], [34.4, 210.5], [47.5, 194.7], [120.2, 122.5], [122, 124.1], [152.2, 91.2],
    [156.3, 92.9], [182.4, 59.9], [187.1, 53.7], [185.7, 31.8], [195, 32.9], [205, 33.7], [228.2, 34.9], [253, 36.2],
    [263, 36.7], [305, 39.4], [315, 40.1], [325.3, 40.9], [345.8, 43.4], [362, 47], [378.7, 54.2], [376.7, 56.4],
    [277.9, 121.4], [260.6, 132.7], [163.7, 196.1], [129.4, 217.7], [114.1, 228], [103.4, 235], [80.1, 250.1],
    [63.1, 254.5],
  ],
  middle: [
    [378.7, 54.2], [340.2, 82.7], [344.4, 88.3], [386.2, 57.1], [447.4, 81.6], [508.2, 139.2], [520.3, 156.3],
    [523.8, 161.2], [522.1, 161.2], [481.8, 162.4], [472.2, 162.5], [443.3, 154.1], [382.3, 171.1], [313, 178.7],
    [309.5, 160], [300.5, 140], [294.5, 126], [293.5, 111.2], [376.7, 56.4],
  ],
};

/** Where one terrace drops to the next: under the Main Yarra Trail, and from the Federation Bells along Tanderrum Bridge. */
export const TERRACE_EDGES: Ring[] = [
  [
    [63.1, 254.5], [80.1, 250.1], [103.4, 235], [114.1, 228], [129.4, 217.7], [163.7, 196.1], [260.6, 132.7],
    [277.9, 121.4], [376.7, 56.4],
  ],
  [
    [293.5, 111.2], [294.5, 126], [300.5, 140], [309.5, 160], [313, 178.7], [382.3, 171.1], [443.3, 154.1],
    [472.2, 162.5], [481.8, 162.4], [522.1, 161.2],
  ],
];

/** The main lawn, in the bowl on the middle terrace: mown, ringed by elms. */
export const MAIN_LAWN: Ring = [
  [333.6, 127.9], [351.4, 139.4], [370.3, 143.5], [400.5, 140.1], [442.3, 131.1], [450.4, 128.3], [455.7, 131.8],
  [471, 125.5], [454.7, 102.4], [429.5, 83.8], [389, 67.5], [344.2, 88.1], [343.8, 87.5], [343.3, 87.8],
  [337.4, 112.2], [333.6, 127.9],
];

/**
 * The Birrarung Marr Playground (OpenStreetMap's "ArtPlay Playground"): the kids' playground beside ArtPlay at the Fed
 * Square end, on the upper terrace between the fence and the path down past ArtPlay. The Kids Playground zone's ring.
 */
export const PLAYGROUND: Ring = [
  [43.2, 205.8], [46.5, 199.3], [51.3, 193.6], [57, 188.5], [65.9, 180.7], [74.2, 178.3], [79.4, 175.9],
  [84.4, 175.7], [88.1, 177.2], [91, 179.2], [80.1, 195.6], [77.9, 199.3], [77.5, 202.4], [79, 205.6], [81.1, 210.9],
  [79.9, 215.2], [74.1, 220], [73.6, 222.5], [76, 228.1], [67.3, 244.5], [61.1, 238.1], [52.2, 230], [48.9, 224.3],
  [44, 214.6], [43.2, 205.8],
];

/**
 * The playground's gear, from above at true size (see map-art's playground()). The swings in the north end, a rope
 * climbing net in the west, a timber cubby tower with its slide down to the south-west, the sandpit by the fence, and
 * rubber soft-fall under everything you can fall off. Benches for parents, and a low fence along the path past ArtPlay
 * with a gap in it where you walk in. All of it north of the steps at the south tip, and clear of the path.
 */
export const PLAY = {
  /** Rubber soft-fall, as boxes paved round their corners: under the swings, and under the cubby tower and its slide. */
  softfall: [
    { x: 69, y: 181, w: 10, h: 8 },
    { x: 63, y: 206.5, w: 9.5, h: 13 },
  ] satisfies Box[],
  /** A two-bay swing frame, its beam along x: two flat seats in the west bay, a basket (nest) swing in the east one. */
  swings: { beam: [[70.5, 185], [77.5, 185]] as Ring, seats: [[71.9, 185], [73.1, 185]] as [number, number][], basket: [75.75, 185] as [number, number] },
  /** The rope climbing net: a six-sided frame of poles round a mast, roped from the mast out, on its own round of soft-fall. */
  net: { at: [59, 200.5] as [number, number], r: 4, pad: 6 },
  /** The cubby: a little timber tower with a pitched roof. The slide comes off its south side, down to the south-west. */
  tower: { x: 66.5, y: 209, w: 3, h: 3 } satisfies Box,
  slide: [[67.6, 212], [65.6, 217]] as Ring,
  /** The sandpit, edged in timber. */
  sandpit: { x: 48.5, y: 211, w: 7, h: 5 } satisfies Box,
  /** Benches for parents: by the way in, facing the gear; between the swings and the net; and at the south end. */
  benches: [
    { x: 75.6, y: 206, kind: 'bench', deg: 80, umbrella: false },
    { x: 64.5, y: 191.5, kind: 'bench', deg: -40, umbrella: false },
    { x: 58, y: 223.5, kind: 'bench', deg: 20, umbrella: false },
  ] satisfies Seat[],
  /** The low fence along the path past ArtPlay, in two runs either side of the way in. */
  fence: [
    [[90.6, 179.8], [80.1, 195.6], [78.3, 198.6]],
    [[77.7, 203.6], [79, 205.6], [81.1, 210.9], [79.9, 215.2], [74.1, 220], [73.6, 222.5]],
  ] satisfies Ring[],
};

/**
 * The real paths inside the fence, from OpenStreetMap. Just paving: you can walk anywhere on the grass too, so
 * routes don't follow them. `trail` is the Main Yarra Trail (asphalt, wide), `gravel` the riverside path along the
 * lower terrace, `boardwalk` the timber walk at the water's edge, `path` everything else.
 */
export const PATHS: { kind: 'trail' | 'gravel' | 'boardwalk' | 'path'; line: Ring }[] = [
  {
    kind: 'trail',
    line: [
      [375.6, 52.9], [375.1, 53.9], [276.3, 118.9], [162.1, 193.6], [127.8, 215.2], [78.5, 247.6],
    ],
  },
  {
    kind: 'gravel',
    line: [
      [480.8, 233.8], [434.3, 215.2], [395.7, 202.8], [355.6, 199.8], [301.3, 200.8], [256.6, 190.2], [245.7, 204],
      [225.2, 205.6], [205.4, 196.7], [190.1, 200.8], [148.4, 221.3], [113.5, 236.3], [91.2, 242.9], [78.5, 247.6],
    ],
  },
  { kind: 'gravel', line: [[490.4, 224.5], [508.2, 233.4], [503.2, 242.9]] },
  { kind: 'gravel', line: [[503.2, 242.9], [480.8, 233.8]] },
  {
    kind: 'gravel',
    line: [
      [503.2, 242.9], [502.5, 250.6], [534.7, 265.8], [542.6, 271], [552.5, 276.6], [558, 281], [588, 296.1],
    ],
  },
  { kind: 'gravel', line: [[503.2, 242.9], [588, 283.2]] },
  { kind: 'gravel', line: [[285.4, 179.5], [301.9, 185.9], [358.1, 191.7], [415.3, 207.7], [480.8, 233.8]] },
  { kind: 'boardwalk', line: [[72.6, 271.6], [114.6, 249.4], [155.7, 229], [166, 225.2], [223.4, 212.2]] },
  {
    kind: 'path',
    line: [
      [449.9, 133.2], [430.1, 137.8], [401, 142.9], [374, 146.9], [369.2, 146.9], [360.6, 145.7], [350.2, 143],
      [338.2, 136], [329.1, 128.2],
    ],
  },
  { kind: 'path', line: [[472.8, 165.9], [481.7, 159.8], [449.9, 133.2]] },
  { kind: 'path', line: [[162.1, 193.6], [165, 179.5]] },
  { kind: 'path', line: [[67.3, 253.5], [72.2, 243.4], [86.3, 218.9]] },
  { kind: 'path', line: [[334.5, 108.4], [327.8, 133.7]] },
  { kind: 'path', line: [[324.2, 148], [321.4, 156.8], [315.8, 156.5]] },
  { kind: 'path', line: [[293, 156.9], [289.9, 160.1], [285.4, 179.5]] },
  { kind: 'path', line: [[172.8, 76], [183.7, 81.2], [214, 96.9]] },
  { kind: 'path', line: [[115.6, 148.8], [189.2, 54.6]] },
  { kind: 'path', line: [[183.7, 81.2], [189.2, 54.6], [195, 32.9]] },
  { kind: 'path', line: [[337, 89.7], [338.9, 93.3], [334.5, 108.4]] },
  { kind: 'path', line: [[327.8, 133.7], [324.2, 148]] },
  { kind: 'path', line: [[86.3, 218.9], [79.6, 202.8], [92.1, 180.1], [103.2, 166.4]] },
  { kind: 'path', line: [[170.3, 144.3], [183.7, 81.2]] },
  { kind: 'path', line: [[70.3, 267.8], [72.4, 266.6], [80.5, 267.7]] },
  { kind: 'path', line: [[101.8, 232.5], [105.2, 238.8], [111.3, 243.4]] },
  { kind: 'path', line: [[112.4, 225.5], [108.7, 215.9]] },
  { kind: 'path', line: [[108.7, 215.9], [109.4, 207.7]] },
  {
    kind: 'path',
    line: [
      [313.3, 180.8], [313.5, 182.4], [371.2, 176.7], [504.5, 234.1], [511, 221.5], [518, 224.9], [510.5, 240.9],
      [503.3, 251.8], [494.7, 247.8], [412, 218.9], [395.8, 213.7], [330.1, 205.7], [288.1, 204.5], [253.9, 205.8],
      [243.3, 217], [234.2, 218.9], [221.9, 211.2], [191.3, 219.9], [173.1, 227.5],
    ],
  },
  { kind: 'path', line: [[147.4, 238.3], [122.7, 248.6], [95.4, 263.8]] },
];

/** Flights of steps between the terraces, along their middle, bottom to top or top to bottom. */
export const STAIRS: Ring[] = [
  [[103.2, 166.4], [115.6, 148.8]],
  [[165, 179.5], [170.3, 144.3]],
  [[315.8, 156.5], [313.6, 156.5], [293, 156.9]],
  [[154.7, 223.1], [156.2, 227.1]],
  [[192.8, 210.6], [194.1, 214.5]],
  [[113.5, 247.7], [111.3, 243.4]],
  [[70.7, 240.8], [67, 234.5]],
];

/** Paved squares: the Federation Bells plaza, the strip along the top of the upper terrace, ArtPlay's forecourt. */
export const PLAZAS: Ring[] = [
  [
    [317.8, 140.1], [307.6, 135.3], [295, 126.1], [331.2, 104], [334.5, 108.4], [337.4, 112.2], [333.6, 127.9],
    [332.5, 131.1], [331.3, 134.6], [327.8, 133.7], [319.8, 131.6], [318, 139], [317.8, 140.1],
  ],
  [
    [190.7, 57.4], [254.8, 61.1], [255, 58.6], [275.9, 59.8], [275.6, 65.3], [190.1, 60.3], [190.7, 57.4],
  ],
  [
    [68.3, 245.6], [70.7, 240.8], [76.6, 228.9], [75.8, 220.7], [84.2, 213.8], [88.3, 210.6], [90.9, 216.3],
    [104.4, 210.1], [109.1, 210.2], [116.3, 210.4], [126.9, 213.1], [111.7, 223.1], [76, 246.8], [70.9, 246],
    [68.3, 245.6],
  ],
];

/**
 * The footbridges, down their middle, from the park out. William Barak Bridge comes down into the Artist Gate from
 * the MCG over the railway; Tanderrum Bridge runs from the lower terrace along the foot of the main lawn and out over
 * Batman Avenue to Melbourne Park. Only 4 m wide, so it jams fast.
 */
export const BRIDGES: { name: string; line: Ring; width: number }[] = [
  {
    name: 'William Barak Bridge',
    width: 5,
    line: [
      [342.3, 85.5], [444.7, 8.4], [455.1, 0.4], [477.5, -17.5], [478.9, -18.4], [742.1, -123.2],
    ],
  },
  {
    name: 'Tanderrum Bridge',
    width: 4,
    line: [
      [312.7, 176.1], [381.8, 168.5], [443.3, 151.4], [472.6, 159.9], [481.7, 159.8], [598.4, 148.9], [720, 137.5],
    ],
  },
];

/** Birrarung Marr Landing: the floating pier off the lower terrace, and the gangway down to it. Outside the fence. */
export const LANDING: { pier: Ring; gangway: Ring } = {
  pier: [[212.9, 230.8], [236.7, 227.7], [237.1, 231.2], [213.3, 234.3]],
  gangway: [[221.5, 224], [222.3, 229.4]],
};

/** The Federation Bells: 39 bells on poles, in rows on the plaza at the west end of the main lawn. */
export const FEDERATION_BELLS: [number, number][] = [
  [320.5, 133.6], [323.2, 134.3], [325.8, 135], [320, 135.7], [322.6, 136.4], [325.3, 137.1], [319.5, 137.8],
  [322.1, 138.5], [324.8, 139.2], [319, 139.9], [321.6, 140.6], [324.3, 141.3], [318.4, 142], [321.1, 142.7],
  [323.7, 143.4], [317.9, 144.1], [320.6, 144.8], [323.2, 145.5], [317.4, 146.2], [320, 146.9], [322.7, 147.6],
  [316.9, 148.3], [319.5, 149], [322.2, 149.7], [316.4, 150.4], [319, 151.1], [321.6, 151.8], [315.8, 152.5],
  [318.5, 153.2], [321.1, 153.9], [315.3, 154.6], [318, 155.3], [320.6, 156], [314.8, 156.7], [317.4, 157.4],
  [320.1, 158.1], [314.3, 158.8], [316.9, 159.5], [319.6, 160.2],
];

/**
 * Trees inside the fence: x, y, canopy radius. Mapped ones from OpenStreetMap, plus the elms of the mapped woods and
 * tree rows (the Grove, the bank round the main lawn, the rows along the trail), kept clear of what's built.
 */
export const TREES: [number, number, number][] = [
  [281.8, 202.9, 4.7], [348.7, 203, 5], [304.4, 202.1, 4.4], [325, 202.4, 5.2], [200.3, 213, 4.8],
  [162.9, 221.8, 4.6], [261.5, 202.3, 4.9], [377.1, 206.7, 4.6], [118.9, 208.6, 4.3],
  [245.8, 195.8, 5.1], [296.5, 162.6, 4.9], [306.3, 191.1, 4.1], [323.4, 192.1, 3.8], [343.1, 192.6, 5.1],
  [405.4, 212.9, 4.2], [419.7, 217.2, 4.8], [420.4, 206.9, 3.9], [401.7, 202.6, 3.9], [382.4, 198.1, 4.4],
  [407.8, 180.3, 4.5], [439.3, 211.6, 4.1], [434.5, 222, 3.9],
  [458.1, 219.8, 4.8], [452.6, 228.1, 3.6], [465.7, 234, 4.4], [476.8, 239.4, 4.3], [493.1, 245, 4.5],
  [100.6, 229, 3.6], [88.8, 229, 4.9], [81.8, 240.5, 4], [483.1, 173.3, 5.4], [460.8, 179, 5.4], [512, 211.7, 5],
  [523, 195.1, 4.9], [512.4, 197.1, 4.9], [535.8, 216.4, 4.8], [460.1, 194.3, 5.6], [532.5, 206.5, 5.8],
  [521.2, 166.3, 5.5], [498.6, 174.7, 4.6], [538.6, 229.3, 4.8], [493.4, 189.7, 5.8], [475.1, 188.8, 5],
  [556.4, 229.3, 5.5], [551.8, 239.1, 5.9], [472.3, 176.9, 4.7], [540.9, 199.1, 5.4], [552.8, 218.4, 4.7],
  [486.1, 204.6, 4.6], [512.5, 181.9, 5.1], [503, 203.2, 5.2], [449, 196, 4.7], [504.6, 188.1, 4.7],
  [529, 225.3, 4.6], [524.5, 179.6, 4.4], [522.1, 215.8, 5.5], [482.6, 194.8, 4.4], [511.7, 171.4, 5.1],
  [534, 192, 5.2], [520.5, 206.1, 4.9], [451.3, 185.9, 5.4], [483.1, 183, 5.7], [497.9, 211.5, 4.8], [533, 175, 5],
  [519.1, 224.9, 4.5], [332.1, 144.7, 5.5], [374.4, 154.9, 4.8], [473, 146.8, 5], [413, 77.1, 5.1],
  [431.6, 79.2, 4.5], [414.8, 149.5, 6], [366.6, 160.1, 4.6], [388.9, 148.3, 5.4], [385.2, 67.4, 5.4],
  [440.7, 83.7, 5.6], [450.3, 134.3, 5.8], [319.3, 168, 4.4], [502.2, 147.3, 5], [341, 148.3, 4.4],
  [455.3, 144.5, 5.9], [394.1, 64.9, 5.6], [461.3, 132.3, 4.4], [480.6, 140, 4.6], [308.5, 166.7, 4.9],
  [331.2, 165.7, 5.6], [500.5, 135.5, 5.6], [489.3, 142.6, 4.8], [468.4, 102, 4.8], [398.5, 147.8, 5.7],
  [392.3, 156.8, 4.7], [377.3, 72.6, 5.8], [421.7, 79.9, 5.1], [466.1, 140.3, 5.5], [406.5, 153.2, 5.5],
  [404, 71.1, 4.6], [327.4, 155.9, 4.5], [365.3, 150.6, 4.5], [304.7, 158.6, 5.7], [278.6, 130.8, 4.5],
  [286.3, 140.6, 4.8], [295, 150.4, 4.8], [304.1, 149.3, 5.5], [270, 128, 5.7], [297.7, 139.1, 4.7],
  [313.8, 152, 4.8], [277.6, 141.1, 5], [270.2, 136.7, 5.8], [262.5, 131.3, 5.7], [338.1, 69.3, 4], [330.1, 74.7, 4],
  [322.1, 80.1, 4], [314.1, 85.5, 4], [306, 90.8, 4], [274, 112.4, 4], [266, 117.8, 4], [103.7, 178, 4],
  [109.1, 170.8, 4], [114.4, 163.5, 4], [119.8, 156.3, 4], [125.2, 149.1, 4], [130.6, 141.8, 4], [135.9, 134.6, 4],
  [141.3, 127.4, 4], [146.7, 120.2, 4], [152, 112.9, 4], [157.4, 105.7, 4], [408.6, 173.6, 4], [417.8, 172.5, 4],
  [426.9, 171.4, 4], [436.1, 170.3, 4], [445.3, 169.2, 4], [454.5, 168.1, 4], [463.6, 167, 4],
];

/** Trees outside the fence, across the river in Alexandra Gardens and along Batman Avenue: drawn faded. */
export const CONTEXT_TREES: [number, number, number][] = [
  [485.8, 52.1, 4.6], [166.2, 343.7, 4.6], [26.4, 262.9, 5.1], [20.8, 288.3, 4], [12.5, 307.2, 4.7],
  [201.2, 326.2, 3.6], [145.6, 356.7, 5], [588, 281.3, 4.7], [-10, 281.7, 4.1], [229.7, 356.8, 4.3],
  [218.8, 349.7, 4.3], [229, 346, 3.8], [240.3, 340.7, 3.7], [226.4, 335.9, 4.4], [244.2, 348.3, 4.1],
  [253.5, 344.6, 3.8], [264.1, 339.1, 5], [259.1, 331.4, 5], [394, 357, 4.3], [459.2, 358.7, 5], [136.3, 346.1, 3.8],
  [157.7, 332.3, 4.1], [178.2, 322.3, 4.3], [101.7, 88.9, 4.3], [103.3, 87.7, 3.7], [104.8, 86.7, 4.6],
  [105.6, 84.9, 3.8], [106.6, 80.5, 4.9], [110.4, 76, 4.9], [115, 72.3, 5], [119.8, 68.8, 4.5], [123.4, 66.1, 3.7],
  [128.9, 61.8, 4.3], [135, 58.3, 4.8], [152.3, 48.9, 4.7], [147.3, 51.5, 5], [158.8, 45.8, 4.1], [164.1, 43.1, 4.5],
  [169.3, 40.6, 4.3], [172, 39.8, 5.2], [175.1, 37.6, 5], [401.9, 19.2, 4.5], [405.4, 12.8, 4.1], [387.3, 15.2, 4.3],
  [282.6, 1.3, 4.9], [288.2, -9.3, 3.6], [301, -10, 4.7], [306.6, 0.8, 3.6], [310.3, -10.5, 4], [315.3, 3.6, 3.7],
  [476.1, 46.6, 4.2], [469.3, 41.7, 4.1], [466.3, 34.3, 4.7], [463.1, 38.8, 4], [477.7, 20.4, 5], [295.6, 2.9, 3.9],
  [341.6, -16.3, 4.8], [332.3, -10.4, 3.6], [353.2, -14.4, 4.3], [344.5, -7.8, 3.9], [28.6, 235.4, 5],
  [249, 335.8, 5.1], [269.4, 324.2, 4.5], [274.8, 331.9, 4.1], [292.3, 295, 4], [278.6, 295.9, 4.8],
  [254.1, 299.4, 4.9], [241.9, 301.7, 5.2], [339.3, 295.8, 3.6], [351.3, 296.7, 5], [389, 305, 3.8],
  [399.6, 308.1, 3.8], [412, 311.7, 4.6], [437.8, 321.9, 4.4], [447.5, 326.1, 4.3], [459.1, 332.3, 3.6],
  [470.4, 338.2, 4.9], [482.6, 344.8, 3.9], [492.7, 350.5, 5.2], [500.3, 354.7, 3.8], [419, 314.2, 5.2],
  [308.6, 343.6, 3.8], [326.8, 309.7, 5], [315.1, 309.5, 4.2], [459.4, 348.5, 4.9], [451.3, 344.8, 5.1],
  [441.2, 339.1, 4.3], [421.7, 331.5, 4.8], [408.8, 326.3, 5], [396.1, 322.1, 5.1], [385.8, 318.5, 4.1],
  [374.2, 315.6, 5], [362.5, 314.6, 4], [302.2, 294.6, 5], [315.2, 295.9, 4.5], [253.1, 321.7, 3.9],
  [264, 319.8, 3.9], [291.3, 309.8, 4.7], [279, 310.9, 4.8], [267.4, 311.8, 4.8], [256, 313, 4.9],
  [245.9, 317.4, 4.2], [201.1, 322.3, 4.4], [181.8, 329.8, 4.5], [162.4, 341.4, 3.7], [141, 353.8, 4.8],
  [265.1, 297.8, 4.8], [227.9, 305.7, 3.7], [215.4, 309.1, 4.1], [205.7, 312.3, 5], [198.4, 315.3, 3.8],
  [64.7, 264.4, 4.4], [71.2, 274, 3.8], [61.8, 279.2, 3.9], [56.1, 273.5, 5.1], [43.2, 285.5, 4.6], [36, 279.4, 4.5],
  [378, 302.6, 4.5], [576, 219.2, 4.9], [583.5, 232.8, 3.7], [588.4, 241.8, 3.9], [594.6, 218.4, 3.6],
  [587.8, 204.9, 3.7], [563.6, 196.6, 4], [559.2, 187.2, 4], [553.2, 176.4, 4.6], [548.3, 166, 4.3],
  [567.3, 164.1, 4.4], [574.3, 175.5, 5.2], [538.9, 183.8, 5], [549.8, 206.3, 5.5], [415.2, 65, 4.9],
  [492.6, 117.7, 4.9], [449.5, 80.7, 5.9], [480.6, 106.5, 5.2], [513, 143.1, 5.6], [425, 66.3, 5.3],
  [404.5, 61.9, 5], [438.2, 72.7, 4.7],
];

/** Places off the site, named faintly so the map has its bearings: what's past each edge. */
export const PLACE_NAMES: { name: string; at: [number, number] }[] = [
  { name: 'Fed Square', at: [-112, 252] },
  { name: 'Flinders St Station', at: [-282, 441] },
  { name: 'Alexandra Gardens', at: [300, 335] },
  { name: 'Melbourne Park', at: [680, 170] },
  { name: 'MCG', at: [800, -150] },
];

/** A w × h rectangle centred on (cx, cy), turned `deg` clockwise on the plan. */
function turned(cx: number, cy: number, w: number, h: number, deg: number): Ring {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return ([[-w, -h], [w, -h], [w, h], [-w, h]] as const).map(([x, y]) => [+(cx + (x * c - y * s) / 2).toFixed(2), +(cy + (x * s + y * c) / 2).toFixed(2)]);
}

/** The ways through the fence for festival-goers: the middle of each opening, and which way is in. */
export const GATEWAYS: { at: [number, number]; in: [number, number] }[] = [
  { at: [63.1, 254.5], in: [0.84, -0.54] }, // the Main Entrance, off Princes Walk
  { at: [258, 36.4], in: [0, 1] }, // the North Gate, off Batman Avenue
];

/** Rounds off a line's corners (Chaikin, 3 passes); the ends stay put. Barricades are drawn and walled along this. */
export function smooth(line: Ring, closed = false, passes = 3): Ring {
  let pts = line;
  for (let k = 0; k < passes; k++) {
    const out: Ring = closed ? [] : [pts[0]];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    if (!closed) out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

/**
 * Barricades: both bridges are closed to festival-goers, and everything round them is the crew's. Control points; each
 * line is `smooth`ed. Together with the fence they close off one restricted area (see restrictedArea in venue.ts), in
 * three runs that wrap the back of each stage rather than stopping at its front:
 *  - From the fence on Batman Avenue, round the foot of William Barak Bridge (the Artist Gate) and east along the top
 *    of the main lawn, under the elms, then round the Lawn Stage: along its top, down its back and back along its
 *    bottom to the stage's front corner.
 *  - From the crew gate beside that corner (the way into Backstage, shut but for the crew: the one gap in the
 *    barricades, so it's never a short cut for anyone else) west along the north side of Tanderrum Bridge's ramp to
 *    the River Stage, which stands across the ramp's foot below the Federation Bells; down its back, and east along the
 *    ramp's south side, then along the top of the Grove Stage's marquee to its back corner.
 *  - Down the marquee's back, then round the elms to the fence where Tanderrum Bridge leaves the park.
 * The River and Grove stages stand in front of the barricade, backed onto it; the Lawn Stage is inside it. Inside: the
 * Artist Gate compound, the crew lane, the Backstage the Lawn and Grove stages share, the River Backstage (joined to it
 * along the ramp), and both decks. Artists and crew come in over William Barak Bridge from the Artist Village;
 * Tanderrum Bridge is emergency only. Where a run follows a stage it sits about 1 m off the footprint, with each corner
 * cut so the rounding hugs it.
 */
export const BARRICADES: { name: string; line: Ring; closed?: boolean }[] = [
  {
    name: 'the Artist Gate compound',
    line: [
      [310, 39.7], [313, 50], [319, 63], [326, 78], [332, 93], [342, 101], [354, 100.5], [368, 92], [384, 81.5], [400, 78.5],
      [414, 83], [420, 93], [421.5, 99], [423.5, 103],
      // Round the Lawn Stage (x 422–436, y 104–140): top, back, bottom
      [428, 103], [435, 103], [437, 105], [437, 120], [437, 139], [435, 141], [428, 141], [422.8, 141],
    ],
  },
  {
    name: 'Tanderrum Bridge',
    line: [
      [420.5, 147], [404, 156], [382, 163], [350, 167], [322, 169.5], [309, 171],
      // Round the back of the River Stage (x 291–301, y 172–194): in along its top, down its back, out along its bottom
      [303.5, 171.2], [301.8, 172.8], [301.8, 183], [301.8, 193.2], [303.5, 194.8],
      [310, 192], [322, 188.5], [345, 184.5], [375, 180.5], [400, 177.5], [416, 176.4], [424, 176.2],
      // Along the top of the Grove Stage's marquee (x 417–443, y 177–194) to its back corner
      [432, 176.2], [441, 176.2], [443.8, 178.2], [443.8, 181],
    ],
  },
  {
    name: 'Backstage',
    line: [
      [443.8, 181], [443.8, 191], [445.5, 196], [450, 199.2], [462, 200], [478, 195], [490, 185], [500, 174], [514, 168.5], [527, 164],
    ],
  },
];

/** Marquees in the Artist Gate compound, badged in the middle: the Green Room, by the fence east of the crew's stores. */
export const ARTIST_TENTS: { name: string; icon: 'backstage' | 'food'; box: Box }[] = [
  { name: 'Green Room', icon: 'backstage', box: { x: 343, y: 48, w: 11, h: 7.5 } },
];

/** The control sheds: the Lawn Stage's in its backstage under the elms, the River Stage's behind it at the ramp's foot. */
export const CONTROL_SHEDS: Ring[] = [
  [[470, 118], [479, 118], [479, 125], [470, 125]],
  [[303, 180], [311, 180], [311, 185], [303, 185]],
];

export const DECOR = {
  /** Medic points: on the edge of the Lawn Stage's crowd, in the Grove, beside the River Stage's crowd at the foot of the Federation Bells' steps, and inside the Main Entrance. */
  medics: [
    { x: 347, y: 150, w: 5, h: 5 },
    { x: 470, y: 204, w: 5, h: 5 },
    { x: 281, y: 164, w: 5, h: 4.5 },
    { x: 120, y: 228, w: 5, h: 4.5 },
  ] satisfies Box[],
  /** Sound desks, out in front of each stage. */
  foh: [
    { x: 369, y: 119, w: 6, h: 6 },
    { x: 263.5, y: 180.5, w: 5, h: 5 },
  ] satisfies Box[],
  bar: { x: 308, y: 103, w: 18, h: 13 } satisfies Box,
  /** Bag check just inside every gate: beside the Main Entrance, inside the North Gate, and at the Artist Gate. */
  security: [
    { x: 70, y: 239, w: 6, h: 5 },
    { x: 264, y: 41, w: 5, h: 4 },
    { x: 346, y: 91, w: 5, h: 4 },
  ] satisfies Box[],
  /** Queue lanes: three out along Princes Walk from the Main Entrance. */
  lanes: [
    [[59, 253.6], [48, 260.7]],
    [[60.6, 256.1], [49.7, 263.2]],
    [[62.2, 258.6], [51.3, 265.7]],
  ] satisfies Ring[],
  /** Crowd barriers from the Main Entrance's posts out along the walk, so the way in is through the lanes. */
  barriers: [
    [[60.1, 249.8], [48.3, 257.4]],
    [[66.1, 259.1], [54.3, 266.7]],
  ] satisfies Ring[],
  /** Shade sails out on the open ground (none yet: Food Alley eats under umbrellas, the Grove has its own, see GROVE). */
  sails: [] as Ring[],
  /** Seating on the grass south of the Bar: café sets under umbrellas, and benches along the edge of the plaza. (Food Alley's is laid out by foodCourt.) */
  seating: [
    { x: 302.5, y: 124, kind: 'cafe', deg: 0, umbrella: true },
    { x: 296, y: 116.5, kind: 'cafe', deg: 0, umbrella: true },
    { x: 303, y: 111, kind: 'cafe', deg: 0, umbrella: false },
    { x: 311, y: 123.5, kind: 'bench', deg: 0, umbrella: false },
    { x: 317.5, y: 123.5, kind: 'bench', deg: 0, umbrella: false },
    { x: 325, y: 122, kind: 'picnic', deg: 0, umbrella: true },
  ] satisfies Seat[],
  /** Dressing cabins: none on the site, the artists change in the Artist Village over the bridge. */
  cabins: [] as Ring[],
  /** Two vans in the Artist Gate compound, nosed in to the fence beside the Green Room. */
  vans: [turned(359.8, 52.8, 6, 2.4, 105), turned(363.3, 53.7, 6, 2.4, 105)] satisfies Ring[],
  /** Stock containers beside each control shed. */
  stores: [
    { x: 482, y: 122, w: 6, h: 2.4 },
    { x: 482, y: 125.6, w: 6, h: 2.4 },
    { x: 303, y: 173, w: 2.4, h: 6 },
    { x: 306.2, y: 173, w: 2.4, h: 6 },
  ] satisfies Box[],
  /** Artist trailers behind the Lawn Stage. */
  trailers: [
    { x: 452, y: 95, w: 7, h: 3 },
    { x: 452, y: 101, w: 7, h: 3 },
    { x: 455, y: 110, w: 5, h: 5 },
  ] satisfies Box[],
};

/** The Grove's furniture under and beside the elms: shade sails, picnic tables and umbrellas (see map-art's grove()). */
export const GROVE = {
  /**
   * Shade sails in the clearings, between the elms so no canopy pokes out from under one: by the medic tent, east of
   * it, and a pair on the open lawn by the riverside paths. Corners only: the edges are cut in, like a real sail's.
   */
  sails: [
    [[451.5, 205], [464, 204.5], [458.5, 212]],
    [[480, 210.5], [491.5, 213], [483.5, 219.5]],
    [[518, 235], [532, 234], [523, 246.5]],
    [[529.5, 238.5], [542, 237], [537.5, 249]],
  ] satisfies Ring[],
  /** Picnic tables, x, y and heading in degrees, squared to the riverside paths (23°): beside the sails, and a pair by the Grove Stage's marquee, west of the Backstage barricade. */
  tables: [
    [428.6, 197.6, 0], [432.8, 197.6, 0],
    [484.6, 220.6, 23], [488.6, 222.3, 23],
    [522.6, 249.3, 23], [527, 251.2, 23], [531.4, 253.1, 23], [535.8, 255, 23],
  ] satisfies [number, number, number][],
  /** Umbrellas over picnic tables on the grass at the Grove's south-east tip. */
  umbrellas: [[550.5, 250.5], [557.5, 253], [553.5, 258], [560.5, 260.5]] satisfies [number, number][],
};

/**
 * The Market: pop-up stalls either side of the gravel path on the lower terrace, from ArtPlay's forecourt along to the
 * stairs up to Water 1, where the River Stage used to be. Each stall is a 3 m gazebo turned square to the path, with
 * its counter on the path side and 1.8 m of grass in front of it to queue on, 1.2 m from the next. As rings from
 * turned(): the back two corners, then the front two, so the counter is the edge from the third corner to the fourth
 * (see map-art's amenities()). Routes walk round each one.
 */
export const MARKET = {
  /** Merch and makers' stalls: eight along the north side, backs to the trail, and four along the south, backs to the river. */
  stalls: [
    turned(138.2, 220.3, 3, 3, -23), turned(142, 218.6, 3, 3, -23), turned(145.9, 216.9, 3, 3, -23), turned(149.4, 215.2, 3, 3, -26),
    turned(153.2, 213.4, 3, 3, -26), turned(157, 211.5, 3, 3, -26), turned(160.7, 209.7, 3, 3, -26), turned(164.5, 207.8, 3, 3, -26),
    turned(134.8, 232.6, 3, 3, 157), turned(138.6, 230.9, 3, 3, 157), turned(142.5, 229.3, 3, 3, 157), turned(146.3, 227.6, 3, 3, 157),
  ] satisfies Ring[],
  /** The glitter and face-paint gazebo at the east end of the north row, with two stools at its counter. */
  glitter: turned(168.3, 206, 3, 3, -26),
  stools: [[168.5, 208.4], [170.1, 207.6]] satisfies [number, number][],
  /** At the west end, nearest the Main Entrance: a bank of hire lockers, and the phone-charging bar, a cabin with its counter on the path. */
  lockers: turned(128.9, 225.4, 4.5, 0.9, -23),
  charging: turned(133.5, 222.6, 3, 2.4, -23),
};

/**
 * Somewhere to lie down: the grass east of the Market, between the trail and the gravel path, out of the stages' crowds.
 * A row of hammocks on their stands, squared to the trail, and a scatter of bean bags round the south side of a shade
 * sail, in its shade through the afternoon.
 */
export const LOUNGE = {
  /** Hammock stands, 3.6 m long and 1.1 m wide, side by side (turned rings, long side down the slope). */
  hammocks: [turned(174.6, 194.4, 3.6, 1.1, 57), turned(176.6, 193.1, 3.6, 1.1, 57), turned(178.6, 191.8, 3.6, 1.1, 57), turned(180.6, 190.5, 3.6, 1.1, 57)] satisfies Ring[],
  /** The sail. Corners only, cut in like the Grove's (see GROVE). */
  sails: [[[196, 183], [208, 176.5], [206.5, 188]]] satisfies Ring[],
  beanbags: [
    [198, 189.5], [200.8, 190.6], [203.4, 189.6], [205.8, 191.2], [201.6, 193], [208.6, 190.2], [210.2, 186.8], [210.8, 183],
  ] satisfies [number, number][],
};

/**
 * Things to do on the upper terrace's open grass, between Water 1's path and the elms by the trail, south of Food
 * Alley: the photo booths on a paved pad just out of the alley, a chair swing ride, giant lawn games, and the silent
 * disco's marquee. Routes walk round the booths, the ride's fence and the marquee; the games are just on the grass.
 */
export const ATTRACTIONS = {
  /** Two enclosed photo booths, 2.5 × 2 m, curtains on the south side, and a flower wall beside them to pose against. */
  booths: [{ x: 196.5, y: 117, w: 2.5, h: 2 }, { x: 200, y: 117, w: 2.5, h: 2 }] satisfies Box[],
  wall: { x: 204.5, y: 117.6, w: 4.5, h: 0.5 } satisfies Box,
  pad: { x: 194.5, y: 115, w: 15, h: 7.5 } satisfies Box,
  /**
   * A chair swing ride: a 6.8 m canopy on its mast, 16 chairs that swing out to 6 m, and a round fence at 8.5 m with
   * its way in on the south-west, towards the lawn.
   */
  swings: { at: [232, 128] as [number, number], canopy: 3.4, chairs: 6, fence: 8.5 },
  /** Giant chess, a 6 m board of 0.75 m squares; two cornhole pitches, boards 8.8 m apart; giant Jenga and Connect Four. */
  chess: { x: 207, y: 131, w: 6, h: 6 } satisfies Box,
  cornhole: [
    { x: 213.5, y: 141.2, w: 1.2, h: 0.6 }, { x: 222.3, y: 141.2, w: 1.2, h: 0.6 },
    { x: 213.5, y: 145.2, w: 1.2, h: 0.6 }, { x: 222.3, y: 145.2, w: 1.2, h: 0.6 },
  ] satisfies Box[],
  jenga: { x: 204.5, y: 145, w: 0.9, h: 0.9 } satisfies Box,
  connect: { x: 208.5, y: 146.5, w: 1.8, h: 0.35 } satisfies Box,
  /** The silent disco: a white marquee, 12 × 8 m, between Water 1's path and the games. */
  disco: { x: 186, y: 146, w: 12, h: 8 } satisfies Box,
};
