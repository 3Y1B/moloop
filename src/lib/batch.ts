import { isActive } from '@/lib/lifecycle';
import type { GuestRequest, Message, Position, Proposal, Task, TaskEvent, Team, TeamSlug, Volunteer } from '@/lib/schema';

/**
 * One state change, built up by the shared commands (src/lib/commands.ts) and then applied in one go:
 * the server writes it in one transaction. Pure, no I/O.
 */

/** The slice of the world a command reads. The server loads live tasks plus whatever the command names. */
export type World = {
  volunteers: Record<string, Volunteer>;
  tasks: Record<string, Task>;
  proposals: Record<string, Proposal>;
  requests: Record<string, GuestRequest>;
  teams: Record<string, Pick<Team, 'name'>>;
  /** Live GPS by person, for walking distances. Read only: phones write their own. */
  positions?: Record<string, Position>;
};

export type IdKind = 'task' | 'event' | 'message' | 'proposal' | 'request';

/** Time and ids come from outside: the server uses Date.now() and uuids, tests whatever they like. */
export type Clock = { now: number; id: (kind: IdKind) => string };

/** A command that doesn't fit. `code` maps to the HTTP status on the server. */
export class CommandError extends Error {
  constructor(readonly code: 'invalid' | 'forbidden' | 'not_found' | 'conflict', message: string) {
    super(message);
  }
}

export type Actor = TaskEvent['actor'];
export const AGENT: Actor = { kind: 'agent', name: 'Assign' };
export const TRIAGE_AGENT: Actor = { kind: 'agent', name: 'Triage' };
export const SCHEDULER: Actor = { kind: 'system', name: 'Scheduler' };
export const FESTIVALGOER: Actor = { kind: 'human', name: 'Festival-goer' };

type MessageExtra = Partial<Pick<Message, 'taskId' | 'delivery' | 'fromName'>> & { senderId?: string };

export class Batch {
  readonly now: number;
  tasks: Record<string, Task>;
  proposals: Record<string, Proposal>;
  requests: Record<string, GuestRequest>;
  volunteers: Record<string, Volunteer>;
  readonly teams: World['teams'];
  readonly positions: Record<string, Position>;
  readonly events: TaskEvent[] = [];
  readonly messages: Message[] = [];
  /** Who sent a message, when it was a person (direct, broadcast). Not on the domain Message. */
  readonly senders: Record<string, string> = {};
  /** What changed, so the server writes only that. */
  readonly dirty = { tasks: new Set<string>(), proposals: new Set<string>(), requests: new Set<string>(), volunteers: new Set<string>() };

  constructor(world: World, private clock: Clock) {
    this.now = clock.now;
    this.tasks = world.tasks;
    this.proposals = world.proposals;
    this.requests = world.requests;
    this.volunteers = world.volunteers;
    this.teams = world.teams;
    this.positions = world.positions ?? {};
  }

  id = (kind: IdKind) => this.clock.id(kind);

  task(t: Task) {
    this.tasks = { ...this.tasks, [t.id]: t };
    this.dirty.tasks.add(t.id);
  }
  proposal(p: Proposal) {
    this.proposals = { ...this.proposals, [p.id]: p };
    this.dirty.proposals.add(p.id);
  }
  request(r: GuestRequest) {
    this.requests = { ...this.requests, [r.id]: r };
    this.dirty.requests.add(r.id);
  }
  volunteer(v: Volunteer) {
    this.volunteers = { ...this.volunteers, [v.id]: v };
    this.dirty.volunteers.add(v.id);
  }

  all = () => Object.values(this.tasks);
  get changed() {
    const d = this.dirty;
    return d.tasks.size + d.proposals.size + d.requests.size + d.volunteers.size + this.events.length + this.messages.length > 0;
  }

  ev(taskId: string, kind: TaskEvent['kind'], text: string, actor: Actor, extra: Pick<TaskEvent, 'reply' | 'note'> = {}) {
    this.events.push({ id: this.id('event'), taskId, at: this.now, kind, actor, text, ...strip(extra) });
  }

  send(recipientId: string, kind: Message['kind'], body: string, { senderId, ...extra }: MessageExtra = {}) {
    const id = this.id('message');
    this.messages.push({ id, recipientId, at: this.now, kind, fromName: 'Moloop', body, read: false, ...strip(extra) });
    if (senderId) this.senders[id] = senderId;
  }

  // ── lookups ──

  coordinator = () => Object.values(this.volunteers).find((v) => v.role === 'coordinator');
  leadFor = (team: TeamSlug | null) => Object.values(this.volunteers).find((v) => v.role === 'team_lead' && v.teamSlug === team);
  /** Everyone working a task right now: the owner and any helpers. */
  onIt = (task: Task) => (isActive(task) ? [task.assigneeId, ...task.helperIds].filter((x): x is string => !!x) : []);
  actor = (id: string): Actor => ({ kind: 'human', id, name: this.volunteers[id]?.name });
}

/** Drop undefined keys so optional fields stay absent rather than `undefined`. */
export const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
