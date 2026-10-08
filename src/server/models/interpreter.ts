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
import { availableHelperReplies, isActive } from '@/lib/lifecycle';
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
  type AnswerArgs,
} from './intake-tools';
import { venueFacts, zones, type Zone } from './venue';

/**
 * Reads what people say and decides what to do with it: answer a routine question, or let the intake agent pick a team
 * and priority and create a task or escalate it to a lead or Mo (its tools, intake-tools.ts), tell if added detail is
 * worse, tell a reply from a new report. Only the models decide: nothing reads keywords.
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
  /** Where a report goes and how urgent it is. */
  triage(i: Heard): Promise<Judged<Triage>>;
  /** Added detail on an open task: is it worse? On a closed one: triage the whole account instead. */
  detail(i: Heard & { before: string; open: boolean }): Promise<Judged<DetailRead & { triage?: Triage }>>;
  /** A new report against open tasks nearby: the one it's about, read again with what's new, or null for a new incident. */
  match(i: Heard & { candidates: Task[] }): Promise<Judged<Match>>;
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

/**
 * "Tell her I'm two minutes away" → "I'm two minutes away": a volunteer or lead speaking straight to the festival-goer
 * or volunteer it's for. As said, if the model fails.
 */
async function spokenTo(text: string, from: 'volunteer' | 'lead' = 'volunteer', to: 'guest' | 'crew' = 'guest'): Promise<string> {
  const speaker = from === 'lead' ? 'team lead' : 'volunteer';
  const listener = to === 'guest' ? 'the festival-goer they are helping' : 'the volunteer working the task';
  try {
    const { message } = await generate(
      {
        system:
          `A festival ${speaker} said this for ${listener}. Rewrite it as the ${speaker} speaking to them directly: ` +
          'drop "tell her/them", keep every fact, same language, one or two short sentences.',
        prompt: text,
        schema: z.object({ message: z.string().min(1).max(300) }),
      },
      { signal: AbortSignal.timeout(Number(process.env.AI_TELL_MS ?? 2_000)) },
    );
    return message.trim();
  } catch (e) {
    console.warn(`spokenTo sent it as said: ${(e as Error).message}`);
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
  'asking for help (even only "help"), for a person, or describing new trouble, does.';

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
  tell_volunteer:
    'A message for the volunteer on the task: what to do, who is coming, how long ("tell her medics are two minutes out", "stay with him")',
  tell_guest:
    'A message for the festival-goer who asked for help ("tell them someone is on the way", "ask them to wait by the gate")',
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
    case 'tell_volunteer':
      return { kind: 'message', to: 'crew', text: said.trim() };
    case 'tell_guest':
      return { kind: 'message', to: 'guest', text: said.trim() };
    case 'unclear':
      return null;
  }
};

/** The actions that fit right now. */
function offered({ task, available, canPass }: Pick<RespondHeard, 'task' | 'available' | 'canPass'>): Partial<Record<Action, string>> {
  const can = (k: EscalationResponseKind) => available.includes(k);
  const keep: Action[] = [
    ...(['backup', 'reassign', 'call', 'close', 'carry_on'] as const).filter(can),
    ...(can('handover') ? (['handover_medics', 'handover_security', 'handover_emergency'] as const) : []),
    ...(canPass ? (['pass'] as const) : []),
    ...(task.assigneeId && isActive(task) ? (['tell_volunteer'] as const) : []),
    ...(task.requestId ? (['tell_guest'] as const) : []),
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
 * The classifier's one job, the gate: can a festival-goer's message be settled with nobody sent? It sees who sent it,
 * where from and what's on site: without them, "i need water" was a coin flip. Team and priority are the intake
 * agent's, which has far more to go on.
 */
export function classify(i: Heard, zs: Zone[], o: CallOptions = {}) {
  const where = whereFrom(i, zs);
  return decide(
    {
      message: i.text,
      ...(where && { location: where }),
      ...(i.from && { sent_by: describe(i.from) }),
      venue_facts: venueFacts(zs),
    },
    { routine: noul(ROUTINE) },
    o,
  );
}
type Classified = Awaited<ReturnType<typeof classify>>;

/**
 * How sure the classifier must be that nobody needs sending before it answers on its own. Below it, the agent
 * decides, and may still answer. scripts/eval-gate.ts (336 cases, gpt-6-luna): nothing that needs a person scores
 * above 0.49 ("it's too crowded at the front"), so 0.8 keeps a wide margin and still passes 87% of routine ones.
 * Without "even only \"help\"" in ROUTINE, "hello? help" scored 0.99.
 */
export const ROUTINE_AT = 0.8;

/** Nobody needs sending. */
const isRoutine = (d: Classified) => d.routine.noul >= ROUTINE_AT;

/** The gate's read of a festival-goer's message, already asked: its reading, or why there isn't one. */
type Gate = { read: Classified | null; error: string | null };

/**
 * The intake agent picks a tool (create_task or escalate), the team and the priority, and writes the account. A
 * festival-goer's message comes with its `gate` (the classifier's read, already asked), and the agent may answer it
 * after all (answer_question). If the agent fails, it's unread (src/lib/ai.ts): a lead decides, at least P2. An
 * escalation is never dropped, except one back to its own sender.
 */
async function assess(i: Heard, zs: Zone[], o: CallOptions, gate?: Gate) {
  const t0 = Date.now();
  const guest = !!gate;
  let c: Awaited<ReturnType<typeof callTool>> | null = null;
  const errors = gate?.error ? [gate.error] : [];
  try {
    c = await callTool({ system: INTAKE_SYSTEM(zs, guest), prompt: prompted(i, zs), tools: intakeTools(guest) }, o);
  } catch (e) {
    errors.push(String((e as Error)?.message ?? e));
  }

  const none = unread(i.text, i.zoneSlug, i.locationHint);
  // create_task's arguments are escalate's without level and reason. answer_question routes nothing.
  const agent =
    c?.tool === 'create_task' || c?.tool === 'escalate'
      ? (c.args as z.infer<typeof CreateTaskArgs> & Partial<z.infer<typeof EscalateArgs>>)
      : null;
  // The agent overrules the gate's "someone is needed".
  const replied = c?.tool === 'answer_question' ? (c.args as z.infer<typeof AnswerArgs>) : null;
  const answer = replied?.answer.trim() || null;

  // Priority is the agent's alone. The classifier's, a step up whenever it was unsure, made most reports P1 or P2.
  const priority: Priority = agent?.priority ?? none.priority;
  const team = agent?.team ?? none.team;
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
    confidence: gate?.read?.routine.noul ?? null,
    team: { team, confidence: null, alternates: [], tool: c?.tool ?? null, escalate: triage.escalate },
    priority: agent ? { priority, confidence: null, signals: [] } : null,
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
    models: { agent: toolModelId(), ...(gate && { classifier: decideModelId() }) },
    latencyMs: Date.now() - t0,
    error: errors.length ? errors.join('; ') : null,
  });
  return { triage, answer, run: log };
}

const OPTS: CallOptions = {};

type Choice = { choice: string; confidence: number; probabilities: Record<string, number> };

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
    const gate: Gate = await classify(i, zs, OPTS).then(
      (read) => ({ read, error: null }),
      (e) => ({ read: null, error: String((e as Error)?.message ?? e) }),
    );
    const d = gate.read;
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
              team: null,
              priority: { priority: 'P3', confidence: null, signals: [] },
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

  async triage(i: Heard) {
    const { triage, run } = await assess(i, await zones(), OPTS);
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
  async match({ candidates, ...i }: Heard & { candidates: Task[] }): Promise<Judged<Match>> {
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
        OPTS,
      );
      const task = candidates[Number(d.about.choice.replace('task_', '')) - 1];
      // Merging two incidents hides one of them: only a sure answer joins a task.
      if (!task || d.about.confidence < 0.6) return { value: null, run: log({ confidence: d.about.confidence }) };
      const value: Match = {
        taskId: task.id,
        read: { priority: d.priority.choice as Priority, resolved: d.sorted.noul >= 0.5 },
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
        { signal: AbortSignal.timeout(ms) },
      );
      console.log(`interpret ${kind.choice} (${kind.confidence.toFixed(2)}) ${Date.now() - t0} ms`);
      if (kind.confidence < 0.6) return report;
      // Any length: it goes to them as said.
      if ((kind.choice as string) === 'tell_guest' && active.requestId) {
        return { heard, intent: { kind: 'tell_guest', taskId: active.id, text: await spokenTo(heard) } };
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
    const actions = offered(i);
    if (Object.keys(actions).length === 1) return { value: null, run: run() };

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
        { signal: AbortSignal.timeout(ms) },
      );
      console.log(`respond ${d.action.choice} (${d.action.confidence.toFixed(2)}) ${Date.now() - t0} ms`);
      if (d.action.confidence < 0.6) return log(null, { confidence: d.action.confidence });
      const command = toCommand(d.action.choice as Action, said);
      if (command?.kind === 'message') command.text = await spokenTo(said, 'lead', command.to);
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
