import { z } from 'zod';

// Mirrors the Postgres enums in supabase/migrations. Keep in sync.
export const Priority = z.enum(['P1', 'P2', 'P3']);
export type Priority = z.infer<typeof Priority>;

export const IncidentCategory = z.enum([
  'medical', 'heat', 'lost_child', 'lost_property', 'crowding', 'security',
  'weather', 'facilities', 'accessibility', 'info_request', 'artist', 'vendor', 'technical', 'other',
]);
export type IncidentCategory = z.infer<typeof IncidentCategory>;

export const ReportChannel = z.enum(['text', 'voice', 'radio', 'photo', 'phone', 'in_person']);
export type ReportChannel = z.infer<typeof ReportChannel>;

/**
 * Task lifecycle (docs/ARCHITECTURE.md). Nudged / lead-alerted are overlays tracked by
 * nudge_count + lead_alerted_at, not statuses, so a nudged task keeps its real status.
 */
export const TaskStatus = z.enum([
  'open', 'queued', 'assigned', 'accepted', 'in_progress', 'escalated', 'resolved', 'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskAssignmentStatus = z.enum([
  'proposed', 'approved', 'rejected', 'notified', 'accepted', 'declined',
  'en_route', 'on_scene', 'done', 'reassigned',
]);
export type TaskAssignmentStatus = z.infer<typeof TaskAssignmentStatus>;

/**
 * Short hands-free replies a volunteer can give to their active task. Deliberately few:
 * accept/decline a fresh assignment, then done or need help. "Still on it" answers a nudge.
 */
export const ReplyKind = z.enum(['accept', 'decline', 'done', 'need_help', 'still_on_it']);
export type ReplyKind = z.infer<typeof ReplyKind>;

// Merged taxonomy: safety teams from the pipeline + ops teams from the architecture doc.
export const TEAM_SLUGS = ['first-aid', 'welfare', 'crowd', 'security', 'info', 'artist', 'vendors', 'ops'] as const;
export const TeamSlug = z.enum(TEAM_SLUGS);
export type TeamSlug = z.infer<typeof TeamSlug>;
