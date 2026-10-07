/** Mo's tabs, by route name: `index` is Needs action. */
export type MoTab = 'index' | 'tasks' | 'crew' | 'map';

/** From this width the tabs become a left column and the map is always on screen beside them. */
const SPLIT_AT = 1000;

/** Phone: four tabs, the map one of them. Laptop: the map leaves the tabs and stays on the right. */
export function moLayout(width: number): { split: boolean; tabs: MoTab[] } {
  const split = width >= SPLIT_AT;
  return { split, tabs: split ? ['index', 'tasks', 'crew'] : ['index', 'tasks', 'crew', 'map'] };
}
