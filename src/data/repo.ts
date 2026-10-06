import type { RespondInput } from '@/lib/lifecycle';
import type { Duty, GuestRequest, Message, Priority, Proposal, ReplyKind, Task, TaskEvent, Team, TeamSlug, Volunteer, Zone } from '@/lib/schema';

export type { RespondInput };

/**
 * The only thing screens talk to. A Repo is a local, reactive cache plus commands:
 *  - MockRepo: in-memory, runs the lifecycle locally. Zero setup.
 *  - SupabaseRepo (later): hydrates from queries, stays fresh via realtime, commands hit /api/*.
 * Snapshots are immutable; a new object is emitted on every change (useSyncExternalStore-friendly).
 */
export type Snapshot = {
  status: 'loading' | 'ready' | 'error';
  now: number;
  /** Who is signed in: a volunteer id, or `guestId` for the festival-goer. */
  meId: string | null;
  /** The festival-goer identity on this device. Not a volunteer. */
  guestId: string | null;
  teams: Record<string, Team>;
  zones: Record<string, Zone>;
  volunteers: Record<string, Volunteer>;
  tasks: Record<string, Task>;
  events: TaskEvent[];
  messages: Message[];
  requests: Record<string, GuestRequest>;
  proposals: Record<string, Proposal>;
};

/** Who a broadcast goes to. Neither set = everyone on duty. */
export type BroadcastScope = { teamSlug?: TeamSlug; zoneSlug?: string };

/** What a push-to-talk utterance means, decided before anything happens ("Heard: ..."). */
export type Interpretation = {
  heard: string;
  intent: { kind: 'reply'; taskId: string; reply: ReplyKind } | { kind: 'report' };
};

export interface Repo {
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;

  /** `note` is what they said or typed alongside it ("gave him water, he's fine now"). */
  reply(taskId: string, reply: ReplyKind, note?: string): Promise<void>;
  setDuty(duty: Duty): Promise<void>;
  /** Speech/text → intent. Server-side classifier later; nothing is executed here. */
  interpret(text: string): Promise<Interpretation>;
  /** Commit an interpretation the volunteer confirmed. */
  commit(interpretation: Interpretation): Promise<{ confirmation: string }>;
  markRead(messageIds: string[]): Promise<void>;

  // ── Leads and Mo (acting as meId) ──

  /** Respond to "need help" or "went quiet": backup, handover, reassign, call, close, carry on. */
  respond(taskId: string, response: RespondInput): Promise<void>;
  /** "Pass to Mo" by hand. */
  passToCoordinator(taskId: string): Promise<void>;
  /** After a handover: they've arrived, the volunteer is freed and the task resolves as handed over. */
  arrived(taskId: string): Promise<void>;
  /** Give a task to someone (unassigned, queued, or moving it). Settles a pending proposal for it. */
  assign(taskId: string, volunteerId: string): Promise<void>;
  /** Approve the AI's proposal: its top pick, or `volunteerId` instead. */
  approve(proposalId: string, volunteerId?: string): Promise<void>;
  broadcast(body: string, scope?: BroadcastScope): Promise<void>;
  sendDirect(volunteerId: string, body: string): Promise<void>;

  // ── Festival-goer (acting as guestId) ──

  /** Ask or report. Resolves with the new request id straight away; the pipeline runs after. */
  guestAsk(text: string, zoneSlug: string | null, locationHint?: string | null): Promise<string>;
  /** "Talk to a person" on an AI answer: becomes a P3 task for the right team. */
  guestRequestHuman(requestId: string): Promise<void>;
  /** "What's changed?" The AI decides: a note for the volunteer, or a priority bump that alerts the lead. */
  guestAddDetail(requestId: string, text: string): Promise<{ escalated: boolean }>;
  guestCancel(requestId: string): Promise<void>;
  /** "Still need help?" after Sorted. */
  guestReopen(requestId: string): Promise<void>;

  /** Volunteer → festival-goer, on a task that came from a request. */
  guestReply(taskId: string, text: string): Promise<void>;

  /** Demo controls. Only the mock implements these. */
  dev?: DevControls;
}

export interface DevControls {
  setMe(volunteerId: string): void;
  /** Move the simulated clock forward (drives nudges). */
  advance(ms: number): void;
  clockOffsetMs(): number;
  spawnIncoming(priority?: Priority): void;
  reset(): void;

  // Scenarios (docs/SCREENS.md, dev panel).
  /** Priya accepts her task if needed, then asks for help with a reason. */
  askForHelp(volunteerId?: string): void;
  /** The volunteer's active task goes silent: nudged, then the lead is alerted. */
  goQuiet(volunteerId?: string): void;
  /** A festival-goer question the AI answers. */
  guestQuestion(): void;
  /** A P3 festival-goer report, dispatched straight away. */
  guestReport(): void;
  /** A P1 festival-goer report that waits for approval, auto-assigning after POLICY.autoAssignMs. */
  guestP1Report(): void;
  /** Act as Mo: answer every escalation bumped to Mo (backup, or medics if nobody is free). */
  moRespond(): number;
  /** Act as Mo: broadcast to everyone on duty. */
  moBroadcast(body?: string): void;
}
