import {
  TEAM_CATEGORY,
  unread,
  type DetailRead,
  type EscalateTo,
  type Match,
  type Reread,
  type Triage,
  type Understood,
} from '@/lib/ai';
import { AGENT, Batch, CommandError, FESTIVALGOER, SCHEDULER, TRIAGE_AGENT, type Actor } from '@/lib/batch';
import { rankCandidates } from '@/lib/candidates';
import { checkIn, shiftStep } from '@/lib/shifts';
import { REPLY_LABEL } from '@/lib/format';
import {
  applyHelperReply,
  applyReply,
  availableHelperReplies,
  assignOrQueue,
  handoverArrived,
  HANDOVER_NAME,
  helperIdsOf,
  isHeld,
  isActive,
  canHelp,
  isBusy,
  isOnTask,
  needsApproval,
  nextQueued,
  passUp,
  POLICY,
  proposalDue,
  respondToEscalation,
  tick,
  type RespondInput,
} from '@/lib/lifecycle';
import { walkFrom } from '@/lib/presence';
import { routeBetween } from '@/lib/route';
import type {
  Duty,
  GuestRequest,
  HelperAssignment,
  Mobilization,
  MobilizationEvidence,
  MobilizationStep,
  Priority,
  Proposal,
  ProposalCandidate,
  ReplyKind,
  Task,
  TeamSlug,
  Volunteer,
} from '@/lib/schema';

/**
 * What every command does, beyond the task state machine in lifecycle.ts: the events it writes, the messages it
 * sends, proposals, queueing, and festival-goer requests. Pure functions over a Batch, shared by MockRepo, the
 * server (src/server/http/commands.ts) and the demo-day simulator. MockRepo was the spec; this is it, moved.
 */

/** A broadcast's audience. Neither set = everyone on duty. */
export type Scope = { teamSlug?: TeamSlug; zoneSlug?: string };

/** What a push-to-talk utterance means (repo.ts Interpretation). */
/** `tell_guest`: words for the festival-goer on a request's task, `text` as the volunteer speaking to them. */
export type Intent =
  | { kind: 'reply'; taskId: string; reply: ReplyKind }
  | { kind: 'tell_guest'; taskId: string; text: string }
  | { kind: 'report' };

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

  // A recruited helper's own accept/decline on their slot, independent of the task's own status. They can only finish
  // it once they've accepted.
  const helperEntry = task.helpers.find((h) => h.volunteerId === actorId);
  if (helperEntry && kind === 'done' && helperEntry.status !== 'accepted')
    throw new CommandError('forbidden', `Accept task ${taskId} before marking it done`);
  if (helperEntry && kind !== 'done') {
    if (kind !== 'accept' && kind !== 'decline')
      throw new CommandError('forbidden', `A helper can only accept, decline or finish task ${taskId}`);
    const ht = applyHelperReply(task, actorId, kind, b.now);
    if (!ht) throw new CommandError('conflict', `Cannot ${kind} task ${taskId}`);
    b.task(kind === 'decline' ? declinedBy(ht.task, actorId) : ht.task);
    b.ev(taskId, kind === 'decline' ? 'reassigned' : 'reply', `${first(me)}: ${ht.text}`, b.actor(me.id), {
      reply: kind,
      note,
    });
    if (kind === 'decline') {
      b.send(me.id, 'system', `Declined: ${task.title}.`, { taskId, quiet: true });
      freeUp(b, me.id);
      staffShort(b);
    }
    return;
  }

  const t = applyReply(task, kind, b.now, note, {
    leadId: lead?.id ?? null,
    coordinatorId: mo?.id ?? null,
  });
  if (!t) throw new CommandError('conflict', `Cannot ${kind} task ${taskId} in status ${task.status}`);
  if (kind !== 'done' && task.assigneeId !== actorId)
    throw new CommandError('forbidden', `Only the owner can ${kind} task ${taskId}`);

  b.task(t.task);
  b.ev(taskId, kind === 'done' ? 'resolved' : kind === 'need_help' ? 'escalated' : 'reply', t.text, b.actor(me.id), {
    reply: kind,
    note,
  });
  // Stand-in for GPS: finishing a task means you were at its zone.
  if (kind === 'done' && task.zoneSlug) b.volunteer({ ...me, zoneSlug: task.zoneSlug });

  if (kind === 'need_help') {
    const owner = t.task.escalation?.level === 'lead' ? lead : mo;
    b.send(me.id, 'system', `Asked ${owner ? `${first(owner)} ` : ''}for help: ${task.title}.`, {
      taskId,
      quiet: true,
    });
    if (owner) b.send(owner.id, 'escalation', `${first(me)} asked for help: ${task.title}.`, { taskId });
  }
  if (kind === 'decline') ownerDeclined(b, declinedBy(b.tasks[taskId], me.id), me);
  // Done from anyone resolves it for everyone on it; each of them pulls their next queued task.
  if (kind === 'done') {
    for (const id of b.onIt(task)) {
      if (id !== me.id) b.send(id, 'system', `${first(me)} marked it done: ${task.title}.`, { taskId });
      freeUp(b, id);
    }
  }
  if (kind === 'decline') {
    freeUp(b, me.id);
    staffShort(b);
  }
}

const declinedBy = (task: Task, id: string): Task => ({
  ...task,
  declinedIds: [...new Set([...(task.declinedIds ?? []), id])],
});

/**
 * The owner said no. An accepted helper takes it over. Otherwise anyone still only asked is let go, and the task goes
 * back to be staffed: a mobilization step by `staffShort`, anything else to its lead.
 */
function ownerDeclined(b: Batch, task: Task, by: Volunteer) {
  const next = task.helpers.find((h) => h.status === 'accepted');
  if (next) {
    const owner = b.volunteers[next.volunteerId];
    b.task({
      ...task,
      status: 'accepted',
      assigneeId: next.volunteerId,
      assignedAt: b.now,
      etaAt: b.now + POLICY.etaMs[task.priority],
      helpers: task.helpers.filter((h) => h !== next),
    });
    b.ev(task.id, 'reassigned', `${first(by)} declined. ${owner?.name ?? 'A helper'} leads it now`, AGENT);
    b.send(next.volunteerId, 'task', `${first(by)} dropped out. You're leading: ${task.title}.`, {
      taskId: task.id,
      delivery: 'spoken',
    });
    return;
  }
  const asked = task.helpers.map((h) => h.volunteerId);
  b.task({ ...task, helpers: [] });
  b.ev(task.id, 'reassigned', 'Back in the pool for reassignment', AGENT);
  for (const id of asked) {
    b.send(id, 'system', `You're off “${task.title}”.`, { taskId: task.id });
    freeUp(b, id);
  }
  if (task.mobilizationId) return;
  const lead = b.leadFor(task.teamSlug) ?? b.coordinator();
  if (lead) b.send(lead.id, 'escalation', `${first(by)} declined: ${task.title}.`, { taskId: task.id });
}

/** On duty during a rostered shift checks them into it (lib/shifts.ts). */
export function setDuty(b: Batch, volunteerId: string, duty: Duty) {
  const me = b.volunteers[volunteerId];
  if (!me) return;
  b.volunteer({ ...me, duty });
  if (duty === 'on_duty') checkIn(b, volunteerId);
}

/** The task a volunteer is on right now, as owner or helper. */
export const activeTaskOf = (tasks: Task[], volunteerId: string) => tasks.find((t) => isOnTask(t, volunteerId));

/** A message to send once triage has had time to run. The server sends it straight away. */
export type Later = { recipientId: string; body: string; taskId: string };

/**
 * Commit what the volunteer confirmed: a reply to their task, an update to an open task it's about (`match`), or a
 * new report (triaged by `ai`, or unread: a lead reads it).
 */
export function commit(
  b: Batch,
  actorId: string,
  i: { heard: string; intent: Intent },
  ai?: Triage,
  match?: Match,
): { confirmation: string; later?: Later } {
  if (i.intent.kind === 'reply') {
    reply(b, actorId, i.intent.taskId, i.intent.reply, i.heard);
    return { confirmation: `Sent “${REPLY_LABEL[i.intent.reply]}”` };
  }
  if (i.intent.kind === 'tell_guest') {
    guestReply(b, actorId, i.intent.taskId, i.intent.text);
    return { confirmation: 'Sent to the festival-goer' };
  }
  const open = openMatch(b, match);
  if (open) {
    updateTask(b, open.id, { volunteerId: actorId }, i.heard, match!.read);
    return { confirmation: `Added to “${open.title}”` };
  }
  return fileReport(b, actorId, i.heard, ai);
}

/** The task a report matched, if it's still open now the lock is held. */
const openMatch = (b: Batch, match: Match | undefined) => {
  const t = match ? b.tasks[match.taskId] : undefined;
  return t && !t.mobilizationId && t.status !== 'resolved' && t.status !== 'cancelled' ? t : undefined;
};

/** A volunteer's own report: triage, then straight to a teammate (or queued behind their current task). */
export function fileReport(
  b: Batch,
  reporterId: string,
  text: string,
  ai?: Triage,
): { confirmation: string; later?: Later } {
  const me = b.volunteers[reporterId];
  const t = ai ?? unread(text);
  const { team, priority } = t;
  const tasks = b.all();
  const candidates = Object.values(b.volunteers).filter(
    (v) => v.teamSlug === team && v.role === 'volunteer' && v.duty === 'on_duty' && v.id !== me?.id,
  );
  const free = candidates.find((v) => !isBusy(tasks, v.id));
  const who = free ?? candidates[0];
  const draft: Task = {
    id: b.id('task'),
    title: t.title,
    summary: t.summary,
    category: t.category,
    priority,
    teamSlug: team,
    // Where they said it's happening, else where they are.
    zoneSlug: t.zoneSlug ?? me?.zoneSlug ?? null,
    locationHint: t.locationHint,
    status: 'open',
    assigneeId: null,
    handledBy: 'human',
    reporter: {
      kind: 'volunteer',
      name: me?.name,
      quote: text,
      language: t.language,
      speakerNeeded: t.speakerNeeded,
      firstAidNeeded: t.firstAidNeeded,
      ...(t.playbook ? { playbook: t.playbook, playbookSure: !!t.playbookSure } : {}),
      ...(t.english ? { english: t.english } : {}),
    },
    createdAt: b.now,
    assignedAt: null,
    etaAt: null,
    lastActivityAt: b.now,
    nudgeCount: 0,
    lastNudgeAt: null,
    leadAlertedAt: null,
    resolvedAt: null,
    escalation: null,
    requiredCount: 1,
    helpers: [],
    resolution: null,
    requestId: null,
    mobilizationId: null,
  };
  b.ev(draft.id, 'created', 'Reported by voice', me ? b.actor(me.id) : { kind: 'human' });
  const teamName = b.teams[team]?.name ?? team;
  const held = t.escalate ? escalateNew(b, draft, t.escalate) : null;
  if (held?.holding) {
    const to = held.level === 'lead' ? `the ${teamName} lead` : 'Mo';
    const body = `Your report “${draft.title}” went to ${to} to decide.`;
    return { confirmation: 'Report sent', later: me ? { recipientId: me.id, body, taskId: draft.id } : undefined };
  }
  if (who) place(b, draft, who.id, AGENT, undefined);
  else b.task(draft);
  // Triage + assignment run after Send, so the reporter hears back via Inbox, not inline.
  const body = who
    ? `Your report “${draft.title}” went to ${teamName}. ${first(who)} ${free ? 'is on it' : 'has it next'}.`
    : `Your report “${draft.title}” is with ${teamName}. A lead will pick it up.`;
  return {
    confirmation: 'Report sent',
    later: me ? { recipientId: me.id, body, taskId: draft.id } : undefined,
  };
}

/** Who a report about an open task came from: a volunteer, or a festival-goer's request. */
export type UpdateFrom = { volunteerId: string } | { requestId: string };

/** A new report that's about a task already open: it goes on that task, read again with what's new. */
export function updateTask(b: Batch, taskId: string, from: UpdateFrom, text: string, read: Reread) {
  const task = b.tasks[taskId];
  if (!task) throw new CommandError('not_found', `No task ${taskId}`);
  const actor = 'volunteerId' in from ? b.actor(from.volunteerId) : FESTIVALGOER;
  const worse = moreUrgent(read.priority, task.priority);
  b.task({ ...task, priority: worse ? read.priority : task.priority, summary: `${task.summary} Update: ${text}` });
  b.ev(taskId, 'note', worse ? `Another report: worse. Now ${read.priority}` : 'Another report about this', actor, {
    note: text,
  });
  // A festival-goer's request follows the task already open, so they see who's coming.
  const r = 'requestId' in from ? b.requests[from.requestId] : undefined;
  if (r) b.request({ ...r, stage: 'finding', taskId });
  // Worse is read out to whoever is on it; anything else waits until they look.
  for (const id of b.onIt(task))
    b.send(id, 'system', `Update: ${text}`, { taskId, delivery: worse ? 'spoken' : 'ping' });
  // Better or sorted is only ever an offer: a lead decides, nothing closes on its own.
  const ask = worse
    ? `Worse: ${task.title}. Now ${read.priority}. Send backup?`
    : read.resolved
      ? `Sounds sorted: ${task.title}. Close it?`
      : moreUrgent(task.priority, read.priority)
        ? `Sounds less urgent: ${task.title}. Downgrade to ${read.priority}?`
        : null;
  if (!ask) return;
  const lead = b.leadFor(task.teamSlug);
  const mo = b.coordinator();
  for (const who of [lead, (worse && read.priority === 'P1') || !lead ? mo : undefined]) {
    if (who) b.send(who.id, 'escalation', ask, { taskId });
  }
}

const URGENCY: Priority[] = ['P1', 'P2', 'P3'];
const moreUrgent = (a: Priority, than: Priority) => URGENCY.indexOf(a) < URGENCY.indexOf(than);

/**
 * Staff → festival-goer, on a task that came from a request: the volunteer on it, or a lead or Mo. A lead's reply
 * goes to the crew on it too, so they know what the festival-goer was told.
 */
export function guestReply(b: Batch, staffId: string, taskId: string, text: string) {
  const me = b.volunteers[staffId];
  const task = b.tasks[taskId];
  if (!task) throw new CommandError('not_found', `No task ${taskId}`);
  const request = task.requestId ? b.requests[task.requestId] : undefined;
  if (!me || !request) throw new CommandError('conflict', `Task ${taskId} has no festival-goer to reply to`);
  b.request({
    ...request,
    thread: [...request.thread, { from: 'staff', name: shortName(me), text, at: b.now }],
  });
  const crew = b.onIt(task);
  if (crew.includes(me.id)) {
    // Talking to them is an update: nudges start over, same as a reply on the task.
    b.task({ ...task, lastActivityAt: b.now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null });
    b.ev(taskId, 'note', 'Replied to the festival-goer', b.actor(me.id), { note: text });
    return;
  }
  b.ev(taskId, 'note', `${me.name} replied to the festival-goer`, b.actor(me.id), { note: text });
  for (const id of crew)
    b.send(id, 'direct', `To the festival-goer: “${text}”`, { taskId, fromName: me.name, senderId: me.id });
}

/** Lead or Mo → everyone on the task, said out loud on their phones and kept on the task's log. */
export function messageCrew(b: Batch, byId: string, taskId: string, text: string) {
  const me = b.volunteers[byId];
  const task = b.tasks[taskId];
  if (!task || !me) throw new CommandError('not_found', `No task ${taskId}`);
  const crew = b.onIt(task).filter((id) => id !== me.id);
  if (!crew.length) throw new CommandError('conflict', `Nobody is on task ${taskId}`);
  b.ev(taskId, 'note', `Message from ${me.name}`, b.actor(me.id), { note: text });
  for (const id of crew)
    b.send(id, 'direct', text, { taskId, fromName: me.name, senderId: me.id, delivery: 'spoken' });
}

// ── leads and Mo ──

/** Respond to "need help" or "went quiet": backup, handover, reassign, call, close, carry on. */
export function respond(b: Batch, byId: string, taskId: string, input: RespondInput) {
  const task = b.tasks[taskId];
  const by = b.volunteers[byId];
  if (!task || !by) throw new CommandError('not_found', `Cannot respond to task ${taskId}`);
  const target = input.volunteerId ? b.volunteers[input.volunteerId] : undefined;
  if (input.volunteerId && !target) throw new CommandError('invalid', `No volunteer ${input.volunteerId}`);
  if (
    task.mobilizationId &&
    input.kind === 'backup' &&
    target &&
    !rankCandidates(task, Object.values(b.volunteers), b.all(), {
      positions: b.positions,
      now: b.now,
      limit: Object.keys(b.volunteers).length,
    }).some((candidate) => candidate.volunteerId === target.id)
  )
    throw new CommandError('conflict', 'Mobilization backup must be free, on duty, qualified and in the required team');
  const t = respondToEscalation(
    task,
    { ...input, etaAt: input.etaAt ?? responseEta(b, task, input) },
    byId,
    b.now,
    input.kind === 'reassign' && !!target && isBusy(b.all(), target.id),
  );
  if (!t) throw new CommandError('conflict', `Cannot ${input.kind} task ${taskId} in status ${task.status}`);

  // Reassignment is routed through `place` below so multi-person work is topped up again. Every
  // other response already has its complete next task state from the pure lifecycle function.
  if (input.kind !== 'reassign') b.task(t.task);
  const owner = task.assigneeId ? b.volunteers[task.assigneeId] : undefined;
  const actor = b.actor(byId);
  const note = input.note ? { note: input.note } : {};

  switch (input.kind) {
    case 'backup':
      b.ev(taskId, 'responded', `${by.name} sent ${target?.name ?? 'backup'}`, actor, note);
      if (target)
        b.send(target.id, 'backup', `Help ${first(owner)}: ${task.title}.`, {
          taskId,
          delivery: 'spoken',
        });
      if (owner) b.send(owner.id, 'backup', `${first(target)} is joining you.`, { taskId });
      break;
    case 'handover': {
      const name = HANDOVER_NAME[input.target!];
      b.ev(taskId, 'responded', `${by.name} handed over to ${name}`, actor, note);
      if (owner)
        b.send(owner.id, 'system', `${name[0].toUpperCase()}${name.slice(1)} on the way: ${task.title}.`, { taskId });
      break;
    }
    case 'reassign': {
      b.ev(taskId, 'reassigned', `${by.name} moved it to ${target?.name}`, actor, note);
      const fresh: Task = { ...t.task, status: 'open', assigneeId: null };
      // Replace the old crew before ranking so people released by the reassignment may be recruited
      // again if they are still genuinely the best fit.
      b.task(fresh);
      place(b, fresh, target!.id, actor, `${by.name} reassigned`);
      const stillOnIt = new Set(b.onIt(b.tasks[taskId]));
      for (const id of b.onIt(task).filter((x) => x !== target!.id && !stillOnIt.has(x))) {
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
        // The reason is the lead's answer: it goes to whoever asked.
        const why = input.note ? ` “${input.note}”` : '';
        b.send(id, 'closed', `Closed by ${first(by)}: ${task.title}.${why}`, { taskId });
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
  const backup = input.kind === 'backup' ? b.volunteers[input.volunteerId ?? ''] : undefined;
  const from = backup
    ? walkFrom(b.positions, backup.id, backup.zoneSlug, b.now)
    : input.kind === 'handover' && input.target === 'medics'
      ? 'first-aid-hq'
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
export function assign(
  b: Batch,
  byId: string,
  taskId: string,
  volunteerId: string,
  how: 'assigned' | 'approved' = 'assigned',
  helperIds: string[] = [],
) {
  const task = b.tasks[taskId];
  const by = b.volunteers[byId];
  const target = b.volunteers[volunteerId];
  if (!task || !by) throw new CommandError('not_found', `No task ${taskId}`);
  if (!target) throw new CommandError('invalid', `No volunteer ${volunteerId}`);
  if (task.status === 'resolved' || task.status === 'cancelled')
    throw new CommandError('conflict', `Cannot assign task ${taskId}`);
  const queuedFor = task.status === 'queued' && task.assigneeId ? [task.assigneeId] : [];
  const selectedIds = [...new Set(helperIds)].filter((id) => id !== volunteerId);
  // A queued owner cannot safely reserve named helpers: they may be assigned elsewhere before activation.
  if (
    selectedIds.length &&
    isBusy(
      b.all().filter((t) => t.id !== taskId),
      volunteerId,
    )
  )
    throw new CommandError('conflict', 'Choose a free owner before sending selected helpers');
  const selectedHelpers = selectedIds.map((id): HelperAssignment => {
    const helper = b.volunteers[id];
    if (!helper) throw new CommandError('invalid', `No volunteer ${id}`);
    if (!canHelp(task, helper, b.all(), b.now))
      throw new CommandError('conflict', 'Selected helpers must be free, on duty, qualified and in the required team');
    const retained = task.helpers.find((entry) => entry.volunteerId === id);
    return retained ?? { volunteerId: id, status: 'notified', assignedAt: b.now, respondedAt: null };
  });
  const prev = [...b.onIt(task), ...queuedFor];
  const fresh: Task = {
    ...task,
    status: 'open',
    assigneeId: null,
    helpers: [],
    // Manual extra picks define the ordinary task's demand; never rewrite an audited Mobilization demand.
    requiredCount: task.mobilizationId ? task.requiredCount : Math.max(task.requiredCount, 1 + selectedHelpers.length),
    escalation: null,
    etaAt: null,
    nudgeCount: 0,
    lastNudgeAt: null,
    leadAlertedAt: null,
    lastActivityAt: b.now,
  };
  place(
    b,
    fresh,
    volunteerId,
    b.actor(byId),
    `${how === 'approved' ? 'Approved' : 'Assigned'} by ${by.name}`,
    [],
    selectedHelpers,
  );
  settleProposal(b, taskId, 'approved', volunteerId, byId);
  const stillOnIt = new Set(b.onIt(b.tasks[taskId]));
  for (const id of prev.filter((id) => id !== volunteerId && !stillOnIt.has(id))) {
    b.send(id, 'moved', `Moved to ${first(target)}: ${task.title}.`, { taskId });
    freeUp(b, id);
  }
}

/**
 * Approve the AI's proposal: its top pick, or `volunteerId` instead, with `helperIds` going along. Left out, the
 * helpers are the proposal's own when its top pick goes, and nobody when someone else does.
 */
export function approve(b: Batch, byId: string, proposalId: string, volunteerId?: string, helperIds?: string[]) {
  const p = b.proposals[proposalId];
  if (!p) throw new CommandError('not_found', `No proposal ${proposalId}`);
  const top = p.candidates[0]?.volunteerId;
  const pick = volunteerId ?? top;
  if (p.status !== 'pending' || !pick) throw new CommandError('conflict', `Cannot approve proposal ${proposalId}`);
  assign(b, byId, p.taskId, pick, 'approved', helperIds ?? (pick === top ? p.helperIds : []));
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
export function guestAsk(
  b: Batch,
  text: string,
  zoneSlug: string | null,
  locationHint: string | null = null,
): GuestRequest {
  const heard = text.trim();
  const request: GuestRequest = {
    id: b.id('request'),
    createdAt: b.now,
    heard,
    zoneSlug,
    locationHint,
    stage: 'understanding',
    aiAnswer: null,
    taskId: null,
    thread: [{ from: 'guest', text: heard, at: b.now }],
    reopenedAt: null,
  };
  b.request(request);
  return request;
}

/**
 * A routine question gets an answer; a report about a task already open joins it (`match`); anything else becomes a
 * task. `ai` is the model's call; without one, a lead reads it.
 */
export function understand(b: Batch, requestId: string, ai?: Understood, match?: Match) {
  const r = b.requests[requestId];
  if (!r || r.stage !== 'understanding') return;
  const u: Understood = ai ?? { kind: 'task', ...unread(r.heard, r.zoneSlug, r.locationHint) };
  const open = u.kind === 'task' ? openMatch(b, match) : undefined;
  // An answer stands even if it's said again ("hello?" twice): the classifier decides when someone is needed.
  if (open) updateTask(b, open.id, { requestId }, r.heard, match!.read);
  else if (u.kind === 'answer')
    b.request({
      ...r,
      stage: 'answered',
      aiAnswer: u.answer,
      thread: [...r.thread, { from: 'ai', text: u.answer, at: b.now }],
    });
  else createGuestTask(b, r, u);
}

/** What a bare "Problem solved?" No says in the conversation. */
export const NOT_SOLVED = 'Not solved';

/**
 * "Problem solved?" No, or anything they add before someone's sent: back through `understand` with the conversation
 * so far, so the AI answers again or sends someone. `text` absent: the No on its own. While it's still being
 * understood, the text joins what the AI reads next.
 */
export function guestFollowUp(b: Batch, requestId: string, text?: string) {
  const r = b.requests[requestId];
  if (!r) throw new CommandError('not_found', `No request ${requestId}`);
  if (r.taskId || (r.stage !== 'answered' && r.stage !== 'understanding')) return;
  if (!text && r.stage !== 'answered') return;
  b.request({
    ...r,
    heard: text ? `${r.heard}. ${text}` : r.heard,
    stage: 'understanding',
    aiAnswer: null,
    thread: [...r.thread, { from: 'guest', text: text || NOT_SOLVED, at: b.now }],
  });
}

/** "Problem solved?" Yes: the answer did it. Closed for good; it no longer counts as open. */
export function guestSolved(b: Batch, requestId: string) {
  const r = b.requests[requestId];
  if (!r) throw new CommandError('not_found', `No request ${requestId}`);
  if (r.stage !== 'answered' || r.taskId) return;
  b.request({ ...r, stage: 'sorted' });
}

/** "What's changed?" A note for the volunteer, or a priority bump that alerts the lead. */
export function guestAddDetail(
  b: Batch,
  requestId: string,
  text: string,
  ai?: DetailRead & { triage?: Triage },
): { escalated: boolean } {
  const r = b.requests[requestId];
  if (!r) throw new CommandError('not_found', `No request ${requestId}`);
  const task = r.taskId ? b.tasks[r.taskId] : undefined;
  const thread = [...r.thread, { from: 'guest' as const, text, at: b.now }];

  if (!task || (!isActive(task) && task.status !== 'open' && task.status !== 'queued')) {
    // Nothing open to add to: treat it as asking for a person, with the detail as the report.
    const withDetail = { ...r, heard: `${r.heard}. ${text}`, thread, taskId: null };
    const t = ai?.triage ?? unread(withDetail.heard, r.zoneSlug, r.locationHint);
    createGuestTask(b, withDetail, t);
    return { escalated: t.priority !== 'P3' };
  }

  // Unread detail goes to the lead as if worse: a person reads it.
  const worse = ai?.worse ?? true;
  // Staff read it in English when the AI translated it; the festival-goer's own words stay on the event and their thread.
  const english = ai?.english?.trim() && ai.english.trim() !== text.trim() ? ai.english.trim() : null;
  const said = english ?? text;
  const updated: Task = worse ? { ...task, priority: BUMP[task.priority] } : task;
  b.task({ ...updated, summary: `${task.summary} Update: ${said}` });
  const what = worse ? `Festival-goer says it’s worse. Now ${updated.priority}` : 'Detail from the festival-goer';
  b.ev(task.id, 'note', english ? `${what}: “${english}”` : what, TRIAGE_AGENT, { note: text });
  for (const id of b.onIt(task))
    b.send(id, 'guest_reply', `Update: “${said}”`, { taskId: task.id, fromName: 'Festival-goer' });
  if (worse) {
    const lead = b.leadFor(task.teamSlug) ?? b.coordinator();
    if (lead)
      b.send(lead.id, 'escalation', `Worse: ${task.title}. Now ${updated.priority}.`, {
        taskId: task.id,
      });
  }
  b.request({
    ...r,
    thread: [...thread, { from: 'ai', text: worse ? 'Lead alerted.' : 'Note added.', at: b.now }],
  });
  return { escalated: worse };
}

export function guestCancel(b: Batch, requestId: string) {
  const r = b.requests[requestId];
  if (!r) return;
  b.request({ ...r, stage: 'cancelled' });
  const task = r.taskId ? b.tasks[r.taskId] : undefined;
  if (task && task.status !== 'resolved' && task.status !== 'cancelled') {
    b.task({
      ...task,
      status: 'cancelled',
      resolution: 'cancelled',
      resolvedAt: b.now,
      etaAt: null,
    });
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
  // Sorted by an AI answer: back through the classifier.
  if (!task) {
    if (r.stage !== 'sorted') return;
    b.request({
      ...r,
      stage: 'understanding',
      aiAnswer: null,
      reopenedAt: b.now,
      thread: [...r.thread, { from: 'guest', text: 'Still need help', at: b.now }],
    });
    return;
  }
  if (task.status !== 'resolved') return;
  b.request({ ...r, reopenedAt: b.now, thread: [...r.thread, { from: 'guest', text: 'Still need help', at: b.now }] });
  const fresh: Task = {
    ...task,
    status: 'open',
    assigneeId: null,
    helpers: [],
    escalation: null,
    resolution: null,
    resolvedAt: null,
    etaAt: null,
    nudgeCount: 0,
    lastNudgeAt: null,
    leadAlertedAt: null,
    lastActivityAt: b.now,
  };
  b.ev(task.id, 'note', 'Reopened: festival-goer still needs help', FESTIVALGOER);
  // Same volunteer if they're still around: they know the situation.
  const prev = task.assigneeId ? b.volunteers[task.assigneeId] : undefined;
  if (prev?.duty === 'on_duty') place(b, fresh, prev.id, AGENT, `Reopened, back to ${prev.name}`);
  else dispatch(b, fresh);
}

function createGuestTask(b: Batch, r: GuestRequest, t: Triage) {
  const task: Task = {
    id: b.id('task'),
    title: t.title,
    summary: t.summary,
    priority: t.priority,
    teamSlug: t.team,
    category: t.category,
    zoneSlug: r.zoneSlug ?? t.zoneSlug,
    locationHint: r.locationHint ?? t.locationHint,
    status: 'open',
    assigneeId: null,
    handledBy: 'ai',
    reporter: {
      kind: 'festivalgoer',
      quote: r.heard,
      language: t.language,
      speakerNeeded: t.speakerNeeded,
      firstAidNeeded: t.firstAidNeeded,
      ...(t.playbook ? { playbook: t.playbook, playbookSure: !!t.playbookSure } : {}),
      ...(t.english ? { english: t.english } : {}),
    },
    createdAt: b.now,
    assignedAt: null,
    etaAt: null,
    lastActivityAt: b.now,
    nudgeCount: 0,
    lastNudgeAt: null,
    leadAlertedAt: null,
    resolvedAt: null,
    escalation: null,
    requiredCount: 1,
    helpers: [],
    resolution: null,
    requestId: r.id,
    mobilizationId: null,
  };
  b.ev(task.id, 'created', 'Reported by a festival-goer', TRIAGE_AGENT);
  b.request({ ...r, stage: 'finding', taskId: task.id });
  if (!t.escalate || !escalateNew(b, task, t.escalate).holding) dispatch(b, task);
}

/**
 * The intake agent's `escalate`: a lead (Mo for a whole-event call, or when the team has no lead) decides before
 * anyone is sent, so the task is held open and the allocator leaves it alone. A P1 isn't held: someone may be in
 * danger, so the allocator still sends help while they decide. Returns who has it and whether it's held (the caller
 * then skips the allocator).
 */
export function escalateNew(b: Batch, task: Task, e: EscalateTo): { level: 'lead' | 'coordinator'; holding: boolean } {
  const lead = e.level === 'lead' ? b.leadFor(task.teamSlug) : undefined;
  const owner = lead ?? b.coordinator();
  const level = lead ? 'lead' : 'coordinator';
  const holding = task.priority !== 'P1';
  b.ev(task.id, 'escalated', `Escalated to ${lead ? first(lead) : 'Mo'}: ${e.reason}`, TRIAGE_AGENT);
  if (holding) {
    b.task({
      ...task,
      status: 'open',
      assigneeId: null,
      escalation: {
        at: b.now,
        reason: e.reason,
        level,
        ownerId: owner?.id ?? null,
        bumpedAt: null,
        response: null,
        source: 'intake',
      },
    });
  }
  if (owner) b.send(owner.id, 'escalation', `Needs your call: ${task.title}. ${e.reason}`, { taskId: task.id });
  return { level, holding };
}

// ── shared steps ──

/** P1/P2: a proposal a human can approve (auto-assigns later). P3: straight to the top pick. */
export function dispatch(b: Batch, task: Task) {
  const candidates = rankCandidates(task, Object.values(b.volunteers), b.all(), { positions: b.positions, now: b.now });
  if (needsApproval(task.priority)) {
    b.task(task);
    const p: Proposal = {
      id: b.id('proposal'),
      taskId: task.id,
      candidates,
      helperIds: [],
      createdAt: b.now,
      autoAssignAt: b.now + POLICY.autoAssignMs,
      status: 'pending',
      volunteerId: null,
      decidedById: null,
      decidedAt: null,
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

/**
 * Assign (free) or queue (busy), with the event and the right delivery: spoken when idle, a ping when busy.
 * If placed (not queued) and the task needs more than one person, tops up to `requiredCount` via
 * `rankCandidates`, each starting `'notified'` (their own accept/decline — not pre-committed, unlike
 * escalation backup). `extraExclude` lets a caller placing several tasks in one go (Mobilization) stop
 * different steps from recruiting the same person twice.
 */
export function place(
  b: Batch,
  task: Task,
  volunteerId: string,
  actor: Actor,
  why: string | undefined,
  extraExclude: string[] = [],
  selectedHelpers: HelperAssignment[] = [],
) {
  const v = b.volunteers[volunteerId];
  if (
    task.mobilizationId &&
    !rankCandidates(task, Object.values(b.volunteers), b.all(), {
      positions: b.positions,
      exclude: extraExclude,
      now: b.now,
      limit: Object.keys(b.volunteers).length,
    }).some((candidate) => candidate.volunteerId === volunteerId)
  )
    throw new CommandError('conflict', 'Mobilization crew must be free, on duty, qualified and in the required team');
  const busy = isBusy(
    b.all().filter((t) => t.id !== task.id),
    volunteerId,
  );
  const before = b.tasks[task.id]?.helpers ?? task.helpers;
  const placed = assignOrQueue({ ...task, helpers: [...task.helpers, ...selectedHelpers] }, volunteerId, busy, b.now);
  // Rank against the new owner/selected crew, not an obsolete assignment that makes retained helpers look busy.
  b.task(placed);
  const recruited = busy ? placed : recruitHelpers(b, placed, extraExclude);
  const final = {
    ...recruited,
    helpers: recruited.helpers.map((helper) => before.find((old) => old.volunteerId === helper.volunteerId) ?? helper),
  };

  b.task(final);
  b.ev(
    task.id,
    busy ? 'queued' : 'assigned',
    `${busy ? 'Queued for' : 'Assigned to'} ${v?.name ?? 'a volunteer'}${why ? ` (${why})` : ''}`,
    actor,
  );
  b.send(
    volunteerId,
    'task',
    busy ? `New task queued: ${task.title}. Check the app.` : `New task: ${task.title}. ${task.summary}`,
    { taskId: task.id, delivery: busy ? 'ping' : 'spoken' },
  );
  announceHelpers(b, final, before, actor, !busy);
}

/** Tells each helper new since `before` where to go, and the owner (when they're on it, not queued) who's coming. */
function announceHelpers(b: Batch, task: Task, before: HelperAssignment[], actor: Actor, tellOwner: boolean) {
  const owner = task.assigneeId ? b.volunteers[task.assigneeId] : undefined;
  const joining = task.helpers.filter((h) => !before.some((e) => e.volunteerId === h.volunteerId));
  for (const h of joining) {
    b.ev(task.id, 'helper_added', `${b.volunteers[h.volunteerId]?.name ?? 'Someone'} recruited to help`, actor);
    b.send(h.volunteerId, 'backup', `Help ${first(owner)}: ${task.title}.`, {
      taskId: task.id,
      delivery: 'spoken',
    });
  }
  if (joining.length && tellOwner && owner) {
    const names = joining.map((h) => first(b.volunteers[h.volunteerId]));
    b.send(owner.id, 'backup', `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} joining you.`, { taskId: task.id });
  }
}

/**
 * Fills what's still short whenever someone may have come free (S1, D4): a mobilization step nobody could take gets
 * the best free person on its team, and a task under its `requiredCount` gets helpers for its empty slots (after a
 * decline or a release). `scope` limits it to some tasks (the scheduler's tests).
 */
function staffShort(b: Batch, scope?: Set<string> | null) {
  for (const task of b.all()) {
    if (scope && !scope.has(task.id)) continue;
    if (task.status === 'open' && !task.assigneeId && task.mobilizationId) {
      const top = rankCandidates(task, Object.values(b.volunteers), b.all(), {
        positions: b.positions,
        limit: 1,
        now: b.now,
      })[0];
      if (top) place(b, task, top.volunteerId, AGENT, 'Freed up');
    } else if (isActive(task) && task.requiredCount - 1 > task.helpers.length) {
      const topped = recruitHelpers(b, task, []);
      if (topped === task) continue;
      b.task(topped);
      announceHelpers(b, topped, task.helpers, AGENT, true);
    }
  }
}

/** Top up to `requiredCount` total (owner included). `rankCandidates` already skips the owner and existing helpers; a no-op once satisfied. */
function recruitHelpers(b: Batch, task: Task, extraExclude: string[]): Task {
  const need = task.requiredCount - 1 - task.helpers.length;
  if (need <= 0) return task;
  const picks = rankCandidates(task, Object.values(b.volunteers), b.all(), {
    positions: b.positions,
    exclude: extraExclude,
    limit: Object.keys(b.volunteers).length,
    now: b.now,
  })
    .filter((candidate) => canHelp(task, b.volunteers[candidate.volunteerId], b.all(), b.now))
    .slice(0, need);
  if (!picks.length) return task;
  const recruited: HelperAssignment[] = picks.map((c) => ({
    volunteerId: c.volunteerId,
    status: 'notified',
    assignedAt: b.now,
    respondedAt: null,
  }));
  return { ...task, helpers: [...task.helpers, ...recruited] };
}

/**
 * The picker's read of a pending proposal (server/pick.ts): `ranked` best first, and how many `people` the task
 * needs. The top pick leads; the next free ones in order go with them. Anyone gone off duty since is dropped.
 * Nothing changes once someone has decided, or if nobody it ranked is still around.
 */
export function rerank(b: Batch, proposalId: string, ranked: ProposalCandidate[], people: number) {
  const p = b.proposals[proposalId];
  const task = p && b.tasks[p.taskId];
  if (!p || p.status !== 'pending' || task?.status !== 'open') return;
  const candidates = ranked.filter((c) => b.volunteers[c.volunteerId]?.duty === 'on_duty');
  if (!candidates.length) return;
  const [top, ...rest] = candidates;
  const helperIds = rest
    .filter((c) => canHelp(task, b.volunteers[c.volunteerId], b.all(), b.now))
    .slice(0, Math.max(0, people - 1))
    .map((c) => c.volunteerId);
  b.proposal({ ...p, candidates, helperIds });
  const was = { top: p.candidates[0]?.volunteerId, helpers: p.helperIds.join() };
  if (top.volunteerId === was.top && helperIds.join() === was.helpers) return;
  const names = [top.volunteerId, ...helperIds].map((id) => b.volunteers[id].name);
  b.ev(
    task.id,
    'proposed',
    `Suggested ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}, waiting for approval`,
    AGENT,
  );
}

/** Freed up → pull the next queued task, delivered spoken since they're now idle. */
function freeUp(b: Batch, volunteerId: string) {
  if (isBusy(b.all(), volunteerId)) return;
  const next = nextQueued(b.all(), volunteerId);
  // One placement funnel means a queued multi-person task also recruits its helpers when it activates.
  if (next) place(b, next, volunteerId, AGENT, 'Freed up');
  else staffShort(b);
}

function settleProposal(
  b: Batch,
  taskId: string,
  status: Proposal['status'],
  volunteerId: string | null,
  byId: string | null,
) {
  const p = Object.values(b.proposals).find((x) => x.taskId === taskId && x.status === 'pending');
  if (p) b.proposal({ ...p, status, volunteerId, decidedById: byId, decidedAt: b.now });
}

/** One scheduler pass: nudges, lead alerts and bumps from lifecycle.tick, proposals nobody approved in time, then shifts. */
export function schedulerStep(b: Batch, taskIds?: readonly string[]) {
  // Tests may tick only their own fixtures while retaining the full world for busy/ranking decisions.
  const scope = taskIds ? new Set(taskIds) : null;
  const mo = b.coordinator();
  for (const task of b.all()) {
    if (scope && !scope.has(task.id)) continue;
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
        b.send(
          a.volunteerId,
          'system',
          `Your team lead has been alerted about “${task.title}”. Send an update when you can.`,
          { taskId: a.taskId },
        );
        const lead = b.leadFor(task.teamSlug) ?? mo;
        if (lead)
          b.send(lead.id, 'escalation', `${first(v)} went quiet: ${task.title}.`, {
            taskId: a.taskId,
          });
      } else if (a.kind === 'remind') {
        if (mo) b.send(mo.id, 'escalation', a.body, { taskId: a.taskId });
      } else if (a.kind === 'helper_released') {
        const helper = b.volunteers[a.volunteerId];
        b.ev(a.taskId, 'lead_alerted', `${first(helper)} didn't answer. Released.`, SCHEDULER);
        b.send(a.volunteerId, 'system', `You're off “${task.title}”.`, { taskId: a.taskId });
        freeUp(b, a.volunteerId);
        const lead = b.leadFor(task.teamSlug) ?? mo;
        if (lead)
          b.send(lead.id, 'escalation', `${first(helper)} didn't answer: ${task.title}. Released.`, {
            taskId: a.taskId,
          });
      } else {
        b.ev(a.taskId, 'bumped', a.body, SCHEDULER);
        const lead = b.leadFor(task.teamSlug);
        if (lead) b.send(lead.id, 'escalation', `Passed to Mo: ${task.title}.`, { taskId: a.taskId });
        if (mo)
          b.send(
            mo.id,
            'escalation',
            isHeld(task)
              ? `Needs your call: ${task.title}. ${task.escalation?.reason ?? ''}`.trim()
              : `${first(v)} asked for help: ${task.title}.`,
            {
              taskId: a.taskId,
            },
          );
      }
    }
  }
  // Nobody approved or changed the AI's pick in time: assign its top pick if they're still free, and whoever it
  // said should go with them. Otherwise the best free one by the rules now, alone.
  for (const p of Object.values(b.proposals)) {
    if (scope && !scope.has(p.taskId)) continue;
    if (!proposalDue(p, b.now)) continue;
    const task = b.tasks[p.taskId];
    const around = (id: string | undefined) => !!id && b.volunteers[id]?.duty === 'on_duty' && !isBusy(b.all(), id);
    const top = p.candidates[0]?.volunteerId;
    const pick =
      task?.status !== 'open'
        ? undefined
        : around(top)
          ? top
          : (
              rankCandidates(task, Object.values(b.volunteers), b.all(), { positions: b.positions, now: b.now })[0] ??
              p.candidates[0]
            )?.volunteerId;
    if (!task || !pick) {
      b.proposal({ ...p, status: 'cancelled', decidedAt: b.now });
      continue;
    }
    const helpers = (pick === top ? p.helperIds : [])
      .filter((id) => id !== pick && around(id) && canHelp(task, b.volunteers[id], b.all(), b.now))
      .map((id): HelperAssignment => ({ volunteerId: id, status: 'notified', assignedAt: b.now, respondedAt: null }));
    const sized = task.mobilizationId ? task : { ...task, requiredCount: Math.max(task.requiredCount, 1 + helpers.length) };
    place(b, sized, pick, AGENT, `auto-assigned, no approval in ${POLICY.autoAssignMs / 1000} s`, [], helpers);
    b.proposal({ ...p, status: 'auto_assigned', volunteerId: pick, decidedAt: b.now });
  }
  staffShort(b, scope);
  if (!scope) finishMobilizations(b);
  shiftStep(b);
}

/** An active mobilization whose tasks are all done or cancelled is over. */
function finishMobilizations(b: Batch) {
  for (const m of Object.values(b.mobilizations)) {
    if (m.status !== 'active') continue;
    const tasks = b.all().filter((t) => t.mobilizationId === m.id);
    if (tasks.length && tasks.every((t) => t.status === 'resolved' || t.status === 'cancelled'))
      b.mobilization({ ...m, status: 'stood_down' });
  }
}

// ── mobilization ──

/** A system-detected situation awaiting Mo's approval. No tasks exist yet; `draft.steps` is a preview only. */
export function proposeMobilization(
  b: Batch,
  draft: {
    title: string;
    rationale: string;
    urgency: Priority;
    zoneSlug: string | null;
    relatedPlaybooks: string[];
    steps: MobilizationStep[];
    evidence?: MobilizationEvidence;
    analysisRunId?: string;
    /** The playbook a trigger planned it from: one pending or running plan per playbook and zone. */
    triggerPlaybook?: string;
  },
): Mobilization {
  assertMobilizationSteps(draft.steps);
  const existing = Object.values(b.mobilizations).find(
    (m) =>
      (m.status === 'proposed' || m.status === 'active') &&
      (draft.analysisRunId
        ? m.analysisRunId === draft.analysisRunId &&
          m.title === draft.title &&
          m.steps.map((s) => s.stepKey).join('|') === draft.steps.map((s) => s.stepKey).join('|')
        : !!draft.triggerPlaybook && m.triggerPlaybook === draft.triggerPlaybook && m.zoneSlug === draft.zoneSlug),
  );
  // Recheck analysis/action identity at the write boundary; different situations in one zone
  // must remain separate. Request-level idempotency is enforced by mobilization_runs.
  if (existing) return existing;
  const m: Mobilization = {
    id: b.id('mobilization'),
    title: draft.title,
    status: 'proposed',
    rationale: draft.rationale,
    relatedPlaybooks: draft.relatedPlaybooks,
    urgency: draft.urgency,
    zoneSlug: draft.zoneSlug,
    steps: draft.steps,
    evidence: draft.evidence ?? null,
    analysisRunId: draft.analysisRunId ?? null,
    playbookSlug: null,
    triggerPlaybook: draft.triggerPlaybook ?? null,
    causes: [],
    createdAt: b.now,
    decidedById: null,
    decidedAt: null,
  };
  b.mobilization(m);
  const mo = b.coordinator();
  if (mo) b.send(mo.id, 'escalation', `Approve: ${draft.title}.`);
  return m;
}

/** Mo acting by hand: active immediately, no self-approval step. `playbookSlug` is a template, freely edited. */
export function createMobilization(
  b: Batch,
  byId: string,
  input: {
    title: string;
    rationale: string;
    urgency: Priority;
    zoneSlug: string | null;
    playbookSlug?: string;
    steps: { teamSlug: TeamSlug; peopleNeeded: number; reason: string }[];
  },
): { mobilization: Mobilization; taskIds: string[] } {
  requireMo(b, byId);
  assertMobilizationSteps(input.steps);
  const m: Mobilization = {
    id: b.id('mobilization'),
    title: input.title,
    status: 'active',
    rationale: input.rationale,
    relatedPlaybooks: input.playbookSlug ? [input.playbookSlug] : [],
    urgency: input.urgency,
    zoneSlug: input.zoneSlug,
    steps: input.steps.map((s) => ({ ...s, candidates: [] })),
    evidence: null,
    playbookSlug: input.playbookSlug ?? null,
    createdAt: b.now,
    decidedById: byId,
    decidedAt: b.now,
  };
  const taskIds = materializeSteps(b, m, byId);
  b.mobilization(m);
  return { mobilization: m, taskIds };
}

/**
 * Approve a proposed mobilization: re-ranks every step fresh (the stored preview is non-binding — see
 * `materializeSteps`) and creates the real tasks.
 */
export function approveMobilization(b: Batch, byId: string, mobilizationId: string): { taskIds: string[] } {
  requireMo(b, byId);
  const m = b.mobilizations[mobilizationId];
  if (!m) throw new CommandError('not_found', `No mobilization ${mobilizationId}`);
  if (m.status !== 'proposed') throw new CommandError('conflict', `Cannot approve mobilization ${mobilizationId}`);
  const active: Mobilization = { ...m, status: 'active', decidedById: byId, decidedAt: b.now };
  const taskIds = materializeSteps(b, active, byId);
  b.mobilization(active);
  return { taskIds };
}

/** Mo declines a system-proposed mobilization. No tasks are ever touched. */
export function rejectMobilization(b: Batch, byId: string, mobilizationId: string) {
  requireMo(b, byId);
  const m = b.mobilizations[mobilizationId];
  if (!m) throw new CommandError('not_found', `No mobilization ${mobilizationId}`);
  if (m.status !== 'proposed') throw new CommandError('conflict', `Cannot reject mobilization ${mobilizationId}`);
  b.mobilization({ ...m, status: 'rejected', decidedById: byId, decidedAt: b.now });
}

/** Close out an active mobilization: its unfinished tasks are cancelled and everyone on them is freed. */
export function standDown(b: Batch, byId: string, mobilizationId: string, outcome: 'stood_down' | 'cancelled') {
  requireMo(b, byId);
  const m = b.mobilizations[mobilizationId];
  if (!m) throw new CommandError('not_found', `No mobilization ${mobilizationId}`);
  if (m.status !== 'active') throw new CommandError('conflict', `Cannot stand down mobilization ${mobilizationId}`);
  b.mobilization({ ...m, status: outcome, decidedById: byId, decidedAt: b.now });
  const open = b.all().filter((t) => t.mobilizationId === m.id && t.status !== 'resolved' && t.status !== 'cancelled');
  for (const task of open) {
    const on = b.onIt(task);
    b.task({
      ...task,
      status: 'cancelled',
      resolution: 'cancelled',
      resolvedAt: b.now,
      etaAt: null,
      helpers: [],
      lastActivityAt: b.now,
    });
    b.ev(task.id, 'resolved', 'Stood down', b.actor(byId));
    for (const id of on) b.send(id, 'closed', `Stood down: ${task.title}.`, { taskId: task.id });
    for (const id of on) freeUp(b, id);
  }
}

/** Mobilizations are venue-wide safety decisions; a team lead cannot activate or dismiss one. */
function requireMo(b: Batch, byId: string) {
  // Supabase maps coordinator/safety_lead/admin to this domain role; do not privilege the first row.
  if (b.volunteers[byId]?.role !== 'coordinator')
    throw new CommandError('forbidden', 'Only Mo can decide a mobilization');
}

/** Each concrete action has its own identity; multiple actions may use the same team. */
function assertMobilizationSteps(
  steps: readonly (Pick<MobilizationStep, 'teamSlug' | 'peopleNeeded' | 'reason'> & Partial<MobilizationStep>)[],
) {
  if (!steps.length) throw new CommandError('invalid', 'A mobilization needs at least one team step');
  const keys = new Set<string>();
  for (const step of steps) {
    if (!Number.isInteger(step.peopleNeeded) || step.peopleNeeded < 1 || step.peopleNeeded > 500)
      throw new CommandError('invalid', 'Each mobilization task needs 1 to 500 people');
    if (!step.reason.trim()) throw new CommandError('invalid', 'Each mobilization step needs a reason');
    const key = step.stepKey ?? step.teamSlug;
    if (keys.has(key)) throw new CommandError('invalid', `Mobilization has duplicate action ${key}`);
    keys.add(key);
  }
}

/**
 * Turn a mobilization's actions into real tasks. Ranks fresh for every action — the step's
 * stored `candidates` (if any) is a preview a human saw, never a binding commitment, mirroring how
 * `schedulerStep`'s auto-assign already re-ranks rather than trusting a stored `Proposal`. Excludes
 * anyone already picked by an earlier step in this same call, so one mobilization doesn't queue two of
 * its own steps behind the same person. A step nobody's free for still gets its task — open, unassigned,
 * with the lead told explicitly — never silently understaffed.
 */
function materializeSteps(b: Batch, m: Mobilization, byId: string): string[] {
  const actor = b.actor(byId);
  const taskIds: string[] = [];
  const pickedSoFar: string[] = [];
  for (const step of m.steps) {
    const draft: Task = {
      id: b.id('task'),
      title: step.title ?? `${m.title} · ${step.teamSlug}`,
      summary: [
        step.instructions ?? step.reason,
        step.completionCriteria ? `Done when: ${step.completionCriteria}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      category: TEAM_CATEGORY[step.teamSlug],
      priority: m.urgency,
      teamSlug: step.teamSlug,
      zoneSlug: step.zoneSlug ?? m.zoneSlug,
      locationHint: null,
      status: 'open',
      assigneeId: null,
      reporter: { kind: 'system', quote: m.rationale, language: 'en' },
      handledBy: 'ai',
      createdAt: b.now,
      assignedAt: null,
      etaAt: null,
      lastActivityAt: b.now,
      nudgeCount: 0,
      lastNudgeAt: null,
      leadAlertedAt: null,
      resolvedAt: null,
      escalation: null,
      requiredCount: step.peopleNeeded,
      helpers: [],
      resolution: null,
      requestId: null,
      mobilizationId: m.id,
      mobilizationStepKey: step.stepKey ?? null,
      requiredSkills: step.requiredSkills ?? [],
    };
    b.ev(draft.id, 'created', `Mobilization: ${m.title}`, actor);
    const picks = rankCandidates(draft, Object.values(b.volunteers), b.all(), {
      positions: b.positions,
      exclude: pickedSoFar,
      limit: 1,
      now: b.now,
    });
    if (!picks.length) {
      b.task(draft);
      const lead = b.leadFor(step.teamSlug) ?? b.coordinator();
      if (lead)
        b.send(lead.id, 'escalation', `No one available for ${step.teamSlug}: ${m.title}.`, {
          taskId: draft.id,
        });
      taskIds.push(draft.id);
      continue;
    }
    if (step.candidates[0] && step.candidates[0].volunteerId !== picks[0].volunteerId) {
      const was = b.volunteers[step.candidates[0].volunteerId]?.name ?? 'The suggested pick';
      b.ev(draft.id, 'note', `${was} was no longer free; assigned to someone else instead.`, SCHEDULER);
    }
    place(b, draft, picks[0].volunteerId, actor, `Mobilization: ${m.title}`, pickedSoFar);
    const final = b.tasks[draft.id];
    const missing = final.requiredCount - 1 - final.helpers.length;
    if (missing > 0) {
      b.ev(final.id, 'note', `Staffing gap: ${missing} of ${final.requiredCount} people still needed.`, actor);
      const lead = b.leadFor(step.teamSlug) ?? b.coordinator();
      if (lead)
        b.send(lead.id, 'escalation', `Staffing gap: ${missing} people needed for ${final.title}.`, {
          taskId: final.id,
        });
    }
    pickedSoFar.push(final.assigneeId!, ...helperIdsOf(final));
    taskIds.push(draft.id);
  }
  return taskIds;
}

/** Task fields a canned report supplies; the command fills in ids, times and lifecycle fields. */
export type TaskDraft = Omit<
  Task,
  | 'id'
  | 'createdAt'
  | 'lastActivityAt'
  | 'status'
  | 'assigneeId'
  | 'assignedAt'
  | 'etaAt'
  | 'nudgeCount'
  | 'lastNudgeAt'
  | 'leadAlertedAt'
  | 'resolvedAt'
  | 'escalation'
  | 'requiredCount'
  | 'helpers'
  | 'resolution'
  | 'requestId'
  | 'mobilizationId'
>;

// ── demo scenarios (the dev panel now, the demo-day simulator later) ──

/** The volunteer's active task goes silent: nudged, then the lead is alerted. */
export function goQuiet(b: Batch, volunteerId: string) {
  const task = b.all().find((t) => t.assigneeId === volunteerId && isActive(t) && t.status !== 'escalated');
  if (!task) return;
  const v = b.volunteers[volunteerId];
  b.task({
    ...task,
    status: task.status === 'assigned' ? 'accepted' : task.status,
    nudgeCount: 1,
    lastNudgeAt: b.now - POLICY.nudgeGapMs,
    leadAlertedAt: b.now,
  });
  b.ev(task.id, 'nudged', `Still on "${task.title}"? Send a quick update.`, SCHEDULER);
  b.ev(task.id, 'lead_alerted', `No update on "${task.title}". Lead alerted.`, SCHEDULER);
  b.send(volunteerId, 'system', `Your team lead has been alerted about “${task.title}”. Send an update when you can.`, {
    taskId: task.id,
  });
  const lead = b.leadFor(task.teamSlug) ?? b.coordinator();
  if (lead) b.send(lead.id, 'escalation', `${first(v)} went quiet: ${task.title}.`, { taskId: task.id });
}

/** A canned report lands on a volunteer. */
export function spawnIncoming(b: Batch, volunteerId: string, draft: TaskDraft) {
  const task: Task = {
    ...draft,
    id: b.id('task'),
    status: 'open',
    assigneeId: null,
    createdAt: b.now,
    assignedAt: null,
    etaAt: null,
    lastActivityAt: b.now,
    nudgeCount: 0,
    lastNudgeAt: null,
    leadAlertedAt: null,
    resolvedAt: null,
    escalation: null,
    requiredCount: 1,
    helpers: [],
    resolution: null,
    requestId: null,
    mobilizationId: null,
  };
  b.ev(task.id, 'created', `Reported by ${draft.reporter.name ?? 'a festival-goer'}`, TRIAGE_AGENT);
  place(b, task, volunteerId, TRIAGE_AGENT, undefined);
}
