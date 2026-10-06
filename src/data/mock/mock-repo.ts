import { applyReply, assignOrQueue, isActive, nextQueued, tick } from '@/lib/lifecycle';
import { REPLY_LABEL } from '@/lib/format';
import type { Duty, Message, Priority, ReplyKind, Task, TaskEvent, TeamSlug } from '@/lib/schema';
import type { DevControls, Interpretation, Repo, Snapshot } from '../repo';
import { INCOMING, initialSnapshot } from './fixtures';

const SCHEDULER_MS = 5_000;

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
  { team: 'first-aid', re: /(collapsed|faint|bleed|injur|hurt|dizzy|heat|unconscious|sting|vomit)/i },
  { team: 'welfare', re: /(lost (child|kid)|can'?t find (my|their)|crying|harass|unsafe|lost property)/i },
  { team: 'crowd', re: /(queue|crowd|crush|gate|barrier|packed)/i },
  { team: 'security', re: /(fight|theft|stole|weapon|aggressive|drunk)/i },
  { team: 'artist', re: /(artist|green room|backstage|rider|band)/i },
  { team: 'vendors', re: /(vendor|stall|food|gas|bbq)/i },
  { team: 'ops', re: /(spill|bin|power|light|toilet|cable|water station|leak)/i },
];
const P1 = /(unconscious|not breathing|not responding|collapsed|lost (child|kid)|weapon|crush)/i;

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

  // ── commands ──

  async reply(taskId: string, reply: ReplyKind, note?: string) {
    const now = this.now();
    const task = this.state.tasks[taskId];
    const me = this.me();
    const t = task && applyReply(task, reply, now);
    if (!t || !me) throw new Error(`Cannot ${reply} task ${taskId} in status ${task?.status}`);

    const events: TaskEvent[] = [{
      id: this.id('e'), taskId, at: now, kind: reply === 'done' ? 'resolved' : reply === 'need_help' ? 'escalated' : 'reply',
      actor: { kind: 'human', id: me.id, name: me.name }, text: t.text, reply, note,
    }];
    const messages: Message[] = [];
    let tasks = { ...this.state.tasks, [taskId]: t.task };
    // Stand-in for GPS: finishing a task means you were at its zone.
    const volunteers = reply === 'done' && task.zoneSlug
      ? { ...this.state.volunteers, [me.id]: { ...me, zoneSlug: task.zoneSlug } }
      : this.state.volunteers;

    if (reply === 'need_help') {
      const lead = this.leadFor(task.teamSlug);
      messages.push(this.msg('system', `${lead?.name ?? 'Your team lead'} has been told you need help with “${task.title}”. Stay with them.`, taskId));
    }
    if (reply === 'decline') {
      events.push({ id: this.id('e'), taskId, at: now, kind: 'reassigned', actor: { kind: 'agent', name: 'Assign' }, text: 'Back in the pool for reassignment' });
    }
    // Freed up → pull the next queued task, delivered spoken since they're now idle.
    if (reply === 'done' || reply === 'decline') {
      const next = nextQueued(Object.values(tasks), me.id);
      if (next) {
        tasks = { ...tasks, [next.id]: assignOrQueue(next, me.id, false, now) };
        events.push({ id: this.id('e'), taskId: next.id, at: now, kind: 'assigned', actor: { kind: 'agent', name: 'Assign' }, text: `Assigned to ${me.name} (freed up)` });
        messages.push(this.msg('task', `Next up: ${next.title}. ${next.summary}`, next.id, 'spoken'));
      }
    }

    this.set({ tasks, volunteers, events: [...this.state.events, ...events], messages: [...this.state.messages, ...messages] });
  }

  async setDuty(duty: Duty) {
    const me = this.me();
    if (!me) return;
    this.set({ volunteers: { ...this.state.volunteers, [me.id]: { ...me, duty } } });
  }

  async interpret(text: string): Promise<Interpretation> {
    const heard = text.trim();
    const active = this.myActive();
    const match = REPLY_PATTERNS.find(([, re]) => re.test(heard));
    // Long utterances are reports even if they contain "done" etc. Replies are short.
    if (active && match && heard.split(/\s+/).length <= 8) {
      return { heard, intent: { kind: 'reply', taskId: active.id, reply: match[0] } };
    }
    return { heard, intent: { kind: 'report' } };
  }

  async commit(i: Interpretation) {
    if (i.intent.kind === 'reply') {
      await this.reply(i.intent.taskId, i.intent.reply, i.heard);
      return { confirmation: `Sent “${REPLY_LABEL[i.intent.reply]}”` };
    }
    return this.fileReport(i.heard);
  }

  async markRead(ids: string[]) {
    const set = new Set(ids);
    if (!this.state.messages.some((m) => set.has(m.id) && !m.read)) return;
    this.set({ messages: this.state.messages.map((m) => (set.has(m.id) ? { ...m, read: true } : m)) });
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
  };

  // ── internals ──

  private now = () => Date.now() + this.offset;
  private id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++this.seq}`;
  private me = () => (this.state.meId ? this.state.volunteers[this.state.meId] : undefined);
  private myActive = () => Object.values(this.state.tasks).find((t) => t.assigneeId === this.state.meId && isActive(t));
  private isBusy = (volunteerId: string) => Object.values(this.state.tasks).some((t) => t.assigneeId === volunteerId && isActive(t));
  private leadFor = (team: TeamSlug | null) =>
    Object.values(this.state.volunteers).find((v) => v.role === 'team_lead' && v.teamSlug === team);

  private msg(kind: Message['kind'], body: string, taskId?: string, delivery?: Message['delivery'], recipientId = this.state.meId!): Message {
    return { id: this.id('m'), recipientId, at: this.now(), kind, fromName: 'Moloop', body, taskId, delivery, read: false };
  }

  private set(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch, now: this.now() };
    this.emit();
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private runScheduler() {
    const now = this.now();
    let tasks = this.state.tasks;
    const events: TaskEvent[] = [];
    const messages: Message[] = [];
    for (const task of Object.values(tasks)) {
      const r = tick(task, now);
      if (!r) continue;
      tasks = { ...tasks, [task.id]: r.task };
      for (const a of r.alerts) {
        const nudge = a.kind === 'nudge';
        events.push({ id: this.id('e'), taskId: a.taskId, at: now, kind: nudge ? 'nudged' : 'lead_alerted', actor: { kind: 'system', name: 'Scheduler' }, text: a.body });
        messages.push(this.msg(nudge ? 'nudge' : 'system', nudge ? a.body : `Your team lead has been alerted about “${task.title}”. Send an update when you can.`, a.taskId, undefined, a.volunteerId));
      }
    }
    if (events.length) this.set({ tasks, events: [...this.state.events, ...events], messages: [...this.state.messages, ...messages] });
    else this.set({});
  }

  private spawnIncoming(priority: Priority) {
    const me = this.me();
    if (!me) return;
    const now = this.now();
    const base = INCOMING[priority][0];
    const busy = this.isBusy(me.id);
    const draft: Task = {
      ...base, id: this.id('t'), status: 'open', assigneeId: null, createdAt: now, assignedAt: null, etaAt: null,
      lastActivityAt: now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null,
    };
    const task = assignOrQueue(draft, me.id, busy, now);
    const triage = { kind: 'agent' as const, name: 'Triage' };
    this.set({
      tasks: { ...this.state.tasks, [task.id]: task },
      events: [
        ...this.state.events,
        { id: this.id('e'), taskId: task.id, at: now, kind: 'created', actor: triage, text: `Reported by ${base.reporter.name ?? 'a festival-goer'}` },
        { id: this.id('e'), taskId: task.id, at: now, kind: busy ? 'queued' : 'assigned', actor: triage, text: busy ? `Queued for ${me.name} (busy)` : `Assigned to ${me.name}` },
      ],
      messages: [
        ...this.state.messages,
        busy
          ? this.msg('task', `New task queued: ${task.title}. Check the app.`, task.id, 'ping')
          : this.msg('task', `New task: ${task.title}. ${task.summary}`, task.id, 'spoken'),
      ],
    });
  }

  private fileReport(text: string) {
    const now = this.now();
    const me = this.me();
    const team = TRIAGE.find((x) => x.re.test(text))?.team ?? 'ops';
    const priority: Priority = P1.test(text) ? 'P1' : team === 'first-aid' || team === 'security' || team === 'welfare' ? 'P2' : 'P3';
    const candidates = Object.values(this.state.volunteers).filter(
      (v) => v.teamSlug === team && v.role === 'volunteer' && v.duty === 'on_duty' && v.id !== me?.id,
    );
    const free = candidates.find((v) => !this.isBusy(v.id));
    const who = free ?? candidates[0];
    const title = text.length > 55 ? `${text.slice(0, 52).trim()}…` : text;
    const draft: Task = {
      id: this.id('t'), title: title[0].toUpperCase() + title.slice(1), summary: text, category: 'other', priority, teamSlug: team,
      zoneSlug: me?.zoneSlug ?? null, locationHint: null, status: 'open', assigneeId: null, handledBy: 'human',
      reporter: { kind: 'volunteer', name: me?.name, quote: text, language: 'en' },
      createdAt: now, assignedAt: null, etaAt: null, lastActivityAt: now, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null,
    };
    const task = who ? assignOrQueue(draft, who.id, !free, now) : draft;
    const teamName = this.state.teams[team]?.name ?? team;
    this.set({
      tasks: { ...this.state.tasks, [task.id]: task },
      events: [
        ...this.state.events,
        { id: this.id('e'), taskId: task.id, at: now, kind: 'created', actor: { kind: 'human', id: me?.id, name: me?.name }, text: 'Reported by voice' },
        ...(who ? [{ id: this.id('e'), taskId: task.id, at: now, kind: task.status === 'queued' ? 'queued' : 'assigned', actor: { kind: 'agent', name: 'Assign' }, text: `${task.status === 'queued' ? 'Queued for' : 'Assigned to'} ${who.name}` } as TaskEvent] : []),
      ],
    });
    // Triage + assignment run after Send on the server, so the reporter hears back via Inbox, not inline.
    const outcome = who
      ? `Your report “${task.title}” went to ${teamName}. ${who.name.split(' ')[0]} ${free ? 'is on it' : 'has it next'}.`
      : `Your report “${task.title}” is with ${teamName}. A lead will pick it up.`;
    setTimeout(() => this.set({ messages: [...this.state.messages, this.msg('system', outcome, task.id)] }), 4_000);
    return { confirmation: 'Report sent' };
  }
}
