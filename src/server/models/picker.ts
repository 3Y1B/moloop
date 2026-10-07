import { SKILL_LABEL, speakerNeeded, withSpeaker } from '@/lib/candidates';
import { clockTime, languageName } from '@/lib/format';
import type { Priority, ProposalCandidate, Task, Volunteer } from '@/lib/schema';
import { choice, decide, decideModelId } from '.';
import type { Judged, Run } from './interpreter';

/**
 * Who should go to a P1/P2 task, and how many of them. Three steps, all on OpenAI's decisions (the Spark turns away
 * a burst this size):
 *
 *  1. `rankQualified`: one choice over every free person's profile (team, certificates, languages, background; no
 *     distance), so it judges fit, not position. Asked three times in shuffled order and averaged, for a steady top 6.
 *  2. That order, and the language intake said someone there needs (Reporter.speakerNeeded), feed the two lanes in
 *     lib/candidates.ts (most qualified, nearest) that make the shortlist.
 *  3. `pickCrew`: one typed call over the shortlist. The model reads each person as a whole (team, certificates,
 *     languages, free or busy, how far, and their description) and gives every one a probability, which ranks them.
 *     Asked about each person alone, it said yes to anyone good enough (scripts/bench-pick.ts); side by side, it can
 *     tell the best. If the task needs a language and nobody it sends speaks it, a speaker goes too (withSpeaker).
 *
 * Fails to null: the rules' order stands and one person goes. A lead or Mo approves either way.
 */

export type Shortlisted = { candidate: ProposalCandidate; volunteer: Volunteer };
export type Picked = { order: string[]; people: number };

/** The most people a priority can ask for at once. */
export const MOST_PEOPLE: Record<Priority, number> = { P1: 3, P2: 2, P3: 1 };

const PEOPLE = {
  one: 'One volunteer: a single person can do everything this needs',
  two: 'Two volunteers: one helps while the other fetches help, keeps people back or stays with someone',
  three: 'Three volunteers: a life-threatening, violent or crowded scene where several jobs need doing at once',
};
const COUNT = { one: 1, two: 2, three: 3 } as Record<string, number>;

const URGENCY: Record<Priority, string> = {
  P1: 'Life-threatening, needs someone now',
  P2: 'Urgent, needs someone within minutes',
  P3: 'Routine',
};

/** Who they are, without where: team, certificates (only those in date reach a Volunteer), languages, bio. */
const person = (v: Volunteer, teams: Record<string, { name: string }>) => {
  const team = v.teamSlug ? `${teams[v.teamSlug]?.name ?? v.teamSlug} team` : 'no team';
  const holds = v.skills.filter((s) => s !== 'multilingual').map((s) => SKILL_LABEL[s] ?? s);
  return {
    head: [
      `${v.name}, ${team}`,
      holds.length ? `Holds: ${holds.join(', ')}` : 'No certificates',
      v.languages.length ? `Speaks ${v.languages.map(languageName).join(' and ')}` : null,
    ],
    bio: v.bio?.replace(/\.$/, ''),
  };
};
const sentences = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join('. ') + '.';

/** "Priya Shah, First Aid team. Holds: first aid cert, radio. Speaks English and Hindi. ED nurse…" */
export function profile(v: Volunteer, teams: Record<string, { name: string }>) {
  const { head, bio } = person(v, teams);
  return sentences([...head, bio]);
}

/** "Priya Shah, First Aid team. Holds: first aid cert, radio. Speaks English and Hindi. Now: free · 120 m. ED nurse…" */
export function describe({ candidate, volunteer: v }: Shortlisted, teams: Record<string, { name: string }>) {
  const { head, bio } = person(v, teams);
  return sentences([...head, `Now: ${candidate.rationale}${v.shiftEndsAt ? `, on shift till ${clockTime(v.shiftEndsAt)}` : ''}`, bio]);
}

const CLOUD = { cloud: true };

const run = (over: Partial<Run>): Run => ({
  route: 'ai_resolved', reason: null, confidence: null, team: null, priority: null, rewrite: null,
  models: { picker: decideModelId(CLOUD) }, latencyMs: 0, error: null, ...over,
});

/** How many times the qualified question is asked, each in a fresh order: one call's top 6 barely held from one to the next. */
const QUALIFIED_ROUNDS = 3;

const shuffled = <T>(xs: T[]) => xs.map((x) => ({ x, k: Math.random() })).sort((a, b) => a.k - b.k).map((y) => y.x);

/**
 * Every free person, most qualified first: one choice over their profiles, no distance (the nearest lane covers that),
 * asked QUALIFIED_ROUNDS times at once in shuffled order, probabilities averaged over the rounds that answered. Asked
 * once, the top 6 kept 0–2 of the same people across three shuffles (bun scripts/bench-pick.ts stability). The list's
 * order breaks ties. Null if every round failed.
 */
export async function rankQualified(task: Task, people: Volunteer[], teams: Record<string, { name: string }>): Promise<Judged<string[] | null>> {
  const t0 = Date.now();
  const log = (over: Partial<Run>) => run({ latencyMs: Date.now() - t0, ...over });
  if (!people.length) return { value: null, run: log({ route: 'escalated_to_triage', reason: 'nobody free to rank' }) };

  const state = { task: `${task.title}. ${task.summary}`, reporter_said: task.reporter.quote };
  const o = { urgent: task.priority === 'P1', ...CLOUD };
  const round = async (order: Volunteer[]) => {
    const labels = Object.fromEntries(order.map((v, n) => [`person_${n + 1}`, profile(v, teams)]));
    const d = await decide(state, {
      best: choice('Who is best qualified for this task: the certificates, team, languages and background it needs? Ignore where they are.', labels),
    }, o);
    const p = d.best.probabilities as Record<string, number>;
    return { p: new Map(order.map((v, n) => [v.id, p[`person_${n + 1}`] ?? 0])), confidence: d.best.confidence };
  };
  const rounds = await Promise.allSettled(Array.from({ length: QUALIFIED_ROUNDS }, () => round(shuffled(people))));
  const answered = rounds.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!answered.length) {
    const why = rounds.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason as Error | undefined;
    return { value: null, run: log({ route: 'escalated_to_triage', error: String(why?.message ?? why) }) };
  }
  const order = people
    .map((v, n) => ({ v, p: answered.reduce((a, r) => a + (r.p.get(v.id) ?? 0), 0) / answered.length, n }))
    .sort((a, b) => b.p - a.p || a.n - b.n);
  const confidence = answered.reduce((a, r) => a + (r.confidence ?? 0), 0) / answered.length;
  return {
    value: order.map((x) => x.v.id),
    run: log({ confidence, reason: `${order[0].v.name} most qualified of ${people.length}, ${answered.length} of ${QUALIFIED_ROUNDS} rounds` }),
  };
}

export async function pickCrew(task: Task, shortlist: Shortlisted[], teams: Record<string, { name: string }>): Promise<Judged<Picked | null>> {
  const t0 = Date.now();
  const log = (over: Partial<Run>) => run({ latencyMs: Date.now() - t0, ...over });
  if (!shortlist.length) return { value: null, run: log({ route: 'escalated_to_triage', reason: 'nobody on duty to pick from' }) };

  const labels = Object.fromEntries(shortlist.map((s, n) => [`person_${n + 1}`, describe(s, teams)]));
  const most = MOST_PEOPLE[task.priority];
  const lang = speakerNeeded(task);
  const about = { task: `${task.title}. ${task.summary}`, urgency: URGENCY[task.priority] };
  const o = { urgent: task.priority === 'P1', ...CLOUD };
  try {
    // Two calls, side by side: asked beside a list of people, the model reads "how many" as "is the best one enough"
    // and says one. Asked about the task alone, it sizes the task. If only that one fails, one person goes.
    const [d, size] = await Promise.all([
      decide({
        ...about,
        ...(lang ? { needs_someone_who_speaks: languageName(lang) } : {}),
        volunteers: labels,
      }, { best: choice('Who is best suited to go to this task?', labels) }, o),
      most > 1
        ? decide(about, { people: choice('How many volunteers should be sent to this task?', Object.fromEntries(Object.entries(PEOPLE).slice(0, most))) }, o)
          .catch(() => null)
        : null,
    ]);

    // Best first; the shortlist's order breaks ties, so a model with no opinion changes nothing.
    const p = d.best.probabilities as Record<string, number>;
    const ranked = shortlist
      .map((s, n) => ({ id: s.candidate.volunteerId, p: p[`person_${n + 1}`] ?? 0, n }))
      .sort((a, b) => b.p - a.p || a.n - b.n)
      .map((x) => x.id);
    const sized = size ? Math.min(most, COUNT[size.people.choice] ?? 1) : 1;
    const speaks = (id: string) => !!lang && !!shortlist.find((s) => s.candidate.volunteerId === id)?.volunteer.languages.includes(lang);
    const { order, people } = withSpeaker(ranked, sized, speaks, most);
    const top = shortlist.find((s) => s.candidate.volunteerId === order[0])!.volunteer;
    const added = order.slice(0, people).join() !== ranked.slice(0, sized).join();
    return {
      value: { order, people },
      run: log({
        confidence: d.best.confidence,
        reason: `${top.name} first of ${shortlist.length}; ${people} needed${added ? `, with a ${languageName(lang!)} speaker` : ''}`,
      }),
    };
  } catch (e) {
    return { value: null, run: log({ route: 'escalated_to_triage', error: String((e as Error).message) }) };
  }
}
