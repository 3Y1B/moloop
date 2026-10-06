import { rankCandidates } from '@/lib/candidates';
import { REPLY_LABEL } from '@/lib/format';
import {
  applyReply, assignOrQueue, handoverArrived, HANDOVER_NAME, isActive, isBusy, isOnTask, needsApproval, needsResponse, nextQueued,
  passUp, POLICY, proposalDue, respondToEscalation, tick, type RespondInput,
} from '@/lib/lifecycle';
import { routeBetween } from '@/lib/route';
import type {
  Duty, GuestRequest, IncidentCategory, Message, Priority, Proposal, ReplyKind, Task, TaskEvent, TeamSlug, Volunteer,
} from '@/lib/schema';
import type { BroadcastScope, DevControls, Interpretation, Repo, Snapshot } from '../repo';
import { GUEST_ANSWERS, GUEST_SCRIPTS, INCOMING, initialSnapshot, ME_ID, MO_ID } from './fixtures';

const SCHEDULER_MS = 5_000;
/** How long a festival-goer sees "Understanding" before the answer or the dispatch. */
const UNDERSTANDING_MS = 1_500;
const MIN = 60_000;

// Stand-in for the server classifier. Order matters: "need help" before "help"-ish report words.
const REPLY_PATTERNS: [ReplyKind, RegExp][] = [
  ['need_help', /\b(need (some )?help|need backup|send (help|backup)|can'?t handle)\b/i],
  ['done', /\b(done|all good|sorted|finished|resolved|all clear)\b/i],
  ['still_on_it', /\b(still on it|running late|delayed|few more min(ute)?s|held up)\b/i],
  ['decline', /\b(can'?t take|decline|not me)\b/i],
  ['accept', /\b(accept|copy|got it|roger|on it|will do|on my way|omw|heading (there|over))\b/i],
];

// Stand-in for triage: keyword → team + priority.
const TRIAGE: { team: TeamSlug; re: RegExp }[] = [
  { team: 'first-aid', re: /(collapsed|faint|bleed|injur|hurt|dizzy|heat|unconscious|sting|vomit|asthma|breath|blister|plaster|sunscreen)/i },
  { team: 'welfare', re: /(lost (child|kid)|can'?t find (my|their)|crying|harass|unsafe|lost property)/i },
  { team: 'crowd', re: /(queue|crowd|crush|gate|barrier|packed)/i },
  { team: 'security', re: /(fight|theft|stole|weapon|aggressive|drunk)/i },
  { team: 'artist', re: /(artist|green room|backstage|rider|band)/i },
  { team: 'vendors', re: /(vendor|stall|food|gas|bbq)/i },
  { team: 'ops', re: /(spill|bin|power|light|toilet|cable|water station|leak)/i },
];
const P1 = /(unconscious|not breathing|not responding|isn'?t responding|collapsed|lost (child|kid)|weapon|crush)/i;
/** First aid that can wait: P3 rather than P2. */
const MINOR = /(blister|plaster|sunscreen|band-?aid|graze|ice pack)/i;
/** Stand-in for the AI reading "Add detail": does it sound worse? */
const WORSE = /(worse|not breathing|can'?t breathe|unconscious|not responding|collapsed|bleeding|seizure|passed out|chest pain|vomit)/i;
const QUESTION = /^(where|what|when|how|is|are|can i|do|does|which)\b|\?\s*$/i;

const TEAM_CATEGORY: Record<TeamSlug, IncidentCategory> = {
  'first-aid': 'medical', welfare: 'other', crowd: 'crowding', security: 'security',
  info: 'info_request', artist: 'artist', vendors: 'vendor', ops: 'facilities',
};

const BUMP: Record<Priority, Priority> = { P3: 'P2', P2: 'P1', P1: 'P1' };

const first = (v: Volunteer | undefined) => v?.name.split(' ')[0] ?? 'Someone';
/** "Priya S.": what a festival-goer sees. */
const shortName = (v: Volunteer) => {
  const [f, l] = v.name.split(' ');
  return l ? `${f} ${l[0]}.` : f;
};
const titleFrom = (text: string) => {
  const t = text.length > 55 ? `${text.slice(0, 52).trim()}…` : text;
  return t[0].toUpperCase() + t.slice(1);
};

function triage(text: string): { team: TeamSlug; priority: Priority } {
  const team = TRIAGE.find((x) => x.re.test(text))?.team ?? 'ops';
  const priority: Priority = P1.test(text) ? 'P1'
    : team === 'first-aid' && MINOR.test(text) ? 'P3'
      : team === 'first-aid' || team === 'security' || team === 'welfare' ? 'P2' : 'P3';
  return { team, priority };
}

/** A routine question the AI can answer itself, or null if someone needs to come. */
function routineAnswer(text: string): string | null {
  if (!QUESTION.test(text.trim()) || P1.test(text) || WORSE.test(text)) return null;
  if (TRIAGE.some((x) => (x.team === 'first-aid' || x.team === 'security') && x.re.test(text))) return null;
  return GUEST_ANSWERS.find((a) => a.re.test(text))?.answer ?? null;
}

type Actor = TaskEvent['actor'];
const AGENT: Actor = { kind: 'agent', name: 'Assign' };
const TRIAGE_AGENT: Actor = { kind: 'agent', name: 'Triage' };
const SCHEDULER: Actor = { kind: 'system', name: 'Scheduler' };

/** One state change, built up and then applied in a single emit. */
class Batch {
  tasks: Record<string, Task>;
  proposals: Record<string, Proposal>;
  requests: Record<string, GuestRequest>;
  volunteers: Record<string, Volunteer>;
  events: TaskEvent[] = [];
  messages: Message[] = [];

  constructor(s: Snapshot) {
    this.tasks = s.tasks;
    this.proposals = s.proposals;
    this.requests = s.requests;
    this.volunteers = s.volunteers;
  }

  task(t: Task) {
    this.tasks = { ...this.tasks, [t.id]: t };
  }
  proposal(p: Proposal) {
    this.proposals = { ...this.proposals, [p.id]: p };
  }
  request(r: GuestRequest) {
    this.requests = { ...this.requests, [r.id]: r };
  }
  all = () => Object.values(this.tasks);
}

export class MockRepo implements Repo {
  private state: Snapshot;
  private listeners = new Set<() => void>();
  private offset = 0;
  private seq = 0;

  constructor() {
    this.state = initialSnapshot(Date.now());
    setInterval(() => this.runScheduler(), SCHEDULER_MS);
  }

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // ── volunteer commands ──

  async reply(taskId: string, reply: ReplyKind, note?: string) {
    this.replyAs(this.state.meId ?? '', taskId, reply, note);
  }

  async setDuty(duty: Duty) {
    const me = this.me();
    if (!me) return;
    this.set({ volunteers: { ...this.state.volunteers, [me.id]: { ...me, duty } } });
  }

  async interpret(text: string): Promise<Interpretation> {
    const heard = text.trim();
    const active = this.myActive();
    // A helper can only finish; escalating is the owner's call.
    const helping = active && active.assigneeId !== this.state.meId;
    const match = REPLY_PATTERNS.find(([kind, re]) => re.test(heard) && !(helping && kind !== 'done'));
    // Long utterances are reports even if they contain "done" etc. Replies are short.
    if (active && match && heard.split(/\s+/).length <= 8) {
      return { heard, intent: { kind: 'reply', taskId: active.id, reply: match[0] } };
    }
    return { heard, intent: { kind: 'report' } };
  }

  async commit(i: Interpretation) {
    if (i.intent.kind === 'reply') {
      // Keep the reason, drop the trigger phrase: "need help, he's getting worse" → "he's getting worse".
      const note = i.intent.reply === 'need_help'
        ? i.heard.replace(REPLY_PATTERNS[0][1], '').replace(/^[\s,.;:-]+/, '').trim() || undefined
        : i.heard;
      await this.reply(i.intent.taskId, i.intent.reply, note);
      return { confirmation: `Sent “${REPLY_LABEL[i.intent.reply]}”` };
    }
    return this.fileReport(i.heard);
  }

  async markRead(ids: string[]) {
    const set = new Set(ids);
    if (!this.state.messages.some((m) => set.has(m.id) && !m.read)) return;
    this.set({ messages: this.state.messages.map((m) => (set.has(m.id) ? { ...m, read: true } : m)) });
  }

  async guestReply(taskId: string, text: string) {
    const me = this.me();
    const task = this.state.tasks[taskId];
    const request = task?.requestId ? this.state.requests[task.requestId] : undefined;
    if (!me || !task || !request) throw new Error(`Task ${taskId} has no festival-goer to reply to`);
    const b = this.batch();
    const now = this.now();
    b.request({ ...request, thread: [...request.thread, { from: 'staff', name: shortName(me), text, at: now }] });
    this.ev(b, taskId, 'note', 'Replied to the festival-goer', this.actor(me.id), { note: text });
    this.apply(b);
  }

  // ── lead and Mo commands ──

  async respond(taskId: string, response: RespondInput) {
    this.respondAs(this.state.meId ?? '', taskId, response);
  }

  async passToCoordinator(taskId: string) {
    const now = this.now();
    const task = this.state.tasks[taskId];
    const me = this.me();
    const mo = this.coordinator();
    const t = task && passUp(task, mo?.id ?? null, now);
    if (!t || !me) throw new Error(`Cannot pass task ${taskId} to Mo`);
    const b = this.batch();
    b.task(t.task);
    this.ev(b, taskId, 'bumped', `${me.name} passed it to Mo`, this.actor(me.id));
    if (mo) this.send(b, mo.id, 'escalation', `${first(me)} passed on: ${task.title}.`, { taskId });
    this.apply(b);
  }

  async arrived(taskId: string) {
    const now = this.now();
    const task = this.state.tasks[taskId];
    const me = this.me();
    const t = task && handoverArrived(task, now);
    if (!t || !me) throw new Error(`Task ${taskId} is not waiting on a handover`);
    const b = this.batch();
    b.task(t.task);
    this.ev(b, taskId, 'resolved', t.text, this.actor(me.id));
    for (const id of this.onIt(task)) {
      this.send(b, id, 'arrived', `${t.text}: ${task.title}. You’re free.`, { taskId });
      this.freeUp(b, id, now);
    }
    this.apply(b);
  }

  async assign(taskId: string, volunteerId: string) {
    this.assignAs(this.state.meId ?? '', taskId, volunteerId);
  }

  async approve(proposalId: string, volunteerId?: string) {
    const p = this.state.proposals[proposalId];
    const pick = volunteerId ?? p?.candidates[0]?.volunteerId;
    if (!p || p.status !== 'pending' || !pick) throw new Error(`Cannot approve proposal ${proposalId}`);
    this.assignAs(this.state.meId ?? '', p.taskId, pick, 'approved');
  }

  async broadcast(body: string, scope: BroadcastScope = {}) {
    this.broadcastAs(this.state.meId ?? '', body, scope);
  }

  async sendDirect(volunteerId: string, body: string) {
    const me = this.me();
    if (!me) return;
    const b = this.batch();
    this.send(b, volunteerId, 'direct', body, { fromName: me.name });
    this.apply(b);
  }

  // ── festival-goer commands ──

  async guestAsk(text: string, zoneSlug: string | null, locationHint: string | null = null) {
    const now = this.now();
    const heard = text.trim();
    const request: GuestRequest = {
      id: this.id('r'), createdAt: now, heard, zoneSlug, locationHint, stage: 'understanding', aiAnswer: null, taskId: null,
      thread: [{ from: 'guest', text: heard, at: now }], reopenedAt: null,
    };
    this.set({ requests: { ...this.state.requests, [request.id]: request } });
    setTimeout(() => this.understand(request.id), UNDERSTANDING_MS);
    return request.id;
  }

  async guestRequestHuman(requestId: string) {
    const r = this.state.requests[requestId];
    if (!r || r.taskId) return;
    const b = this.batch();
    // A person to talk to: routine by definition, for the team that fits (Info if nothing does).
    const team = TRIAGE.find((x) => x.re.test(r.heard))?.team ?? 'info';
    this.createGuestTask(b, r, { team, priority: 'P3' }, this.now());
    this.apply(b);
  }

  async guestAddDetail(requestId: string, text: string) {
    const r = this.state.requests[requestId];
    if (!r) throw new Error(`No request ${requestId}`);
    const now = this.now();
    const b = this.batch();
    const task = r.taskId ? this.state.tasks[r.taskId] : undefined;
    const thread = [...r.thread, { from: 'guest' as const, text, at: now }];

    if (!task || (!isActive(task) && task.status !== 'open' && task.status !== 'queued')) {
      // Nothing open to add to: treat it as asking for a person, with the detail as the report.
      const withDetail = { ...r, heard: `${r.heard}. ${text}`, thread, taskId: null };
      const { team, priority } = triage(withDetail.heard);
      this.createGuestTask(b, withDetail, { team, priority }, now);
      this.apply(b);
      return { escalated: priority !== 'P3' };
    }

    const worse = WORSE.test(text);
    const updated: Task = worse ? { ...task, priority: BUMP[task.priority] } : task;
    b.task({ ...updated, summary: `${task.summary} Update: ${text}` });
    this.ev(b, task.id, 'note', worse ? `Festival-goer says it’s worse. Now ${updated.priority}` : 'Detail from the festival-goer', { kind: 'agent', name: 'Triage' }, { note: text });
    for (const id of this.onIt(task)) this.send(b, id, 'guest_reply', `Update: “${text}”`, { taskId: task.id, fromName: 'Festival-goer' });
    if (worse) {
      const lead = this.leadFor(task.teamSlug) ?? this.coordinator();
      if (lead) this.send(b, lead.id, 'escalation', `Worse: ${task.title}. Now ${updated.priority}.`, { taskId: task.id });
    }
    b.request({ ...r, thread: [...thread, { from: 'ai', text: worse ? 'Lead alerted.' : 'Note added.', at: now }] });
    this.apply(b);
    return { escalated: worse };
  }

  async guestCancel(requestId: string) {
    const r = this.state.requests[requestId];
    if (!r) return;
    const now = this.now();
    const b = this.batch();
    b.request({ ...r, stage: 'cancelled' });
    const task = r.taskId ? this.state.tasks[r.taskId] : undefined;
    if (task && task.status !== 'resolved' && task.status !== 'cancelled') {
      b.task({ ...task, status: 'cancelled', resolution: 'cancelled', resolvedAt: now, etaAt: null });
      this.ev(b, task.id, 'resolved', 'Cancelled by the festival-goer', { kind: 'human', name: 'Festival-goer' });
      this.settleProposal(b, task.id, 'cancelled', null, null, now);
      for (const id of this.onIt(task)) {
        this.send(b, id, 'closed', `Cancelled by the festival-goer: ${task.title}.`, { taskId: task.id });
        this.freeUp(b, id, now);
      }
    }
    this.apply(b);
  }

  async guestReopen(requestId: string) {
    const r = this.state.requests[requestId];
    if (!r) return;
    const task = r.taskId ? this.state.tasks[r.taskId] : undefined;
    if (!task) return this.guestRequestHuman(requestId);
    if (task.status !== 'resolved') return;
    const now = this.now();
    const b = this.batch();
    b.request({ ...r, reopenedAt: now, thread: [...r.thread, { from: 'guest', text: 'Still need help', at: now }] });
    const fresh: Task = {
      ...task, status: 'open', assigneeId: null, helperIds: [], escalation: null, resolution: null, resolvedAt: null,
      etaAt: null, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, lastActivityAt: now,
    };
    this.ev(b, task.id, 'note', 'Reopened: festival-goer still needs help', { kind: 'human', name: 'Festival-goer' });
    // Same volunteer if they're still around: they know the situation.
    const prev = task.assigneeId ? this.state.volunteers[task.assigneeId] : undefined;
    if (prev?.duty === 'on_duty') this.place(b, fresh, prev.id, now, AGENT, `Reopened, back to ${prev.name}`);
    else this.dispatch(b, fresh, now);
    this.apply(b);
  }

  dev: DevControls = {
    setMe: (id) => this.set({ meId: id }),
    advance: (ms) => {
      this.offset += ms;
      this.runScheduler();
    },
    clockOffsetMs: () => this.offset,
    spawnIncoming: (priority: Priority = 'P2') => this.spawnIncoming(priority),
    reset: () => {
      this.offset = 0;
      this.state = initialSnapshot(Date.now());
      this.emit();
    },
    askForHelp: (volunteerId = ME_ID) => {
      const task = Object.values(this.state.tasks).find((t) => t.assigneeId === volunteerId && isActive(t));
      if (!task) return;
      if (task.status === 'assigned') this.replyAs(volunteerId, task.id, 'accept');
      if (this.state.tasks[task.id].status !== 'escalated') this.replyAs(volunteerId, task.id, 'need_help', 'He’s getting worse');
    },
    goQuiet: (volunteerId = 'v-linh') => this.goQuiet(volunteerId),
    guestQuestion: () => void this.guestAsk(GUEST_SCRIPTS.question.text, GUEST_SCRIPTS.question.zoneSlug),
    guestReport: () => void this.guestAsk(GUEST_SCRIPTS.report.text, GUEST_SCRIPTS.report.zoneSlug),
    guestP1Report: () => void this.guestAsk(GUEST_SCRIPTS.p1.text, GUEST_SCRIPTS.p1.zoneSlug),
    moRespond: () => this.moRespond(),
    moBroadcast: (body = 'Heat check: drink water now, and take your break in the shade.') => this.broadcastAs(MO_ID, body, {}),
  };

  // ── internals: acting as someone ──

  private replyAs(actorId: string, taskId: string, reply: ReplyKind, note?: string) {
    const now = this.now();
    const task = this.state.tasks[taskId];
    const me = this.state.volunteers[actorId];
    const lead = task ? this.leadFor(task.teamSlug) : undefined;
    const mo = this.coordinator();
    const t = task && applyReply(task, reply, now, note, { leadId: lead?.id ?? null, coordinatorId: mo?.id ?? null });
    if (!t || !me) throw new Error(`Cannot ${reply} task ${taskId} in status ${task?.status}`);
    if (reply !== 'done' && task.assigneeId !== actorId) throw new Error(`Only the owner can ${reply} task ${taskId}`);

    const b = this.batch();
    b.task(t.task);
    this.ev(b, taskId, reply === 'done' ? 'resolved' : reply === 'need_help' ? 'escalated' : 'reply', t.text, this.actor(me.id), { reply, note });
    // Stand-in for GPS: finishing a task means you were at its zone.
    if (reply === 'done' && task.zoneSlug) b.volunteers = { ...b.volunteers, [me.id]: { ...me, zoneSlug: task.zoneSlug } };

    if (reply === 'need_help') {
      const owner = t.task.escalation?.level === 'lead' ? lead : mo;
      this.send(b, me.id, 'system', `Asked ${owner ? `${first(owner)} ` : ''}for help: ${task.title}.`, { taskId });
      if (owner) this.send(b, owner.id, 'escalation', `${first(me)} asked for help: ${task.title}.`, { taskId });
    }
    if (reply === 'decline') this.ev(b, taskId, 'reassigned', 'Back in the pool for reassignment', AGENT);
    // Done from anyone resolves it for everyone on it; each of them pulls their next queued task.
    if (reply === 'done') {
      for (const id of this.onIt(task)) {
        if (id !== me.id) this.send(b, id, 'system', `${first(me)} marked it done: ${task.title}.`, { taskId });
        this.freeUp(b, id, now);
      }
    }
    if (reply === 'decline') this.freeUp(b, me.id, now);
    this.apply(b);
  }

  private respondAs(byId: string, taskId: string, input: RespondInput) {
    const now = this.now();
    const task = this.state.tasks[taskId];
    const by = this.state.volunteers[byId];
    if (!task || !by) throw new Error(`Cannot respond to task ${taskId}`);
    const target = input.volunteerId ? this.state.volunteers[input.volunteerId] : undefined;
    const t = respondToEscalation(
      task, { ...input, etaAt: input.etaAt ?? this.responseEta(task, input, now) }, byId, now,
      input.kind === 'reassign' && !!target && isBusy(Object.values(this.state.tasks), target.id),
    );
    if (!t) throw new Error(`Cannot ${input.kind} task ${taskId} in status ${task.status}`);

    const b = this.batch();
    b.task(t.task);
    const owner = task.assigneeId ? this.state.volunteers[task.assigneeId] : undefined;
    const actor = this.actor(byId);
    const note = input.note ? { note: input.note } : {};

    switch (input.kind) {
      case 'backup':
        this.ev(b, taskId, 'responded', `${by.name} sent ${target?.name ?? 'backup'}`, actor, note);
        if (target) this.send(b, target.id, 'backup', `Help ${first(owner)}: ${task.title}.`, { taskId, delivery: 'spoken' });
        if (owner) this.send(b, owner.id, 'backup', `${first(target)} is joining you.`, { taskId });
        break;
      case 'handover':
        this.ev(b, taskId, 'responded', `${by.name} handed over to ${HANDOVER_NAME[input.target!]}`, actor, note);
        if (owner) this.send(b, owner.id, 'system', `${HANDOVER_NAME[input.target!][0].toUpperCase()}${HANDOVER_NAME[input.target!].slice(1)} on the way: ${task.title}.`, { taskId });
        break;
      case 'reassign': {
        const queued = t.task.status === 'queued';
        this.ev(b, taskId, 'reassigned', `${by.name} moved it to ${target?.name}`, actor, note);
        this.ev(b, taskId, queued ? 'queued' : 'assigned', `${queued ? 'Queued for' : 'Assigned to'} ${target?.name}`, actor);
        if (target) {
          this.send(b, target.id, 'task', queued ? `New task queued: ${task.title}. Check the app.` : `New task: ${task.title}. ${task.summary}`, { taskId, delivery: queued ? 'ping' : 'spoken' });
        }
        for (const id of this.onIt(task).filter((x) => x !== target?.id)) {
          this.send(b, id, 'moved', `Moved to ${first(target)}: ${task.title}.`, { taskId });
          this.freeUp(b, id, now);
        }
        break;
      }
      case 'call':
        this.ev(b, taskId, 'responded', `${by.name} called ${owner?.name ?? 'the volunteer'}`, actor, note);
        break;
      case 'close':
        this.ev(b, taskId, 'resolved', `Closed by ${by.name}`, actor, note);
        for (const id of this.onIt(task)) {
          this.send(b, id, 'closed', `Closed by ${first(by)}: ${task.title}.`, { taskId });
          this.freeUp(b, id, now);
        }
        break;
      case 'carry_on':
        this.ev(b, taskId, 'responded', `${by.name}: carry on`, actor, note);
        break;
    }
    this.apply(b);
  }

  /** Walking time for backup or medics, so screens can say "~3 min". */
  private responseEta(task: Task, input: RespondInput, now: number): number | undefined {
    const from = input.kind === 'backup' ? this.state.volunteers[input.volunteerId ?? '']?.zoneSlug ?? null
      : input.kind === 'handover' && input.target === 'medics' ? 'first-aid-hq'
        : null;
    const walk = from ? routeBetween(from, task.zoneSlug) : null;
    return walk ? now + Math.max(1, walk.minutes) * MIN : undefined;
  }

  private assignAs(byId: string, taskId: string, volunteerId: string, how: 'assigned' | 'approved' = 'assigned') {
    const now = this.now();
    const task = this.state.tasks[taskId];
    const by = this.state.volunteers[byId];
    const target = this.state.volunteers[volunteerId];
    if (!task || !by || !target || task.status === 'resolved' || task.status === 'cancelled') throw new Error(`Cannot assign task ${taskId}`);
    const b = this.batch();
    const queuedFor = task.status === 'queued' && task.assigneeId ? [task.assigneeId] : [];
    const prev = [...this.onIt(task), ...queuedFor].filter((id) => id !== volunteerId);
    const fresh: Task = {
      ...task, status: 'open', assigneeId: null, helperIds: [], escalation: null, etaAt: null,
      nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, lastActivityAt: now,
    };
    this.place(b, fresh, volunteerId, now, this.actor(byId), `${how === 'approved' ? 'Approved' : 'Assigned'} by ${by.name}`);
    this.settleProposal(b, taskId, 'approved', volunteerId, byId, now);
    for (const id of prev) {
      this.send(b, id, 'moved', `Moved to ${first(target)}: ${task.title}.`, { taskId });
      this.freeUp(b, id, now);
    }
    this.apply(b);
  }

  private broadcastAs(byId: string, body: string, scope: BroadcastScope) {
    const by = this.state.volunteers[byId];
    if (!by) return;
    const b = this.batch();
    for (const v of Object.values(this.state.volunteers)) {
      if (v.id === byId || v.duty !== 'on_duty') continue;
      if (scope.teamSlug && v.teamSlug !== scope.teamSlug) continue;
      if (scope.zoneSlug && v.zoneSlug !== scope.zoneSlug) continue;
      this.send(b, v.id, 'broadcast', body, { fromName: by.name });
    }
    this.apply(b);
  }

  private goQuiet(volunteerId: string) {
    const task = Object.values(this.state.tasks).find((t) => t.assigneeId === volunteerId && isActive(t) && t.status !== 'escalated');
    if (!task) return;
    const now = this.now();
    const b = this.batch();
    const v = this.state.volunteers[volunteerId];
    b.task({ ...task, status: task.status === 'assigned' ? 'accepted' : task.status, nudgeCount: 1, lastNudgeAt: now - POLICY.nudgeGapMs, leadAlertedAt: now });
    this.ev(b, task.id, 'nudged', `Still on "${task.title}"? Send a quick update.`, SCHEDULER);
    this.ev(b, task.id, 'lead_alerted', `No update on "${task.title}". Lead alerted.`, SCHEDULER);
    this.send(b, volunteerId, 'system', `Your team lead has been alerted about “${task.title}”. Send an update when you can.`, { taskId: task.id });
    const lead = this.leadFor(task.teamSlug) ?? this.coordinator();
    if (lead) this.send(b, lead.id, 'escalation', `${first(v)} went quiet: ${task.title}.`, { taskId: task.id });
    this.apply(b);
  }

  /** Mo answers everything bumped to them: backup from the nearest free teammate, else medics. */
  private moRespond() {
    const tasks = Object.values(this.state.tasks).filter((t) => needsResponse(t) && t.escalation?.level === 'coordinator');
    for (const t of tasks) {
      const current = this.state.tasks[t.id];
      const free = rankCandidates(current, Object.values(this.state.volunteers), Object.values(this.state.tasks))
        .find((c) => !isBusy(Object.values(this.state.tasks), c.volunteerId) && this.state.volunteers[c.volunteerId]?.teamSlug === current.teamSlug);
      this.respondAs(MO_ID, t.id, free ? { kind: 'backup', volunteerId: free.volunteerId } : { kind: 'handover', target: 'medics' });
    }
    return tasks.length;
  }

  // ── internals: shared steps ──

  /** Mock AI: a routine question gets an answer; anything else becomes a task. */
  private understand(requestId: string) {
    const r = this.state.requests[requestId];
    if (!r || r.stage !== 'understanding') return;
    const now = this.now();
    const b = this.batch();
    const answer = routineAnswer(r.heard);
    if (answer) b.request({ ...r, stage: 'answered', aiAnswer: answer, thread: [...r.thread, { from: 'ai', text: answer, at: now }] });
    else this.createGuestTask(b, r, triage(r.heard), now);
    this.apply(b);
  }

  private createGuestTask(b: Batch, r: GuestRequest, { team, priority }: { team: TeamSlug; priority: Priority }, now: number) {
    const task: Task = {
      id: this.id('t'), title: titleFrom(r.heard), summary: r.heard, priority, teamSlug: team,
      category: team === 'welfare' && /child|kid|son|daughter/i.test(r.heard) ? 'lost_child' : TEAM_CATEGORY[team],
      zoneSlug: r.zoneSlug, locationHint: r.locationHint, status: 'open', assigneeId: null, handledBy: 'ai',
      reporter: { kind: 'festivalgoer', quote: r.heard, language: 'en' },
      createdAt: now, assignedAt: null, etaAt: null, lastActivityAt: now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null,
      resolvedAt: null, escalation: null, helperIds: [], resolution: null, requestId: r.id,
    };
    this.ev(b, task.id, 'created', 'Reported by a festival-goer', TRIAGE_AGENT);
    b.request({ ...r, stage: 'finding', taskId: task.id });
    this.dispatch(b, task, now);
  }

  /** P1/P2: a proposal a human can approve (auto-assigns later). P3: straight to the top pick. */
  private dispatch(b: Batch, task: Task, now: number) {
    const candidates = rankCandidates(task, Object.values(b.volunteers), b.all());
    if (needsApproval(task.priority)) {
      b.task(task);
      const p: Proposal = {
        id: this.id('p'), taskId: task.id, candidates, createdAt: now, autoAssignAt: now + POLICY.autoAssignMs,
        status: 'pending', volunteerId: null, decidedById: null, decidedAt: null,
      };
      b.proposal(p);
      const top = candidates[0] ? b.volunteers[candidates[0].volunteerId] : undefined;
      this.ev(b, task.id, 'proposed', top ? `Suggested ${top.name}, waiting for approval` : 'Nobody suggested yet', AGENT);
      const lead = this.leadFor(task.teamSlug);
      const mo = this.coordinator();
      for (const who of [lead, task.priority === 'P1' || !lead ? mo : undefined]) {
        if (who) this.send(b, who.id, 'escalation', `Approve: ${task.title}.`, { taskId: task.id });
      }
      return;
    }
    const top = candidates[0];
    if (top) return this.place(b, task, top.volunteerId, now, AGENT, undefined);
    b.task(task);
    const lead = this.leadFor(task.teamSlug) ?? this.coordinator();
    if (lead) this.send(b, lead.id, 'escalation', `Unassigned: ${task.title}.`, { taskId: task.id });
  }

  /** Assign (free) or queue (busy), with the event and the right delivery: spoken when idle, a ping when busy. */
  private place(b: Batch, task: Task, volunteerId: string, now: number, actor: Actor, why: string | undefined) {
    const v = b.volunteers[volunteerId];
    const busy = isBusy(b.all().filter((t) => t.id !== task.id), volunteerId);
    const placed = assignOrQueue(task, volunteerId, busy, now);
    b.task(placed);
    this.ev(b, task.id, busy ? 'queued' : 'assigned', `${busy ? 'Queued for' : 'Assigned to'} ${v?.name ?? 'a volunteer'}${why ? ` (${why})` : ''}`, actor);
    this.send(
      b, volunteerId, 'task',
      busy ? `New task queued: ${task.title}. Check the app.` : `New task: ${task.title}. ${task.summary}`,
      { taskId: task.id, delivery: busy ? 'ping' : 'spoken' },
    );
  }

  /** Freed up → pull the next queued task, delivered spoken since they're now idle. */
  private freeUp(b: Batch, volunteerId: string, now: number) {
    if (isBusy(b.all(), volunteerId)) return;
    const next = nextQueued(b.all(), volunteerId);
    if (!next) return;
    b.task(assignOrQueue(next, volunteerId, false, now));
    this.ev(b, next.id, 'assigned', `Assigned to ${b.volunteers[volunteerId]?.name} (freed up)`, AGENT);
    this.send(b, volunteerId, 'task', `Next up: ${next.title}. ${next.summary}`, { taskId: next.id, delivery: 'spoken' });
  }

  private settleProposal(b: Batch, taskId: string, status: Proposal['status'], volunteerId: string | null, byId: string | null, now: number) {
    const p = Object.values(b.proposals).find((x) => x.taskId === taskId && x.status === 'pending');
    if (p) b.proposal({ ...p, status, volunteerId, decidedById: byId, decidedAt: now });
  }

  private runScheduler() {
    const now = this.now();
    const b = this.batch();
    const mo = this.coordinator();
    for (const task of b.all()) {
      const r = tick(task, now, mo?.id ?? null);
      if (!r) continue;
      b.task(r.task);
      const v = this.state.volunteers[task.assigneeId ?? ''];
      for (const a of r.alerts) {
        if (a.kind === 'nudge') {
          this.ev(b, a.taskId, 'nudged', a.body, SCHEDULER);
          this.send(b, a.volunteerId, 'nudge', a.body, { taskId: a.taskId });
        } else if (a.kind === 'lead_alert') {
          this.ev(b, a.taskId, 'lead_alerted', a.body, SCHEDULER);
          this.send(b, a.volunteerId, 'system', `Your team lead has been alerted about “${task.title}”. Send an update when you can.`, { taskId: a.taskId });
          const lead = this.leadFor(task.teamSlug) ?? mo;
          if (lead) this.send(b, lead.id, 'escalation', `${first(v)} went quiet: ${task.title}.`, { taskId: a.taskId });
        } else {
          this.ev(b, a.taskId, 'bumped', a.body, SCHEDULER);
          const lead = this.leadFor(task.teamSlug);
          if (lead) this.send(b, lead.id, 'escalation', `Passed to Mo: ${task.title}.`, { taskId: a.taskId });
          if (mo) this.send(b, mo.id, 'escalation', `${first(v)} asked for help: ${task.title}.`, { taskId: a.taskId });
        }
      }
    }
    // Nobody approved or changed the AI's pick in time: assign the top pick that's still around.
    for (const p of Object.values(b.proposals)) {
      if (!proposalDue(p, now)) continue;
      const task = b.tasks[p.taskId];
      const pick = task?.status === 'open'
        ? (rankCandidates(task, Object.values(b.volunteers), b.all())[0] ?? p.candidates[0])?.volunteerId
        : undefined;
      if (!task || !pick) {
        b.proposal({ ...p, status: 'cancelled', decidedAt: now });
        continue;
      }
      this.place(b, task, pick, now, AGENT, `auto-assigned, no approval in ${POLICY.autoAssignMs / 1000} s`);
      b.proposal({ ...p, status: 'auto_assigned', volunteerId: pick, decidedAt: now });
    }
    this.apply(b);
  }

  private spawnIncoming(priority: Priority) {
    const me = this.me();
    if (!me) return;
    const now = this.now();
    const base = INCOMING[priority][0];
    const task: Task = {
      ...base, id: this.id('t'), status: 'open', assigneeId: null, createdAt: now, assignedAt: null, etaAt: null,
      lastActivityAt: now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null,
      escalation: null, helperIds: [], resolution: null, requestId: null,
    };
    const b = this.batch();
    this.ev(b, task.id, 'created', `Reported by ${base.reporter.name ?? 'a festival-goer'}`, TRIAGE_AGENT);
    this.place(b, task, me.id, now, TRIAGE_AGENT, undefined);
    this.apply(b);
  }

  private fileReport(text: string) {
    const now = this.now();
    const me = this.me();
    const { team, priority } = triage(text);
    const tasks = Object.values(this.state.tasks);
    const candidates = Object.values(this.state.volunteers).filter(
      (v) => v.teamSlug === team && v.role === 'volunteer' && v.duty === 'on_duty' && v.id !== me?.id,
    );
    const free = candidates.find((v) => !isBusy(tasks, v.id));
    const who = free ?? candidates[0];
    const draft: Task = {
      id: this.id('t'), title: titleFrom(text), summary: text, category: 'other', priority, teamSlug: team,
      zoneSlug: me?.zoneSlug ?? null, locationHint: null, status: 'open', assigneeId: null, handledBy: 'human',
      reporter: { kind: 'volunteer', name: me?.name, quote: text, language: 'en' },
      createdAt: now, assignedAt: null, etaAt: null, lastActivityAt: now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null,
      escalation: null, helperIds: [], resolution: null, requestId: null,
    };
    const b = this.batch();
    this.ev(b, draft.id, 'created', 'Reported by voice', me ? this.actor(me.id) : { kind: 'human' });
    if (who) this.place(b, draft, who.id, now, AGENT, undefined);
    else b.task(draft);
    this.apply(b);
    // Triage + assignment run after Send on the server, so the reporter hears back via Inbox, not inline.
    const teamName = this.state.teams[team]?.name ?? team;
    const outcome = who
      ? `Your report “${draft.title}” went to ${teamName}. ${first(who)} ${free ? 'is on it' : 'has it next'}.`
      : `Your report “${draft.title}” is with ${teamName}. A lead will pick it up.`;
    const reporterId = me?.id;
    if (reporterId) {
      setTimeout(() => {
        const later = this.batch();
        this.send(later, reporterId, 'system', outcome, { taskId: draft.id });
        this.apply(later);
      }, 4_000);
    }
    return { confirmation: 'Report sent' };
  }

  // ── internals: plumbing ──

  private now = () => Date.now() + this.offset;
  private id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++this.seq}`;
  private me = () => (this.state.meId ? this.state.volunteers[this.state.meId] : undefined);
  private myActive = () => Object.values(this.state.tasks).find((t) => !!this.state.meId && isOnTask(t, this.state.meId));
  private coordinator = () => Object.values(this.state.volunteers).find((v) => v.role === 'coordinator');
  private leadFor = (team: TeamSlug | null) =>
    Object.values(this.state.volunteers).find((v) => v.role === 'team_lead' && v.teamSlug === team);
  /** Everyone working a task right now: the owner and any helpers. */
  private onIt = (task: Task) => (isActive(task) ? [task.assigneeId, ...task.helperIds].filter((x): x is string => !!x) : []);
  private actor = (id: string): Actor => ({ kind: 'human', id, name: this.state.volunteers[id]?.name });

  private batch = () => new Batch(this.state);

  private ev(b: Batch, taskId: string, kind: TaskEvent['kind'], text: string, actor: Actor, extra: Pick<TaskEvent, 'reply' | 'note'> = {}) {
    b.events.push({ id: this.id('e'), taskId, at: this.now(), kind, actor, text, ...strip(extra) });
  }

  private send(b: Batch, recipientId: string, kind: Message['kind'], body: string, extra: Partial<Pick<Message, 'taskId' | 'delivery' | 'fromName'>> = {}) {
    b.messages.push({ id: this.id('m'), recipientId, at: this.now(), kind, fromName: 'Moloop', body, read: false, ...strip(extra) });
  }

  private apply(b: Batch) {
    this.set({
      tasks: b.tasks,
      proposals: b.proposals,
      requests: b.requests,
      volunteers: b.volunteers,
      events: b.events.length ? [...this.state.events, ...b.events] : this.state.events,
      messages: b.messages.length ? [...this.state.messages, ...b.messages] : this.state.messages,
    });
  }

  private set(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch, now: this.now() };
    this.emit();
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

/** Drop undefined keys so optional fields stay absent rather than `undefined`. */
const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
