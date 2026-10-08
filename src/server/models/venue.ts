import { sql } from '../world';

/** Zones the model may name, and the venue facts it may answer from. Zones change rarely: cached for a minute. */

export type Zone = { slug: string; name: string; capacity: number | null };

let cache: { at: number; zones: Zone[] } | undefined;

export async function zones(): Promise<Zone[]> {
  if (!cache || Date.now() - cache.at > 60_000) {
    cache = { at: Date.now(), zones: await sql()<Zone[]>`select slug, name, capacity from zones order by name` };
  }
  return cache.zones;
}

/** What the AI may answer from. */
const FACTS = [
  'The park sits on the Yarra (the Birrarung) in three terraces: upper by Flinders St, the middle lawn by Batman Ave, and a lower gravel strip on the river.',
  'There are three stages. Lawn Stage is on the middle terrace, facing the arena lawn. River Stage is on the lower terrace below the Federation Bells, at the foot of Tanderrum Bridge, facing west along the river. Grove Stage is a small covered stage for smaller acts, in The Grove.',
  'The Grove is under the elms in the south-east corner, by the river: shade sails, seating, and Water 3.',
  'Main Entrance is at the Fed Square end, on Princes Walk (from Flinders St Station). North Gate is on Batman Ave, at the top of the park (from the MCG and Richmond).',
  'The bridges are closed to the public. William Barak Bridge is for artists and crew only, through the Artist Gate. Tanderrum Bridge is barricaded, for emergencies only.',
  'Nearest toilets to the Lawn Stage are Toilets East, on the riverside path near The Grove. There are more at Toilets West, next to ArtPlay.',
  'Free water refills at Water 1 (upper terrace, west end), Water 2 (middle terrace, near the Lawn Stage) and Water 3 (in The Grove).',
  'Food Alley is the food court on the upper terrace: rows of food trucks. Lost property is at Info, on the upper terrace by Food Alley, open until 11pm. Bring ID to collect. Lost children are looked after at ArtPlay.',
  'The Kids Playground is beside ArtPlay at the Fed Square end, just inside the Main Entrance: swings, a climbing net, a cubby with a slide, and a sandpit, with benches for parents. A child lost near it is taken next door to ArtPlay.',
  'Next up: Lawn Stage at 5:30pm, River Stage at 6:00pm, Grove Stage at 6:30pm. Full times are on the board at Info. The Bar is by the Federation Bells.',
  'In a storm, shelter inside ArtPlay (west, by the Main Entrance) or under the Grove Stage marquee (east, in The Grove). Keep back from the river edge, the bridge barricades and the Landing pier.',
  'If someone feels faint or unwell: sit them down in the shade, give them water, and ask any volunteer in a hi-vis vest, or go to First Aid on the middle terrace, near the Lawn Stage. If they collapse or stop responding, report it straight away.',
];

/** Everything the AI knows about the venue. If it isn't here, it says where Info is. */
export const venueFacts = (zs: Zone[]) =>
  [
    ...FACTS.map((f) => `- ${f}`),
    `Places: ${zs.map((z) => z.name).join(', ')}.`,
  ].join('\n');
