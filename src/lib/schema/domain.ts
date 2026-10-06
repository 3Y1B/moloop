import type { IncidentCategory, Priority, ReplyKind, TaskStatus, TeamSlug } from './enums';

/**
 * Client-facing domain model. Screens only ever see these shapes, whichever Repo backs them
 * (in-memory mock now, Supabase later). Times are epoch ms.
 */

export type Team = {
  slug: TeamSlug;
  name: string;
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
};

export type Reporter = {
  kind: 'festivalgoer' | 'volunteer' | 'staff' | 'system';
  name?: string;
  /** What they actually said, in their language. */
  quote: string;
  language: string;
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
};

export type TaskEventKind =
  | 'created' | 'assigned' | 'queued' | 'reply' | 'nudged' | 'lead_alerted'
  | 'escalated' | 'reassigned' | 'resolved' | 'note';

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

export type MessageKind = 'task' | 'nudge' | 'broadcast' | 'direct' | 'system';

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
  read: boolean;
};
