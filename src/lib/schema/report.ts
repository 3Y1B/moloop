import { z } from 'zod';
import { Priority, IncidentCategory, ReportChannel, TeamSlug } from './enums';

/** What the client sends to POST /api/reports. Voice is transcribed server-side or client-side into raw_text. */
export const ReportInput = z.object({
  channel: ReportChannel,
  rawText: z.string().min(1).max(4000),
  mediaUrl: z.string().url().optional(),
  reporterKind: z.enum(['festivalgoer', 'volunteer', 'staff']).default('festivalgoer'),
  reporterId: z.string().uuid().optional(),
  zoneSlug: z.string().optional(),
  locationHint: z.string().max(300).optional(),
  coords: z.object({ lat: z.number(), lng: z.number() }).optional(),
  /** BCP-47 hint from the device locale; the pipeline still detects language itself. */
  localeHint: z.string().optional(),
});
export type ReportInput = z.infer<typeof ReportInput>;

// ── Stage outputs (each agent/classifier has a typed, validated contract) ──

export const RouteResult = z.object({
  decision: z.enum(['ai_resolved', 'escalated_to_triage']),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  detectedLanguage: z.string(),
  textEn: z.string(),
});
export type RouteResult = z.infer<typeof RouteResult>;

export const TeamResult = z.object({
  team: TeamSlug,
  confidence: z.number().min(0).max(1),
  alternates: z.array(z.object({ team: TeamSlug, confidence: z.number() })).default([]),
});
export type TeamResult = z.infer<typeof TeamResult>;

export const PriorityResult = z.object({
  priority: Priority,
  confidence: z.number().min(0).max(1),
  signals: z.array(z.string()).default([]), // e.g. ["child", "unconscious", "heat 38C"]
});
export type PriorityResult = z.infer<typeof PriorityResult>;

export const RewriteResult = z.object({
  title: z.string().max(60),
  summary: z.string().max(280),
  category: IncidentCategory,
  zoneSlug: z.string().nullable(),
  locationHint: z.string().nullable(),
  requiredSkills: z.array(z.string()).default([]),
  peopleInvolved: z.number().int().nullable(),
});
export type RewriteResult = z.infer<typeof RewriteResult>;

export const P3Response = z.object({
  /** Reply in the reporter's language. */
  reply: z.string(),
  language: z.string(),
  category: IncidentCategory,
  /** If the model realises it is out of its depth mid-answer it can bail to triage. */
  escalate: z.boolean().default(false),
});
export type P3Response = z.infer<typeof P3Response>;

export const AssignmentProposal = z.object({
  candidates: z.array(z.object({
    volunteerId: z.string().uuid(),
    rationale: z.string(),
    distanceM: z.number().int().nullable(),
  })).max(5),
  /** Always true for P1/P2: Mo (or a team lead) approves before anyone is notified. */
  requiresApproval: z.boolean(),
});
export type AssignmentProposal = z.infer<typeof AssignmentProposal>;

export const PipelineOutcome = z.object({
  reportId: z.string().uuid(),
  taskId: z.string().uuid(),
  handledBy: z.enum(['ai', 'human']),
  /** Shown to the reporter in the app straight away. */
  reporterReply: z.string(),
  priority: Priority,
});
export type PipelineOutcome = z.infer<typeof PipelineOutcome>;
