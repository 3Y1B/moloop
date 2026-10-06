import { z } from 'zod';

// Mirrors the Postgres enums in supabase/migrations. Keep in sync.
export const Priority = z.enum(['P1', 'P2', 'P3']);
export type Priority = z.infer<typeof Priority>;

export const IncidentCategory = z.enum([
  'medical', 'heat', 'lost_child', 'lost_property', 'crowding', 'security',
  'weather', 'facilities', 'accessibility', 'info_request', 'other',
]);
export type IncidentCategory = z.infer<typeof IncidentCategory>;

export const ReportChannel = z.enum(['text', 'voice', 'radio', 'photo', 'phone', 'in_person']);
export type ReportChannel = z.infer<typeof ReportChannel>;

export const TaskStatus = z.enum(['open', 'assigned', 'in_progress', 'resolved', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskAssignmentStatus = z.enum([
  'proposed', 'approved', 'rejected', 'notified', 'accepted', 'declined',
  'en_route', 'on_scene', 'done', 'reassigned',
]);
export type TaskAssignmentStatus = z.infer<typeof TaskAssignmentStatus>;

export const TEAM_SLUGS = ['first-aid', 'water-heat', 'welfare', 'crowd', 'security', 'access'] as const;
export const TeamSlug = z.enum(TEAM_SLUGS);
export type TeamSlug = z.infer<typeof TeamSlug>;
