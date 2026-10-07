import type { Database } from '@/lib/database.types';
import { fromMs, statusFromDuty, type Refs } from '@/data/supabase/rows';
import { helperIdsOf } from '@/lib/lifecycle';
import type { GuestRequest, Message, Mobilization, Proposal, Task, TaskEvent } from '@/lib/schema';

/**
 * Domain → rows, for the server's writes. Reading goes through the canonical mappers in
 * src/data/supabase/rows.ts, which the phones use too; this is their inverse. Conventions:
 *
 *  - Every new task gets its own `reports` row: who said what (Task.reporter).
 *  - TaskEvent: `task_events.data` = { text, reply?, note?, actorName? }. actor_id is set for crew.
 *  - Message: one `messages` row + one `message_deliveries` row per recipient, broadcasts included, so
 *    Message.id = messages.id is unique per recipient. sender_id is set when a person sent it.
 *  - Proposal: an `agent_actions(assign_volunteer)` row, payload { type, taskId, volunteerIds, helperIds } best first, plus
 *    one task_assignments(proposed) row per candidate. Decided: approved → approved, auto-assigned → executed
 *    with nobody in decided_by, cancelled → expired; the pick's row goes approved, the rest rejected.
 *  - Everyone placed on a task (owner, queued owner, backup) has a task_assignments row that follows them:
 *    notified → accepted → done, or reassigned when the task moves off them. The row is what lets their
 *    phone still read the task, and hear about it over realtime, once it's someone else's.
 */

type Enums = Database['public']['Enums'];

/** Slug → id, the other way from Refs. */
export type Ids = { teams: Map<string, string>; zones: Map<string, string> };
export const idsFrom = (refs: Refs): Ids => ({
  teams: new Map([...refs.teams].map(([id, slug]) => [slug, id])),
  zones: new Map([...refs.zones].map(([id, slug]) => [slug, id])),
});
const idOf = (map: Map<string, string>, slug: string | null) => (slug == null ? null : (map.get(slug) ?? null));

export { statusFromDuty };

/** Everything on a task the commands can change. `escalation`/`helper_status` still need wrapping as json by the caller. */
export const taskRow = (t: Task, ids: Ids) => ({
  title: t.title,
  summary: t.summary,
  category: t.category,
  priority: t.priority,
  team_id: idOf(ids.teams, t.teamSlug),
  zone_id: idOf(ids.zones, t.zoneSlug),
  location_hint: t.locationHint,
  status: t.status,
  assignee_id: t.assigneeId,
  assigned_at: fromMs(t.assignedAt),
  eta_at: fromMs(t.etaAt),
  last_activity_at: fromMs(t.lastActivityAt),
  nudge_count: t.nudgeCount,
  last_nudge_at: fromMs(t.lastNudgeAt),
  lead_alerted_at: fromMs(t.leadAlertedAt),
  resolved_at: fromMs(t.resolvedAt),
  escalation: t.escalation,
  required_count: t.requiredCount,
  helper_ids: helperIdsOf(t),
  helper_status: t.helpers,
  resolution: t.resolution,
  request_id: t.requestId,
  mobilization_id: t.mobilizationId,
  mobilization_step_key: t.mobilizationStepKey ?? null,
  required_skills: t.requiredSkills ?? [],
  declined_ids: t.declinedIds ?? [],
  handled_by: t.handledBy,
});

/** The `reports` row behind a new task. */
export const reportRow = (t: Task, ids: Ids, reporterId: string | null) => ({
  id: crypto.randomUUID(),
  channel: (t.reporter.kind === 'festivalgoer' ? 'text' : 'voice') as Enums['report_channel'],
  reporter_kind: t.reporter.kind,
  reporter_id: reporterId,
  raw_text: t.reporter.quote,
  detected_language: t.reporter.language,
  speaker_needed: t.reporter.speakerNeeded ?? null,
  first_aid_needed: t.reporter.firstAidNeeded ?? null,
  text_en: t.reporter.english ?? null,
  zone_id: idOf(ids.zones, t.zoneSlug),
  location_hint: t.locationHint,
  received_at: fromMs(t.createdAt),
});

export const eventRow = (e: TaskEvent) => ({
  id: e.id,
  task_id: e.taskId,
  actor_id: e.actor.kind === 'human' ? (e.actor.id ?? null) : null,
  actor_kind: e.actor.kind,
  kind: e.kind,
  data: Object.fromEntries(
    Object.entries({ text: e.text, reply: e.reply, note: e.note, actorName: e.actor.name }).filter(
      ([, v]) => v !== undefined,
    ),
  ),
});

export const messageRow = (m: Message, senderId: string | null) => ({
  id: m.id,
  direction: 'outbound' as const,
  scope: (m.kind === 'broadcast' ? 'broadcast' : 'direct') as Enums['message_scope'],
  sender_id: senderId,
  task_id: m.taskId ?? null,
  body: m.body,
  kind: m.kind,
});

export const deliveryRow = (m: Message) => ({
  message_id: m.id,
  recipient_id: m.recipientId,
  delivery: m.delivery ?? null,
});

const ACTION_STATUS: Record<Proposal['status'], Enums['action_status']> = {
  pending: 'pending',
  approved: 'approved',
  auto_assigned: 'executed',
  cancelled: 'expired',
};

export const proposalRow = (p: Proposal) => ({
  type: 'assign_volunteer' as const,
  task_id: p.taskId,
  payload: {
    type: 'assign_volunteer',
    taskId: p.taskId,
    volunteerIds: p.candidates.map((c) => c.volunteerId),
    helperIds: p.helperIds,
  },
  rationale: p.candidates[0]?.rationale ?? null,
  status: ACTION_STATUS[p.status],
  decided_by: p.decidedById,
  decided_at: fromMs(p.decidedAt),
  executed_at: p.status === 'approved' || p.status === 'auto_assigned' ? fromMs(p.decidedAt) : null,
  auto_assign_at: fromMs(p.autoAssignAt),
  created_at: fromMs(p.createdAt),
});

/** `steps` and non-null `evidence` still need wrapping as json by the caller. */
export const mobilizationRow = (m: Mobilization, ids: Ids) => ({
  title: m.title,
  status: m.status,
  rationale: m.rationale,
  related_playbooks: m.relatedPlaybooks,
  urgency: m.urgency,
  zone_id: idOf(ids.zones, m.zoneSlug),
  steps: m.steps,
  evidence: m.evidence,
  playbook_slug: m.playbookSlug,
  analysis_run_id: m.analysisRunId ?? null,
  decided_by: m.decidedById,
  decided_at: fromMs(m.decidedAt),
});

export const requestRow = (r: GuestRequest, ids: Ids) => ({
  heard: r.heard,
  zone_id: idOf(ids.zones, r.zoneSlug),
  location_hint: r.locationHint,
  stage: r.stage,
  ai_answer: r.aiAnswer,
  task_id: r.taskId,
  thread: r.thread,
  reopened_at: fromMs(r.reopenedAt),
});

/** The owner and any backup: everyone a task_assignments row should follow. */
export const peopleOn = (t: Task | undefined) =>
  t ? [t.assigneeId, ...helperIdsOf(t)].filter((x): x is string => !!x) : [];

/**
 * Where someone on a task stands, as a task_assignments status. A helper's own slot (own accept/decline,
 * independent of the task's status) is checked first; everything else falls back to the owner-only logic.
 * Null: leave the row as it is.
 */
export function assignmentStatus(t: Task, volunteerId: string): Enums['task_assignment_status'] | null {
  if (t.status === 'resolved') return 'done';
  const helper = t.helpers.find((h) => h.volunteerId === volunteerId);
  if (helper) return helper.status === 'accepted' ? 'accepted' : 'notified';
  if (t.status === 'accepted' || t.status === 'in_progress' || t.status === 'escalated') return 'accepted';
  if ((t.status === 'assigned' || t.status === 'queued') && t.assigneeId === volunteerId) return 'notified';
  return null;
}
