import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { CommandError, type Batch } from '@/lib/batch';
import * as C from '@/lib/commands';
import { ReplyKind, TeamSlug, type Task } from '@/lib/schema';
import { interpret } from '../interpret';
import { read, sql, transact, type Loaded } from '../world';
import type { AuthEnv, Caller } from './auth';

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
const Interpretation = z.object({
  heard: Text,
  intent: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('reply'), taskId: Id, reply: ReplyKind }),
    z.object({ kind: z.literal('report') }),
  ]),
});

const STATUS: Record<CommandError['code'], ContentfulStatusCode> = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409 };
const LEADS = new Set(['team_lead', 'coordinator', 'safety_lead', 'admin']);
const isLead = (c: Caller) => c.kind === 'crew' && LEADS.has(c.role);

/** crew: anyone with a profile. lead: team leads and Mo. any: festival-goers too. */
type Who = 'any' | 'crew' | 'lead';

function route<S extends z.ZodType>(name: string, who: Who, schema: S, handle: (args: z.infer<S>, caller: Caller) => Promise<unknown>) {
  commands.post(`/${name}`, async (c) => {
    const caller = c.get('caller');
    if ((who !== 'any' && caller.kind !== 'crew') || (who === 'lead' && !isLead(caller))) return c.json({ error: 'forbidden' }, 403);
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
  if (t.assigneeId !== caller.id && !t.helperIds.includes(caller.id)) throw new CommandError('forbidden', 'Not your task');
}
/** Festival-goers touch only their own requests. */
function mustOwn(w: Loaded, id: string, caller: Caller) {
  if (!w.world.requests[id]) throw new CommandError('not_found', `No request ${id}`);
  if (w.requestOwner[id] !== caller.id) throw new CommandError('forbidden', 'Not your request');
}

// ── volunteers ──

route('reply', 'crew', z.object({ taskId: Id, reply: ReplyKind, note: z.string().trim().max(500).optional() }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => {
    mustBeOn(taskOf(b, a.taskId), caller);
    C.reply(b, caller.id, a.taskId, a.reply, a.note || undefined);
  });
});

route('setDuty', 'crew', z.object({ duty: Duty }), async (a, caller) => {
  await transact({}, (b) => C.setDuty(b, caller.id, a.duty));
});

route('interpret', 'crew', z.object({ text: Text }), (a, caller) =>
  read({}, ({ world }) => interpret(Object.values(world.tasks), caller.id, a.text)));

route('commit', 'crew', z.object({ interpretation: Interpretation }), async ({ interpretation: i }, caller) => {
  const taskIds = i.intent.kind === 'reply' ? [i.intent.taskId] : [];
  return transact({ taskIds }, (b) => {
    if (i.intent.kind === 'reply') mustBeOn(taskOf(b, i.intent.taskId), caller);
    const { confirmation, later } = C.commit(b, caller.id, i);
    // The mock waits to mimic triage; here it has already run.
    if (later) b.send(later.recipientId, 'system', later.body, { taskId: later.taskId });
    return { confirmation };
  }, { reporterId: caller.id });
});

route('markRead', 'any', z.object({ messageIds: z.array(Id).max(500) }), async (a, caller) => {
  if (!a.messageIds.length) return;
  await sql()`
    update message_deliveries set read_at = now()
    where recipient_id = ${caller.id} and message_id = any(${a.messageIds}::uuid[]) and read_at is null`;
});

route('guestReply', 'crew', z.object({ taskId: Id, text: Text }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => {
    const t = taskOf(b, a.taskId);
    if (!isLead(caller)) mustBeOn(t, caller);
    C.guestReply(b, caller.id, a.taskId, a.text);
  });
});

// ── leads and Mo ──

route('respond', 'lead', z.object({ taskId: Id, response: RespondInput }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => C.respond(b, caller.id, a.taskId, a.response));
});

route('passToCoordinator', 'lead', z.object({ taskId: Id }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => C.passToCoordinator(b, caller.id, a.taskId));
});

route('arrived', 'lead', z.object({ taskId: Id }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => C.arrived(b, caller.id, a.taskId));
});

route('assign', 'lead', z.object({ taskId: Id, volunteerId: Id }), async (a, caller) => {
  await transact({ taskIds: [a.taskId] }, (b) => C.assign(b, caller.id, a.taskId, a.volunteerId));
});

route('approve', 'lead', z.object({ proposalId: Id, volunteerId: Id.optional() }), async (a, caller) => {
  await transact({ proposalIds: [a.proposalId] }, (b) => C.approve(b, caller.id, a.proposalId, a.volunteerId));
});

const Scope = z.object({ teamSlug: TeamSlug.optional(), zoneSlug: z.string().optional() });
route('broadcast', 'lead', z.object({ body: Text, scope: Scope.optional() }), async (a, caller) => {
  await transact({}, (b) => C.broadcast(b, caller.id, a.body, a.scope ?? {}));
});

route('sendDirect', 'lead', z.object({ volunteerId: Id, body: Text }), async (a, caller) => {
  await transact({}, (b) => C.sendDirect(b, caller.id, a.volunteerId, a.body));
});

// ── festival-goers ──

/** The AI step runs after the reply, in its own transaction: the phone shows "Understanding" meanwhile. */
function understandLater(requestId: string) {
  setTimeout(() => {
    transact({ requestIds: [requestId] }, (b) => C.understand(b, requestId))
      .catch((e) => console.error(`understand ${requestId} failed`, e));
  }, 0);
}

route('guestAsk', 'any', z.object({ text: Text, zoneSlug: z.string().nullable(), locationHint: z.string().trim().max(200).nullish() }), async (a, caller) => {
  const requestId = await transact({}, (b, w) => {
    if (a.zoneSlug && !w.ids.zones.has(a.zoneSlug)) throw new CommandError('invalid', `No zone ${a.zoneSlug}`);
    return C.guestAsk(b, a.text, a.zoneSlug, a.locationHint || null).id;
  }, { guestId: caller.id });
  understandLater(requestId);
  return { requestId };
});

const RequestArgs = z.object({ requestId: Id });

route('guestRequestHuman', 'any', RequestArgs, async (a, caller) => {
  await transact({ requestIds: [a.requestId] }, (b, w) => {
    mustOwn(w, a.requestId, caller);
    C.guestRequestHuman(b, a.requestId);
  });
});

route('guestAddDetail', 'any', z.object({ requestId: Id, text: Text }), (a, caller) =>
  transact({ requestIds: [a.requestId] }, (b, w) => {
    mustOwn(w, a.requestId, caller);
    return C.guestAddDetail(b, a.requestId, a.text);
  }));

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
});
