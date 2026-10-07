import { z } from 'zod';

import {
  TEAM_CATEGORY,
  unread,
  type DetailRead,
  type EscalateTo,
  type Match,
  type Named,
  type RespondCommand,
  type Triage,
  type Understood,
} from '@/lib/ai';
import { activeTaskOf } from '@/lib/commands';
import { availableHelperReplies } from '@/lib/lifecycle';
import { ReplyKind, type EscalationResponseKind, type Priority, type Task, type TeamSlug } from '@/lib/schema';
import type { Interpretation } from '@/data/repo';
import { callTool, chatModelId, choice, decide, decideModelId, generate, noul, toolModelId, type CallOptions } from '.';
import {
  ANSWER_SYSTEM,
  AnswerOut,
  CreateTaskArgs,
  EscalateArgs,
  INTAKE_SYSTEM,
  intakeTools,
  TEAMS,
  type AnswerArgs,
} from './intake-tools';
import { venueFacts, zones, type Zone } from './venue';

/**
 * Reads what people say and decides what to do with it: answer a routine question, pick a team and priority, create a
 * task or escalate it to a lead or Mo (the intake agent's tools, intake-tools.ts), tell if added detail is worse, tell
 * a reply from a new report. Only the models decide: nothing reads keywords.
 * None of these throw on a model failure: they fail closed to a person (priority at least P2, a lead decides, never an
 * AI answer) and say so in `run.error`, which lands in triage_runs.
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
  /** A festival-goer's words: the classifier gates, a routine answer, else the intake agent's task. */
  understand(i: Heard): Promise<Judged<Understood>>;
  /** Where a report goes and how urgent it is. `urgent` puts it ahead of festival-goers' requests (a volunteer's report). */
  triage(i: Heard & { urgent?: boolean }): Promise<Judged<Triage>>;
  /** Added detail on an open task: is it worse? On a closed one: triage the whole account instead. */
  detail(i: Heard & { before: string; open: boolean }): Promise<Judged<DetailRead & { triage?: Triage }>>;
  /** A new report against open tasks nearby: the one it's about, read again with what's new, or null for a new incident. */
  match(i: Heard & { candidates: Task[]; urgent?: boolean }): Promise<Judged<Match>>;
  /** Speech or text from a volunteer: a reply to their task, or a new report. */
  interpret(i: { tasks: Task[]; meId: string; text: string }): Promise<Interpretation>;
  /** A lead's words on the Respond screen: one of the responses that fit, or null when it can't tell. */
  respond(i: RespondHeard): Promise<Judged<RespondCommand | null>>;
}

/** Who could be sent, as the Respond screen shows them: free or busy, and minutes away on foot. */
export type Teammate = Named & { free: boolean; minutes?: number };

/** What a lead said, about which task, and what fits: `available` responses, "Pass to Mo" if `canPass`. */
export type RespondHeard = {
  task: Task;
  text: string;
  available: EscalationResponseKind[];
  canPass: boolean;
  people: Teammate[];
  quiet?: boolean;
};

const URGENCY: Priority[] = ['P1', 'P2', 'P3'];

/** "Tell her I'm two minutes away" → "I'm two minutes away": the volunteer speaking to the festival-goer. As said, if the model fails. */
async function toGuest(text: string): Promise<string> {
  try {
    const { message } = await generate(
      {
        system:
          'A festival volunteer said this for the festival-goer they are on their way to help. Rewrite it as the ' +
          'volunteer speaking to them directly: drop "tell her/them", keep every fact, same language, one or two short sentences.',
        prompt: text,
        schema: z.object({ message: z.string().min(1).max(300) }),
      },
      { signal: AbortSignal.timeout(Number(process.env.AI_TELL_MS ?? 2_000)) },
    );
    return message.trim();
  } catch (e) {
    console.warn(`toGuest sent it as said: ${(e as Error).message}`);
    return text;
  }
}
/** A festival-goer's words in English, or null when they're already English or the model is down or slow. */
async function toEnglish(text: string): Promise<string | null> {
  try {
    const { language, english } = await generate(
      {
        system:
          'A festival-goer added this to their request for help. Say which language it is in (ISO 639-1) and give it ' +
          'in English, faithful to what they said, names and places kept as written. If it is already English, repeat it.',
        prompt: text,
        schema: z.object({ language: z.string().min(2).max(8), english: z.string().min(1).max(2000) }),
      },
      { signal: AbortSignal.timeout(Number(process.env.AI_TRANSLATE_MS ?? 3_000)) },
    );
    return language.toLowerCase().startsWith('en') ? null : english.trim();
  } catch (e) {
    console.warn(`toEnglish kept the original: ${(e as Error).message}`);
    return null;
  }
}
const moreUrgent = (a: Priority, b: Priority) => (URGENCY.indexOf(a) <= URGENCY.indexOf(b) ? a : b);

const run = (over: Partial<Run> = {}): Run => ({
  route: 'escalated_to_triage',
  reason: null,
  confidence: null,
  team: null,
  priority: null,
  rewrite: null,
  models: {},
  latencyMs: 0,
  error: null,
  ...over,
});

// ── Spark ──

const PRIORITIES = {
  P1: 'Life-threatening: unconscious, not breathing, a missing child, a weapon, a crush, severe bleeding',
  P2: 'Urgent: an injury, heat illness, a fight or distress; someone needs help within minutes',
  P3: 'Routine: a question, an inconvenience or a facility problem; nothing urgent',
} satisfies Record<Priority, string>;

/**
 * The gate: can it be settled with nobody sent? A need they can walk to counts, not only a question, and so does a
 * greeting. "That didn't help" on its own doesn't make it more than routine; asking for a person does.
 */
const ROUTINE =
  'Can this be settled with nobody sent: a greeting or a message with no request yet, or only a routine question ' +
  'or need the person can sort out themselves once told where to go (water, toilets, food, Info, lost property, set times, ' +
  'directions), with nothing urgent, unsafe or medical in it? Saying an earlier answer did not help does not change this; ' +
  'asking for a person, or describing new trouble, does.';

const REPLIES = {
  accept: 'Agrees to take the task or says they are on their way',
  decline: 'Says they cannot or will not take the task',
  done: 'Says the task is finished, sorted or resolved',
  need_help: 'Asks for backup or help with the task',
  still_on_it: 'Says they are still working on it, delayed or running late',
  new_report: 'Reports something new, or says anything that is not a reply to the task',
} satisfies Record<ReplyKind | 'new_report', string>;

/** Only on a festival-goer's request: words meant for them. */
const TELL_GUEST = {
  tell_guest:
    'A message for the festival-goer who asked for help: where to wait, what the volunteer looks like, how long they will be ("tell her I\'m two minutes away", "I\'m in the yellow vest")',
};

/** The responses a lead can pick, as the model is offered them. Only those that fit right now are offered. */
const ACTIONS = {
  backup: 'Send a teammate to help the volunteer',
  reassign: 'Take the task off the volunteer and give it to a teammate',
  handover_medics: 'Hand it over to the medics or first aid',
  handover_security: 'Hand it over to security',
  handover_emergency: 'Call 000: an ambulance, the police or the fire brigade',
  call: 'Phone the volunteer',
  close: 'Close the task: not needed, a false alarm, stand down',
  carry_on: 'The volunteer is fine and carries on as they are',
  pass: 'Pass it up to Mo, the event coordinator',
  unclear: 'None of these, or it is not clear what the lead wants',
} as const;
type Action = keyof typeof ACTIONS;

const toCommand = (a: Action, said: string): RespondCommand | null => {
  switch (a) {
    case 'backup':
    case 'reassign':
      return { kind: a };
    case 'handover_medics':
      return { kind: 'handover', target: 'medics' };
    case 'handover_security':
      return { kind: 'handover', target: 'security' };
    case 'handover_emergency':
      return { kind: 'handover', target: 'emergency' };
    case 'close':
      return { kind: 'close', note: said.trim() };
    case 'call':
    case 'carry_on':
    case 'pass':
      return { kind: a };
    case 'unclear':
      return null;
  }
};

/** The actions that fit right now. */
function offered({ available, canPass }: Pick<RespondHeard, 'available' | 'canPass'>): Partial<Record<Action, string>> {
  const can = (k: EscalationResponseKind) => available.includes(k);
  const keep: Action[] = [
    ...(['backup', 'reassign', 'call', 'close', 'carry_on'] as const).filter(can),
    ...(can('handover') ? (['handover_medics', 'handover_security', 'handover_emergency'] as const) : []),
    ...(canPass ? (['pass'] as const) : []),
  ];
  return Object.fromEntries([...keep, 'unclear'].map((k) => [k, ACTIONS[k as Action]]));
}

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
/** The higher of two escalations. Escalating is never undone. */
const higher = (a: EscalateTo | null, b: EscalateTo | null) =>
  !a ? b : !b ? a : LEVEL[b.level] > LEVEL[a.level] ? b : a;

/** "Food Alley, by the bins": the zone picked and what they said about where. */
const whereFrom = (i: Heard, zs: Zone[]) =>
  [zs.find((z) => z.slug === i.zoneSlug)?.name, i.locationHint].filter(Boolean).join(', ');

/** The message as a model reads it, with who sent it and from where. */
function prompted(i: Heard, zs: Zone[]) {
  const where = whereFrom(i, zs);
  const about = [i.from && `From: ${describe(i.from)}.`, where && `Sent from: ${where}.`].filter(Boolean).join(' ');
  return about ? `${i.text}\n(${about})` : i.text;
}

/**
 * The classifier's read of one message: team, priority, and whether it can be settled with nobody sent. It sees what
 * the agent sees: without who sent it and what's on site, "i need water" was a coin flip.
 */
export function classify(i: Heard, zs: Zone[], o: CallOptions = {}) {
  const where = whereFrom(i, zs);
  return decide(
    {
      message: i.text,
      ...(where && { location: where }),
      ...(i.from && { sent_by: describe(i.from) }),
      ...(i.from?.kind === 'festivalgoer' && { venue_facts: venueFacts(zs) }),
    },
    {
      team: choice('Which team should handle this message?', TEAMS),
      priority: choice('How urgent is this message?', PRIORITIES),
      routine: noul(ROUTINE),
    },
    o,
  );
}
type Classified = Awaited<ReturnType<typeof classify>>;

/**
 * How sure the classifier must be that nobody needs sending before it answers on its own. Below it, the agent
 * decides, and may still answer. scripts/eval-gate.ts (336 cases, Spark): the only value where no case that needs a
 * person gets through. At 0.9, "help", "need help" and a collapse in Korean did. About a third of routine ones pass.
 */
export const ROUTINE_AT = 0.95;

/** Nobody needs sending: routine, and it leans P3 (even unsurely: "I need water" does). */
const isRoutine = (d: Classified) => d.routine.noul >= ROUTINE_AT && d.priority.choice === 'P3';

/**
 * The intake agent picks a tool (create_task or escalate) and writes the account; the classifier cross-checks team
 * and priority. A volunteer's report has no gate, so both run in parallel; a festival-goer's message passes its
 * `gate` (the classifier's read, already asked) and only the agent is called, which may answer it after all
 * (answer_question) unless the classifier read it as P1. If the agent fails, a lead decides; if both fail, it's
 * unread (src/lib/ai.ts). An escalation is never dropped, except one back to its own sender.
 */
async function assess(i: Heard, zs: Zone[], o: CallOptions, gate?: Promise<Classified>) {
  const t0 = Date.now();
  const [called, decided] = await Promise.allSettled([
    callTool({ system: INTAKE_SYSTEM(zs, !!gate), prompt: prompted(i, zs), tools: intakeTools(!!gate) }, o),
    gate ?? classify(i, zs, o),
  ]);

  const none = unread(i.text, i.zoneSlug, i.locationHint);
  const errors = [called, decided].flatMap((r) =>
    r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : [],
  );
  const c = called.status === 'fulfilled' ? called.value : null;
  const d = decided.status === 'fulfilled' ? decided.value : null;
  // create_task's arguments are escalate's without level and reason. answer_question routes nothing.
  const routed = c?.tool === 'create_task' || c?.tool === 'escalate';
  const agent = routed ? (c.args as z.infer<typeof CreateTaskArgs> & Partial<z.infer<typeof EscalateArgs>>) : null;
  // The agent overrules the gate's "someone is needed", but not a life-threatening read.
  const replied =
    c?.tool === 'answer_question' && d?.priority.choice !== 'P1' ? (c.args as z.infer<typeof AnswerArgs>) : null;
  const answer = replied?.answer.trim() || null;

  // Priority: the classifier's calibrated reading (a step up when it's unsure). The agent's counts when it says P1,
  // or when the classifier failed (then at least P2). Taking the higher of the two every time inflated routine
  // reports to P2 (scripts/check-intake.ts). A festival-goer's message the gate called routine, with nothing in the
  // venue facts for it, stays P3: no step up.
  let priority: Priority = d
    ? gate && isRoutine(d)
      ? 'P3'
      : modelPriority(d.priority)
    : moreUrgent(agent?.priority ?? none.priority, 'P2');
  if (agent?.priority === 'P1') priority = 'P1';

  const team = agent?.team ?? (d ? (d.team.choice as Triage['team']) : none.team);
  const asked =
    c?.tool === 'escalate' && agent?.level && agent.reason?.trim()
      ? { level: agent.level, reason: agent.reason.trim().slice(0, 140) }
      : null;
  // No model said which language: it stays unknown rather than English.
  const said = iso(agent?.language ?? replied?.language);
  const language = said ?? none.language;
  const triage: Triage = {
    team,
    priority,
    category: agent?.category ?? TEAM_CATEGORY[team],
    title: (agent?.title ?? none.title).slice(0, 60),
    summary: (agent?.summary ?? none.summary).slice(0, 280),
    zoneSlug: dropUnknownZone(agent?.zone ?? null, zs) ?? i.zoneSlug,
    locationHint: agent?.place ?? i.locationHint,
    language,
    ...(agent?.english?.trim() ? { english: agent.english.trim().slice(0, 2000) } : {}),
    // The agent's read; a report written in another language always needs it.
    speakerNeeded: needsSpeaker(agent?.speaker_needed) ?? needsSpeaker(said),
    // Null when the agent didn't say: the picker falls back to the category.
    firstAidNeeded: typeof agent?.first_aid_needed === 'boolean' ? agent.first_aid_needed : null,
    playbook: agent?.playbook && agent.playbook !== 'none' ? agent.playbook : null,
    playbookSure: !!agent?.playbook && agent.playbook !== 'none' && agent.playbook_sure === true,
    // Without the agent nothing checked whether a lead or Mo must decide: a lead does.
    escalate: aboveSender(higher(asked, agent || answer ? null : none.escalate), i.from, team),
  };

  const log = run({
    route: answer ? 'ai_resolved' : 'escalated_to_triage',
    reason: answer
      ? 'The agent answered it'
      : errors.length
        ? 'A model failed; sent to a person'
        : (triage.escalate?.reason ?? null),
    confidence: d?.routine.noul ?? null,
    team: {
      team,
      confidence: d?.team.confidence ?? null,
      alternates: d
        ? Object.entries(d.team.probabilities)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([t, confidence]) => ({ team: t, confidence }))
        : [],
      tool: c?.tool ?? null,
      escalate: triage.escalate,
    },
    priority: d ? { priority, confidence: d.priority.confidence, signals: [] } : null,
    rewrite: agent
      ? {
          title: triage.title,
          summary: triage.summary,
          category: triage.category,
          zoneSlug: triage.zoneSlug,
          locationHint: triage.locationHint,
          language: triage.language,
        }
      : null,
    models: { agent: toolModelId(), classifier: decideModelId() },
    latencyMs: Date.now() - t0,
    error: errors.length ? errors.join('; ') : null,
  });
  return { triage, answer, run: log };
}

const OPTS: CallOptions = {};

/** A model's language code as two lowercase letters, or null for none (or English said as "none"). */
const iso = (code: string | null | undefined) => {
  const c = code?.trim().toLowerCase().slice(0, 2);
  return c && /^[a-z]{2}$/.test(c) ? c : null;
};
/** Someone needs a speaker of this: any language but English. */
const needsSpeaker = (code: string | null | undefined) => {
  const c = iso(code);
  return c === 'en' ? null : c;
};

type Choice = { choice: string; confidence: number; probabilities: Record<string, number> };

/** The classifier's priority, a step more urgent if it isn't sure. */
function modelPriority(p: Choice): Priority {
  const ranked = Object.entries(p.probabilities).sort((a, b) => b[1] - a[1]);
  return p.confidence < 0.5 ? moreUrgent(p.choice as Priority, ranked[1][0] as Priority) : (p.choice as Priority);
}

export class SparkInterpreter implements Interpreter {
  /**
   * The classifier is the gate, on every message, follow-ups and "not solved" too. Routine: an answer from the venue
   * facts straight away, nobody sent. Not routine, or the facts have nothing (more) for it: the intake agent, which
   * sends someone or answers it after all.
   */
  async understand(heard: Heard) {
    const t0 = Date.now();
    const i: Heard = { ...heard, from: heard.from ?? { kind: 'festivalgoer' } };
    const zs = await zones();
    const gate = classify(i, zs, OPTS);
    const d = await gate.catch(() => null);
    let writerError: string | null = null;
    if (d && isRoutine(d)) {
      try {
        const out = await generate({ system: ANSWER_SYSTEM(zs), prompt: prompted(i, zs), schema: AnswerOut }, OPTS);
        const answer = out.answer?.trim();
        if (answer) {
          return {
            value: { kind: 'answer', answer, language: out.language.toLowerCase().slice(0, 2) } satisfies Understood,
            run: run({
              route: 'ai_resolved',
              reason: 'Routine question',
              confidence: d.routine.noul,
              team: { team: d.team.choice, confidence: d.team.confidence, alternates: [], tool: null, escalate: null },
              priority: { priority: 'P3', confidence: d.priority.confidence, signals: [] },
              models: { classifier: decideModelId(), writer: chatModelId() },
              latencyMs: Date.now() - t0,
            }),
          };
        }
      } catch (e) {
        writerError = String((e as Error).message);
      }
    }
    const { triage, answer, run: log } = await assess(i, zs, OPTS, gate);
    const error = [log.error, writerError].filter(Boolean).join('; ') || null;
    const value: Understood = answer
      ? { kind: 'answer', answer, language: triage.language }
      : { kind: 'task', ...triage };
    return { value, run: { ...log, error, latencyMs: Date.now() - t0 } };
  }

  async triage({ urgent, ...i }: Heard & { urgent?: boolean }) {
    const { triage, run } = await assess(i, await zones(), { ...OPTS, urgent });
    return { value: triage, run };
  }

  async detail(i: Heard & { before: string; open: boolean }) {
    if (!i.open) {
      const { triage, run } = await assess({ ...i, text: `${i.before}. ${i.text}` }, await zones(), OPTS);
      // The task may reopen before this lands; then `worse` is what counts: as urgent as the account reads now.
      return { value: { worse: triage.priority !== 'P3', triage }, run };
    }
    const t0 = Date.now();
    // Staff read the detail in English. The classifier only scores it, so a small call translates it alongside.
    const translating = toEnglish(i.text);
    // Unread, it goes to the lead as worse.
    let worse = true;
    let error: string | null = null;
    let p: number | null = null;
    try {
      const { worse: q } = await decide(
        { original_report: i.before, update: i.text },
        {
          worse: noul('Does the update say the situation has got worse or more dangerous than the original report?'),
        },
        OPTS,
      );
      p = q.noul;
      worse = q.noul >= 0.6;
    } catch (e) {
      error = String((e as Error).message);
    }
    const english = await translating;
    return {
      value: { worse, ...(english ? { english } : {}) },
      run: run({ confidence: p, models: { classifier: decideModelId() }, latencyMs: Date.now() - t0, error }),
    };
  }

  /** One typed call: which open task this is about (or none), how urgent that is now, and whether it says it's sorted. */
  async match({ candidates, urgent, ...i }: Heard & { candidates: Task[]; urgent?: boolean }): Promise<Judged<Match>> {
    if (!candidates.length) return { value: null, run: run() };
    const t0 = Date.now();
    const labels = Object.fromEntries(candidates.map((t, n) => [`task_${n + 1}`, `${t.title}. ${t.summary}`]));
    const log = (over: Partial<Run>) =>
      run({ models: { classifier: decideModelId() }, latencyMs: Date.now() - t0, ...over });
    try {
      const d = await decide(
        { new_report: i.text, open_tasks: labels },
        {
          about: choice('Which open task is the new report about?', {
            ...labels,
            new: 'None of them: a different incident',
          }),
          priority: choice('Taking the open task and the new report together, how urgent is it now?', PRIORITIES),
          sorted: noul('Does the new report say the problem is over or sorted?'),
        },
        { ...OPTS, urgent },
      );
      const task = candidates[Number(d.about.choice.replace('task_', '')) - 1];
      // Merging two incidents hides one of them: only a sure answer joins a task.
      if (!task || d.about.confidence < 0.6) return { value: null, run: log({ confidence: d.about.confidence }) };
      const value: Match = {
        taskId: task.id,
        read: { priority: modelPriority(d.priority), resolved: d.sorted.noul >= 0.5 },
      };
      return { value, run: log({ confidence: d.about.confidence }) };
    } catch (e) {
      return { value: null, run: log({ error: String((e as Error).message) }) };
    }
  }

  /**
   * A reply to the task you're on, or a new report. When the classifier is down, slow or under 0.6 sure, it's a
   * report: a person reads it. Helpers reply to their own slot: notified accepts or declines, accepted finishes.
   * Long utterances are reports even if they say "done".
   */
  async interpret({ tasks, meId, text }: { tasks: Task[]; meId: string; text: string }): Promise<Interpretation> {
    const t0 = Date.now();
    const heard = text.trim();
    const active = activeTaskOf(tasks, meId);
    const report: Interpretation = { heard, intent: { kind: 'report' } };
    // No task, nothing to reply to: skip the model.
    if (!active) return report;
    const helping = active.assigneeId !== meId;
    const helper = active.helpers.find((entry) => entry.volunteerId === meId);
    const ms = Number(process.env.AI_INTERPRET_MS ?? 1_500);
    try {
      // The signal bounds the whole call, queue wait and retries included, and frees its Spark slot when it fires.
      const { kind } = await decide(
        {
          utterance: heard,
          current_task: {
            title: active.title,
            summary: active.summary,
            volunteer_is: helping ? `a helper (${helper?.status ?? 'unknown'} assignment)` : 'the owner',
            asked_by: active.requestId ? 'a festival-goer, who can read messages' : 'staff',
          },
        },
        {
          kind: choice(
            'What is the volunteer doing with this message?',
            active.requestId ? { ...REPLIES, ...TELL_GUEST } : REPLIES,
          ),
        },
        { urgent: true, signal: AbortSignal.timeout(ms) },
      );
      console.log(`interpret ${kind.choice} (${kind.confidence.toFixed(2)}) ${Date.now() - t0} ms`);
      if (kind.confidence < 0.6) return report;
      // Any length: it goes to them as said.
      if ((kind.choice as string) === 'tell_guest' && active.requestId) {
        return { heard, intent: { kind: 'tell_guest', taskId: active.id, text: await toGuest(heard) } };
      }
      const reply = ReplyKind.safeParse(kind.choice);
      const short = heard.split(/\s+/).length <= 12;
      const helperReplies = helper ? availableHelperReplies(helper.status) : null;
      const helperAllowed = helperReplies ? [helperReplies.primary, ...helperReplies.secondary] : [];
      if (!reply.success || !short || (helping && !helperAllowed.includes(reply.data))) return report;
      return { heard, intent: { kind: 'reply', taskId: active.id, reply: reply.data } };
    } catch (e) {
      console.warn(`interpret read it as a report after ${Date.now() - t0} ms: ${(e as Error).message}`);
      return report;
    }
  }

  /**
   * One typed call: which response the lead means, and who, when they name someone. Only the responses that fit
   * are offered. When the classifier is down, slow or under 0.6 sure, it's null: the lead taps instead. A teammate
   * is only one of `people`, and only when the model is sure who.
   */
  async respond(i: RespondHeard): Promise<Judged<RespondCommand | null>> {
    const t0 = Date.now();
    const said = i.text.trim();
    const log = (value: RespondCommand | null, over: Partial<Run>): Judged<RespondCommand | null> => {
      const r = run({
        reason: value?.kind ?? null,
        models: { classifier: decideModelId() },
        latencyMs: Date.now() - t0,
        ...over,
      });
      return { value, run: r };
    };
    if (!i.available.length && !i.canPass) return { value: null, run: run() };

    const actions = offered(i);
    const people = Object.fromEntries(
      i.people.map((p, n) => [
        `person_${n + 1}`,
        [p.name, p.free ? 'free' : 'busy', p.minutes != null ? `${p.minutes} min walk` : null]
          .filter(Boolean)
          .join(', '),
      ]),
    );
    const ms = Number(process.env.AI_RESPOND_MS ?? 2_500);
    try {
      const d = await decide(
        {
          lead_said: said,
          task: {
            title: i.task.title,
            summary: i.task.summary,
            situation: i.quiet ? 'the volunteer went quiet' : 'the volunteer asked for help',
          },
          ...(i.people.length ? { teammates: people } : {}),
        },
        {
          action: choice('What does the team lead want done about this task?', actions),
          ...(i.people.length
            ? { who: choice('Which teammate does the lead name, if any?', { ...people, nobody: 'Nobody by name' }) }
            : {}),
        },
        { urgent: true, signal: AbortSignal.timeout(ms) },
      );
      console.log(`respond ${d.action.choice} (${d.action.confidence.toFixed(2)}) ${Date.now() - t0} ms`);
      if (d.action.confidence < 0.6) return log(null, { confidence: d.action.confidence });
      const command = toCommand(d.action.choice as Action, said);
      if (command?.kind === 'backup' || command?.kind === 'reassign') {
        const who = 'who' in d ? (d.who as Choice) : null;
        const picked =
          who && who.confidence >= 0.6 ? i.people[Number(who.choice.replace('person_', '')) - 1]?.id : undefined;
        command.volunteerId = picked;
      }
      return log(command, { route: command ? 'ai_resolved' : 'escalated_to_triage', confidence: d.action.confidence });
    } catch (e) {
      console.warn(`respond couldn't read it after ${Date.now() - t0} ms: ${(e as Error).message}`);
      return log(null, { error: String((e as Error).message) });
    }
  }
}

/** The models behind every decision: OPENAI_API_KEY, or SPARK_API_KEY with MODEL_PROVIDER=spark (main.ts checks). */
export const interpreter: Interpreter = new SparkInterpreter();
