import type { IncidentCategory, Priority, ReplyKind, TaskAssignmentStatus, TaskStatus, TeamSlug } from './enums';

/**
 * Client-facing domain model. Screens see these shapes; SupabaseRepo maps database rows into them.
 * Times are epoch ms. Tests construct the same domain shapes without changing production data.
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
  /**
   * Someone there may need hands-on first aid (intake's read). Null when no model said; missing on reports from
   * before intake said. Either way the picker goes by the category.
   */
  firstAidNeeded?: boolean | null;
  /** `quote` in English, when the AI read it. Shown first to staff (see lib/quote). */
  english?: string;
};

/**
 * One recruited helper's own state on a task, independent of the owner's `status`. `status` reuses
 * `TaskAssignmentStatus` but only ever holds `'notified'` (recruited, awaiting their own accept/decline)
 * or `'accepted'` here — a decline removes the entry outright rather than storing `'declined'`.
 */
export type HelperAssignment = {
  volunteerId: string;
  /** A helper is either awaiting their own reply or has explicitly accepted. */
  status: Extract<TaskAssignmentStatus, 'notified' | 'accepted'>;
  assignedAt: number;
  respondedAt: number | null;
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
  /** How many people this task needs in total, owner included. 1 for almost every task. */
  requiredCount: number;
  /**
   * Everyone beyond the owner: backup sent by a lead (immediately `'accepted'`), or proactively
   * recruited to reach `requiredCount` (starts `'notified'`, until they accept/decline their own slot).
   * Helpers are busy with this task too; `done` from anyone resolves it for all.
   */
  helpers: HelperAssignment[];
  /** How it ended. Null while open. */
  resolution: TaskResolution | null;
  /** The festival-goer request this task came from, if any. */
  requestId: string | null;
  /** The mobilization this task was spawned from, if any. */
  mobilizationId: string | null;
  /** Stable action key within a mobilization; legacy tasks have none. */
  mobilizationStepKey?: string | null;
  /** Hard qualifications for a mobilization action, preserved through reassignment. */
  requiredSkills?: string[];
  /** Who said no to it, as owner or helper. Nobody offers it to them again. */
  declinedIds?: string[];
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
  /** Intake held this open for a lead or Mo before anyone is dispatched. */
  source?: 'intake';
};

export type GuestRequestStage =
  'understanding' | 'answered' | 'finding' | 'coming' | 'with_you' | 'sorted' | 'cancelled';

export type GuestThreadEntry = {
  from: 'guest' | 'ai' | 'staff';
  name?: string;
  text: string;
  at: number;
};

/**
 * A festival-goer's question or report. RLS returns their own requests; crew may read requests
 * behind tasks they are working on.
 */
export type GuestRequest = {
  id: string;
  /** Requester used by crew to locate the person. */
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
  | 'created'
  | 'assigned'
  | 'queued'
  | 'reply'
  | 'nudged'
  | 'lead_alerted'
  | 'escalated'
  | 'reassigned'
  | 'resolved'
  | 'note'
  | 'responded'
  | 'bumped'
  | 'proposed'
  | 'helper_added';

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
  | 'task'
  | 'nudge'
  | 'broadcast'
  | 'direct'
  | 'system'
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
  /** Rendered brief in the speech bucket. */
  audio?: string;
  read: boolean;
};

// ── mobilization ──

export type MobilizationStatus = 'proposed' | 'active' | 'stood_down' | 'cancelled' | 'rejected';

/** One concrete action. A team can own several actions; candidates are non-binding previews. */
export type MobilizationStep = {
  teamSlug: TeamSlug;
  peopleNeeded: number;
  reason: string;
  candidates: ProposalCandidate[];
  stepKey?: string;
  title?: string;
  instructions?: string;
  zoneSlug?: string | null;
  requiredSkills?: string[];
  completionCriteria?: string;
  evidenceRefs?: string[];
  addressesFindingIds?: string[];
  playbookRefs?: import('../mobilization-contracts').PlaybookActionRef[];
};

/** The observations that supported a detection proposal. A historical snapshot, never a live rollup. */
export type MobilizationEvidence = {
  observedAt: number;
  windowMinutes: number;
  incidents: {
    /** Representative zone for this cluster; nearby source tasks can belong to adjacent zones. */
    zoneSlug: string;
    category: IncidentCategory;
    count: number;
    openCount: number;
    taskIds: string[];
    sampleTitles: string[];
  }[];
  weather: {
    tempC: number;
    trendCPerHour: number;
    activeWarnings: ('heat' | 'storm')[];
    minutesToWarning: number | null;
  };
  lineup: {
    stageSlug: string;
    act: string;
    minutesUntil: number;
    expectedDraw: 'low' | 'medium' | 'high';
  }[];
};

/**
 * A multi-team response plan: system-proposed (needs Mo's approval, no auto-timeout) or Mo-initiated
 * (active immediately). `steps` is authoritative only while `status === 'proposed'`; once active, the
 * real per-step state is the `Task` rows themselves (`task.mobilizationId === this.id`).
 */
export type Mobilization = {
  id: string;
  title: string;
  status: MobilizationStatus;
  rationale: string;
  /** Playbook slugs cited as precedent, not enforced templates. */
  relatedPlaybooks: string[];
  urgency: Priority;
  zoneSlug: string | null;
  steps: MobilizationStep[];
  /** Detection-time source observations. Manual and older mobilizations have no stored snapshot. */
  evidence: MobilizationEvidence | null;
  /** Immutable AI input/output and prompt audit; absent on legacy/manual plans. */
  analysisRunId?: string | null;
  /** Set when created from a playbook template. */
  playbookSlug: string | null;
  createdAt: number;
  decidedById: string | null;
  decidedAt: number | null;
};

/** A precedent case (heat, storm, lost child...): reference material for Gate 3, not a rigid dispatcher. */
export type Playbook = {
  id: string;
  slug: string;
  title: string;
  trigger: string;
  steps: { step: string; teamSlug: TeamSlug; template: string }[];
};
