import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  MobilizationOutputSchema,
  type ManagedPlaybook,
  type PlanningSnapshot,
  type ProposedMobilizationTask,
} from "@/lib/mobilization-contracts";
import { createCompactMobilizationOutput, type CompactMobilizationOutput } from "./compact-output";
import { validateMobilizationOutput } from "./validate";

const at = "2026-10-08T04:00:00.000Z";
function book(slug: string, requiredInputs: string[]): ManagedPlaybook {
  return {
    id: slug, version: 2, status: "published", createdAt: at, updatedAt: at, publishedAt: at,
    content: {
      schemaVersion: 1, slug, title: slug, appliesWhen: "Test condition", requiredInputs,
      constraints: [], decisionPoints: [], source: "Unit test fixture only",
      actions: [{ id: "assess", requirement: "must", teamSlug: "first-aid", title: "Assess",
        instructions: "Assess the affected visitors", peopleNeeded: 1, requiredSkills: [],
        staffingGuidance: "One responder", locationGuidance: "Affected zone", completionCriteria: "Record assessment" }],
    },
  };
}
function snapshot(): PlanningSnapshot {
  return {
    schemaVersion: 1, evaluatedAt: at,
    scenario: {
      requestId: "compact-output-test-001",
      weather: { temperatureC: 41, trendCPerHour: null, condition: "clear", warning: "heat", warningInMinutes: 0 },
      upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [{
        key: "audienceByZone", kind: "zone_counts", minutesAgo: 2, zoneSlug: null,
        value: { coverage: "partial", entries: [{ zoneSlug: "water-2", count: 220 }] },
      }],
    },
    zones: [{ slug: "water-2", name: "Water Station 2", kind: "water", capacity: null, isOpenAir: true }],
    teams: [{ slug: "first-aid", name: "First Aid", description: "Clinical assessment" }],
    skills: [], routes: [], roster: [], existingResponses: [],
    evidence: [{ ref: "demo-weather", kind: "weather", zoneSlug: null, observedAt: at,
      source: "manual_demo", value: { temperatureC: 41 } }],
    playbooks: [book("heat-response", ["weather.temperature", "weather.trendCPerHour", "unknownSensor"]),
      book("wind-response", ["weather.windSpeed"])],
  };
}
const task = (key: string): ProposedMobilizationTask => ({
  key, title: `Assess ${key}`, instructions: `Assess the visitor group ${key} at water-2`,
  teamSlug: "first-aid", zoneSlug: "water-2", peopleNeeded: 1, requiredSkills: [],
  reason: "Reported hypothetical heat warrants assessment", completionCriteria: `Record status for ${key}`,
  addressesFindingIds: ["heat-risk"], evidenceRefs: ["demo-weather"], playbookRefs: [],
});
function wire(): CompactMobilizationOutput {
  return {
    decision: "propose",
    assessment: {
      summary: "Assess the affected visitors", severity: "urgent",
      findings: [{ id: "heat-risk", risk: "Heat exposure requires assessment", possibleCause: "Heat may contribute",
        uncertainty: "No clinical cause is established", evidenceRefs: ["demo-weather"] }],
      missingInputs: ["Current patient status"],
      playbookAssessments: [
        { playbookKey: "heat-response:2", applicability: "insufficient_data",
          reason: "Heat is supplied, but trend and a sensor are unknown", evidenceRefs: ["demo-weather"],
          contextualMissingInputs: ["audienceByZone: current river-stage count", "weather.trendCPerHour"] },
        { playbookKey: "wind-response:2", applicability: "insufficient_data",
          reason: "Wind speed is unknown", evidenceRefs: ["demo-weather"], contextualMissingInputs: [] },
      ],
    },
    mobilizations: [{ title: "Independent protective assessment", priority: "P1", rationale: "Assess before choosing a full SOP response",
      tasks: [task("group-one"), task("group-two")], unmetRequirements: [] }],
  };
}

describe("compact mobilization output expansion", () => {
  it("restores only deterministic required-input gaps and preserves every AI judgement and contextual gap", () => {
    const output = wire();
    const expanded = createCompactMobilizationOutput(snapshot()).expand(output);
    expect(expanded.assessment.playbookAssessments).toEqual([
      { slug: "heat-response", version: 2, applicability: "insufficient_data",
        reason: output.assessment.playbookAssessments[0].reason, evidenceRefs: ["demo-weather"],
        missingInputs: ["weather.trendCPerHour", "unknownSensor", "audienceByZone: current river-stage count"] },
      { slug: "wind-response", version: 2, applicability: "insufficient_data",
        reason: output.assessment.playbookAssessments[1].reason, evidenceRefs: ["demo-weather"],
        missingInputs: ["weather.windSpeed"] },
    ]);
    expect(expanded.assessment.missingInputs).toEqual(["Current patient status"]);
    expect(expanded.assessment.findings).toEqual(output.assessment.findings);
    expect(expanded.mobilizations).toEqual(output.mobilizations);
    expect(MobilizationOutputSchema.safeParse(expanded).success).toBe(true);
    expect(validateMobilizationOutput(expanded, snapshot(), [])).toEqual([]);
    expect(output.assessment.playbookAssessments[0]).not.toHaveProperty("missingInputs");
  });

  it("does not turn an invalid applicability verdict into a different verdict", () => {
    const output = wire();
    output.assessment.playbookAssessments[0].applicability = "applicable";
    const expanded = createCompactMobilizationOutput(snapshot()).expand(output);
    expect(expanded.assessment.playbookAssessments[0].applicability).toBe("applicable");
    expect(validateMobilizationOutput(expanded, snapshot(), [])).toContain(
      "Playbook assessment heat-response:2 claims applicability with unknown required inputs",
    );
  });

  it("requires exactly all supplied published SOP reviews; no verdict is defaulted", () => {
    const contract = createCompactMobilizationOutput(snapshot());
    const output = wire();
    output.assessment.playbookAssessments.pop();
    expect(contract.schema.safeParse(output).success).toBe(false);
    expect(() => contract.expand(output)).toThrow();
  });

  it("rejects duplicate reviews even when the array length is correct", () => {
    const output = wire();
    output.assessment.playbookAssessments[1] = structuredClone(output.assessment.playbookAssessments[0]);
    expect(() => createCompactMobilizationOutput(snapshot()).expand(output)).toThrow(
      "Duplicate playbook assessment heat-response:2",
    );
  });

  it("rejects unknown playbook keys on the wire", () => {
    const output = wire();
    output.assessment.playbookAssessments[0].playbookKey = "invented-book:99";
    expect(createCompactMobilizationOutput(snapshot()).schema.safeParse(output).success).toBe(false);
  });

  it.each(["finding", "review", "task"] as const)("prevents hallucinated evidence paths in %s references", (where) => {
    const output = wire();
    if (where === "finding") output.assessment.findings[0].evidenceRefs.push("existingResponses");
    if (where === "review") output.assessment.playbookAssessments[0].evidenceRefs.push("existingResponses");
    if (where === "task") output.mobilizations[0].tasks[0].evidenceRefs.push("existingResponses");
    const contract = createCompactMobilizationOutput(snapshot());
    expect(contract.schema.safeParse(output).success).toBe(false);
    expect(() => contract.expand(output)).toThrow();
  });

  it.each(["global", "review"] as const)("rejects known complete input keys fabricated as missing in %s gaps", (where) => {
    const output = wire();
    if (where === "global") output.assessment.missingInputs = ["weather.temperatureC"];
    else output.assessment.playbookAssessments[0].contextualMissingInputs = [" weather.temperature "];
    expect(() => createCompactMobilizationOutput(snapshot()).expand(output)).toThrow("known complete input");
  });

  it("retains partial-coverage contextual gaps rather than treating the whole site as known", () => {
    const output = wire();
    output.assessment.playbookAssessments[0].contextualMissingInputs = ["audienceByZone"];
    expect(createCompactMobilizationOutput(snapshot()).expand(output).assessment.playbookAssessments[0].missingInputs)
      .toEqual(["weather.trendCPerHour", "unknownSensor", "audienceByZone"]);
  });

  it("preserves unrecognized action references for the unchanged semantic validator to reject", () => {
    const output = wire();
    output.mobilizations[0].tasks[0].playbookRefs = [{ slug: "heat-response", version: 2, actionId: "invented" }];
    const expanded = createCompactMobilizationOutput(snapshot()).expand(output);
    expect(expanded.mobilizations[0].tasks[0].playbookRefs).toEqual(output.mobilizations[0].tasks[0].playbookRefs);
    expect(validateMobilizationOutput(expanded, snapshot(), [])).toContain(
      "Plan 1 cites unknown published action heat-response:2:invented",
    );
  });

  it("does not repair covered/unmet overlaps", () => {
    const output = wire();
    const ref = { slug: "heat-response", version: 2, actionId: "assess" };
    output.mobilizations[0].tasks[0].playbookRefs = [ref];
    output.mobilizations[0].unmetRequirements = [{ playbookRef: ref, reason: "Specific authorization is unknown" }];
    const expanded = createCompactMobilizationOutput(snapshot()).expand(output);
    expect(expanded.mobilizations).toEqual(output.mobilizations);
    expect(validateMobilizationOutput(expanded, snapshot(), [])).toContain(
      "Action heat-response:2:assess is both covered and unmet",
    );
  });

  it("rejects merged missing-input overflow rather than dropping any input or relaxing the canonical bound", () => {
    const input = snapshot();
    input.playbooks[0].content.requiredInputs = Array.from({ length: 31 }, (_, i) => `unknown-sensor-${i}`);
    expect(() => createCompactMobilizationOutput(input).expand(wire())).toThrow();
  });

  it.each(["tasks", "global-gaps", "findings"] as const)("retains canonical bounds for %s", (field) => {
    const output = wire();
    if (field === "tasks") output.mobilizations[0].tasks = [task("one")];
    if (field === "global-gaps") output.assessment.missingInputs = Array.from({ length: 31 }, (_, i) => `gap-${i}`);
    if (field === "findings") output.assessment.findings = Array.from({ length: 21 }, () => output.assessment.findings[0]);
    expect(createCompactMobilizationOutput(snapshot()).schema.safeParse(output).success).toBe(false);
  });

  it("ignores draft/disabled books, without dropping any published book", () => {
    const input = snapshot();
    input.playbooks.push({ ...book("draft-book", ["unknown"]), status: "draft" },
      { ...book("disabled-book", ["unknown"]), status: "disabled" });
    expect(createCompactMobilizationOutput(input).expand(wire()).assessment.playbookAssessments).toHaveLength(2);
  });

  it("binds expansion to the immutable audited snapshot", () => {
    const input = snapshot();
    const contract = createCompactMobilizationOutput(input);
    input.scenario.weather.trendCPerHour = 2;
    input.playbooks[0].content.slug = "changed-after-generation";
    input.evidence = [];
    const expanded = contract.expand(wire());
    expect(expanded.assessment.playbookAssessments[0].slug).toBe("heat-response");
    expect(expanded.assessment.playbookAssessments[0].missingInputs).toContain("weather.trendCPerHour");
  });

  it("supports independent proposals with no playbooks and never invents SOP reviews", () => {
    const input = snapshot();
    input.playbooks = [];
    const output = wire();
    output.assessment.playbookAssessments = [];
    const expanded = createCompactMobilizationOutput(input).expand(output);
    expect(expanded.assessment.playbookAssessments).toEqual([]);
    expect(validateMobilizationOutput(expanded, input, [])).toEqual([]);
  });

  it("fails closed for ambiguous duplicate books or a snapshot without any evidence", () => {
    const input = snapshot();
    input.playbooks.push(structuredClone(input.playbooks[0]));
    expect(() => createCompactMobilizationOutput(input)).toThrow("Duplicate published playbook key");
    input.playbooks = [];
    input.evidence = [];
    expect(() => createCompactMobilizationOutput(input)).toThrow("no evidence references");
  });

  it("exports a plain JSON schema usable by either endpoint without canonical per-SOP missingInputs", () => {
    const jsonSchema = z.toJSONSchema(createCompactMobilizationOutput(snapshot()).schema);
    const nested = (value: unknown, ...keys: string[]) => keys.reduce<unknown>((node, key) =>
      node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined, value);
    const item = nested(jsonSchema, "properties", "assessment", "properties", "playbookAssessments", "items");
    expect(item).toMatchObject({
      properties: {
        playbookKey: { enum: ["heat-response:2", "wind-response:2"] },
        evidenceRefs: { items: { enum: ["demo-weather"] } },
        contextualMissingInputs: { maxItems: 30 },
      },
    });
    expect(nested(item, "properties")).not.toHaveProperty("missingInputs");
    expect(nested(item, "properties")).not.toHaveProperty("slug");
    expect(nested(item, "properties")).not.toHaveProperty("version");
  });
});
