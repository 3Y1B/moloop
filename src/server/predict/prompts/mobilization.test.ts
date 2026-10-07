import { describe, expect, it } from "vitest";

import {
  MobilizationOutputSchema,
  type ManagedPlaybook,
  type MobilizationOutput,
  type PlanningSnapshot,
  type PlaybookActionRef,
  type ProposedMobilizationTask,
} from "@/lib/mobilization-contracts";
import { validateMobilizationOutput } from "../validate";
import { MOBILIZATION_PROMPT_VERSION, MOBILIZATION_SYSTEM_PROMPT } from "./mobilization";

const at = "2026-10-07T14:30:00.000Z";
const slug = "extreme-heat-water-shortage";
const actions = [
  { id: "cooling-welfare", teamSlug: "welfare" },
  { id: "water-queue-control", teamSlug: "crowd" },
  { id: "hydration-messaging", teamSlug: "info" },
] as const;
const ref = (actionId: string): PlaybookActionRef => ({ slug, version: 1, actionId });

/** A minimal action-accounting fixture, not a replacement for the published operational SOP. */
function snapshot(requiredInputs = ["weather.temperatureC"]): PlanningSnapshot {
  const book: ManagedPlaybook = {
    id: "heat-accounting-fixture", version: 1, status: "published",
    createdAt: at, updatedAt: at, publishedAt: at,
    content: {
      schemaVersion: 1, slug, title: "Heat action accounting fixture", appliesWhen: "Extreme heat",
      requiredInputs, constraints: [], decisionPoints: [], source: "Unit test fixture only",
      actions: actions.map(({ id, teamSlug }) => ({
        id, teamSlug, requirement: "must", title: id, instructions: `Complete ${id}`,
        peopleNeeded: 1, staffingGuidance: "One crew member", requiredSkills: [],
        locationGuidance: "The affected zone", completionCriteria: `Record completion of ${id}`,
      })),
    },
  };
  return {
    schemaVersion: 1, evaluatedAt: at,
    scenario: {
      requestId: "heat-accounting-test-001",
      weather: { temperatureC: 41, trendCPerHour: null, condition: "clear", warning: "heat", warningInMinutes: 0 },
      upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [],
    },
    zones: [{ slug: "water-2", name: "Water Station 2", kind: "water", capacity: null, isOpenAir: true }],
    teams: actions.map(({ teamSlug }) => ({ slug: teamSlug, name: teamSlug, description: teamSlug })),
    skills: [], routes: [], roster: [], existingResponses: [], playbooks: [book],
    evidence: [{ ref: "demo-weather", kind: "weather", zoneSlug: null, observedAt: at,
      source: "manual_demo", value: { temperatureC: 41, warning: "heat" } }],
  };
}

function task(action: typeof actions[number]): ProposedMobilizationTask {
  return {
    key: action.id, title: action.id, instructions: `Complete the fixture action ${action.id} at Water Station 2`,
    teamSlug: action.teamSlug, zoneSlug: "water-2", peopleNeeded: 1, requiredSkills: [],
    reason: "The hypothetical 41 C heat warrants a coordinated protective response",
    completionCriteria: `Record completion of ${action.id}`,
    addressesFindingIds: ["heat-risk"], evidenceRefs: ["demo-weather"], playbookRefs: [ref(action.id)],
  };
}

function proposal(): MobilizationOutput {
  return {
    decision: "propose",
    assessment: {
      summary: "Coordinate a heat response for Mo to approve", severity: "urgent",
      findings: [{ id: "heat-risk", risk: "Hypothetical extreme heat warrants protection",
        possibleCause: "High temperature may increase heat exposure", uncertainty: "No medical diagnosis is established",
        evidenceRefs: ["demo-weather"] }],
      missingInputs: [], playbookAssessments: [{ slug, version: 1, applicability: "applicable",
        reason: "The hypothetical temperature is 41 C", evidenceRefs: ["demo-weather"], missingInputs: [] }],
    },
    mobilizations: [{ title: "Heat response", priority: "P1",
      rationale: "Proposed work awaits Mo's final approval and has not been executed",
      tasks: actions.map(task), unmetRequirements: [] }],
  };
}

const unmet = () => actions.map(({ id }) => ({
  playbookRef: ref(id), reason: "Approved shelter and alternative water source facts have not been supplied",
}));
const errorsFor = (output: MobilizationOutput, input = snapshot()) => {
  // Demonstrate that JSON-schema correctness alone does not establish semantic relationships.
  expect(MobilizationOutputSchema.safeParse(output).success).toBe(true);
  return validateMobilizationOutput(output, input, []);
};
const duplicateErrors = actions.map(({ id }) => `Action ${slug}:1:${id} is both covered and unmet`);

describe("mobilization v3 SOP action accounting", () => {
  it("pins the audited prompt version and explicitly distinguishes full coverage from partial preparation", () => {
    expect(MOBILIZATION_PROMPT_VERSION).toBe("mobilization.v3");
    expect(MOBILIZATION_SYSTEM_PROMPT).toContain("mutually\nexclusive across ALL mobilizations");
    expect(MOBILIZATION_SYSTEM_PROMPT).toContain("these facts alone do not make a fully proposed SOP action unmet");
    expect(MOBILIZATION_SYSTEM_PROMPT).toContain("use playbookRefs: [] even when related to that SOP");
    expect(MOBILIZATION_SYSTEM_PROMPT).toContain("Preserve every relevant missing input, evidence reference and required action");
  });

  it("accepts fully proposed actions that still await Mo approval and execution", () => {
    expect(errorsFor(proposal())).toEqual([]);
  });

  it("rejects the three covered-and-unmet heat actions from the failed response shape", () => {
    const output = proposal();
    output.mobilizations[0].unmetRequirements = unmet();
    expect(errorsFor(output)).toEqual(duplicateErrors);
  });

  it.each(["covered-first", "unmet-first"])("rejects cross-plan overlaps regardless of order: %s", (order) => {
    const output = proposal();
    const independent = {
      title: "Gather missing authorization facts", priority: "P1" as const,
      rationale: "Gather facts without issuing blocked infrastructure or movement instructions",
      tasks: output.mobilizations[0].tasks.slice(0, 2).map((entry) => ({
        ...entry, key: `verify-${entry.key}`, instructions: `Gather the missing approval facts for ${entry.key}`,
        playbookRefs: [],
      })),
      unmetRequirements: unmet(),
    };
    output.mobilizations = order === "covered-first"
      ? [output.mobilizations[0], independent] : [independent, output.mobilizations[0]];
    expect(errorsFor(output)).toEqual(duplicateErrors);
  });

  it("accepts independent information-gathering tasks with empty refs and full SOP actions explicitly unmet", () => {
    const output = proposal();
    const missingInputs = ["approvedShelterZones", "approvedAlternativeWaterSources"];
    output.assessment.missingInputs = missingInputs;
    output.assessment.playbookAssessments[0] = {
      ...output.assessment.playbookAssessments[0], applicability: "insufficient_data", missingInputs,
      reason: "The heat is known, but authorization prerequisites for the complete SOP actions are unknown",
    };
    output.mobilizations[0].tasks = output.mobilizations[0].tasks.map((entry) => ({
      ...entry, instructions: `Request the missing approval and scope facts for ${entry.key}; do not issue blocked movement or infrastructure instructions`,
      completionCriteria: "Record the responsible owner's answer, or explicitly record that it remains unknown",
      playbookRefs: [],
    }));
    output.mobilizations[0].unmetRequirements = unmet();
    expect(errorsFor(output, snapshot(["weather.temperatureC", ...missingInputs]))).toEqual([]);
  });

  it("still rejects an unaccounted-for must action; empty task refs do not waive SOP coverage", () => {
    const output = proposal();
    output.mobilizations[0].tasks[0].playbookRefs = [];
    expect(errorsFor(output)).toEqual([`Proposal omits required playbook action ${slug}:1:cooling-welfare`]);
  });

  it("still rejects applicability claims with missing approval inputs and omitted missing-input disclosures", () => {
    expect(errorsFor(proposal(), snapshot(["weather.temperatureC", "approvedShelterZones"]))).toEqual([
      `Playbook assessment ${slug}:1 omits unknown required input approvedShelterZones`,
      `Playbook assessment ${slug}:1 claims applicability with unknown required inputs`,
    ]);
  });
});
