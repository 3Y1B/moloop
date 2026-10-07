import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import type { VoiceResponse } from '@/data/repo';
import { CommandError, type Batch } from '@/lib/batch';
import { rankCandidates } from '@/lib/candidates';
import * as C from '@/lib/commands';
import {
  availableResponses,
  HANDOVER_NAME,
  isBusy,
  isQuiet,
  needsResponse,
  type RespondInput as RespondInputType,
} from '@/lib/lifecycle';
import { walkFrom } from '@/lib/presence';
import type { RespondCommand } from '@/lib/ai';
import { routeBetween } from '@/lib/route';
import { Priority, ReplyKind, TeamSlug, type Task, type Volunteer } from '@/lib/schema';
import { interpreter } from '../models/interpreter';
import { judgeReport } from '../retriage';
import { understandLater } from '../understand';
import { summarize } from '../summarize';
import { registerToken, unregisterToken } from '../push';
import { ownClip } from '../voice';
import { read, sql, transact, type Loaded } from '../world';
import type { AuthEnv, Caller } from './auth';
import { assertMobilizationReview, type ReviewRun } from './mobilization-review';

/**
 * One route per Repo command: POST /api/<method>, body = named args, 200 with `{}` or the result.
 * Each loads the world, checks the caller may do it, runs the shared command and writes it in one
 * transaction (../world.ts). Errors are `{ error }` with 400, 403, 404 or 409.
 */
export const commands = new Hono<AuthEnv>();

const Id = z.uuid();
const Text = z.string().trim().min(1).max(2000);
const Duty = z.enum(['on_duty', 'on_break', 'off_shift']);
const RespondInput = z.object({
  kind: z.enum(['backup', 'handover', 'reassign', 'call', 'close', 'carry_on']),
  volunteerId: Id.optional(),
  target: z.enum(['medics', 'security', 'emergency']).optional(),
  etaAt: z.number().int().positive().optional(),
  note: z.string().trim().max(500).optional(),
});
/** Voice clips from /api/transcribe, one per hold. */
const Clips = z.array(z.string().max(200)).max(10).optional();
const Interpretation = z.object({
  heard: Text,
  clips: Clips,
  intent: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('reply'), taskId: Id, reply: ReplyKind }),
    z.object({ kind: z.literal('tell_guest'), taskId: Id, text: Text }),
    z.object({ kind: z.literal('report') }),
  ]),
});

const STATUS: Record<CommandError['code'], ContentfulStatusCode> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};
const LEADS = new Set(['team_lead', 'coordinator', 'safety_lead', 'admin']);
const isLead = (c: Caller) => c.kind === 'crew' && LEADS.has(c.role);

/** crew: anyone with a profile. lead: team leads and Mo. any: festival-goers too. */
const isMo = (c: Caller) => c.kind === 'crew' && ['coordinator', 'safety_lead', 'admin'].includes(c.role);
type Who = 'any' | 'crew' | 'lead' | 'mo';

function route<S extends z.ZodType>(
  name: string,
  who: Who,
  schema: S,
  handle: (args: z.infer<S>, caller: Caller) => Promise<unknown>,
) {
  commands.post(`/${name}`, async (c) => {
    const caller = c.get('caller');
    if (
      (who !== 'any' && caller.kind !== 'crew') ||
      (who === 'lead' && !isLead(caller)) ||
      (who === 'mo' && !isMo(caller))
    )
      return c.json({ error: 'forbidden' }, 403);
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: `invalid body: ${z.prettifyError(parsed.error)}` }, 400);
    try {
      return c.json((await handle(parsed.data, caller)) ?? {});
    } catch (e) {
      if (e instanceof CommandError) return c.json({ error: e.message }, STATUS[e.code]);
      console.error(`/api/${name} failed`, e);
      return c.json({ error: 'internal' }, 500);
    }
  });
}

// ── guards, inside the transaction ──

function taskOf(b: Batch, id: string): Task {
  const t = b.tasks[id];
  if (!t) throw new CommandError('not_found', `No task ${id}`);
  return t;
}
/** Volunteers act only on tasks they're on, as owner or backup. */
function mustBeOn(t: Task, caller: Caller) {
  if (t.assigneeId !== caller.id && !t.helpers.some((h) => h.volunteerId === caller.id))
    throw new CommandError('forbidden', 'Not your task');
}
/** Only your own clips go on what you report. */
function ownClips(clips: string[] | undefined, caller: Caller) {
  if (clips?.some((p) => !ownClip(caller.id, p))) throw new CommandError('forbidden', 'Not your clip');
  return clips;
}
/** Festival-goers touch only their own requests. */
function mustOwn(w: Loaded, id: string, caller: Caller) {
  if (!w.world.requests[id]) throw new CommandError('not_found', `No request ${id}`);
  if (w.requestOwner[id] !== caller.id) throw new CommandError('forbidden', 'Not your request');
}

// ── volunteers ──

route(
  'reply',
  'crew',
  z.object({ taskId: Id, reply: ReplyKind, note: z.string().trim().max(500).optional() }),
  async (a, caller) => {
    await transact({ taskIds: [a.taskId] }, (b) => {
      mustBeOn(taskOf(b, a.taskId), caller);
      C.reply(b, caller.id, a.taskId, a.reply, a.note || undefined);
    });
  },
);

route('setDuty', 'crew', z.object({ duty: Duty }), async (a, caller) => {
  await transact({}, (b) => C.setDuty(b, caller.id, a.duty));
});

route('interpret', 'crew', z.object({ text: Text }), async (a, caller) =>
  interpreter.interpret({
    tasks: Object.values((await read({}, ({ world }) => world)).tasks),
    meId: caller.id,
    text: a.text,
  }),
);

route('commit', 'crew', z.object({ interpretation: Interpretation }), async ({ interpretation: i }, caller) => {
  const taskIds = i.intent.kind === 'report' ? [] : [i.intent.taskId];
  const clips = ownClips(i.clips, caller);
  // A new report is judged before the lock is taken: the models take seconds.
  const { judged, matched } =
    i.intent.kind === 'report'
      ? await judgeReport(caller.id, caller.kind === 'crew' ? caller.role : 'volunteer', i.heard)
      : { judged: undefined, matched: undefined };
  return transact(
    { taskIds: matched?.value ? [...taskIds, matched.value.taskId] : taskIds },
    (b) => {
      if (i.intent.kind !== 'report') mustBeOn(taskOf(b, i.intent.taskId), caller);
      const { confirmation, later } = C.commit(b, caller.id, i, judged?.value, matched?.value);
      // Triage has already run. It answers the caller's own report while they're in the app: no push.
      if (later) b.send(later.recipientId, 'system', later.body, { taskId: later.taskId, quiet: true });
      return { confirmation };
    },
    {
      reporterId: caller.id,
      clips,
      run: matched?.value ? { ...matched.run, taskId: matched.value.taskId } : judged?.run,
    },
  );
});

route('markRead', 'any', z.object({ messageIds: z.array(Id).max(500) }), async (a, caller) => {
  if (!a.messageIds.length) return;
  await sql()`
    update message_deliveries set read_at = now()
    where recipient_id = ${caller.id} and message_id = any(${a.messageIds}::uuid[]) and read_at is null`;
});

// ── push (../push.ts) ──

/** Expo push tokens, e.g. ExponentPushToken[…]. */
const PushToken = z.string().trim().min(1).max(300);

// Anyone signed in, festival-goers too. Upserts: a token another account had moves to the caller (a shared phone).
route('registerPush', 'any', z.object({ token: PushToken, platform: z.enum(['ios', 'android']) }), async (a, caller) => {
  await registerToken(caller.id, a.token, a.platform);
});

// On sign-out. Only the caller's own token goes.
route('unregisterPush', 'any', z.object({ token: PushToken }), async (a, caller) => {
  await unregisterToken(caller.id, a.token);
});

route('guestReply', 'crew', z.object({ taskId: Id, text: Text }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => {
    const t = taskOf(b, a.taskId);
    if (!isLead(caller)) mustBeOn(t, caller);
    C.guestReply(b, caller.id, a.taskId, a.text);
  });
});

// ── leads and Mo ──

route('messageCrew', 'lead', z.object({ taskId: Id, text: Text }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => C.messageCrew(b, caller.id, a.taskId, a.text));
});

route('respond', 'lead', z.object({ taskId: Id, response: RespondInput }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => C.respond(b, caller.id, a.taskId, a.response));
});

/** "Pass to Mo" fits: a team lead's own "need help" that hasn't gone up yet. */
const canPassUp = (t: Task, caller: Caller) =>
  caller.kind === 'crew' && caller.role === 'team_lead' && needsResponse(t) && t.escalation?.level === 'lead';

const firstName = (v: Volunteer | undefined) => v?.name.split(' ')[0] ?? 'them';

/**
 * Hold on the Respond screen: the AI reads what the lead said as one of the responses that fit, and it's done
 * straight away, the same command the buttons send. What needs the screen comes back as a step to open: the picker
 * when nobody was named, and 000, which the lead always holds to confirm there; nothing here dials or marks it called.
 */
route('respondByVoice', 'lead', z.object({ taskId: Id, text: Text }), async (a, caller): Promise<VoiceResponse> => {
  // Read before the model is asked: it takes a second or two.
  const { task, people } = await read({ taskIds: [a.taskId] }, ({ world }) => {
    const t = world.tasks[a.taskId];
    if (!t) throw new CommandError('not_found', `No task ${a.taskId}`);
    const all = Object.values(world.tasks);
    const now = Date.now();
    const ranked = rankCandidates(t, Object.values(world.volunteers), all, {
      limit: 20,
      positions: world.positions,
      now,
    });
    return {
      task: t,
      people: ranked.flatMap(({ volunteerId }) => {
        const v = world.volunteers[volunteerId];
        if (!v) return [];
        const walk = routeBetween(walkFrom(world.positions, v.id, v.zoneSlug, now), t.zoneSlug);
        return [
          {
            id: v.id,
            name: v.name,
            free: !isBusy(all, v.id),
            ...(walk ? { minutes: Math.max(1, Math.round(walk.minutes)) } : {}),
          },
        ];
      }),
    };
  });
  const { value: command } = await interpreter.respond({
    task,
    text: a.text,
    available: availableResponses(task),
    canPass: canPassUp(task, caller),
    people,
    quiet: isQuiet(task),
  });
  if (!command) return { done: false };
  if (command.kind === 'handover' && command.target === 'emergency') return { done: false, open: '000' };
  if ((command.kind === 'backup' || command.kind === 'reassign') && !command.volunteerId)
    return { done: false, open: command.kind };

  const confirmation = await transact({ taskIds: [a.taskId] }, (b) => {
    const t = taskOf(b, a.taskId);
    if (command.kind === 'pass') {
      // It may have changed while the model read it.
      if (!canPassUp(t, caller)) throw new CommandError('conflict', `Cannot pass task ${a.taskId} to Mo`);
      C.passToCoordinator(b, caller.id, a.taskId);
    } else if (command.kind === 'message') {
      if (command.to === 'guest') C.guestReply(b, caller.id, a.taskId, command.text);
      else C.messageCrew(b, caller.id, a.taskId, command.text);
    } else {
      C.respond(b, caller.id, a.taskId, inputOf(command));
    }
    return confirmationOf(command, b.volunteers, t);
  });
  return { done: true, kind: command.kind, confirmation };
});

function inputOf(c: Exclude<RespondCommand, { kind: 'pass' | 'message' }>): RespondInputType {
  switch (c.kind) {
    case 'backup':
    case 'reassign':
      return { kind: c.kind, volunteerId: c.volunteerId };
    case 'handover':
      return { kind: c.kind, target: c.target };
    case 'close':
      return { kind: c.kind, note: c.note };
    case 'call':
    case 'carry_on':
      return { kind: c.kind };
  }
}

/** What the screen flashes once it's done. */
function confirmationOf(c: RespondCommand, volunteers: Record<string, Volunteer>, t: Task): string {
  const owner = t.assigneeId ? volunteers[t.assigneeId] : undefined;
  switch (c.kind) {
    case 'backup':
      return `Sent ${firstName(volunteers[c.volunteerId ?? ''])}`;
    case 'reassign':
      return `Moved to ${firstName(volunteers[c.volunteerId ?? ''])}`;
    case 'handover':
      return `Handing to ${HANDOVER_NAME[c.target]}`;
    case 'call':
      return `Calling ${firstName(owner)}`;
    case 'close':
      return 'Closed';
    case 'carry_on':
      return isQuiet(t) ? 'They’re fine' : 'Carry on';
    case 'pass':
      return 'Passed to Mo';
    case 'message':
      return c.to === 'guest' ? 'Sent to the festival-goer' : `Sent to ${firstName(owner)}`;
  }
}

route('passToCoordinator', 'lead', z.object({ taskId: Id }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => C.passToCoordinator(b, caller.id, a.taskId));
});

route('arrived', 'lead', z.object({ taskId: Id }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => C.arrived(b, caller.id, a.taskId));
});

route(
  'assign',
  'lead',
  z.object({ taskId: Id, volunteerId: Id, helperIds: z.array(Id).max(8).optional() }),
  async (a, caller) => {
    await transact({ taskIds: [a.taskId] }, (b) =>
      C.assign(b, caller.id, a.taskId, a.volunteerId, 'assigned', a.helperIds),
    );
  },
);

route(
  'approve',
  'lead',
  z.object({ proposalId: Id, volunteerId: Id.optional(), helperIds: z.array(Id).max(8).optional() }),
  async (a, caller) => {
    await transact({ proposalIds: [a.proposalId] }, (b) =>
      C.approve(b, caller.id, a.proposalId, a.volunteerId, a.helperIds),
    );
  },
);

const Scope = z.object({ teamSlug: TeamSlug.optional(), zoneSlug: z.string().optional() });
route('broadcast', 'lead', z.object({ body: Text, scope: Scope.optional() }), async (a, caller) => {
  await transact({}, (b) => C.broadcast(b, caller.id, a.body, a.scope ?? {}));
});

route('sendDirect', 'lead', z.object({ volunteerId: Id, body: Text }), async (a, caller) => {
  await transact({}, (b) => C.sendDirect(b, caller.id, a.volunteerId, a.body));
});

// ── mobilizations ──
// `proposeMobilization` has no route: only the planner (src/server/predict/plan.ts), started by a trigger, proposes.

const MobilizationStepInput = z.object({
  teamSlug: TeamSlug,
  peopleNeeded: z.number().int().positive().max(10),
  reason: Text,
});

route(
  'createMobilization',
  'mo',
  z.object({
    title: Text,
    rationale: Text,
    urgency: Priority,
    zoneSlug: z.string().nullable(),
    playbookSlug: z.string().optional(),
    steps: z.array(MobilizationStepInput).min(1),
  }),
  async (a, caller) => {
    const { mobilization } = await transact({}, (b) => C.createMobilization(b, caller.id, a));
    return { mobilizationId: mobilization.id };
  },
);

route(
  'approveMobilization',
  'mo',
  z.object({
    mobilizationId: Id,
    reviewedRunId: Id.optional(),
  }),
  async (a, caller) => {
    await transact(
      { mobilizationIds: [a.mobilizationId] },
      (b) => {
        const proposal = b.mobilizations[a.mobilizationId];
        const result = C.approveMobilization(b, caller.id, a.mobilizationId);
        return { proposal, ...result };
      },
      {},
      async (tx, { proposal }, b) => {
        const rows = proposal.analysisRunId
          ? await tx<ReviewRun[]>`
      select id, status, result, input_snapshot, validation_errors, mobilization_ids
      from mobilization_runs where id = ${proposal.analysisRunId} for share`
          : [];
        assertMobilizationReview(proposal, rows[0] ?? null, a);
        if (proposal.analysisRunId)
          await tx`
      update mobilization_runs set raw_responses = raw_responses || ${tx.json([
        {
          event: 'approval_review',
          mobilizationId: proposal.id,
          reviewedRunId: a.reviewedRunId,
          reviewedBy: caller.id,
          occurredAt: new Date(b.now).toISOString(),
        },
      ])}::jsonb where id = ${proposal.analysisRunId}`;
      },
    );
  },
);

route('rejectMobilization', 'mo', z.object({ mobilizationId: Id }), async (a, caller) => {
  await transact({ mobilizationIds: [a.mobilizationId] }, (b) => C.rejectMobilization(b, caller.id, a.mobilizationId));
});

route(
  'standDown',
  'mo',
  z.object({ mobilizationId: Id, outcome: z.enum(['stood_down', 'cancelled']) }),
  async (a, caller) => {
    await transact({ mobilizationIds: [a.mobilizationId] }, (b) =>
      C.standDown(b, caller.id, a.mobilizationId, a.outcome),
    );
  },
);

// ── festival-goers ──

route(
  'guestAsk',
  'any',
  z.object({
    text: Text,
    zoneSlug: z.string().nullable(),
    locationHint: z.string().trim().max(200).nullish(),
    clips: Clips,
  }),
  async (a, caller) => {
    const clips = ownClips(a.clips, caller);
    const requestId = await transact(
      {},
      (b, w) => {
        if (a.zoneSlug && !w.ids.zones.has(a.zoneSlug)) throw new CommandError('invalid', `No zone ${a.zoneSlug}`);
        return C.guestAsk(b, a.text, a.zoneSlug, a.locationHint || null).id;
      },
      { guestId: caller.id, clips },
    );
    understandLater(requestId);
    return { requestId };
  },
);

const RequestArgs = z.object({ requestId: Id });

/** The request and its task, read before the model is asked, and only for the festival-goer it belongs to. */
async function ownRequest(requestId: string, caller: Caller) {
  return read({ requestIds: [requestId] }, (w) => {
    mustOwn(w, requestId, caller);
    const request = w.world.requests[requestId];
    return { request, task: request.taskId ? w.world.tasks[request.taskId] : undefined };
  });
}

/** Added detail on a request with a task: a note for whoever's on it, or a priority bump. */
async function addDetail(a: { requestId: string; text: string }, caller: Caller) {
  const { request, task } = await ownRequest(a.requestId, caller);
  const open = !!task && !['resolved', 'cancelled'].includes(task.status);
  const judged = await interpreter.detail({
    text: a.text,
    before: task?.summary ?? request.heard,
    open,
    zoneSlug: request.zoneSlug,
    locationHint: request.locationHint,
    from: { kind: 'festivalgoer' },
  });
  return transact(
    { requestIds: [a.requestId] },
    (b, w) => {
      mustOwn(w, a.requestId, caller);
      return C.guestAddDetail(b, a.requestId, a.text, judged.value);
    },
    { run: { ...judged.run, requestId: a.requestId } },
  );
}

// "Problem solved?" No (no text), or what they add before anyone's sent: the AI reads the conversation again.
route('guestFollowUp', 'any', z.object({ requestId: Id, text: Text.optional() }), async (a, caller) => {
  const { request } = await ownRequest(a.requestId, caller);
  // Someone was sent meanwhile: what they add is detail for them.
  if (request.taskId && a.text) {
    await addDetail({ requestId: a.requestId, text: a.text }, caller);
    return;
  }
  await transact({ requestIds: [a.requestId] }, (b, w) => {
    mustOwn(w, a.requestId, caller);
    C.guestFollowUp(b, a.requestId, a.text);
  });
  understandLater(a.requestId);
});

route('guestSolved', 'any', RequestArgs, async (a, caller) => {
  await transact({ requestIds: [a.requestId] }, (b, w) => {
    mustOwn(w, a.requestId, caller);
    C.guestSolved(b, a.requestId);
  });
});

route('guestAddDetail', 'any', z.object({ requestId: Id, text: Text }), (a, caller) => addDetail(a, caller));

route('guestCancel', 'any', RequestArgs, async (a, caller) => {
  await transact({ requestIds: [a.requestId] }, (b, w) => {
    mustOwn(w, a.requestId, caller);
    C.guestCancel(b, a.requestId);
  });
});

route('guestReopen', 'any', RequestArgs, async (a, caller) => {
  await transact({ requestIds: [a.requestId] }, (b, w) => {
    mustOwn(w, a.requestId, caller);
    C.guestReopen(b, a.requestId);
  });
  // Sorted by an AI answer goes back to the AI; a no-op for one with a task.
  understandLater(a.requestId);
});

// ── Mo ──

/** A short AI summary of the shift or one task. The server reads the world itself; the body only says which. */
const SummaryScope = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('shift') }),
  z.object({ scope: z.literal('task'), taskId: Id }),
]);
route('summarize', 'lead', SummaryScope, (a) => summarize(a));
