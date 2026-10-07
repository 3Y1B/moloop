import { describe, expect, it } from "vitest";

import { MobilizationOutputSchema, type PlanningSnapshot } from "@/lib/mobilization-contracts";
import { playbooks } from "../playbooks";
import { briefFor, completeRequiredActions } from "./plan";
import { plainTextFor } from "./plain-text";
import { createTriggeredPlanningRequest } from "./planning-request";

const at = "2026-10-08T04:00:00.000Z";
const BOOK = "crowd-crush-main-stage";
const book = playbooks().find((entry) => entry.content.slug === BOOK)!;
const must = book.content.actions.filter((action) => action.requirement === "must");
const teams = [...new Set(must.map((action) => action.teamSlug))];

function snapshot(): PlanningSnapshot {
  return {
    schemaVersion: 1, evaluatedAt: at,
    scenario: { requestId: "triggered-plan-test-01",
      weather: { temperatureC: null, trendCPerHour: null, condition: null, warning: null, warningInMinutes: null },
      upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [] },
    zones: [{ slug: "lawn-stage", name: "Oval Stage", kind: "stage", capacity: 8000, isOpenAir: true },
      { slug: "backstage", name: "Oval Backstage", kind: "area", capacity: null, isOpenAir: true }],
    teams: teams.map((slug) => ({ slug, name: slug, description: slug })),
    skills: [], routes: [], roster: [], existingResponses: [],
    evidence: [
      { ref: "incident-t1", kind: "incident", zoneSlug: "lawn-stage", observedAt: at, source: "database",
        value: { title: "Crush at the barrier", category: "crowd", count: 1, openCount: 1 } },
      ...teams.map((slug) => ({ ref: `roster-${slug}`, kind: "roster" as const, zoneSlug: null, observedAt: at,
        source: "database" as const, value: { teamSlug: slug, onDuty: 3, free: 3, freeBySkill: {} } })),
    ],
    playbooks: [book],
  };
}

const task = (key: string, teamSlug: string, peopleNeeded: number) => ({
  key, title: `Do ${key}`, instructions: `Handle ${key} at the barrier`, teamSlug, zoneSlug: "lawn-stage",
  peopleNeeded, reason: "Crush reported", requiredSkills: [], completionCriteria: `${key} done`,
  addressesFindingId: "crush", evidenceRefs: ["incident-t1"],
});
/** The live P1 crowd surge: three tasks (first-aid 2, ops 1, crowd 1), the other required actions as gaps. */
function liveWire() {
  const planned: Record<string, string> = { "triage-and-extract": "medics",
    "barrier-and-lighting": "barrier", "freeze-inflow": "inflow" };
  return {
    decision: "propose",
    assessment: {
      summary: "Crush at the barrier", severity: "urgent", missingInputs: [],
      findings: [{ id: "crush", risk: "Crush at the barrier", possibleCause: "", uncertainty: "",
        evidenceRefs: ["incident-t1"] }],
      playbookAssessments: [{ playbookKey: `${BOOK}:1`, applicability: "insufficient_data", reason: "Sensors unknown",
        evidenceRefs: ["incident-t1"], contextualMissingInputs: [] }],
    },
    mobilizations: [{ title: "Relieve the barrier", priority: "P1", rationale: "A crush is reported",
      tasks: [task("medics", "first-aid", 2), task("barrier", "ops", 1), task("inflow", "crowd", 1)] }],
    actionCoverage: Object.fromEntries(must.map((action, index) => [`${BOOK}:1:${action.id}`, planned[action.id]
      ? { taskKey: planned[action.id], blocker: null }
      // One left out entirely; the rest given blockers.
      : { taskKey: null, blocker: index === must.length - 1 ? null : "Approved route not supplied" }])),
  };
}

describe("a triggered plan reaches Mo with every required action", () => {
  it("the rules check accepts gaps by design; the planner fills them from the playbook", async () => {
    const planning = await createTriggeredPlanningRequest(snapshot(),
      { playbookKey: `${BOOK}:1`, zoneSlug: "lawn-stage", why: ["P1 report: Crush"], evidenceRefs: ["incident-t1"] },
      async () => {});
    const expanded = planning.expand(liveWire());
    // Why the live plan passed: a blocker (or, in a triggered run, an omission) accounts for a required action.
    expect(planning.validate(expanded)).toEqual([]);
    expect(expanded.mobilizations[0].tasks).toHaveLength(3);
    expect(expanded.mobilizations[0].unmetRequirements).toHaveLength(must.length - 3);

    const { output, added } = completeRequiredActions(expanded, BOOK, "lawn-stage");
    expect(added).toHaveLength(must.length - 3);
    const tasks = output.mobilizations[0].tasks;
    expect(tasks.slice(0, 3).map((t) => t.key)).toEqual(["medics", "barrier", "inflow"]);
    expect(tasks.flatMap((t) => t.playbookRefs.map((r) => r.actionId)).sort())
      .toEqual(must.map((a) => a.id).sort());
    expect(output.mobilizations[0].unmetRequirements).toEqual([]);
    expect(MobilizationOutputSchema.safeParse(output).success).toBe(true);
    expect(planning.validate(output)).toEqual([]);
  });

  it("adds nothing to a plan that does every required action", async () => {
    const planning = await createTriggeredPlanningRequest(snapshot(),
      { playbookKey: `${BOOK}:1`, zoneSlug: "lawn-stage", why: [], evidenceRefs: ["incident-t1"] }, async () => {});
    const wire = liveWire();
    wire.mobilizations[0].tasks = must.map((a) => task(a.id, a.teamSlug, a.peopleNeeded ?? 1));
    wire.actionCoverage = Object.fromEntries(must.map((a) => [`${BOOK}:1:${a.id}`, { taskKey: a.id, blocker: null }]));
    const expanded = planning.expand(wire);
    expect(planning.validate(expanded)).toEqual([]);
    const { output, added } = completeRequiredActions(expanded, BOOK, "lawn-stage");
    expect(added).toEqual([]);
    expect(output).toBe(expanded);
  });
});

describe("plain text for people", () => {
  const plain = plainTextFor(snapshot());
  it("names places, and leaves ordinary words alone", () => {
    expect(plain("Clear lawn-stage; brief backstage crew")).toBe("Clear Oval Stage; brief backstage crew");
  });
  it("drops refs and sources, keeps the sentence", () => {
    expect(plain("Hold the barrier (Sources: incident-t1, roster-crowd).")).toBe("Hold the barrier.");
  });
});

describe("the trigger's why lines", () => {
  const reading = (value: string | number, line: string) => ({ kind: "reading" as const, readingId: "r1",
    key: "crowd.densityByZone", zoneSlug: "lawn-stage", value, line, source: "simulated" as const, at: 0 });
  it("names the reading in words, with its line only when there is one", () => {
    const brief = briefFor(BOOK, "lawn-stage", [reading(5, "limit 4 people/m²"), reading("failed", "")], snapshot());
    expect(brief.why).toEqual(["Crowd density: 5 people/m² (limit 4 people/m²)", "Crowd density: failed"]);
  });
});
