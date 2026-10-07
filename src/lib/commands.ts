import type { DetailRead, Triage, Understood } from '@/lib/ai';
import { AGENT, Batch, CommandError, FESTIVALGOER, SCHEDULER, TRIAGE_AGENT, type Actor } from '@/lib/batch';
import { rankCandidates } from '@/lib/candidates';
import { REPLY_LABEL } from '@/lib/format';
import { heuristicDetail, heuristicPerson, heuristicTriage, heuristicUnderstanding, noteFor, replyIn } from '@/lib/heuristics';
import {
  applyReply, assignOrQueue, handoverArrived, HANDOVER_NAME, isActive, isBusy, isOnTask, needsApproval, nextQueued,
  passUp, POLICY, proposalDue, respondToEscalation, tick, type RespondInput,
} from '@/lib/lifecycle';
import { routeBetween } from '@/lib/route';
import type { Duty, GuestRequest, Priority, Proposal, ReplyKind, Task, TeamSlug, Volunteer } from '@/lib/schema';

/**
 * What every command does, beyond the task state machine in lifecycle.ts: the events it writes, the messages it
 * sends, proposals, queueing, and festival-goer requests. Pure functions over a Batch, shared by MockRepo, the
 * server (src/server/http/commands.ts) and the demo-day simulator. MockRepo was the spec; this is it, moved.
 */

/** A broadcast's audience. Neither set = everyone on duty. */
export type Scope = { teamSlug?: TeamSlug; zoneSlug?: string };

/** What a push-to-talk utterance means (repo.ts Interpretation). */
export type Intent = { kind: 'reply'; taskId: string; reply: ReplyKind } | { kind: 'report' };

const MIN = 60_000;
const BUMP: Record<Priority, Priority> = { P3: 'P2', P2: 'P1', P1: 'P1' };

const first = (v: Volunteer | undefined) => v?.name.split(' ')[0] ?? 'Someone';
/** "Priya S.": what a festival-goer sees. */
const shortName = (v: Volunteer) => {
  const [f, l] = v.name.split(' ');
  return l ? `${f} ${l[0]}.` : f;
};

// ── volunteers ──

export function reply(b: Batch, actorId: string, taskId: string, kind: ReplyKind, note?: string) {
  const task = b.tasks[taskId];
  const me = b.volunteers[actorId];
  const lead = task ? b.leadFor(task.teamSlug) : undefined;
  const mo = b.coordinator();
  if (!task || !me) throw new CommandError('not_found', `No task ${taskId}`);
  const t = applyReply(task, kind, b.now, note, { leadId: lead?.id ?? null, coordinatorId: mo?.id ?? null });
  if (!t) throw new CommandError('conflict', `Cannot ${kind} task ${taskId} in status ${task.status}`);
  if (kind !== 'done' && task.assigneeId !== actorId) throw new CommandError('forbidden', `Only the owner can ${kind} task ${taskId}`);

  b.task(t.task);
  b.ev(taskId, kind === 'done' ? 'resolved' : kind === 'need_help' ? 'escalated' : 'reply', t.text, b.actor(me.id), { reply: kind, note });
  // Stand-in for GPS: finishing a task means you were at its zone.
  if (kind === 'done' && task.zoneSlug) b.volunteer({ ...me, zoneSlug: task.zoneSlug });

  if (kind === 'need_help') {
    const owner = t.task.escalation?.level === 'lead' ? lead : mo;
    b.send(me.id, 'system', `Asked ${owner ? `${first(owner)} ` : ''}for help: ${task.title}.`, { taskId });
    if (owner) b.send(owner.id, 'escalation', `${first(me)} asked for help: ${task.title}.`, { taskId });
  }
  if (kind === 'decline') b.ev(taskId, 'reassigned', 'Back in the pool for reassignment', AGENT);
  // Done from anyone resolves it for everyone on it; each of them pulls their next queued task.
  if (kind === 'done') {
    for (const id of b.onIt(task)) {
      if (id !== me.id) b.send(id, 'system', `${first(me)} marked it done: ${task.title}.`, { taskId });
      freeUp(b, id);
    }
  }
  if (kind === 'decline') freeUp(b, me.id);
}

export function setDuty(b: Batch, volunteerId: string, duty: Duty) {
  const me = b.volunteers[volunteerId];
  if (me) b.volunteer({ ...me, duty });
}

/** The task a volunteer is on right now, as owner or helper. */
export const activeTaskOf = (tasks: Task[], volunteerId: string) => tasks.find((t) => isOnTask(t, volunteerId));

/** Keyword stand-in for the reply classifier: a short reply to the task you're on, or a new report. */
export function interpretHeuristic(tasks: Task[], meId: string | null, text: string): { heard: string; intent: Intent } {
  const heard = text.trim();
  const active = meId ? activeTaskOf(tasks, meId) : undefined;
  const kind = active ? replyIn(heard, active.assigneeId !== meId) : null;
  return { heard, intent: active && kind ? { kind: 'reply', taskId: active.id, reply: kind } : { kind: 'report' } };
}

/** A message to send once triage has had time to run. The mock delays it; the server sends it straight away. */
export type Later = { recipientId: string; body: string; taskId: string };

/** Commit what the volunteer confirmed: a reply to their task, or a new report (triaged by `ai`, or by keywords). */
export function commit(b: Batch, actorId: string, i: { heard: string; intent: Intent }, ai?: Triage): { confirmation: string; later?: Later } {
  if (i.intent.kind === 'reply') {
    reply(b, actorId, i.intent.taskId, i.intent.reply, noteFor(i.intent.reply, i.heard));
    return { confirmation: `Sent “${REPLY_LABEL[i.intent.reply]}”` };
  }
  return fileReport(b, actorId, i.heard, ai);
}

/** A volunteer's own report: triage, then straight to a teammate (or queued behind their current task). */
export function fileReport(b: Batch, reporterId: string, text: string, ai?: Triage): { confirmation: string; later?: Later } {
  const me = b.volunteers[reporterId];
  const t = ai ?? heuristicTriage(text);
  const { team, priority } = t;
  const tasks = b.all();
  const candidates = Object.values(b.volunteers).filter(
    (v) => v.teamSlug === team && v.role === 'volunteer' && v.duty === 'on_duty' && v.id !== me?.id,
  );
  const free = candidates.find((v) => !isBusy(tasks, v.id));
  const who = free ?? candidates[0];
  const draft: Task = {
    id: b.id('task'), title: t.title, summary: t.summary, category: t.category, priority, teamSlug: team,
    // Where they said it's happening, else where they are.
    zoneSlug: t.zoneSlug ?? me?.zoneSlug ?? null, locationHint: t.locationHint, status: 'open', assigneeId: null, handledBy: 'human',
    reporter: { kind: 'volunteer', name: me?.name, quote: text, language: t.language },
    createdAt: b.now, assignedAt: null, etaAt: null, lastActivityAt: b.now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null,
    escalation: null, helperIds: [], resolution: null, requestId: null,
  };
  b.ev(draft.id, 'created', 'Reported by voice', me ? b.actor(me.id) : { kind: 'human' });
  if (who) place(b, draft, who.id, AGENT, undefined);
  else b.task(draft);
  // Triage + assignment run after Send, so the reporter hears back via Inbox, not inline.
  const teamName = b.teams[team]?.name ?? team;
  const body = who
    ? `Your report “${draft.title}” went to ${teamName}. ${first(who)} ${free ? 'is on it' : 'has it next'}.`
    : `Your report “${draft.title}” is with ${teamName}. A lead will pick it up.`;
  return { confirmation: 'Report sent', later: me ? { recipientId: me.id, body, taskId: draft.id } : undefined };
}

/** Volunteer → festival-goer, on a task that came from a request. */
export function guestReply(b: Batch, staffId: string, taskId: string, text: string) {
  const me = b.volunteers[staffId];
  const task = b.tasks[taskId];
  if (!task) throw new CommandError('not_found', `No task ${taskId}`);
  const request = task.requestId ? b.requests[task.requestId] : undefined;
  if (!me || !request) throw new CommandError('conflict', `Task ${taskId} has no festival-goer to reply to`);
  b.request({ ...request, thread: [...request.thread, { from: 'staff', name: shortName(me), text, at: b.now }] });
  b.ev(taskId, 'note', 'Replied to the festival-goer', b.actor(me.id), { note: text });
}

// ── leads and Mo ──

/** Respond to "need help" or "went quiet": backup, handover, reassign, call, close, carry on. */
export function respond(b: Batch, byId: string, taskId: string, input: RespondInput) {
  const task = b.tasks[taskId];
  const by = b.volunteers[byId];
  if (!task || !by) throw new CommandError('not_found', `Cannot respond to task ${taskId}`);
  const target = input.volunteerId ? b.volunteers[input.volunteerId] : undefined;
  if (input.volunteerId && !target) throw new CommandError('invalid', `No volunteer ${input.volunteerId}`);
  const t = respondToEscalation(
    task, { ...input, etaAt: input.etaAt ?? responseEta(b, task, input) }, byId, b.now,
    input.kind === 'reassign' && !!target && isBusy(b.all(), target.id),
  );
  if (!t) throw new CommandError('conflict', `Cannot ${input.kind} task ${taskId} in status ${task.status}`);

  b.task(t.task);
  const owner = task.assigneeId ? b.volunteers[task.assigneeId] : undefined;
  const actor = b.actor(byId);
  const note = input.note ? { note: input.note } : {};

  switch (input.kind) {
    case 'backup':
      b.ev(taskId, 'responded', `${by.name} sent ${target?.name ?? 'backup'}`, actor, note);
      if (target) b.send(target.id, 'backup', `Help ${first(owner)}: ${task.title}.`, { taskId, delivery: 'spoken' });
      if (owner) b.send(owner.id, 'backup', `${first(target)} is joining you.`, { taskId });
      break;
    case 'handover': {
      const name = HANDOVER_NAME[input.target!];
      b.ev(taskId, 'responded', `${by.name} handed over to ${name}`, actor, note);
      if (owner) b.send(owner.id, 'system', `${name[0].toUpperCase()}${name.slice(1)} on the way: ${task.title}.`, { taskId });
      break;
    }
    case 'reassign': {
      const queued = t.task.status === 'queued';
      b.ev(taskId, 'reassigned', `${by.name} moved it to ${target?.name}`, actor, note);
      b.ev(taskId, queued ? 'queued' : 'assigned', `${queued ? 'Queued for' : 'Assigned to'} ${target?.name}`, actor);
      if (target) {
        b.send(target.id, 'task', queued ? `New task queued: ${task.title}. Check the app.` : `New task: ${task.title}. ${task.summary}`, { taskId, delivery: queued ? 'ping' : 'spoken' });
      }
      for (const id of b.onIt(task).filter((x) => x !== target?.id)) {
        b.send(id, 'moved', `Moved to ${first(target)}: ${task.title}.`, { taskId });
        freeUp(b, id);
      }
      break;
    }
    case 'call':
      b.ev(taskId, 'responded', `${by.name} called ${owner?.name ?? 'the volunteer'}`, actor, note);
      break;
    case 'close':
      b.ev(taskId, 'resolved', `Closed by ${by.name}`, actor, note);
      for (const id of b.onIt(task)) {
        b.send(id, 'closed', `Closed by ${first(by)}: ${task.title}.`, { taskId });
        freeUp(b, id);
      }
      break;
    case 'carry_on':
      b.ev(taskId, 'responded', `${by.name}: carry on`, actor, note);
      break;
  }
}

/** Walking time for backup or medics, so screens can say "~3 min". */
function responseEta(b: Batch, task: Task, input: RespondInput): number | undefined {
  const from = input.kind === 'backup' ? b.volunteers[input.volunteerId ?? '']?.zoneSlug ?? null
    : input.kind === 'handover' && input.target === 'medics' ? 'first-aid-hq'
      : null;
  const walk = from ? routeBetween(from, task.zoneSlug) : null;
  return walk ? b.now + Math.max(1, walk.minutes) * MIN : undefined;
}

/** "Pass to Mo" by hand. */
export function passToCoordinator(b: Batch, byId: string, taskId: string) {
  const task = b.tasks[taskId];
  const me = b.volunteers[byId];
  const mo = b.coordinator();
  if (!task || !me) throw new CommandError('not_found', `No task ${taskId}`);
  const t = passUp(task, mo?.id ?? null, b.now);
  if (!t) throw new CommandError('conflict', `Cannot pass task ${taskId} to Mo`);
  b.task(t.task);
  b.ev(taskId, 'bumped', `${me.name} passed it to Mo`, b.actor(me.id));
  if (mo) b.send(mo.id, 'escalation', `${first(me)} passed on: ${task.title}.`, { taskId });
}

/** After a handover: they've arrived, the volunteer is freed and the task resolves as handed over. */
export function arrived(b: Batch, byId: string, taskId: string) {
  const task = b.tasks[taskId];
  const me = b.volunteers[byId];
  if (!task || !me) throw new CommandError('not_found', `No task ${taskId}`);
  const t = handoverArrived(task, b.now);
  if (!t) throw new CommandError('conflict', `Task ${taskId} is not waiting on a handover`);
  b.task(t.task);
  b.ev(taskId, 'resolved', t.text, b.actor(me.id));
  for (const id of b.onIt(task)) {
    b.send(id, 'arrived', `${t.text}: ${task.title}. You’re free.`, { taskId });
    freeUp(b, id);
  }
}

/** Give a task to someone (unassigned, queued, or moving it). Settles a pending proposal for it. */
export function assign(b: Batch, byId: string, taskId: string, volunteerId: string, how: 'assigned' | 'approved' = 'assigned') {
  const task = b.tasks[taskId];
  const by = b.volunteers[byId];
  const target = b.volunteers[volunteerId];
  if (!task || !by) throw new CommandError('not_found', `No task ${taskId}`);
  if (!target) throw new CommandError('invalid', `No volunteer ${volunteerId}`);
  if (task.status === 'resolved' || task.status === 'cancelled') throw new CommandError('conflict', `Cannot assign task ${taskId}`);
  const queuedFor = task.status === 'queued' && task.assigneeId ? [task.assigneeId] : [];
  const prev = [...b.onIt(task), ...queuedFor].filter((id) => id !== volunteerId);
  const fresh: Task = {
    ...task, status: 'open', assigneeId: null, helperIds: [], escalation: null, etaAt: null,
    nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, lastActivityAt: b.now,
  };
  place(b, fresh, volunteerId, b.actor(byId), `${how === 'approved' ? 'Approved' : 'Assigned'} by ${by.name}`);
  settleProposal(b, taskId, 'approved', volunteerId, byId);
  for (const id of prev) {
    b.send(id, 'moved', `Moved to ${first(target)}: ${task.title}.`, { taskId });
    freeUp(b, id);
  }
}

/** Approve the AI's proposal: its top pick, or `volunteerId` instead. */
export function approve(b: Batch, byId: string, proposalId: string, volunteerId?: string) {
  const p = b.proposals[proposalId];
  if (!p) throw new CommandError('not_found', `No proposal ${proposalId}`);
  const pick = volunteerId ?? p.candidates[0]?.volunteerId;
  if (p.status !== 'pending' || !pick) throw new CommandError('conflict', `Cannot approve proposal ${proposalId}`);
  assign(b, byId, p.taskId, pick, 'approved');
}

export function broadcast(b: Batch, byId: string, body: string, scope: Scope = {}) {
  const by = b.volunteers[byId];
  if (!by) return;
  for (const v of Object.values(b.volunteers)) {
    if (v.id === byId || v.duty !== 'on_duty') continue;
    if (scope.teamSlug && v.teamSlug !== scope.teamSlug) continue;
    if (scope.zoneSlug && v.zoneSlug !== scope.zoneSlug) continue;
    b.send(v.id, 'broadcast', body, { fromName: by.name, senderId: by.id });
  }
}

export function sendDirect(b: Batch, byId: string, volunteerId: string, body: string) {
  const me = b.volunteers[byId];
  if (!me) return;
  if (!b.volunteers[volunteerId]) throw new CommandError('invalid', `No volunteer ${volunteerId}`);
  b.send(volunteerId, 'direct', body, { fromName: me.name, senderId: me.id });
}

// ── festival-goers ──

/** Ask or report. The request starts at "Understanding"; `understand` runs after. */
export function guestAsk(b: Batch, text: string, zoneSlug: string | null, locationHint: string | null = null): GuestRequest {
  const heard = text.trim();
  const request: GuestRequest = {
    id: b.id('request'), createdAt: b.now, heard, zoneSlug, locationHint, stage: 'understanding', aiAnswer: null, taskId: null,
    thread: [{ from: 'guest', text: heard, at: b.now }], reopenedAt: null,
  };
  b.request(request);
  return request;
}

/** A routine question gets an answer; anything else becomes a task. `ai` is the model's call, else keywords decide. */
export function understand(b: Batch, requestId: string, ai?: Understood) {
  const r = b.requests[requestId];
  if (!r || r.stage !== 'understanding') return;
  const u = ai ?? heuristicUnderstanding(r.heard, r.zoneSlug, r.locationHint);
  if (u.kind === 'answer') b.request({ ...r, stage: 'answered', aiAnswer: u.answer, thread: [...r.thread, { from: 'ai', text: u.answer, at: b.now }] });
  else createGuestTask(b, r, u);
}

/** "Talk to a person" on an AI answer: a task for the team that fits, P3 unless `ai` raised it. */
export function guestRequestHuman(b: Batch, requestId: string, ai?: Triage) {
  const r = b.requests[requestId];
  if (!r || r.taskId) return;
  createGuestTask(b, r, ai ?? heuristicPerson(r.heard, r.zoneSlug, r.locationHint));
}

/** "What's changed?" A note for the volunteer, or a priority bump that alerts the lead. */
export function guestAddDetail(b: Batch, requestId: string, text: string, ai?: DetailRead & { triage?: Triage }): { escalated: boolean } {
  const r = b.requests[requestId];
  if (!r) throw new CommandError('not_found', `No request ${requestId}`);
  const task = r.taskId ? b.tasks[r.taskId] : undefined;
  const thread = [...r.thread, { from: 'guest' as const, text, at: b.now }];

  if (!task || (!isActive(task) && task.status !== 'open' && task.status !== 'queued')) {
    // Nothing open to add to: treat it as asking for a person, with the detail as the report.
    const withDetail = { ...r, heard: `${r.heard}. ${text}`, thread, taskId: null };
    const t = ai?.triage ?? heuristicTriage(withDetail.heard, r.zoneSlug, r.locationHint);
    createGuestTask(b, withDetail, t);
    return { escalated: t.priority !== 'P3' };
  }

  const worse = (ai ?? heuristicDetail(text)).worse;
  const updated: Task = worse ? { ...task, priority: BUMP[task.priority] } : task;
  b.task({ ...updated, summary: `${task.summary} Update: ${text}` });
  b.ev(task.id, 'note', worse ? `Festival-goer says it’s worse. Now ${updated.priority}` : 'Detail from the festival-goer', TRIAGE_AGENT, { note: text });
  for (const id of b.onIt(task)) b.send(id, 'guest_reply', `Update: “${text}”`, { taskId: task.id, fromName: 'Festival-goer' });
  if (worse) {
    const lead = b.leadFor(task.teamSlug) ?? b.coordinator();
    if (lead) b.send(lead.id, 'escalation', `Worse: ${task.title}. Now ${updated.priority}.`, { taskId: task.id });
  }
  b.request({ ...r, thread: [...thread, { from: 'ai', text: worse ? 'Lead alerted.' : 'Note added.', at: b.now }] });
  return { escalated: worse };
}

export function guestCancel(b: Batch, requestId: string) {
  const r = b.requests[requestId];
  if (!r) return;
  b.request({ ...r, stage: 'cancelled' });
  const task = r.taskId ? b.tasks[r.taskId] : undefined;
  if (task && task.status !== 'resolved' && task.status !== 'cancelled') {
    b.task({ ...task, status: 'cancelled', resolution: 'cancelled', resolvedAt: b.now, etaAt: null });
    b.ev(task.id, 'resolved', 'Cancelled by the festival-goer', FESTIVALGOER);
    settleProposal(b, task.id, 'cancelled', null, null);
    for (const id of b.onIt(task)) {
      b.send(id, 'closed', `Cancelled by the festival-goer: ${task.title}.`, { taskId: task.id });
      freeUp(b, id);
    }
  }
}

/** "Still need help?" after Sorted. */
export function guestReopen(b: Batch, requestId: string) {
  const r = b.requests[requestId];
  if (!r) return;
  const task = r.taskId ? b.tasks[r.taskId] : undefined;
  if (!task) return guestRequestHuman(b, requestId);
  if (task.status !== 'resolved') return;
  b.request({ ...r, reopenedAt: b.now, thread: [...r.thread, { from: 'guest', text: 'Still need help', at: b.now }] });
  const fresh: Task = {
    ...task, status: 'open', assigneeId: null, helperIds: [], escalation: null, resolution: null, resolvedAt: null,
    etaAt: null, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, lastActivityAt: b.now,
  };
  b.ev(task.id, 'note', 'Reopened: festival-goer still needs help', FESTIVALGOER);
  // Same volunteer if they're still around: they know the situation.
  const prev = task.assigneeId ? b.volunteers[task.assigneeId] : undefined;
  if (prev?.duty === 'on_duty') place(b, fresh, prev.id, AGENT, `Reopened, back to ${prev.name}`);
  else dispatch(b, fresh);
}

function createGuestTask(b: Batch, r: GuestRequest, t: Triage) {
  const task: Task = {
    id: b.id('task'), title: t.title, summary: t.summary, priority: t.priority, teamSlug: t.team, category: t.category,
    zoneSlug: r.zoneSlug ?? t.zoneSlug, locationHint: r.locationHint ?? t.locationHint, status: 'open', assigneeId: null, handledBy: 'ai',
    reporter: { kind: 'festivalgoer', quote: r.heard, language: t.language },
    createdAt: b.now, assignedAt: null, etaAt: null, lastActivityAt: b.now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null,
    resolvedAt: null, escalation: null, helperIds: [], resolution: null, requestId: r.id,
  };
  b.ev(task.id, 'created', 'Reported by a festival-goer', TRIAGE_AGENT);
  b.request({ ...r, stage: 'finding', taskId: task.id });
  dispatch(b, task);
}

// ── shared steps ──

/** P1/P2: a proposal a human can approve (auto-assigns later). P3: straight to the top pick. */
export function dispatch(b: Batch, task: Task) {
  const candidates = rankCandidates(task, Object.values(b.volunteers), b.all());
  if (needsApproval(task.priority)) {
    b.task(task);
    const p: Proposal = {
      id: b.id('proposal'), taskId: task.id, candidates, createdAt: b.now, autoAssignAt: b.now + POLICY.autoAssignMs,
      status: 'pending', volunteerId: null, decidedById: null, decidedAt: null,
    };
    b.proposal(p);
    const top = candidates[0] ? b.volunteers[candidates[0].volunteerId] : undefined;
    b.ev(task.id, 'proposed', top ? `Suggested ${top.name}, waiting for approval` : 'Nobody suggested yet', AGENT);
    const lead = b.leadFor(task.teamSlug);
    const mo = b.coordinator();
    for (const who of [lead, task.priority === 'P1' || !lead ? mo : undefined]) {
      if (who) b.send(who.id, 'escalation', `Approve: ${task.title}.`, { taskId: task.id });
    }
    return;
  }
  const top = candidates[0];
  if (top) return place(b, task, top.volunteerId, AGENT, undefined);
  b.task(task);
  const lead = b.leadFor(task.teamSlug) ?? b.coordinator();
  if (lead) b.send(lead.id, 'escalation', `Unassigned: ${task.title}.`, { taskId: task.id });
}

/** Assign (free) or queue (busy), with the event and the right delivery: spoken when idle, a ping when busy. */
export function place(b: Batch, task: Task, volunteerId: string, actor: Actor, why: string | undefined) {
  const v = b.volunteers[volunteerId];
  const busy = isBusy(b.all().filter((t) => t.id !== task.id), volunteerId);
  b.task(assignOrQueue(task, volunteerId, busy, b.now));
  b.ev(task.id, busy ? 'queued' : 'assigned', `${busy ? 'Queued for' : 'Assigned to'} ${v?.name ?? 'a volunteer'}${why ? ` (${why})` : ''}`, actor);
  b.send(
    volunteerId, 'task',
    busy ? `New task queued: ${task.title}. Check the app.` : `New task: ${task.title}. ${task.summary}`,
    { taskId: task.id, delivery: busy ? 'ping' : 'spoken' },
  );
}

/** Freed up → pull the next queued task, delivered spoken since they're now idle. */
function freeUp(b: Batch, volunteerId: string) {
  if (isBusy(b.all(), volunteerId)) return;
  const next = nextQueued(b.all(), volunteerId);
  if (!next) return;
  b.task(assignOrQueue(next, volunteerId, false, b.now));
  b.ev(next.id, 'assigned', `Assigned to ${b.volunteers[volunteerId]?.name} (freed up)`, AGENT);
  b.send(volunteerId, 'task', `Next up: ${next.title}. ${next.summary}`, { taskId: next.id, delivery: 'spoken' });
}

function settleProposal(b: Batch, taskId: string, status: Proposal['status'], volunteerId: string | null, byId: string | null) {
  const p = Object.values(b.proposals).find((x) => x.taskId === taskId && x.status === 'pending');
  if (p) b.proposal({ ...p, status, volunteerId, decidedById: byId, decidedAt: b.now });
}

/** One scheduler pass: nudges, lead alerts and bumps from lifecycle.tick, then proposals nobody approved in time. */
export function schedulerStep(b: Batch) {
  const mo = b.coordinator();
  for (const task of b.all()) {
    const r = tick(task, b.now, mo?.id ?? null);
    if (!r) continue;
    b.task(r.task);
    const v = b.volunteers[task.assigneeId ?? ''];
    for (const a of r.alerts) {
      if (a.kind === 'nudge') {
        b.ev(a.taskId, 'nudged', a.body, SCHEDULER);
        b.send(a.volunteerId, 'nudge', a.body, { taskId: a.taskId });
      } else if (a.kind === 'lead_alert') {
        b.ev(a.taskId, 'lead_alerted', a.body, SCHEDULER);
        b.send(a.volunteerId, 'system', `Your team lead has been alerted about “${task.title}”. Send an update when you can.`, { taskId: a.taskId });
        const lead = b.leadFor(task.teamSlug) ?? mo;
        if (lead) b.send(lead.id, 'escalation', `${first(v)} went quiet: ${task.title}.`, { taskId: a.taskId });
      } else {
        b.ev(a.taskId, 'bumped', a.body, SCHEDULER);
        const lead = b.leadFor(task.teamSlug);
        if (lead) b.send(lead.id, 'escalation', `Passed to Mo: ${task.title}.`, { taskId: a.taskId });
        if (mo) b.send(mo.id, 'escalation', `${first(v)} asked for help: ${task.title}.`, { taskId: a.taskId });
      }
    }
  }
  // Nobody approved or changed the AI's pick in time: assign the top pick that's still around.
  for (const p of Object.values(b.proposals)) {
    if (!proposalDue(p, b.now)) continue;
    const task = b.tasks[p.taskId];
    const pick = task?.status === 'open'
      ? (rankCandidates(task, Object.values(b.volunteers), b.all())[0] ?? p.candidates[0])?.volunteerId
      : undefined;
    if (!task || !pick) {
      b.proposal({ ...p, status: 'cancelled', decidedAt: b.now });
      continue;
    }
    place(b, task, pick, AGENT, `auto-assigned, no approval in ${POLICY.autoAssignMs / 1000} s`);
    b.proposal({ ...p, status: 'auto_assigned', volunteerId: pick, decidedAt: b.now });
  }
}

/** Task fields a canned report supplies; the command fills in ids, times and lifecycle fields. */
export type TaskDraft = Omit<
  Task,
  | 'id' | 'createdAt' | 'lastActivityAt' | 'status' | 'assigneeId' | 'assignedAt' | 'etaAt' | 'nudgeCount' | 'lastNudgeAt'
  | 'leadAlertedAt' | 'resolvedAt' | 'escalation' | 'helperIds' | 'resolution' | 'requestId'
>;

// ── demo scenarios (the dev panel now, the demo-day simulator later) ──

/** The volunteer's active task goes silent: nudged, then the lead is alerted. */
export function goQuiet(b: Batch, volunteerId: string) {
  const task = b.all().find((t) => t.assigneeId === volunteerId && isActive(t) && t.status !== 'escalated');
  if (!task) return;
  const v = b.volunteers[volunteerId];
  b.task({ ...task, status: task.status === 'assigned' ? 'accepted' : task.status, nudgeCount: 1, lastNudgeAt: b.now - POLICY.nudgeGapMs, leadAlertedAt: b.now });
  b.ev(task.id, 'nudged', `Still on "${task.title}"? Send a quick update.`, SCHEDULER);
  b.ev(task.id, 'lead_alerted', `No update on "${task.title}". Lead alerted.`, SCHEDULER);
  b.send(volunteerId, 'system', `Your team lead has been alerted about “${task.title}”. Send an update when you can.`, { taskId: task.id });
  const lead = b.leadFor(task.teamSlug) ?? b.coordinator();
  if (lead) b.send(lead.id, 'escalation', `${first(v)} went quiet: ${task.title}.`, { taskId: task.id });
}

/** A canned report lands on a volunteer. */
export function spawnIncoming(b: Batch, volunteerId: string, draft: TaskDraft) {
  const task: Task = {
    ...draft, id: b.id('task'), status: 'open', assigneeId: null, createdAt: b.now, assignedAt: null, etaAt: null,
    lastActivityAt: b.now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null,
    escalation: null, helperIds: [], resolution: null, requestId: null,
  };
  b.ev(task.id, 'created', `Reported by ${draft.reporter.name ?? 'a festival-goer'}`, TRIAGE_AGENT);
  place(b, task, volunteerId, TRIAGE_AGENT, undefined);
}
