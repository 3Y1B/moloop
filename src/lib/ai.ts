import type { IncidentCategory, Priority, TeamSlug } from '@/lib/schema';

/**
 * What the models decide, as plain data. The shared commands (src/lib/commands.ts) are pure and synchronous, so a
 * model call can't happen inside one: the server asks first, outside the world lock, and hands the answer in.
 */

/** A report or request, understood: where it goes, how urgent, and how to say it to a lead on a phone. */
export type Triage = {
  team: TeamSlug;
  priority: Priority;
  category: IncidentCategory;
  /** English, 60 characters or fewer. */
  title: string;
  /** English, what the lead and volunteer read. */
  summary: string;
  zoneSlug: string | null;
  locationHint: string | null;
  /** ISO 639-1 of what the reporter wrote ("es"), since volunteers are matched on languages spoken. */
  language: string;
};

/** A festival-goer's request: a routine question the AI answers itself, or a task for people. */
export type Understood =
  | { kind: 'answer'; answer: string; language: string }
  | ({ kind: 'task' } & Triage);

/** Did the festival-goer's added detail make it worse? */
export type DetailRead = { worse: boolean };
