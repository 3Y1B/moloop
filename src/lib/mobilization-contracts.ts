import { z } from "zod";

import { IncidentCategory, Priority, TeamSlug } from "./schema/enums";
import { ObservationSchema } from "./mobilization-observations";
export { ObservationSchema, type MobilizationObservation } from "./mobilization-observations";

const Text = z.string().trim().min(1).max(2000);

/** The festival's playbooks (src/server/playbooks/festival.ts). Intake names one of these, or none. */
export const PLAYBOOK_SLUGS = [
  "severe-weather-main-stage",
  "crowd-crush-main-stage",
  "extreme-heat-water-shortage",
  "gate-breach-uncontrolled-ingress",
] as const;
export type PlaybookSlug = (typeof PLAYBOOK_SLUGS)[number];
const Key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
export const PLAYBOOK_INPUTS = [
  "weather.temperatureC", "weather.trendCPerHour", "weather.condition", "weather.warning",
  "upcomingSets", "crowdByZone", "recentIncidents", "roster", "venue", "existingResponses",
] as const;

export const PlaybookContentSchema = z.object({
  schemaVersion: z.literal(1),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  title: z.string().trim().min(1).max(120),
  appliesWhen: Text,
  // Preserve human SOP vocabulary even when a sensor/input is not connected yet.
  requiredInputs: z.array(z.string().trim().min(1).max(120)).max(40),
  decisionPoints: z.array(z.object({ id: Key, owner: z.literal("mo"), question: Text })).max(20).default([]),
  constraints: z.array(z.object({ id: Key, instruction: Text })).max(20),
  actions: z.array(z.object({
    id: Key,
    requirement: z.enum(["must", "recommended"]),
    teamSlug: TeamSlug,
    title: z.string().trim().min(1).max(120),
    instructions: Text,
    peopleNeeded: z.number().int().min(1).max(500).nullable(),
    staffingGuidance: z.string().trim().max(1000).default(""),
    requiredSkills: z.array(z.string().min(1).max(80)).max(20).default([]),
    locationGuidance: z.string().trim().max(1000).default(""),
    // Source SOPs need not invent a completion rule; AI tasks still require a concrete criterion.
    completionCriteria: z.string().trim().max(2000).default(""),
  })).min(1).max(30),
  source: z.string().trim().max(1000),
});
export type PlaybookContent = z.infer<typeof PlaybookContentSchema>;
export type ManagedPlaybook = {
  id: string; version: number; status: "draft" | "published" | "disabled";
  content: PlaybookContent; createdAt: string; updatedAt: string; publishedAt: string | null;
};

export const SimulationInputSchema = z.object({
  requestId: z.string().min(16).max(128),
  // From the latest readings (src/server/predict/plan.ts). Null when nothing has measured it.
  weather: z.object({
    temperatureC: z.number().min(-20).max(60).nullable(),
    trendCPerHour: z.number().min(-20).max(20).nullable(),
    condition: z.enum(["clear", "rain", "storm"]).nullable(),
    warning: z.enum(["none", "heat", "storm"]).nullable(),
    warningInMinutes: z.number().int().min(0).max(1440).nullable(),
  }),
  upcomingSets: z.array(z.object({
    stageSlug: z.string().min(1).max(80), act: z.string().trim().min(1).max(120),
    startsInMinutes: z.number().int().min(0).max(1440),
    durationMinutes: z.number().int().min(1).max(360),
    expectedPeople: z.number().int().min(0).max(100000).nullable(),
  })).max(2),
  crowdByZone: z.array(z.object({
    zoneSlug: z.string().min(1).max(80), estimatedPeople: z.number().int().min(0).max(100000).nullable(),
    trend: z.enum(["stable", "growing", "falling"]).nullable(),
  })).max(30),
  recentIncidents: z.array(z.object({
    category: IncidentCategory, zoneSlug: z.string().min(1).max(80).nullable(),
    minutesAgo: z.number().int().min(0).max(1440), description: Text,
    count: z.number().int().min(1).max(1000), openCount: z.number().int().min(0).max(1000),
  })).max(30),
  observations: z.array(ObservationSchema).max(100).default([]),
});
export type SimulationInput = z.input<typeof SimulationInputSchema>;
export type VenueZone = { slug: string; name: string; kind: string; capacity: number | null; isOpenAir: boolean };
export type PlanningTeam = { slug: z.infer<typeof TeamSlug>; name: string; description: string };
export type TimetableEntry = { id: string; stageSlug: string; act: string; startsAt: string; endsAt: string; expectedPeople: number | null };
export type SimulationContext = {
  zones: VenueZone[]; teams: PlanningTeam[]; skills: { slug: string; name: string }[];
  timetable: TimetableEntry[]; playbooks: ManagedPlaybook[];
  modelReady: boolean; modelConfigurationMessage: string | null;
};
export type PlanningEvidence = {
  ref: string; kind: string; zoneSlug: string | null; observedAt: string;
  source: "manual_demo" | "database"; value: Record<string, unknown>;
};
export type PlanningSnapshot = {
  schemaVersion: 1; evaluatedAt: string; scenario: SimulationInput;
  zones: VenueZone[]; teams: PlanningTeam[];
  skills: SimulationContext["skills"];
  routes: { from: string; to: string; minutes: number; meters: number }[];
  roster: { id: string; name: string; teamSlug: string | null; zoneSlug: string | null; duty: string;
    skills: string[]; free: boolean; shiftEndsAt: number | null }[];
  existingResponses: { id: string; title: string; status: string; teamSlug: string | null;
    zoneSlug: string | null; mobilizationId: string | null; requiredCount: number }[];
  evidence: PlanningEvidence[]; playbooks: ManagedPlaybook[];
};

export const PlaybookActionRefSchema = z.object({ slug: z.string().min(1), version: z.number().int().min(1), actionId: Key });
export type PlaybookActionRef = z.infer<typeof PlaybookActionRefSchema>;
export const FindingSchema = z.object({
  id: Key, risk: Text, possibleCause: z.string().max(1500),
  evidenceRefs: z.array(z.string().min(1)).min(1).max(30), uncertainty: z.string().max(1500),
});
export const ProposedTaskSchema = z.object({
  key: Key, title: z.string().trim().min(1).max(120), instructions: Text,
  teamSlug: TeamSlug, zoneSlug: z.string().min(1).max(80),
  peopleNeeded: z.number().int().min(1).max(500), reason: Text,
  requiredSkills: z.array(z.string().min(1).max(80)).max(20), completionCriteria: Text,
  addressesFindingIds: z.array(Key).min(1).max(20),
  evidenceRefs: z.array(z.string().min(1)).min(1).max(30),
  playbookRefs: z.array(PlaybookActionRefSchema).max(30),
});
export const MobilizationOutputSchema = z.object({
  decision: z.enum(["no_mobilization", "insufficient_data", "propose"]),
  assessment: z.object({
    summary: Text, severity: z.enum(["minor", "concerning", "urgent"]),
    findings: z.array(FindingSchema).max(20), missingInputs: z.array(z.string().min(1).max(300)).max(30),
    playbookAssessments: z.array(z.object({
      slug: z.string().min(1), version: z.number().int().min(1),
      applicability: z.enum(["applicable", "not_applicable", "insufficient_data"]),
      reason: Text, evidenceRefs: z.array(z.string().min(1)).min(1).max(30),
      missingInputs: z.array(z.string().min(1).max(300)).max(30),
    })),
  }),
  mobilizations: z.array(z.object({
    title: z.string().trim().min(1).max(120), priority: Priority, rationale: Text,
    tasks: z.array(ProposedTaskSchema).min(2).max(30),
    unmetRequirements: z.array(z.object({
      playbookRef: PlaybookActionRefSchema, reason: Text,
    })).max(30),
  })).max(8),
});
export type MobilizationOutput = z.infer<typeof MobilizationOutputSchema>;
export type ProposedMobilizationTask = z.infer<typeof ProposedTaskSchema>;
export type SimulationRunResult = {
  runId: string; status: "running" | "completed" | "failed" | "configuration_required";
  decision: MobilizationOutput["decision"] | null; output: MobilizationOutput | null;
  mobilizationIds: string[]; validationErrors: string[]; error: string | null;
  snapshot: PlanningSnapshot | null; promptVersion: string; model: string | null; createdAt: string;
};
