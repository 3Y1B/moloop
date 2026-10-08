import type { RespondInput } from '@/lib/lifecycle';
import type { Fix } from '@/lib/presence';
import type { RespondCommand } from '@/lib/ai';
import type { Summary, SummaryScope } from '@/lib/summary';
import type {
  ManagedPlaybook,
  SavePlaybookDraftInput,
  SimulationContext,
  SimulationInput,
  SimulationRunResult,
} from '@/lib/mobilization-contracts';
import type {
  Duty,
  GuestRequest,
  Message,
  Mobilization,
  Position,
  Proposal,
  ReplyKind,
  Task,
  TaskEvent,
  Team,
  TeamSlug,
  Volunteer,
  Zone,
} from '@/lib/schema';

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
  mobilizations: Record<string, Mobilization>;
  /** Live GPS by person id, restricted to people this caller may see. */
  positions: Record<string, Position>;
};

/** Who a broadcast goes to. Neither set = everyone on duty. */
export type BroadcastScope = { teamSlug?: TeamSlug; zoneSlug?: string };

/** What a push-to-talk utterance means, decided before anything happens ("Heard: ..."). */
export type Interpretation = {
  heard: string;
  /** The voice clips it was said in (from `transcribe`), kept with the report it becomes. */
  clips?: string[];
  intent:
    | { kind: 'reply'; taskId: string; reply: ReplyKind }
    | { kind: 'tell_guest'; taskId: string; text: string }
    | { kind: 'report' };
};

/**
 * What a lead's hold on the Respond screen did. `done`: the response was sent (`kind`), flash `confirmation`.
 * Not done: `open` that step (the picker when nobody was named; 000, which is always held to confirm), or nothing
 * was understood.
 */
export type VoiceResponse =
  | { done: true; kind: RespondCommand['kind']; confirmation: string }
  | { done: false; open?: 'backup' | 'reassign' | '000' };

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
  /** This phone's Expo push token, for whoever is signed in. Moves it off anyone else who had it. */
  registerPush(token: string, platform: 'ios' | 'android'): Promise<void>;
  /** On sign-out: this phone stops getting pushes for that person. */
  unregisterPush(token: string): Promise<void>;
  /** Leads and Mo: a short summary of the shift or one task (AI, or plain counts if the model is down). */
  summarize(scope: SummaryScope): Promise<Summary>;
  /** Where my phone is. Written straight to `presence`, not through the server: high volume, no logic. */
  sharePosition(fix: Fix): Promise<void>;

  // ── Leads and Mo (acting as meId) ──

  /** Respond to "need help" or "went quiet": backup, handover, reassign, call, close, carry on. */
  respond(taskId: string, response: RespondInput): Promise<void>;
  /** What the lead said on the Respond screen: the AI reads it and does it, or says which step to open. */
  respondByVoice(taskId: string, text: string): Promise<VoiceResponse>;
  /** "Pass to Mo" by hand. */
  passToCoordinator(taskId: string): Promise<void>;
  /** After a handover: they've arrived, the volunteer is freed and the task resolves as handed over. */
  arrived(taskId: string): Promise<void>;
  /** Give a task to someone (unassigned, queued, or moving it). Settles a pending proposal for it. */
  /** `helperIds` go along as helpers, same as backup. */
  assign(taskId: string, volunteerId: string, helperIds?: string[]): Promise<void>;
  /** Approve the AI's proposal: its top pick, or `volunteerId` instead. */
  approve(proposalId: string, volunteerId?: string, helperIds?: string[]): Promise<void>;
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

  /** Staff → festival-goer, on a task that came from a request: the volunteer on it, a lead or Mo. */
  guestReply(taskId: string, text: string): Promise<void>;
  /** Lead or Mo → everyone on the task, spoken on their phones and kept on the task's log. */
  messageCrew(taskId: string, text: string): Promise<void>;

  /** Mobilization is server/Supabase-only: real-model simulation and approval need shared persistence. */
  mobilizations?: MobilizationControls;
  /** Mo-authored, versioned SOPs. Published revisions are immutable. */
  playbooks?: PlaybookControls;
}

export interface MobilizationControls {
  /** Approve a system-proposed mobilization: re-ranks candidates fresh and creates the real tasks. */
  approve(mobilizationId: string, review?: MobilizationReview): Promise<void>;
  reject(mobilizationId: string): Promise<void>;
  standDown(mobilizationId: string, outcome: 'stood_down' | 'cancelled'): Promise<void>;
  context(): Promise<SimulationContext>;
  /** Analyze editable facts with the configured model; never inject canned plans. */
  simulate(input: SimulationInput): Promise<SimulationRunResult>;
  getRun(id: string): Promise<SimulationRunResult>;
}

/** The run Mo reviewed: approval checks the plan still matches it. */
export type MobilizationReview = { reviewedRunId?: string; acknowledgeGaps?: boolean };

export interface PlaybookControls {
  list(): Promise<ManagedPlaybook[]>;
  saveDraft(input: SavePlaybookDraftInput): Promise<ManagedPlaybook>;
  revise(id: string): Promise<ManagedPlaybook>;
  publish(id: string, expectedUpdatedAt: string): Promise<ManagedPlaybook>;
  disable(id: string, expectedUpdatedAt: string): Promise<ManagedPlaybook>;
  deleteDraft(id: string, expectedUpdatedAt: string): Promise<void>;
}
