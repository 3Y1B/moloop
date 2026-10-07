import type { RespondInput } from '@/lib/lifecycle';
import type { Fix } from '@/lib/presence';
import type { Duty, GuestRequest, Message, Position, Proposal, ReplyKind, Task, TaskEvent, Team, TeamSlug, Volunteer, Zone } from '@/lib/schema';

export type { RespondInput };

/**
 * The only thing screens talk to. A Repo is a local, reactive cache plus commands: SupabaseRepo hydrates from
 * queries, stays fresh via realtime, and sends every command to the server.
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
  /** Live GPS by person id: everyone this caller may see (crew see crew; a festival-goer, who's coming). */
  positions: Record<string, Position>;
};

/** Who a broadcast goes to. Neither set = everyone on duty. */
export type BroadcastScope = { teamSlug?: TeamSlug; zoneSlug?: string };

/** What a push-to-talk utterance means, decided before anything happens ("Heard: ..."). */
export type Interpretation = {
  heard: string;
  /** The voice clips it was said in (from `transcribe`), kept with the report it becomes. */
  clips?: string[];
  intent: { kind: 'reply'; taskId: string; reply: ReplyKind } | { kind: 'report' };
};

/** One hold of the pill, recorded on the phone. `name` carries the format (`clip.m4a`). */
export type Recording = { audio: Blob; name: string; durationMs: number };

/** What a hold said. `clip` is where the server keeps it, to send along with what it becomes. */
export type Heard = { text: string; clip: string | null };

export interface Repo {
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;

  /** `note` is what they said or typed alongside it ("gave him water, he's fine now"). */
  reply(taskId: string, reply: ReplyKind, note?: string): Promise<void>;
  setDuty(duty: Duty): Promise<void>;
  /** Speech → text, for the "Heard" check. Nothing happens until it's sent. */
  transcribe(recording: Recording): Promise<Heard>;
  /** A playable URL for a spoken message (`Message.audio`). */
  speechUrl(path: string): Promise<string>;
  /** Speech/text → intent, decided on the server. Nothing is executed here. */
  interpret(text: string): Promise<Interpretation>;
  /** Commit an interpretation the volunteer confirmed. */
  commit(interpretation: Interpretation): Promise<{ confirmation: string }>;
  markRead(messageIds: string[]): Promise<void>;
  /** Where my phone is. Written straight to `presence`, not through the server: high volume, no logic. */
  sharePosition(fix: Fix): Promise<void>;

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

  /** Ask or report. Resolves with the new request id straight away; the pipeline runs after. `clips`: what it was said in. */
  guestAsk(text: string, zoneSlug: string | null, locationHint?: string | null, clips?: string[]): Promise<string>;
  /**
   * "Problem solved?" No (no `text`), or what they add before anyone's sent. The AI reads the conversation again:
   * another answer, or someone goes.
   */
  guestFollowUp(requestId: string, text?: string): Promise<void>;
  /** "Problem solved?" Yes: closes the request. */
  guestSolved(requestId: string): Promise<void>;
  /** "What's changed?" The AI decides: a note for the volunteer, or a priority bump that alerts the lead. */
  guestAddDetail(requestId: string, text: string): Promise<{ escalated: boolean }>;
  guestCancel(requestId: string): Promise<void>;
  /** "Still need help?" after Sorted. */
  guestReopen(requestId: string): Promise<void>;

  /** Volunteer → festival-goer, on a task that came from a request. */
  guestReply(taskId: string, text: string): Promise<void>;
}

