/**
 * Badges the map's symbol layers draw, by the name the style uses. 32 pt, rendered at 3x from
 * the SVGs in assets/images/map/svg.
 */
export const MAP_ICONS = {
  stage: require('@/assets/images/map/stage.png'),
  gate: require('@/assets/images/map/gate.png'),
  water: require('@/assets/images/map/water.png'),
  firstaid: require('@/assets/images/map/firstaid.png'),
  food: require('@/assets/images/map/food.png'),
  info: require('@/assets/images/map/info.png'),
  backstage: require('@/assets/images/map/backstage.png'),
  toilets: require('@/assets/images/map/toilets.png'),
  shade: require('@/assets/images/map/shade.png'),
  bar: require('@/assets/images/map/bar.png'),
  medic: require('@/assets/images/map/medic.png'),
} as const;

export type MapIconName = keyof typeof MAP_ICONS;

/**
 * The badges under the names the style asks for. Prefixed, because the base style's sprite has
 * its own `water`, `bar` and so on, and those would win.
 */
export const STYLE_ICONS = Object.fromEntries(Object.entries(MAP_ICONS).map(([name, src]) => [`site-${name}`, src])) as Record<string, number>;

/** Size of a badge in points; the PNGs are this times their pixel ratio. */
export const MAP_ICON_SIZE = 32;
