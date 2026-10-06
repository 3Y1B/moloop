import type { Duty, Message, ReplyKind, Task, TaskEvent, Team, Volunteer, Zone } from '@/lib/schema';

/**
 * The only thing screens talk to. A Repo is a local, reactive cache plus commands:
 *  - MockRepo: in-memory, runs the lifecycle locally. Zero setup.
 *  - SupabaseRepo (later): hydrates from queries, stays fresh via realtime, commands hit /api/*.
 * Snapshots are immutable; a new object is emitted on every change (useSyncExternalStore-friendly).
 */
export type Snapshot = {
  status: 'loading' | 'ready' | 'error';
  now: number;
  meId: string | null;
  teams: Record<string, Team>;
  zones: Record<string, Zone>;
  volunteers: Record<string, Volunteer>;
  tasks: Record<string, Task>;
  events: TaskEvent[];
  messages: Message[];
};

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

  /** Demo controls. Only the mock implements these. */
  dev?: DevControls;
}

export interface DevControls {
  setMe(volunteerId: string): void;
  /** Move the simulated clock forward (drives nudges). */
  advance(ms: number): void;
  clockOffsetMs(): number;
  spawnIncoming(priority?: 'P1' | 'P2' | 'P3'): void;
  reset(): void;
}
