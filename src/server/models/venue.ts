import { sql } from '../world';

/** Zones the model may name, and the venue facts it may answer from. Zones change rarely: cached for a minute. */

export type Zone = { slug: string; name: string };

let cache: { at: number; zones: Zone[] } | undefined;

export async function zones(): Promise<Zone[]> {
  if (!cache || Date.now() - cache.at > 60_000) {
    cache = { at: Date.now(), zones: await sql()<Zone[]>`select slug, name from zones order by name` };
  }
  return cache.zones;
}

/** What the AI may answer from. */
const FACTS = [
  'Nearest toilets to the Oval Stage are Toilets East, by the tennis courts. There are more at Toilets West, next to the Grove.',
  'Free water refills at Water 1 (in the Grove, by the first aid tent) and Water 2 (east end, near the Oval Stage).',
  'Lost property is at Info, the tent just inside the Main Entrance, open until 11pm. Bring ID to collect.',
  'Next up: Oval Stage at 5:30pm, Track Stage at 6:00pm. Full times are on the board at Info.',
  'Info is the tent just inside the Main Entrance, on the left. Food Alley runs between the oval and the track.',
  'If someone feels faint or unwell: sit them down in the shade, give them water, and ask any volunteer in a hi-vis vest, or go to First Aid on the south walk. If they collapse or stop responding, report it straight away.',
];

/** Everything the AI knows about the venue. If it isn't here, it says where Info is. */
export const venueFacts = (zs: Zone[]) =>
  [
    ...FACTS.map((f) => `- ${f}`),
    `Places: ${zs.map((z) => z.name).join(', ')}.`,
  ].join('\n');
