/**
 * Database rows → domain types (src/lib/schema/domain.ts). The one canonical mapping: SupabaseRepo
 * uses it on the phone, and the server reuses it. Pure: no client, no React Native.
 *
 * Conventions:
 *  - Domain times are epoch ms; the database stores timestamptz.
 *  - `tasks.escalation` and `guest_requests.thread` are jsonb already in the domain shape (times in ms).
 *  - Rows carry ids for teams and zones; the domain uses slugs. `Refs` resolves them.
 */
import type { Database, Json, Tables } from '@/lib/database.types';
import type {
  Duty,
  Escalation,
  GuestRequest,
  GuestThreadEntry,
  HelperAssignment,
  Message,
  Mobilization,
  MobilizationCause,
  MobilizationEvidence,
  MobilizationStep,
  Playbook,
  Position,
  Proposal,
  ProposalStatus,
  ReplyKind,
  Reporter,
  Task,
  TaskEvent,
  TaskEventKind,
  Team,
  TeamSlug,
  Volunteer,
  VolunteerRole,
  Zone,
} from '@/lib/schema';
import { POLICY } from '@/lib/lifecycle';
import { TEAMS } from '../teams';
import { toPlan } from '../venue';

export type Row<T extends keyof Database['public']['Tables']> = Tables<T>;

// ── time ──

/** timestamptz → epoch ms. Tolerates Postgres' own format ("2026-10-07 01:02:03.123456+00") as well as ISO. */
export function toMs(ts: string): number {
  const iso = ts
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1') // microseconds: not every JS engine parses more than 3 digits
    .replace(/([+-]\d{2})$/, '$1:00'); // "+00" → "+00:00"
  return Date.parse(iso);
}

export const toMsOrNull = (ts: string | null | undefined): number | null => (ts ? toMs(ts) : null);

/** Epoch ms → timestamptz, for the server writing domain values back. */
export const fromMs = (ms: number | null | undefined): string | null =>
  ms == null ? null : new Date(ms).toISOString();

// ── reference data ──

/** id → slug lookups for teams and zones. */
export type Refs = { teams: Map<string, TeamSlug>; zones: Map<string, string> };

export const emptyRefs = (): Refs => ({ teams: new Map(), zones: new Map() });

export function refsFrom(teams: Pick<Row<'teams'>, 'id' | 'slug'>[], zones: Pick<Row<'zones'>, 'id' | 'slug'>[]): Refs {
  return {
    teams: new Map(teams.map((t) => [t.id, t.slug as TeamSlug])),
    zones: new Map(zones.map((z) => [z.id, z.slug])),
  };
}

const teamSlug = (refs: Refs, id: string | null) => (id ? (refs.teams.get(id) ?? null) : null);
const zoneSlug = (refs: Refs, id: string | null) => (id ? (refs.zones.get(id) ?? null) : null);

const ICONS = new Map(TEAMS.map((t) => [t.slug, t]));

/** `sf`/`md` icons aren't in the database: they come from the app's team list, by slug. */
export function toTeam(row: Pick<Row<'teams'>, 'slug' | 'name' | 'color'>): Team {
  const icon = ICONS.get(row.slug as TeamSlug);
  return {
    slug: row.slug as TeamSlug,
    name: row.name,
    short: icon?.short ?? row.name,
    color: row.color ?? icon?.color ?? '#8E8E93',
    sf: icon?.sf ?? 'person.3.fill',
    md: icon?.md ?? 'groups',
  };
}

export const toZone = (row: Pick<Row<'zones'>, 'slug' | 'name'>): Zone => ({
  slug: row.slug,
  name: row.name,
});

// ── people ──

type VolunteerStatus = Database['public']['Enums']['volunteer_status'];
type UserRole = Database['public']['Enums']['user_role'];

/** active → on duty, on_break → on break; off_shift, invited and unavailable all read as off shift. */
export function dutyFromStatus(status: VolunteerStatus): Duty {
  return status === 'active' ? 'on_duty' : status === 'on_break' ? 'on_break' : 'off_shift';
}

export const statusFromDuty = (duty: Duty): VolunteerStatus =>
  duty === 'on_duty' ? 'active' : duty === 'on_break' ? 'on_break' : 'off_shift';

/** The app knows three roles; safety leads and admins act as Mo. */
export const toRole = (role: UserRole): VolunteerRole =>
  role === 'volunteer' || role === 'team_lead' ? role : 'coordinator';

export type ProfileRow = Pick<
  Row<'profiles'>,
  'id' | 'full_name' | 'role' | 'team_id' | 'status' | 'languages' | 'last_known_zone' | 'avatar'
>;
export const PROFILE_SELECT = 'id, full_name, role, team_id, status, languages, last_known_zone, avatar';

/** `skills` from volunteer_skills, `phone` from profile_private (null when the caller can't read it). */
export function toVolunteer(
  row: ProfileRow,
  refs: Refs,
  extra: { skills?: string[]; phone?: string | null } = {},
): Volunteer {
  return {
    id: row.id,
    name: row.full_name,
    role: toRole(row.role),
    teamSlug: teamSlug(refs, row.team_id),
    skills: extra.skills ?? [],
    languages: row.languages ?? ['en'],
    zoneSlug: zoneSlug(refs, row.last_known_zone),
    duty: dutyFromStatus(row.status),
    shiftEndsAt: null,
    phone: extra.phone ?? null,
    avatar: row.avatar,
  };
}

// ── tasks ──

/** The report behind a task, embedded with the reporter's profile name. */
export type ReportJoin = {
  reporter_kind: Row<'reports'>['reporter_kind'];
  raw_text: string | null;
  detected_language: string | null;
  /** Server-side only (server/world.ts): the app's embed leaves it out, and the picker that reads it is on the server. */
  speaker_needed?: string | null;
  /** Server-side only, like `speaker_needed`. */
  first_aid_needed?: boolean | null;
  /** `raw_text` in English, when the AI read it. */
  text_en?: string | null;
  reporter: { full_name: string } | null;
} | null;

/** `report` is null when the caller can't read it (RLS) or the embed was left out. */
export const TASK_SELECT =
  '*, report:reports!tasks_report_id_fkey(reporter_kind, raw_text, detected_language, text_en, reporter:profiles!reports_reporter_id_fkey(full_name))';

export type TaskRow = Row<'tasks'> & { report?: ReportJoin };

export function toReporter(report: ReportJoin | undefined): Reporter {
  if (!report) return { kind: 'system', quote: '', language: 'en' };
  return {
    kind: report.reporter_kind,
    ...(report.reporter?.full_name ? { name: report.reporter.full_name } : {}),
    quote: report.raw_text ?? '',
    language: report.detected_language ?? 'en',
    ...(report.speaker_needed !== undefined ? { speakerNeeded: report.speaker_needed } : {}),
    ...(report.first_aid_needed !== undefined ? { firstAidNeeded: report.first_aid_needed } : {}),
    ...(report.text_en ? { english: report.text_en } : {}),
  };
}

/** `reporter` overrides the embedded report, so a realtime row (no embed) can keep the reporter it had. */
export function toTask(row: TaskRow, refs: Refs, reporter: Reporter = toReporter(row.report)): Task {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    priority: row.priority,
    teamSlug: teamSlug(refs, row.team_id),
    zoneSlug: zoneSlug(refs, row.zone_id),
    locationHint: row.location_hint,
    status: row.status,
    assigneeId: row.assignee_id,
    reporter,
    handledBy: row.handled_by,
    createdAt: toMs(row.created_at),
    assignedAt: toMsOrNull(row.assigned_at),
    etaAt: toMsOrNull(row.eta_at),
    lastActivityAt: toMs(row.last_activity_at),
    nudgeCount: row.nudge_count,
    lastNudgeAt: toMsOrNull(row.last_nudge_at),
    leadAlertedAt: toMsOrNull(row.lead_alerted_at),
    resolvedAt: toMsOrNull(row.resolved_at),
    escalation: (row.escalation as Escalation | null) ?? null,
    requiredCount: row.required_count,
    helpers: (row.helper_status as HelperAssignment[] | null) ?? [],
    resolution: row.resolution,
    requestId: row.request_id,
    mobilizationId: row.mobilization_id,
    mobilizationStepKey: row.mobilization_step_key,
    requiredSkills: row.required_skills ?? [],
    declinedIds: row.declined_ids ?? [],
  };
}

// ── task events ──

/** What `task_events.data` holds. Every field is optional so older rows (`{ handledBy }`) still map. */
export type TaskEventData = {
  text?: string;
  reply?: ReplyKind;
  note?: string;
  /** For system and agent actors with no profile: "Triage", "Scheduler". */
  actorName?: string;
};

const EVENT_KINDS = new Set<TaskEventKind>([
  'created',
  'assigned',
  'queued',
  'reply',
  'nudged',
  'lead_alerted',
  'escalated',
  'reassigned',
  'resolved',
  'note',
  'responded',
  'bumped',
  'proposed',
  'helper_added',
]);

/** Shown when an event row carries no text of its own. */
const EVENT_TEXT: Record<TaskEventKind, string> = {
  created: 'Reported',
  assigned: 'Assigned',
  queued: 'Queued',
  reply: 'Replied',
  nudged: 'Nudged',
  lead_alerted: 'Lead alerted',
  escalated: 'Asked for help',
  reassigned: 'Reassigned',
  resolved: 'Resolved',
  note: 'Note',
  responded: 'Responded',
  bumped: 'Passed to Mo',
  proposed: 'Suggested a volunteer',
  helper_added: 'Helper recruited',
};

const asObject = (j: Json): Record<string, Json | undefined> =>
  j && typeof j === 'object' && !Array.isArray(j) ? j : {};

/** `actorName` is the actor's profile name, when the caller can see it. Unknown kinds read as notes. */
export function toTaskEvent(row: Row<'task_events'>, actorName?: string): TaskEvent {
  const data = asObject(row.data) as TaskEventData;
  const kind = EVENT_KINDS.has(row.kind as TaskEventKind) ? (row.kind as TaskEventKind) : 'note';
  const actorKind = row.actor_kind === 'human' || row.actor_kind === 'agent' ? row.actor_kind : 'system';
  const name = actorName ?? data.actorName;
  return {
    id: row.id,
    taskId: row.task_id,
    at: toMs(row.created_at),
    kind,
    actor: {
      kind: actorKind,
      ...(row.actor_id ? { id: row.actor_id } : {}),
      ...(name ? { name } : {}),
    },
    text: data.text ?? (kind === 'note' && row.kind !== 'note' ? row.kind : EVENT_TEXT[kind]),
    ...(data.reply ? { reply: data.reply } : {}),
    ...(data.note ? { note: data.note } : {}),
  };
}

// ── presence ──

/** A presence row on the plan. Rows carry lng/lat; everything on the phone works in plan metres. */
export function toPosition(
  row: Pick<Row<'presence'>, 'person_id' | 'lat' | 'lng' | 'accuracy' | 'heading' | 'at'>,
): Position {
  const { x, y } = toPlan([row.lng, row.lat]);
  return { personId: row.person_id, x, y, accuracy: row.accuracy, heading: row.heading, at: toMs(row.at) };
}

// ── festival-goers ──

export function toGuestRequest(row: Row<'guest_requests'>, refs: Refs): GuestRequest {
  return {
    id: row.id,
    guestId: row.guest_id,
    createdAt: toMs(row.created_at),
    heard: row.heard,
    zoneSlug: zoneSlug(refs, row.zone_id),
    locationHint: row.location_hint,
    stage: row.stage,
    aiAnswer: row.ai_answer,
    taskId: row.task_id,
    thread: Array.isArray(row.thread) ? (row.thread as GuestThreadEntry[]) : [],
    reopenedAt: toMsOrNull(row.reopened_at),
  };
}

// ── proposals ──

/** Proposals are `agent_actions(assign_volunteer)` plus its `task_assignments(status = proposed)`. */
export const PROPOSAL_ACTION_SELECT =
  'id, task_id, status, payload, decided_by, decided_at, executed_at, auto_assign_at, created_at';
export type ProposalActionRow = Pick<
  Row<'agent_actions'>,
  | 'id'
  | 'task_id'
  | 'status'
  | 'payload'
  | 'decided_by'
  | 'decided_at'
  | 'executed_at'
  | 'auto_assign_at'
  | 'created_at'
>;
export const PROPOSAL_CANDIDATE_SELECT = 'id, task_id, volunteer_id, status, rationale, distance_m, created_at';
export type ProposalCandidateRow = Pick<
  Row<'task_assignments'>,
  'id' | 'task_id' | 'volunteer_id' | 'status' | 'rationale' | 'distance_m' | 'created_at'
>;

/** pending → pending, approved → approved, executed with nobody deciding → auto-assigned, rejected/expired/failed → cancelled. */
export function toProposalStatus(row: Pick<Row<'agent_actions'>, 'status' | 'decided_by'>): ProposalStatus {
  switch (row.status) {
    case 'pending':
      return 'pending';
    case 'approved':
      return 'approved';
    case 'executed':
      return row.decided_by ? 'approved' : 'auto_assigned';
    default:
      return 'cancelled';
  }
}

/**
 * `candidates` are the proposed assignment rows, in the order the agent proposed them
 * (`payload.volunteerIds`, else row creation order); `helperIds` go with the top pick. `volunteerId` is who got it, once decided.
 */
export function toProposal(
  action: ProposalActionRow,
  candidates: ProposalCandidateRow[],
  volunteerId: string | null = null,
): Proposal {
  const { volunteerIds: order, helperIds } = asObject(action.payload);
  const rank = new Map(Array.isArray(order) ? order.map((id, i) => [String(id), i]) : []);
  const proposed = candidates
    .filter((c) => c.status === 'proposed' && c.task_id === action.task_id)
    .sort(
      (a, b) =>
        (rank.get(a.volunteer_id) ?? Infinity) - (rank.get(b.volunteer_id) ?? Infinity) ||
        toMs(a.created_at) - toMs(b.created_at),
    );
  const createdAt = toMs(action.created_at);
  const status = toProposalStatus(action);
  return {
    id: action.id,
    taskId: action.task_id ?? '',
    candidates: proposed.map((c) => ({
      volunteerId: c.volunteer_id,
      rationale: c.rationale ?? '',
      distanceM: c.distance_m,
    })),
    helperIds: Array.isArray(helperIds)
      ? helperIds.map(String).filter((id) => proposed.some((c) => c.volunteer_id === id))
      : [],
    createdAt,
    autoAssignAt: toMsOrNull(action.auto_assign_at) ?? createdAt + POLICY.autoAssignMs,
    status,
    volunteerId: status === 'pending' || status === 'cancelled' ? null : volunteerId,
    decidedById: action.decided_by,
    decidedAt: toMsOrNull(action.decided_at) ?? toMsOrNull(action.executed_at),
  };
}

// ── mobilization ──

export function toMobilization(row: Row<'mobilizations'>, refs: Refs): Mobilization {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    rationale: row.rationale,
    relatedPlaybooks: row.related_playbooks ?? [],
    urgency: row.urgency,
    zoneSlug: zoneSlug(refs, row.zone_id),
    steps: (row.steps as MobilizationStep[] | null) ?? [],
    evidence: (row.evidence as MobilizationEvidence | null) ?? null,
    playbookSlug: row.playbook_slug,
    triggerPlaybook: row.trigger_playbook,
    causes: (row.causes as MobilizationCause[] | null) ?? [],
    analysisRunId: row.analysis_run_id,
    createdAt: toMs(row.created_at),
    decidedById: row.decided_by,
    decidedAt: toMsOrNull(row.decided_at),
  };
}

export function toPlaybook(row: Row<'playbooks'>): Playbook {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    trigger: row.trigger,
    steps: (row.steps as Playbook['steps'] | null) ?? [],
  };
}

// ── messages ──

/** A delivery row with its message and the sender's name embedded. */
export const DELIVERY_SELECT =
  'message_id, recipient_id, body_local, delivery, audio_path, read_at, message:messages!message_deliveries_message_id_fkey(id, kind, body, task_id, created_at, sender:profiles!messages_sender_id_fkey(full_name))';

export type DeliveryRow = Pick<
  Row<'message_deliveries'>,
  'message_id' | 'recipient_id' | 'body_local' | 'delivery' | 'audio_path' | 'read_at'
> & {
  message:
    | (Pick<Row<'messages'>, 'id' | 'kind' | 'body' | 'task_id' | 'created_at'> & {
        sender: { full_name: string } | null;
      })
    | null;
};

/** A message as one recipient sees it: their delivery decides `read` and `delivery`. No sender reads as the festival-goer for their replies, Moloop otherwise. */
export function toMessage(delivery: DeliveryRow): Message | null {
  const m = delivery.message;
  if (!m) return null;
  return {
    id: m.id,
    recipientId: delivery.recipient_id,
    at: toMs(m.created_at),
    kind: m.kind as Message['kind'],
    fromName: m.sender?.full_name ?? (m.kind === 'guest_reply' ? 'Festival-goer' : 'Moloop'),
    body: delivery.body_local ?? m.body,
    ...(m.task_id ? { taskId: m.task_id } : {}),
    ...(delivery.delivery === 'spoken' || delivery.delivery === 'ping' ? { delivery: delivery.delivery } : {}),
    ...(delivery.audio_path ? { audio: delivery.audio_path } : {}),
    read: delivery.read_at !== null,
  };
}
