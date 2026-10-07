import type { HandoverTarget, IncidentCategory, Priority, TeamSlug } from '@/lib/schema';

/**
 * What the models decide, as plain data. The shared commands (src/lib/commands.ts) are pure and synchronous, so a
 * model call can't happen inside one: the server asks first, outside the world lock, and hands the answer in.
 */

/** The intake agent's `escalate`: a lead or Mo decides before anyone is sent. `reason` is what they read. */
export type EscalateTo = { level: 'lead' | 'coordinator'; reason: string };

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
  /** ISO 639-1 of what the reporter wrote ("es"): replies and "translated from" follow it. "und": unknown. */
  language: string;
  /** ISO 639-1 of a language someone there needs a volunteer to speak, else null (Reporter.speakerNeeded). */
  speakerNeeded: string | null;
  /** Someone there may need hands-on first aid; null when no model said (Reporter.firstAidNeeded). */
  firstAidNeeded: boolean | null;
  /** What the reporter wrote, in English, when the AI read it. Absent from the keyword fallback. */
  english?: string;
  /** Set when the intake agent escalated instead of creating a task for the allocator. */
  escalate: EscalateTo | null;
};

/** A festival-goer's request: a routine question the AI answers itself, or a task for people. */
export type Understood =
  | { kind: 'answer'; answer: string; language: string }
  | ({ kind: 'task' } & Triage);

/** Did the festival-goer's added detail make it worse? `english`: the detail in English, when the AI read it. */
export type DetailRead = { worse: boolean; english?: string };

/** A new report read together with the task it's about: how urgent it is now, and whether it says it's sorted. */
export type Reread = { priority: Priority; resolved: boolean };

/** The open task a new report is about, read again with what's new. Null: a new incident. */
export type Match = { taskId: string; read: Reread } | null;

/**
 * What a lead said on the Respond screen, read as one of the responses on it (src/server/models/interpreter.ts).
 * Null when the model can't tell: the lead taps instead.
 */
export type RespondCommand =
  | { kind: 'backup' | 'reassign'; volunteerId?: string }
  | { kind: 'handover'; target: HandoverTarget }
  | { kind: 'call' } | { kind: 'carry_on' } | { kind: 'pass' }
  | { kind: 'close'; note?: string };

/** Someone who could be sent: not the volunteer on the task, nor anyone already helping. */
export type Named = { id: string; name: string };

export const TEAM_CATEGORY: Record<TeamSlug, IncidentCategory> = {
  'first-aid': 'medical', welfare: 'other', crowd: 'crowding', security: 'security',
  info: 'info_request', artist: 'artist', vendors: 'vendor', ops: 'facilities',
};

const titleFrom = (text: string) => {
  const t = text.length > 55 ? `${text.slice(0, 52).trim()}…` : text;
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

/**
 * When no model read it: a P2 for Info with their words as the title, and a lead decides. Nothing guesses from
 * keywords; a person reads it.
 */
/**
 * Without the AI nothing can tell a report's language, so it says "und" (ISO 639 for undetermined), not English,
 * and carries no translation: screens show it as written, marked as not translated.
 */
export const UNKNOWN_LANGUAGE = 'und';

export const unread = (text: string, zoneSlug: string | null = null, locationHint: string | null = null): Triage => ({
  team: 'info', priority: 'P2', category: TEAM_CATEGORY.info, title: titleFrom(text), summary: text, zoneSlug, locationHint,
  language: UNKNOWN_LANGUAGE, speakerNeeded: null, firstAidNeeded: null, escalate: { level: 'lead', reason: 'No model read it: needs a lead' },
});
