import { Batch, type IdKind } from '@/lib/batch';
import { rankCandidates } from '@/lib/candidates';
import * as C from '@/lib/commands';
import { isActive, isBusy, needsResponse, type RespondInput } from '@/lib/lifecycle';
import type { Duty, Priority, ReplyKind } from '@/lib/schema';
import type { BroadcastScope, DevControls, Heard, Interpretation, Recording, Repo, Snapshot } from '../repo';
import { GUEST_SCRIPTS, INCOMING, initialSnapshot, ME_ID, MO_ID } from './fixtures';

const SCHEDULER_MS = 5_000;
/** How long a festival-goer sees "Understanding" before the answer or the dispatch. */
const UNDERSTANDING_MS = 1_500;
/** The reporter hears back once triage has had time to run. */
const REPORT_OUTCOME_MS = 4_000;

/** The mock has no ears: a hold "says" a plausible line for where your task is. */
const HEARD: Record<string, string> = {
  assigned: 'yep got it, heading over now',
  accepted: 'all sorted, done',
  escalated: 'paramedics have taken over, done',
  none: 'there’s a spill near the track stage bar, it’s pretty slippery',
};

const PREFIX: Record<IdKind, string> = { task: 't', event: 'e', message: 'm', proposal: 'p', request: 'r' };

/**
 * In-memory world on this device. Runs the same shared commands (src/lib/commands.ts) as the server,
 * applies each Batch as one new snapshot, and runs its own scheduler.
 */
export class MockRepo implements Repo {
  private state: Snapshot;
  private listeners = new Set<() => void>();
  private offset = 0;
  private seq = 0;

  constructor() {
    this.state = initialSnapshot(Date.now());
    setInterval(() => this.run((b) => C.schedulerStep(b)), SCHEDULER_MS);
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
    this.run((b) => C.reply(b, this.meId(), taskId, reply, note));
  }

  async setDuty(duty: Duty) {
    if (this.state.meId) this.run((b) => C.setDuty(b, this.meId(), duty));
  }

  async transcribe(_: Recording): Promise<Heard> {
    const active = Object.values(this.state.tasks).find((t) => t.assigneeId === this.state.meId && isActive(t));
    return { text: HEARD[active?.status ?? 'none'] ?? HEARD.none, clip: null };
  }

  async interpret(text: string): Promise<Interpretation> {
    return C.interpretHeuristic(Object.values(this.state.tasks), this.state.meId, text);
  }

  async commit(i: Interpretation) {
    const { confirmation, later } = this.run((b) => C.commit(b, this.meId(), i));
    if (later) {
      setTimeout(() => this.run((b) => b.send(later.recipientId, 'system', later.body, { taskId: later.taskId })), REPORT_OUTCOME_MS);
    }
    return { confirmation };
  }

  async markRead(ids: string[]) {
    const set = new Set(ids);
    if (!this.state.messages.some((m) => set.has(m.id) && !m.read)) return;
    this.set({ messages: this.state.messages.map((m) => (set.has(m.id) ? { ...m, read: true } : m)) });
  }

  async guestReply(taskId: string, text: string) {
    this.run((b) => C.guestReply(b, this.meId(), taskId, text));
  }

  // ── lead and Mo commands ──

  async respond(taskId: string, response: RespondInput) {
    this.run((b) => C.respond(b, this.meId(), taskId, response));
  }

  async passToCoordinator(taskId: string) {
    this.run((b) => C.passToCoordinator(b, this.meId(), taskId));
  }

  async arrived(taskId: string) {
    this.run((b) => C.arrived(b, this.meId(), taskId));
  }

  async assign(taskId: string, volunteerId: string) {
    this.run((b) => C.assign(b, this.meId(), taskId, volunteerId));
  }

  async approve(proposalId: string, volunteerId?: string) {
    this.run((b) => C.approve(b, this.meId(), proposalId, volunteerId));
  }

  async broadcast(body: string, scope: BroadcastScope = {}) {
    this.run((b) => C.broadcast(b, this.meId(), body, scope));
  }

  async sendDirect(volunteerId: string, body: string) {
    if (this.state.meId) this.run((b) => C.sendDirect(b, this.meId(), volunteerId, body));
  }

  // ── festival-goer commands ──

  async guestAsk(text: string, zoneSlug: string | null, locationHint: string | null = null) {
    const request = this.run((b) => C.guestAsk(b, text, zoneSlug, locationHint));
    setTimeout(() => this.run((b) => C.understand(b, request.id)), UNDERSTANDING_MS);
    return request.id;
  }

  async guestRequestHuman(requestId: string) {
    this.run((b) => C.guestRequestHuman(b, requestId));
  }

  async guestAddDetail(requestId: string, text: string) {
    return this.run((b) => C.guestAddDetail(b, requestId, text));
  }

  async guestCancel(requestId: string) {
    this.run((b) => C.guestCancel(b, requestId));
  }

  async guestReopen(requestId: string) {
    this.run((b) => C.guestReopen(b, requestId));
  }

  dev: DevControls = {
    setMe: (id) => this.set({ meId: id }),
    advance: (ms) => {
      this.offset += ms;
      this.run((b) => C.schedulerStep(b));
    },
    clockOffsetMs: () => this.offset,
    spawnIncoming: (priority: Priority = 'P2') => {
      if (this.state.volunteers[this.meId()]) this.run((b) => C.spawnIncoming(b, this.meId(), INCOMING[priority][0]));
    },
    reset: () => {
      this.offset = 0;
      this.state = initialSnapshot(Date.now());
      this.emit();
    },
    askForHelp: (volunteerId = ME_ID) => {
      const task = Object.values(this.state.tasks).find((t) => t.assigneeId === volunteerId && isActive(t));
      if (!task) return;
      if (task.status === 'assigned') this.run((b) => C.reply(b, volunteerId, task.id, 'accept'));
      if (this.state.tasks[task.id].status !== 'escalated') this.run((b) => C.reply(b, volunteerId, task.id, 'need_help', 'He’s getting worse'));
    },
    goQuiet: (volunteerId = 'v-linh') => this.run((b) => C.goQuiet(b, volunteerId)),
    guestQuestion: () => void this.guestAsk(GUEST_SCRIPTS.question.text, GUEST_SCRIPTS.question.zoneSlug),
    guestReport: () => void this.guestAsk(GUEST_SCRIPTS.report.text, GUEST_SCRIPTS.report.zoneSlug),
    guestP1Report: () => void this.guestAsk(GUEST_SCRIPTS.p1.text, GUEST_SCRIPTS.p1.zoneSlug),
    moRespond: () => this.moRespond(),
    moBroadcast: (body = 'Heat check: drink water now, and take your break in the shade.') => this.run((b) => C.broadcast(b, MO_ID, body, {})),
  };

  /** Mo answers everything bumped to them: backup from the nearest free teammate, else medics. */
  private moRespond() {
    const tasks = Object.values(this.state.tasks).filter((t) => needsResponse(t) && t.escalation?.level === 'coordinator');
    for (const t of tasks) {
      const current = this.state.tasks[t.id];
      const all = Object.values(this.state.tasks);
      const free = rankCandidates(current, Object.values(this.state.volunteers), all)
        .find((c) => !isBusy(all, c.volunteerId) && this.state.volunteers[c.volunteerId]?.teamSlug === current.teamSlug);
      this.run((b) => C.respond(b, MO_ID, t.id, free ? { kind: 'backup', volunteerId: free.volunteerId } : { kind: 'handover', target: 'medics' }));
    }
    return tasks.length;
  }

  // ── plumbing ──

  private now = () => Date.now() + this.offset;
  private meId = () => this.state.meId ?? '';

  /** Run one shared command against the current state and emit the result as one snapshot. A throw leaves state untouched. */
  private run<T>(command: (b: Batch) => T): T {
    const s = this.state;
    const b = new Batch(s, { now: this.now(), id: (kind) => `${PREFIX[kind]}-${Date.now().toString(36)}-${++this.seq}` });
    const result = command(b);
    this.set({
      tasks: b.tasks,
      proposals: b.proposals,
      requests: b.requests,
      volunteers: b.volunteers,
      events: b.events.length ? [...s.events, ...b.events] : s.events,
      messages: b.messages.length ? [...s.messages, ...b.messages] : s.messages,
    });
    return result;
  }

  private set(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch, now: this.now() };
    this.emit();
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}
