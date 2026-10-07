import type { IncidentCategory, Priority, ReplyKind, TaskStatus, TeamSlug } from './enums';

/**
 * Client-facing domain model. Screens only ever see these shapes; SupabaseRepo maps rows into them.
 * Times are epoch ms.
 */

export type Team = {
  slug: TeamSlug;
  name: string;
  /** For tight spaces like Mo's team pills: "First Aid", not "First Aid & Heat". */
  short: string;
  color: string;
  /** SF Symbol name; Android falls back to `md`. */
  sf: string;
  md: string;
};

export type Zone = {
  slug: string;
  name: string;
};

export type VolunteerRole = 'volunteer' | 'team_lead' | 'coordinator';
export type Duty = 'on_duty' | 'on_break' | 'off_shift';

export type Volunteer = {
  id: string;
  name: string;
  role: VolunteerRole;
  teamSlug: TeamSlug | null;
  skills: string[];
  languages: string[];
  zoneSlug: string | null;
  duty: Duty;
  shiftEndsAt: number | null;
  /** For Call. */
  phone: string | null;
  /** Background and strengths, for the picker ("ICU nurse. Calm under pressure."). Crew-only, so the server's alone. */
  bio?: string | null;
};

/** Someone's place on a rostered shift (src/lib/roster.ts), as the day runs it (src/lib/shifts.ts). */
export type RosteredShift = {
  /** The shift_assignments row. */
  id: string;
  volunteerId: string;
  teamSlug: TeamSlug | null;
  startsAt: number;
  endsAt: number;
  /** Certificates everyone on it holds: what someone covering it needs too. */
  requires: string[];
  /** Assigned until they go on duty during it (checked in); no-show if they don't by SHIFTS.noShowMs; completed after. */
  status: 'assigned' | 'checked_in' | 'no_show' | 'completed';
  /** When they were told it's starting. */
  remindedAt: number | null;
};

/**
 * Where someone's phone last put them (live GPS), in plan metres (see data/venue.ts). Crew share it while on
 * duty, a festival-goer while someone is coming to them. `at` is when the server got it.
 */
export type Position = {
  personId: string;
  x: number;
  y: number;
  /** Metres. */
  accuracy: number | null;
  /** Degrees clockwise from north. */
  heading: number | null;
  at: number;
};

export type Reporter = {
  kind: 'festivalgoer' | 'volunteer' | 'staff' | 'system';
  name?: string;
  /** What they actually said, in their language. */
  quote: string;
  /** ISO 639-1 of `quote`; "und" when the AI was down and nobody could tell. */
  language: string;
  /**
   * The language someone there needs a volunteer to speak: their own when it isn't English, or one the report names
   * ("his wife only speaks Mandarin"). Null when English will do; missing on reports from before intake said.
   */
  speakerNeeded?: string | null;
  /** `quote` in English, when the AI read it. Shown first to staff (see lib/quote). */
  english?: string;
};

export type Task = {
  id: string;
  title: string;
  summary: string;
  category: IncidentCategory;
  priority: Priority;
  teamSlug: TeamSlug | null;
  zoneSlug: string | null;
  locationHint: string | null;
  status: TaskStatus;
  /** Current owner. Set for queued tasks too: queued means "theirs, after the current one". */
  assigneeId: string | null;
  reporter: Reporter;
  handledBy: 'ai' | 'human';
  createdAt: number;
  assignedAt: number | null;
  etaAt: number | null;
  lastActivityAt: number;
  nudgeCount: number;
  lastNudgeAt: number | null;
  leadAlertedAt: number | null;
  resolvedAt: number | null;
  /** Set while someone asked for help, and kept after a response so screens can say what happened. */
  escalation: Escalation | null;
  /** Backup sent by a lead. Helpers are busy with this task too; `done` from anyone resolves it for all. */
  helperIds: string[];
  /** How it ended. Null while open. */
  resolution: TaskResolution | null;
  /** The festival-goer request this task came from, if any. */
  requestId: string | null;
};

export type TaskResolution = 'done' | 'handed_over' | 'cancelled';

export type EscalationResponseKind = 'backup' | 'handover' | 'reassign' | 'call' | 'close' | 'carry_on';
export type HandoverTarget = 'medics' | 'security' | 'emergency';

export type EscalationResponse = {
  kind: EscalationResponseKind;
  byId: string;
  at: number;
  /** Backup or reassign target. */
  volunteerId?: string;
  target?: HandoverTarget;
  etaAt?: number;
  note?: string;
};

/** "Need help": the lead owns it first, then Mo once it bumps (lifecycle POLICY.bumpToCoordinatorMs). */
export type Escalation = {
  at: number;
  /** What the volunteer said. */
  reason: string | null;
  /** Who owns it now. */
  level: 'lead' | 'coordinator';
  /** Lead id, or Mo. */
  ownerId: string | null;
  bumpedAt: number | null;
  response: EscalationResponse | null;
  /**
   * 'intake': the intake agent escalated a new report before anyone was sent. The task stays open and unassigned,
   * the allocator leaves it alone, and `reason` is the agent's. Absent: a volunteer asked for help.
   */
  source?: 'intake';
};

export type GuestRequestStage = 'understanding' | 'answered' | 'finding' | 'coming' | 'with_you' | 'sorted' | 'cancelled';

export type GuestThreadEntry = { from: 'guest' | 'ai' | 'staff'; name?: string; text: string; at: number };

/**
 * A festival-goer's question or report. A festival-goer only ever reads their own; crew read the ones
 * behind tasks they work on.
 */
export type GuestRequest = {
  id: string;
  /** Who asked. Crew use it to find them on the map. */
  guestId?: string;
  createdAt: number;
  heard: string;
  zoneSlug: string | null;
  locationHint: string | null;
  /** Stored for the steps before a task exists; once there is one, read `guestStage()` instead. */
  stage: GuestRequestStage;
  aiAnswer: string | null;
  taskId: string | null;
  thread: GuestThreadEntry[];
  /** "Still need help?" after Sorted. */
  reopenedAt: number | null;
};

export type ProposalCandidate = {
  volunteerId: string;
  /** Why, short: "free · 120 m · first aid cert". */
  rationale: string;
  distanceM: number | null;
};

export type ProposalStatus = 'pending' | 'approved' | 'auto_assigned' | 'cancelled';

/** The AI's pick for a P1/P2 guest report. A lead or Mo approves or changes it; nobody acting by `autoAssignAt` assigns the top pick. */
export type Proposal = {
  id: string;
  taskId: string;
  /** Best first. */
  candidates: ProposalCandidate[];
  /** Who goes with the top pick: the picker's read of how many it needs (one, so none, until it has read it). */
  helperIds: string[];
  createdAt: number;
  autoAssignAt: number;
  status: ProposalStatus;
  /** Who got it, once decided. */
  volunteerId: string | null;
  decidedById: string | null;
  decidedAt: number | null;
};

export type TaskEventKind =
  | 'created' | 'assigned' | 'queued' | 'reply' | 'nudged' | 'lead_alerted'
  | 'escalated' | 'reassigned' | 'resolved' | 'note'
  | 'responded' | 'bumped' | 'proposed';

export type TaskEvent = {
  id: string;
  taskId: string;
  at: number;
  kind: TaskEventKind;
  actor: { kind: 'system' | 'agent' | 'human'; id?: string; name?: string };
  text: string;
  reply?: ReplyKind;
  /** What the volunteer said or typed with the reply. */
  note?: string;
};

export type MessageKind =
  | 'task' | 'nudge' | 'broadcast' | 'direct' | 'system'
  /** Your task went to someone else ("Moved to Kai"). */
  | 'moved'
  /** Your task was closed by a lead ("Closed by Jordan"). */
  | 'closed'
  /** Handover arrived; you're free. */
  | 'arrived'
  /** You've been sent as backup. */
  | 'backup'
  /** Something needs a lead or Mo: help asked, bumped, approval waiting. */
  | 'escalation'
  /** A festival-goer replied or added detail. */
  | 'guest_reply';

export type Message = {
  id: string;
  recipientId: string;
  at: number;
  kind: MessageKind;
  fromName: string;
  body: string;
  taskId?: string;
  /** How it reached the volunteer: read aloud (idle) or a short ping (busy). */
  delivery?: 'spoken' | 'ping';
  /** The spoken version, once rendered: a path in the `speech` bucket. */
  audio?: string;
  read: boolean;
};
