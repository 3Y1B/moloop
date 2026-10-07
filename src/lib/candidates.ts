import { languageName } from '@/lib/format';
import { isBusy } from '@/lib/lifecycle';
import { walkFrom } from '@/lib/presence';
import { formatMeters, routeBetween } from '@/lib/route';
import type { IncidentCategory, Position, ProposalCandidate, Task, Volunteer } from '@/lib/schema';

/**
 * Who should take a task, best first, with a short why ("free · 120 m · first aid cert").
 * Same team, then free, then the right skill, then nearest. Nearest is the walk from where their phone says they are
 * (`positions`, fresh at `now`), else from their zone. Skills are only certificates still in date (server/world.ts).
 * Used for the Assign and backup pickers, and as a P1/P2 proposal's first order, which stands if the picker can't be
 * asked. The picker itself reads `laneCandidates`.
 */

const SKILL_FOR: Partial<Record<IncidentCategory, string>> = {
  medical: 'first-aid-cert',
  heat: 'first-aid-cert',
  lost_child: 'wwcc',
  crowding: 'crowd-control',
  security: 'security-licence',
  vendor: 'food-safety',
};

export const SKILL_LABEL: Record<string, string> = {
  'first-aid-cert': 'first aid cert',
  wwcc: 'WWCC',
  'crowd-control': 'crowd control',
  'radio-trained': 'radio',
  rsa: 'RSA',
  'mental-health-first-aid': 'mental health first aid',
  'security-licence': 'security licence',
  'food-safety': 'food safety',
  multilingual: 'multilingual',
};

type Assessed = { v: Volunteer; candidate: ProposalCandidate; free: boolean; sameTeam: boolean; held: string[]; speaks: boolean };

/** The language someone at a task needs a volunteer to speak (intake's read), else the report's own if not English. */
export const speakerNeeded = (task: Task) =>
  task.reporter.speakerNeeded !== undefined ? task.reporter.speakerNeeded : task.reporter.language !== 'en' ? task.reporter.language : null;

/** The certificates a task wants by its category alone: one at most. */
export const certsFor = (category: IncidentCategory) => (SKILL_FOR[category] ? [SKILL_FOR[category]] : []);

/** One person against one task: free or busy, the walk, which of the wanted certificates they hold, the language it needs. */
function assess(task: Task, v: Volunteer, tasks: Task[], certs: string[], lang: string | null, positions: Record<string, Position> | undefined, now: number): Assessed {
  const route = routeBetween(walkFrom(positions, v.id, v.zoneSlug, now), task.zoneSlug);
  const distanceM = route ? Math.round(route.meters) : null;
  const free = !isBusy(tasks, v.id);
  const held = certs.filter((c) => v.skills.includes(c));
  const speaks = !!lang && v.languages.includes(lang);
  const why = [
    free ? 'free' : 'busy',
    distanceM == null ? null : distanceM === 0 ? 'here' : formatMeters(distanceM),
    ...held.map((c) => SKILL_LABEL[c] ?? c),
    speaks ? `speaks ${languageName(lang)}` : null,
  ].filter(Boolean);
  return { v, candidate: { volunteerId: v.id, rationale: why.join(' · '), distanceM }, free, sameTeam: v.teamSlug === task.teamSlug, held, speaks };
}

/** Volunteers on duty and not already on this task. */
export function eligible(task: Task, volunteers: Volunteer[], exclude: string[] = []) {
  const skip = new Set([...exclude, ...task.helperIds, ...(task.assigneeId ? [task.assigneeId] : [])]);
  return volunteers.filter((v) => v.role === 'volunteer' && v.duty === 'on_duty' && !skip.has(v.id));
}

export function rankCandidates(
  task: Task, volunteers: Volunteer[], tasks: Task[],
  { exclude = [], limit = 5, positions, now = Date.now() }: { exclude?: string[]; limit?: number; positions?: Record<string, Position>; now?: number } = {},
): ProposalCandidate[] {
  const lang = speakerNeeded(task);
  return eligible(task, volunteers, exclude)
    .map((v) => {
      const a = assess(task, v, tasks, certsFor(task.category), lang, positions, now);
      return { candidate: a.candidate, score: [a.sameTeam ? 0 : 1, a.free ? 0 : 1, a.held.length || a.speaks ? 0 : 1, a.candidate.distanceM ?? 9_999] };
    })
    .sort((a, b) => a.score.reduce((d, x, i) => d || x - b.score[i], 0))
    .slice(0, limit)
    .map((x) => x.candidate);
}

/**
 * The picker's shortlist for a P1/P2 (server/pick.ts): two lanes of `size`, taken in turn, nobody twice.
 *  - Most qualified: `qualified`, the model's order best first (picker.ts), or `rankCandidates`' when it couldn't be asked.
 *  - Nearest: the shortest walk, nothing else.
 * When it needs a language and neither lane has a speaker, the nearest one gets a seat of their own.
 * Free people only, unless nobody's free.
 */
export function laneCandidates(
  task: Task, volunteers: Volunteer[], tasks: Task[],
  { qualified, size = 6, positions, now = Date.now() }:
    { qualified: string[] | null; size?: number; positions?: Record<string, Position>; now?: number },
): ProposalCandidate[] {
  const all = eligible(task, volunteers).map((v) => assess(task, v, tasks, certsFor(task.category), speakerNeeded(task), positions, now));
  const pool = new Map((all.some((a) => a.free) ? all.filter((a) => a.free) : all).map((a) => [a.v.id, a]));
  const far = (a: Assessed) => a.candidate.distanceM ?? 9_999;

  const order = qualified ?? rankCandidates(task, volunteers, tasks, { limit: Infinity, positions, now }).map((c) => c.volunteerId);
  const best = order.flatMap((id) => pool.get(id) ?? []).slice(0, size);
  const nearest = [...pool.values()].sort((a, b) => far(a) - far(b));
  const seen = new Set<string>();
  const picked = Array.from({ length: size }, (_, i) => [best[i], nearest[i]]).flat()
    .filter((a) => a && !seen.has(a.v.id) && seen.add(a.v.id));
  const speaker = !picked.some((a) => a.speaks) && nearest.find((a) => a.speaks);
  return [...picked, ...(speaker ? [speaker] : [])].map((a) => a.candidate);
}

/**
 * Who goes, with a speaker among them: when a task needs a language and none of the first `people` in `order`
 * speaks it, the first who does goes too, as one more person while `most` allows, else in place of the last.
 */
export function withSpeaker(order: string[], people: number, speaks: (id: string) => boolean, most: number) {
  const going = order.slice(0, people);
  const speaker = !going.some(speaks) && order.find(speaks);
  if (!speaker) return { order, people };
  const rest = order.filter((id) => id !== speaker);
  return people < most
    ? { order: [...going, speaker, ...rest.slice(people)], people: people + 1 }
    : { order: [...going.slice(0, -1), speaker, ...rest.slice(people - 1)], people };
}
