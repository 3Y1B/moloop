import { z } from 'zod';

import type { DetailRead, Triage, Understood } from '@/lib/ai';
import {
  heuristicDetail, heuristicPerson, heuristicTriage, heuristicUnderstanding, soundsCritical, soundsUrgent, TEAM_CATEGORY,
} from '@/lib/heuristics';
import { activeTaskOf, interpretHeuristic } from '@/lib/commands';
import { IncidentCategory, ReplyKind, TEAM_SLUGS, type Priority, type Task } from '@/lib/schema';
import type { Interpretation } from '@/data/repo';
import { choice, chatModelId, decide, decideModelId, generate, noul, type CallOptions } from './spark';
import { venueFacts, zones, type Zone } from './venue';

/**
 * Reads what people say and decides what to do with it: answer a routine question, pick a team and priority,
 * tell if added detail is worse, tell a reply from a new report. One interface, so Spark and Luna or plain
 * keywords can answer.
 * None of these throw on a model failure: they fail closed to a person (priority at least P2, never an AI answer)
 * and say so in `run.error`, which lands in triage_runs.
 */

/** What one decision cost and what it said: a triage_runs row. */
export type Run = {
  route: 'ai_resolved' | 'escalated_to_triage';
  reason: string | null;
  confidence: number | null;
  team: unknown;
  priority: unknown;
  rewrite: unknown;
  models: Record<string, string>;
  latencyMs: number;
  error: string | null;
};

export type Judged<T> = { value: T; run: Run };

type Heard = { text: string; zoneSlug: string | null; locationHint: string | null };

export interface Interpreter {
  /** A festival-goer's words: a routine answer, or a task. */
  understand(i: Heard): Promise<Judged<Understood>>;
  /** Where a report goes and how urgent it is. `urgent` puts it ahead of festival-goers' requests (a volunteer's report). */
  triage(i: Heard & { urgent?: boolean }): Promise<Judged<Triage>>;
  /** "Talk to a person" on an AI answer: the team that fits, P3 unless a safety rule raises it. */
  person(i: Heard): Promise<Judged<Triage>>;
  /** Added detail on an open task: is it worse? On a closed one: triage the whole account instead. */
  detail(i: Heard & { before: string; open: boolean }): Promise<Judged<DetailRead & { triage?: Triage }>>;
  /** Speech or text from a volunteer: a reply to their task, or a new report. */
  interpret(i: { tasks: Task[]; meId: string; text: string }): Promise<Interpretation>;
}

const URGENCY: Priority[] = ['P1', 'P2', 'P3'];
const moreUrgent = (a: Priority, b: Priority) => (URGENCY.indexOf(a) <= URGENCY.indexOf(b) ? a : b);

// ── keywords: the default, and the fallback ──

const run = (over: Partial<Run> = {}): Run => ({
  route: 'escalated_to_triage', reason: null, confidence: null, team: null, priority: null, rewrite: null,
  models: { interpreter: 'keywords' }, latencyMs: 0, error: null, ...over,
});

export class KeywordInterpreter implements Interpreter {
  async understand(i: Heard) {
    const value = heuristicUnderstanding(i.text, i.zoneSlug, i.locationHint);
    return { value, run: run({ route: value.kind === 'answer' ? 'ai_resolved' : 'escalated_to_triage' }) };
  }
  async triage(i: Heard) {
    return { value: heuristicTriage(i.text, i.zoneSlug, i.locationHint), run: run() };
  }
  async person(i: Heard) {
    return { value: heuristicPerson(i.text, i.zoneSlug, i.locationHint), run: run() };
  }
  async detail(i: Heard & { before: string; open: boolean }) {
    return {
      value: { ...heuristicDetail(i.text), ...(i.open ? {} : { triage: heuristicTriage(`${i.before}. ${i.text}`, i.zoneSlug, i.locationHint) }) },
      run: run(),
    };
  }
  async interpret({ tasks, meId, text }: { tasks: Task[]; meId: string; text: string }) {
    return interpretHeuristic(tasks, meId, text);
  }
}

// ── Spark ──

const TEAMS = {
  'first-aid': 'Someone is hurt, ill, collapsed, bleeding, faint or overheated and needs medical attention',
  welfare: 'A lost or separated child, someone vulnerable, harassed or feeling unsafe, or lost property',
  crowd: 'Overcrowding, a crush, long queues, a blocked gate or barrier, evacuation',
  security: 'A fight, theft, weapon, trespass, or an aggressive or very drunk person',
  info: 'A question about directions, the schedule, accessibility or general information',
  artist: 'Anything for artists, bands or performers, or from the backstage or green room area: hospitality, requests, stage management',
  vendors: 'Food or drink stalls, vendors, gas or cooking, stallholder payments',
  ops: 'Facilities and logistics: power, lighting, sound, spills, bins, toilets, water, cables',
} satisfies Record<(typeof TEAM_SLUGS)[number], string>;

const PRIORITIES = {
  P1: 'Life-threatening: unconscious, not breathing, a missing child, a weapon, a crush, severe bleeding',
  P2: 'Urgent: an injury, heat illness, a fight or distress; someone needs help within minutes',
  P3: 'Routine: a question, an inconvenience or a facility problem; nothing urgent',
} satisfies Record<Priority, string>;

const REPLIES = {
  accept: 'Agrees to take the task or says they are on their way',
  decline: 'Says they cannot or will not take the task',
  done: 'Says the task is finished, sorted or resolved',
  need_help: 'Asks for backup or help with the task',
  still_on_it: 'Says they are still working on it, delayed or running late',
  new_report: 'Reports something new, or says anything that is not a reply to the task',
} satisfies Record<ReplyKind | 'new_report', string>;

const Assessment = z.object({
  language: z.string().describe('ISO 639-1 code of the language the message is written in, e.g. "en", "es"'),
  title: z.string().describe('English, at most 60 characters. What and where, e.g. "Collapsed person at Food Alley"'),
  summary: z.string().describe('English, at most two short sentences. Facts from the message only.'),
  category: IncidentCategory,
  zone: z.string().nullable().describe('slug of the place named in the message, from the list, else null'),
  place: z.string().nullable().describe('the location as the person described it, else null'),
  answer: z.string().nullable().describe('Only for a routine question answerable from the venue facts: the answer, in the language of the message. Otherwise null.'),
});

const SYSTEM = (zs: Zone[], canAnswer: boolean) => `You read messages sent at a 15,000-person music festival and prepare them for the safety team.
Write title and summary in English whatever language the message is in. Never invent facts.
${canAnswer ? `If the message is only a routine question (toilets, water, times, lost-property process, directions) and the venue facts below answer it, give the answer in 1-2 short sentences in the SAME language as the message. Never answer anything involving injury, illness, children, safety, security, crowding, weather or distress: set answer to null. If the facts don't cover it, set answer to null.

Venue facts:
${venueFacts(zs)}
` : 'Set answer to null.\n'}
Places (slug: name):
${zs.map((z) => `${z.slug}: ${z.name}`).join('\n')}`;

const dropUnknownZone = (slug: string | null, zs: Zone[]) => (slug && zs.some((z) => z.slug === slug) ? slug : null);

/**
 * Chat model writes the account; typed questions pick team and priority. In parallel: they don't depend on each other.
 * `canAnswer`: the chat model may answer a routine question. `answered`: the AI already answered it and the person
 * asked for a human anyway, so it stays P3 unless a safety rule below raises it.
 */
async function assess(i: Heard, { canAnswer = false, answered = false }, o: CallOptions) {
  const t0 = Date.now();
  const zs = await zones();
  const where = [zs.find((z) => z.slug === i.zoneSlug)?.name, i.locationHint].filter(Boolean).join(', ');
  const [written, decided] = await Promise.allSettled([
    generate({ system: SYSTEM(zs, canAnswer), prompt: where ? `${i.text}\n(Sent from: ${where})` : i.text, schema: Assessment }, o),
    decide(where ? { message: i.text, location: where } : i.text, {
      team: choice('Which team should handle this message?', TEAMS),
      priority: choice('How urgent is this message?', PRIORITIES),
      routine: noul('Is this only a routine question about directions, times or facilities, with nothing urgent or unsafe in it?'),
    }, o),
  ]);

  const kw = heuristicTriage(i.text, i.zoneSlug, i.locationHint);
  const errors = [written, decided].flatMap((r) => (r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : []));
  const w = written.status === 'fulfilled' ? written.value : null;
  const d = decided.status === 'fulfilled' ? decided.value : null;

  // Priority: the model's reading, a step more urgent if it isn't sure, and never below what the red-flag words say.
  let priority: Priority = kw.priority;
  let teamConfidence: number | null = null;
  let alternates: { team: string; confidence: number }[] = [];
  let priorityConfidence: number | null = null;
  if (d) {
    const ranked = Object.entries(d.priority.probabilities).sort((a, b) => b[1] - a[1]);
    priority = d.priority.choice as Priority;
    if (d.priority.confidence < 0.5) priority = moreUrgent(priority, ranked[1][0] as Priority);
    priorityConfidence = d.priority.confidence;
    teamConfidence = d.team.confidence;
    alternates = Object.entries(d.team.probabilities).sort((a, b) => b[1] - a[1]).slice(1, 3).map(([team, confidence]) => ({ team, confidence }));
  } else {
    priority = moreUrgent(priority, 'P2');
  }
  if (answered && d && priority !== 'P1') priority = 'P3';
  if (soundsCritical(i.text)) priority = 'P1';
  else if (soundsUrgent(i.text)) priority = moreUrgent(priority, 'P2');

  const team = d ? (d.team.choice as Triage['team']) : kw.team;
  const triage: Triage = {
    team, priority,
    category: w?.category ?? TEAM_CATEGORY[team],
    title: (w?.title ?? kw.title).slice(0, 60),
    summary: (w?.summary ?? kw.summary).slice(0, 280),
    zoneSlug: dropUnknownZone(w?.zone ?? null, zs) ?? i.zoneSlug,
    locationHint: w?.place ?? i.locationHint,
    language: (w?.language ?? 'en').toLowerCase().slice(0, 2),
  };

  // An AI answer needs two independent yeses, and nothing that sounds like trouble.
  const answerable = !!w?.answer?.trim() && !!d && d.routine.noul >= 0.5 && priority === 'P3' && !soundsUrgent(i.text);
  const log = run({
    route: answerable ? 'ai_resolved' : 'escalated_to_triage',
    reason: answerable ? 'Routine question' : errors.length ? 'A model failed; sent to a person' : null,
    confidence: d?.routine.noul ?? null,
    team: d ? { team, confidence: teamConfidence, alternates } : null,
    priority: d ? { priority, confidence: priorityConfidence, signals: [] } : null,
    rewrite: w ? { title: triage.title, summary: triage.summary, category: triage.category, zoneSlug: triage.zoneSlug, locationHint: triage.locationHint, language: triage.language } : null,
    models: { writer: chatModelId(), classifier: decideModelId() },
    latencyMs: Date.now() - t0,
    error: errors.length ? errors.join('; ') : null,
  });
  return { triage, answer: answerable ? w!.answer!.trim() : null, run: log };
}

const OPTS: CallOptions = { timeoutMs: 12_000 };

export class SparkInterpreter implements Interpreter {
  async understand(i: Heard) {
    const { triage, answer, run } = await assess(i, { canAnswer: true }, OPTS);
    const value: Understood = answer ? { kind: 'answer', answer, language: triage.language } : { kind: 'task', ...triage };
    return { value, run };
  }

  async triage({ urgent, ...i }: Heard & { urgent?: boolean }) {
    const { triage, run } = await assess(i, {}, { ...OPTS, urgent });
    return { value: triage, run };
  }

  async person(i: Heard) {
    const { triage, run } = await assess(i, { answered: true }, OPTS);
    return { value: triage, run };
  }

  async detail(i: Heard & { before: string; open: boolean }) {
    if (!i.open) {
      const { triage, run } = await assess({ ...i, text: `${i.before}. ${i.text}` }, {}, OPTS);
      // The task may reopen before this lands; then `worse` is what counts, so keywords still read it.
      return { value: { worse: heuristicDetail(i.text).worse, triage }, run };
    }
    const t0 = Date.now();
    let worse = heuristicDetail(i.text).worse;
    let error: string | null = null;
    let p: number | null = null;
    try {
      const { worse: q } = await decide({ original_report: i.before, update: i.text }, {
        worse: noul('Does the update say the situation has got worse or more dangerous than the original report?'),
      }, OPTS);
      p = q.noul;
      worse ||= q.noul >= 0.6;
    } catch (e) {
      error = String((e as Error).message);
    }
    return { value: { worse }, run: run({ confidence: p, models: { classifier: decideModelId() }, latencyMs: Date.now() - t0, error }) };
  }

  /**
   * A reply to the task you're on, or a new report. When the classifier is down, slow or under 0.6 sure, keywords
   * decide, same as without a model. A helper can only finish. Long utterances are reports even if they say "done":
   * 12 words here, 8 for keywords, which match "done" inside any sentence.
   */
  async interpret({ tasks, meId, text }: { tasks: Task[]; meId: string; text: string }): Promise<Interpretation> {
    const t0 = Date.now();
    const heard = text.trim();
    const active = activeTaskOf(tasks, meId);
    // No task, nothing to reply to: skip the model.
    if (!active) return interpretHeuristic(tasks, meId, text);
    const helping = active.assigneeId !== meId;
    const ms = Number(process.env.AI_INTERPRET_MS ?? 1_500);
    try {
      // The signal bounds the whole call, queue wait and retries included, and frees its Spark slot when it fires.
      const { kind } = await decide({
        utterance: heard,
        current_task: { title: active.title, summary: active.summary, volunteer_is: helping ? 'a helper' : 'the owner' },
      }, { kind: choice('What is the volunteer doing with this message?', REPLIES) }, { urgent: true, timeoutMs: ms, signal: AbortSignal.timeout(ms) });
      console.log(`interpret ${kind.choice} (${kind.confidence.toFixed(2)}) ${Date.now() - t0} ms`);
      if (kind.confidence < 0.6) return interpretHeuristic(tasks, meId, text);
      const reply = ReplyKind.safeParse(kind.choice);
      const short = heard.split(/\s+/).length <= 12;
      if (!reply.success || !short || (helping && reply.data !== 'done')) return { heard, intent: { kind: 'report' } };
      return { heard, intent: { kind: 'reply', taskId: active.id, reply: reply.data } };
    } catch (e) {
      console.warn(`interpret fell back to keywords after ${Date.now() - t0} ms: ${(e as Error).message}`);
      return interpretHeuristic(tasks, meId, text);
    }
  }
}

/**
 * USE_LIVE_MODELS=1 puts the models behind every decision (needs TYPESAFE_BASE_URL and TYPESAFE_API_KEY).
 * Anything else keeps the keyword stand-ins, so the server runs with no keys.
 */
export const live = process.env.USE_LIVE_MODELS === '1';
export const interpreter: Interpreter = live ? new SparkInterpreter() : new KeywordInterpreter();
