import type { Database } from '@/lib/database.types';
import type {
  Duty, Escalation, GuestRequest, GuestThreadEntry, Message, Proposal, ProposalCandidate, ProposalStatus, Task, TaskEvent,
  TeamSlug, Volunteer, VolunteerRole,
} from '@/lib/schema';

/**
 * Row ↔ domain mapping for the server, in one place. The client's SupabaseRepo has its own
 * (src/data/supabase/rows.ts); collapse onto that at merge. Conventions both sides must agree on:
 *
 *  - Times: timestamptz columns ↔ epoch ms. jsonb `tasks.escalation` and `guest_requests.thread` hold epoch ms already.
 *  - Task.reporter comes from the task's `reports` row (every task has one; the server writes one per new task).
 *  - TaskEvent: `task_events.data` = { text, reply?, note?, actorName? }. actor_id is set for crew, null for
 *    agents, the scheduler and festival-goers; actorName carries the name for those.
 *  - Message: one `messages` row + one `message_deliveries` row per recipient, broadcasts included, so
 *    Message.id = messages.id is unique per recipient. fromName = the sender's name if sender_id is set,
 *    'Festival-goer' for kind guest_reply, else 'Moloop'. read = delivery.read_at is not null.
 *  - Proposal: an `agent_actions` row of type assign_volunteer. payload = { type, taskId, volunteerIds, candidates,
 *    volunteerId }. Status pending ↔ pending, approved ↔ approved, auto_assigned ↔ executed, cancelled ↔ expired.
 *    One task_assignments(status proposed) row per candidate too, so candidates can see the task (RLS).
 *  - Volunteer.duty ↔ profiles.status: on_duty ↔ active, on_break ↔ on_break, off_shift ↔ anything else.
 *    zoneSlug ↔ profiles.last_known_zone. Roles safety_lead and admin read as coordinator.
 */

type Enums = Database['public']['Enums'];
type Ts = Date | null;

export type Refs = {
  teamId: Map<string, string>;
  teamSlug: Map<string, string>;
  teamName: Map<string, string>;
  zoneId: Map<string, string>;
  zoneSlug: Map<string, string>;
};

export const ms = (d: Ts) => (d ? d.getTime() : null);
export const ts = (n: number | null | undefined) => (n == null ? null : new Date(n));

// ── volunteers ──

export type VolunteerRow = {
  id: string; full_name: string; role: Enums['user_role']; team_slug: string | null; zone_slug: string | null;
  status: Enums['volunteer_status']; languages: string[]; skills: string[]; phone: string | null;
};

const ROLE: Record<Enums['user_role'], VolunteerRole> = {
  volunteer: 'volunteer', team_lead: 'team_lead', coordinator: 'coordinator', safety_lead: 'coordinator', admin: 'coordinator',
};
const dutyOf = (s: Enums['volunteer_status']): Duty => (s === 'active' ? 'on_duty' : s === 'on_break' ? 'on_break' : 'off_shift');
export const statusOf = (d: Duty): Enums['volunteer_status'] => (d === 'on_duty' ? 'active' : d);

export const volunteerFromRow = (r: VolunteerRow): Volunteer => ({
  id: r.id, name: r.full_name, role: ROLE[r.role], teamSlug: r.team_slug as TeamSlug | null, skills: r.skills, languages: r.languages,
  zoneSlug: r.zone_slug, duty: dutyOf(r.status), shiftEndsAt: null, phone: r.phone,
});

// ── tasks ──

export type TaskRow = {
  id: string; title: string; summary: string; category: Enums['incident_category']; priority: Enums['priority'];
  team_slug: string | null; zone_slug: string | null; location_hint: string | null; status: Enums['task_status'];
  assignee_id: string | null; handled_by: Enums['handled_by']; created_at: Date; assigned_at: Ts; eta_at: Ts;
  last_activity_at: Date; nudge_count: number; last_nudge_at: Ts; lead_alerted_at: Ts; resolved_at: Ts;
  escalation: Escalation | null; helper_ids: string[]; resolution: Enums['task_resolution'] | null; request_id: string | null;
  reporter_kind: Enums['reporter_kind']; raw_text: string | null; detected_language: string | null; reporter_name: string | null;
};

export const taskFromRow = (r: TaskRow): Task => ({
  id: r.id, title: r.title, summary: r.summary, category: r.category, priority: r.priority, teamSlug: r.team_slug as TeamSlug | null,
  zoneSlug: r.zone_slug, locationHint: r.location_hint, status: r.status, assigneeId: r.assignee_id,
  reporter: {
    kind: r.reporter_kind, ...(r.reporter_name ? { name: r.reporter_name } : {}),
    quote: r.raw_text ?? r.summary, language: r.detected_language ?? 'en',
  },
  handledBy: r.handled_by, createdAt: r.created_at.getTime(), assignedAt: ms(r.assigned_at), etaAt: ms(r.eta_at),
  lastActivityAt: r.last_activity_at.getTime(), nudgeCount: r.nudge_count, lastNudgeAt: ms(r.last_nudge_at),
  leadAlertedAt: ms(r.lead_alerted_at), resolvedAt: ms(r.resolved_at), escalation: r.escalation, helperIds: r.helper_ids,
  resolution: r.resolution, requestId: r.request_id,
});

const idOf = (map: Map<string, string>, slug: string | null) => (slug == null ? null : map.get(slug) ?? null);

/** Everything on a task the commands can change. `escalation` still needs wrapping as json by the caller. */
export const taskRow = (t: Task, refs: Refs) => ({
  title: t.title, summary: t.summary, category: t.category, priority: t.priority,
  team_id: idOf(refs.teamId, t.teamSlug), zone_id: idOf(refs.zoneId, t.zoneSlug), location_hint: t.locationHint,
  status: t.status, assignee_id: t.assigneeId, assigned_at: ts(t.assignedAt), eta_at: ts(t.etaAt),
  last_activity_at: ts(t.lastActivityAt), nudge_count: t.nudgeCount, last_nudge_at: ts(t.lastNudgeAt),
  lead_alerted_at: ts(t.leadAlertedAt), resolved_at: ts(t.resolvedAt), escalation: t.escalation, helper_ids: t.helperIds,
  resolution: t.resolution, request_id: t.requestId, handled_by: t.handledBy,
});

/** The `reports` row behind a new task: who said what. */
export const reportRow = (t: Task, refs: Refs, reporterId: string | null) => ({
  id: crypto.randomUUID(),
  channel: (t.reporter.kind === 'festivalgoer' ? 'text' : 'voice') as Enums['report_channel'],
  reporter_kind: t.reporter.kind, reporter_id: reporterId, raw_text: t.reporter.quote, detected_language: t.reporter.language,
  zone_id: idOf(refs.zoneId, t.zoneSlug), location_hint: t.locationHint, received_at: ts(t.createdAt),
});

// ── events and messages ──

export const eventRow = (e: TaskEvent) => ({
  id: e.id, task_id: e.taskId, actor_id: e.actor.kind === 'human' ? e.actor.id ?? null : null, actor_kind: e.actor.kind, kind: e.kind,
  data: Object.fromEntries(Object.entries({
    text: e.text, reply: e.reply, note: e.note, actorName: e.actor.kind === 'human' && e.actor.id ? undefined : e.actor.name,
  }).filter(([, v]) => v !== undefined)),
  created_at: ts(e.at),
});

export const messageRow = (m: Message, senderId: string | null) => ({
  id: m.id, direction: 'outbound' as const, scope: (m.kind === 'broadcast' ? 'broadcast' : 'direct') as Enums['message_scope'],
  sender_id: senderId, task_id: m.taskId ?? null, body: m.body, kind: m.kind, created_at: ts(m.at),
});

export const deliveryRow = (m: Message) => ({ message_id: m.id, recipient_id: m.recipientId, delivery: m.delivery ?? null });

// ── proposals ──

export type ProposalRow = {
  id: string; task_id: string; payload: { volunteerIds?: string[]; candidates?: ProposalCandidate[]; volunteerId?: string | null };
  rationale: string | null; status: Enums['action_status']; decided_by: string | null; decided_at: Ts; auto_assign_at: Ts; created_at: Date;
};

const PROPOSAL_STATUS: Record<Enums['action_status'], ProposalStatus> = {
  pending: 'pending', approved: 'approved', executed: 'auto_assigned', rejected: 'cancelled', expired: 'cancelled', failed: 'cancelled',
};
const ACTION_STATUS: Record<ProposalStatus, Enums['action_status']> = {
  pending: 'pending', approved: 'approved', auto_assigned: 'executed', cancelled: 'expired',
};

export const proposalFromRow = (r: ProposalRow): Proposal => ({
  id: r.id, taskId: r.task_id,
  // The report pipeline's proposals (store.insertProposal) carry ids only.
  candidates: r.payload.candidates ?? (r.payload.volunteerIds ?? []).map((volunteerId, i) => ({ volunteerId, rationale: i === 0 ? r.rationale ?? '' : '', distanceM: null })),
  createdAt: r.created_at.getTime(), autoAssignAt: ms(r.auto_assign_at) ?? Number.MAX_SAFE_INTEGER, status: PROPOSAL_STATUS[r.status],
  volunteerId: r.payload.volunteerId ?? null, decidedById: r.decided_by, decidedAt: ms(r.decided_at),
});

export const proposalRow = (p: Proposal) => ({
  type: 'assign_volunteer' as const, task_id: p.taskId,
  payload: { type: 'assign_volunteer', taskId: p.taskId, volunteerIds: p.candidates.map((c) => c.volunteerId), candidates: p.candidates, volunteerId: p.volunteerId },
  rationale: p.candidates[0]?.rationale ?? null, status: ACTION_STATUS[p.status], decided_by: p.decidedById, decided_at: ts(p.decidedAt),
  executed_at: p.status === 'approved' || p.status === 'auto_assigned' ? ts(p.decidedAt) : null,
  auto_assign_at: ts(p.autoAssignAt), created_at: ts(p.createdAt),
});

// ── festival-goer requests ──

export type RequestRow = {
  id: string; guest_id: string; heard: string; zone_slug: string | null; location_hint: string | null; stage: Enums['guest_request_stage'];
  ai_answer: string | null; task_id: string | null; thread: GuestThreadEntry[]; reopened_at: Ts; created_at: Date;
};

export const requestFromRow = (r: RequestRow): GuestRequest => ({
  id: r.id, createdAt: r.created_at.getTime(), heard: r.heard, zoneSlug: r.zone_slug, locationHint: r.location_hint, stage: r.stage,
  aiAnswer: r.ai_answer, taskId: r.task_id, thread: r.thread, reopenedAt: ms(r.reopened_at),
});

export const requestRow = (r: GuestRequest, refs: Refs) => ({
  heard: r.heard, zone_id: idOf(refs.zoneId, r.zoneSlug), location_hint: r.locationHint, stage: r.stage, ai_answer: r.aiAnswer,
  task_id: r.taskId, thread: r.thread, reopened_at: ts(r.reopenedAt),
});
