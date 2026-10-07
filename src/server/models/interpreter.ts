import { z } from 'zod';

import type { DetailRead, EscalateTo, Match, Triage, Understood } from '@/lib/ai';
import {
  heuristicDetail, heuristicTriage, soundsCritical, soundsUrgent, TEAM_CATEGORY,
} from '@/lib/heuristics';
import { activeTaskOf, interpretHeuristic } from '@/lib/commands';
import { ReplyKind, type Priority, type Task, type TeamSlug } from '@/lib/schema';
import type { Interpretation } from '@/data/repo';
import { callTool, choice, decide, decideModelId, noul, toolModelId, type CallOptions } from '.';
import { CreateTaskArgs, EscalateArgs, INTAKE_SYSTEM, intakeTools, TEAMS, type AnswerArgs } from './intake-tools';
import { zones, type Zone } from './venue';

/**
 * Reads what people say and decides what to do with it: answer a routine question, pick a team and priority, create a
 * task or escalate it to a lead or Mo (the intake agent's tools, intake-tools.ts), tell if added detail is worse, tell
 * a reply from a new report. The models answer; keywords only stand in when a call fails.
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

/** Who sent a message. Staff: their role and team, from the volunteers table. */
export type Sender = { kind: 'festivalgoer' } | { kind: 'staff'; role: string; teamSlug: TeamSlug | null };

/** A message, where it was sent from (the zone picked, or where the volunteer is) and who sent it. */
type Heard = { text: string; zoneSlug: string | null; locationHint: string | null; from?: Sender };

export interface Interpreter {
  /** A festival-goer's words: a routine answer, or a task. */
  understand(i: Heard): Promise<Judged<Understood>>;
  /** Where a report goes and how urgent it is. `urgent` puts it ahead of festival-goers' requests (a volunteer's report). */
  triage(i: Heard & { urgent?: boolean }): Promise<Judged<Triage>>;
  /** Added detail on an open task: is it worse? On a closed one: triage the whole account instead. */
  detail(i: Heard & { before: string; open: boolean }): Promise<Judged<DetailRead & { triage?: Triage }>>;
  /** A new report against open tasks nearby: the one it's about, read again with what's new, or null for a new incident. */
  match(i: Heard & { candidates: Task[]; urgent?: boolean }): Promise<Judged<Match>>;
  /** Speech or text from a volunteer: a reply to their task, or a new report. */
  interpret(i: { tasks: Task[]; meId: string; text: string }): Promise<Interpretation>;
}

const URGENCY: Priority[] = ['P1', 'P2', 'P3'];
const moreUrgent = (a: Priority, b: Priority) => (URGENCY.indexOf(a) <= URGENCY.indexOf(b) ? a : b);

// ── keywords: only when a model call fails ──

const run = (over: Partial<Run> = {}): Run => ({
  route: 'escalated_to_triage', reason: null, confidence: null, team: null, priority: null, rewrite: null,
  models: { interpreter: 'keywords' }, latencyMs: 0, error: null, ...over,
});

// ── Spark ──

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

const dropUnknownZone = (slug: string | null, zs: Zone[]) => (slug && zs.some((z) => z.slug === slug) ? slug : null);

/** How the agent is told who sent it: "a volunteer on the first-aid team". */
function describe(from: Sender): string {
  if (from.kind === 'festivalgoer') return 'a festival-goer';
  const team = from.teamSlug ? ` ${from.teamSlug}` : '';
  if (from.role === 'volunteer') return `a volunteer on the${team} team`;
  if (from.role === 'team_lead') return `the${team} team lead`;
  if (from.role === 'coordinator') return 'Mo, the event coordinator';
  return `a staff member (${from.role.replace('_', ' ')})`;
}

/** An escalation that would land back on whoever sent it isn't one: they've already decided. */
function aboveSender(e: EscalateTo | null, from: Sender | undefined, team: TeamSlug): EscalateTo | null {
  if (!e || from?.kind !== 'staff') return e;
  if (from.role === 'coordinator') return null;
  if (from.role === 'team_lead' && e.level === 'lead' && from.teamSlug === team) return null;
  return e;
}

const LEVEL = { lead: 1, coordinator: 2 } as const;
/** The higher of two escalations: the agent's and the keyword rule's. Escalating is never undone. */
const higher = (a: EscalateTo | null, b: EscalateTo | null) => (!a ? b : !b ? a : LEVEL[b.level] > LEVEL[a.level] ? b : a);

/**
 * The intake agent picks a tool (create_task or escalate) and writes the account; typed questions cross-check team,
 * priority and "is this routine". In parallel: they don't depend on each other. Then code has the last word:
 * priority is never below the red-flag words, an escalation is never dropped (except one back to its own sender),
 * and a keyword rule can add one.
 * `canAnswer`: the agent may answer a routine question instead of calling a tool.
 */
async function assess(i: Heard, { canAnswer = false }, o: CallOptions) {
  const t0 = Date.now();
  const zs = await zones();
  const where = [zs.find((z) => z.slug === i.zoneSlug)?.name, i.locationHint].filter(Boolean).join(', ');
  const about = [i.from && `From: ${describe(i.from)}.`, where && `Sent from: ${where}.`].filter(Boolean).join(' ');
  const [called, decided] = await Promise.allSettled([
    callTool({ system: INTAKE_SYSTEM(zs, canAnswer), prompt: about ? `${i.text}\n(${about})` : i.text, tools: intakeTools(canAnswer) }, o),
    decide(where ? { message: i.text, location: where } : i.text, {
      team: choice('Which team should handle this message?', TEAMS),
      priority: choice('How urgent is this message?', PRIORITIES),
      routine: noul('Is this only a routine question about directions, times or facilities, with nothing urgent or unsafe in it?'),
    }, o),
  ]);

  const kw = heuristicTriage(i.text, i.zoneSlug, i.locationHint);
  const errors = [called, decided].flatMap((r) => (r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : []));
  const c = called.status === 'fulfilled' ? called.value : null;
  const d = decided.status === 'fulfilled' ? decided.value : null;
  // create_task's arguments are escalate's without level and reason. answer_question routes nothing.
  const routed = c?.tool === 'create_task' || c?.tool === 'escalate';
  const agent = routed ? (c.args as z.infer<typeof CreateTaskArgs> & Partial<z.infer<typeof EscalateArgs>>) : null;
  const replied = c?.tool === 'answer_question' ? (c.args as z.infer<typeof AnswerArgs>) : null;

  // Priority: the classifier's calibrated reading (a step up when it's unsure). The agent's counts when it says P1,
  // or when the classifier failed. Never below the red-flag words. Taking the higher of the two every time inflated
  // routine reports to P2 (scripts/check-intake.ts).
  let priority: Priority = d ? modelPriority(d.priority) : moreUrgent(agent?.priority ?? kw.priority, 'P2');
  if (agent?.priority === 'P1') priority = 'P1';
  priority = floor(priority, i.text);

  const team = agent?.team ?? (d ? (d.team.choice as Triage['team']) : kw.team);
  const asked = c?.tool === 'escalate' && agent?.level && agent.reason?.trim() ? { level: agent.level, reason: agent.reason.trim().slice(0, 140) } : null;
  const triage: Triage = {
    team, priority,
    category: agent?.category ?? TEAM_CATEGORY[team],
    title: (agent?.title ?? kw.title).slice(0, 60),
    summary: (agent?.summary ?? kw.summary).slice(0, 280),
    zoneSlug: dropUnknownZone(agent?.zone ?? null, zs) ?? i.zoneSlug,
    locationHint: agent?.place ?? i.locationHint,
    language: (agent?.language ?? replied?.language ?? 'en').toLowerCase().slice(0, 2),
    escalate: aboveSender(higher(asked, kw.escalate), i.from, team),
  };

  // An AI answer needs two independent yeses, and nothing that sounds like trouble or needs a decision.
  const answer = canAnswer ? replied?.answer.trim() || c?.text || null : null;
  const answerable = !!answer && !!d && d.routine.noul >= 0.5 && priority === 'P3' && !soundsUrgent(i.text) && !triage.escalate;
  const log = run({
    route: answerable ? 'ai_resolved' : 'escalated_to_triage',
    reason: answerable ? 'Routine question' : errors.length ? 'A model failed; sent to a person' : triage.escalate?.reason ?? null,
    confidence: d?.routine.noul ?? null,
    team: {
      team,
      confidence: d?.team.confidence ?? null,
      alternates: d ? Object.entries(d.team.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, confidence]) => ({ team: t, confidence })) : [],
      tool: c?.tool ?? null,
      escalate: triage.escalate,
    },
    priority: d ? { priority, confidence: d.priority.confidence, signals: [] } : null,
    rewrite: agent ? { title: triage.title, summary: triage.summary, category: triage.category, zoneSlug: triage.zoneSlug, locationHint: triage.locationHint, language: triage.language } : null,
    models: { agent: toolModelId(), classifier: decideModelId() },
    latencyMs: Date.now() - t0,
    error: errors.length ? errors.join('; ') : null,
  });
  return { triage, answer: answerable ? answer : null, run: log };
}

const OPTS: CallOptions = {};

type Choice = { choice: string; confidence: number; probabilities: Record<string, number> };

/** The classifier's priority, a step more urgent if it isn't sure. */
function modelPriority(p: Choice): Priority {
  const ranked = Object.entries(p.probabilities).sort((a, b) => b[1] - a[1]);
  return p.confidence < 0.5 ? moreUrgent(p.choice as Priority, ranked[1][0] as Priority) : (p.choice as Priority);
}

/** Never below what the red-flag words say. */
const floor = (p: Priority, text: string): Priority => (soundsCritical(text) ? 'P1' : soundsUrgent(text) ? moreUrgent(p, 'P2') : p);

const safePriority = (p: Choice, text: string) => floor(modelPriority(p), text);

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

  /** One typed call: which open task this is about (or none), how urgent that is now, and whether it says it's sorted. */
  async match({ candidates, urgent, ...i }: Heard & { candidates: Task[]; urgent?: boolean }): Promise<Judged<Match>> {
    if (!candidates.length) return { value: null, run: run() };
    const t0 = Date.now();
    const labels = Object.fromEntries(candidates.map((t, n) => [`task_${n + 1}`, `${t.title}. ${t.summary}`]));
    const log = (over: Partial<Run>) => run({ models: { classifier: decideModelId() }, latencyMs: Date.now() - t0, ...over });
    try {
      const d = await decide({ new_report: i.text, open_tasks: labels }, {
        about: choice('Which open task is the new report about?', { ...labels, new: 'None of them: a different incident' }),
        priority: choice('Taking the open task and the new report together, how urgent is it now?', PRIORITIES),
        sorted: noul('Does the new report say the problem is over or sorted?'),
      }, { ...OPTS, urgent });
      const task = candidates[Number(d.about.choice.replace('task_', '')) - 1];
      // Merging two incidents hides one of them: only a sure answer joins a task.
      if (!task || d.about.confidence < 0.6) return { value: null, run: log({ confidence: d.about.confidence }) };
      const value: Match = { taskId: task.id, read: { priority: safePriority(d.priority, i.text), resolved: d.sorted.noul >= 0.5 } };
      return { value, run: log({ confidence: d.about.confidence }) };
    } catch (e) {
      return { value: null, run: log({ error: String((e as Error).message) }) };
    }
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
      }, { kind: choice('What is the volunteer doing with this message?', REPLIES) }, { urgent: true, signal: AbortSignal.timeout(ms) });
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

/** The models behind every decision: OPENAI_API_KEY, or SPARK_API_KEY with MODEL_PROVIDER=spark (main.ts checks). */
export const interpreter: Interpreter = new SparkInterpreter();
