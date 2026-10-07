import { GUEST_ANSWERS } from '@/lib/heuristics';
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

/** Everything the AI knows about the venue. If it isn't here, it says where the Info Tent is. */
export const venueFacts = (zs: Zone[]) =>
  [
    ...GUEST_ANSWERS.map((a) => `- ${a.answer}`),
    `Places: ${zs.map((z) => z.name).join(', ')}.`,
  ].join('\n');
