/// <reference types="node" />
import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";
import { describe, expect, it } from "vitest";

import { SimulationInputSchema, type SimulationContext } from "./mobilization-contracts";
import { OBSERVATION_CATALOG, ObservationSchema, observationReferenceErrors } from "./mobilization-observations";
import { buildScenario, MOBILIZATION_SCENARIOS } from "./mobilization-scenarios";
import { validateScenario } from "../server/predict/validate";

const context: SimulationContext = {
  zones: [
    { slug: "water-2", name: "Water Station 2", kind: "water", capacity: 500, isOpenAir: true },
    { slug: "lawn-stage", name: "Oval Stage", kind: "stage", capacity: 8000, isOpenAir: true },
    { slug: "food-alley", name: "Food Alley", kind: "food", capacity: 1500, isOpenAir: true },
    { slug: "gate-a", name: "Gate A", kind: "gate", capacity: 3000, isOpenAir: true },
  ],
  teams: [], skills: [], timetable: [], playbooks: [], modelReady: false, modelConfigurationMessage: null,
};
const inputFor = (id: (typeof MOBILIZATION_SCENARIOS)[number]["id"], venue = context) =>
  ({ requestId: "offline-scenario-test-001", ...buildScenario(id, venue).input });

describe("mobilization situation presets", () => {
  it("offers one normal control and nine distinct hazards grounded in supplied SOPs", () => {
    const books = parseAllDocuments(readFileSync("supabase/playbooks/festival-emergency.yaml", "utf8"))
      .map((document) => document.toJSON() as { slug: string; requiredInputs: string[] });
    expect(MOBILIZATION_SCENARIOS).toHaveLength(10);
    expect(new Set(MOBILIZATION_SCENARIOS.map((scenario) => scenario.id)).size).toBe(10);
    expect(MOBILIZATION_SCENARIOS[0].id).toBe("normal");
    const references = MOBILIZATION_SCENARIOS.flatMap((scenario) => [...scenario.playbookSlugs]);
    expect(new Set(references).size).toBe(9);
    for (const reference of references) expect(books.some((book) => book.slug === reference)).toBe(true);
  });

  it("builds schema-valid facts and valid real-venue references for every preset", () => {
    for (const scenario of MOBILIZATION_SCENARIOS) {
      const input = SimulationInputSchema.parse(inputFor(scenario.id));
      expect(validateScenario(input, context), scenario.id).toEqual([]);
      expect(observationReferenceErrors(input.observations, context.zones.map((zone) => zone.slug))).toEqual([]);
      for (const row of input.observations) {
        expect(ObservationSchema.safeParse(row).success, `${scenario.id}: ${row.key}`).toBe(true);
        expect(OBSERVATION_CATALOG[row.key].builtin).not.toBe(true);
      }
    }
  });

  it("uses renamed venue zones and preserves unknown capacity without substituting made-up places", () => {
    const renamed: SimulationContext = { ...context, zones: context.zones.map((zone, index) => ({
      ...zone, slug: `real-zone-${index}`, name: `Renamed location ${index}`, capacity: null,
    })) };
    for (const scenario of MOBILIZATION_SCENARIOS) {
      const built = buildScenario(scenario.id, renamed);
      const input = SimulationInputSchema.parse({ requestId: "offline-renamed-venue-001", ...built.input });
      expect(validateScenario(input, renamed), scenario.id).toEqual([]);
      if (scenario.id === "heat-water") expect(input.crowdByZone[0].estimatedPeople).toBe(220);
      else expect(input.crowdByZone.every((entry) => entry.estimatedPeople === null)).toBe(true);
      expect(input.upcomingSets.every((entry) => entry.expectedPeople === null)).toBe(true);
      if (scenario.id !== "heat-water") expect(built.missingContext.some((message) => message.includes("capacity is unknown"))).toBe(true);
    }
  });

  it("handles an empty venue with unknown locations and scoped values instead of fabricated references", () => {
    const empty = { ...context, zones: [] };
    for (const scenario of MOBILIZATION_SCENARIOS) {
      const built = buildScenario(scenario.id, empty);
      const input = SimulationInputSchema.parse({ requestId: "offline-empty-venue-001", ...built.input });
      expect(validateScenario(input, empty), scenario.id).toEqual([]);
      expect(input.crowdByZone).toEqual([]);
      expect(input.upcomingSets).toEqual([]);
      expect(input.recentIncidents.every((entry) => entry.zoneSlug === null)).toBe(true);
      expect(built.missingContext.length).toBeGreaterThan(0);
      for (const row of input.observations) {
        expect(row.zoneSlug).toBeNull();
        if (row.kind === "location" || OBSERVATION_CATALOG[row.key].scope === "zone") expect(row.value).toBeNull();
      }
    }
  });

  it("does not mistake a zone's familiar slug for its stage type", () => {
    const mismatched = { ...context, zones: [
      { ...context.zones[1], kind: "water" },
      { ...context.zones[1], slug: "actual-stage" },
    ] };
    const input = SimulationInputSchema.parse(inputFor("storm", mismatched));
    expect(input.upcomingSets[0].stageSlug).toBe("actual-stage");
    expect(validateScenario(input, mismatched)).toEqual([]);
  });

  it("is deterministic, owns its copies, and does not mutate context", () => {
    const before = JSON.stringify(context);
    for (const scenario of MOBILIZATION_SCENARIOS) {
      const first = buildScenario(scenario.id, context);
      const second = buildScenario(scenario.id, context);
      expect(first).toEqual(second);
      first.input.weather.temperatureC = -20;
      first.input.observations[0].value = null;
      first.input.recentIncidents.length = 0;
      first.missingContext.push("changed");
      expect(buildScenario(scenario.id, context)).toEqual(second);
    }
    expect(JSON.stringify(context)).toBe(before);
    expect(buildScenario("storm", { ...context, zones: [...context.zones].reverse() }))
      .toEqual(buildScenario("storm", context));
  });

  it("tests two real stages and known timetable acts without inventing audience counts for unknown capacity", () => {
    const twoStages = { ...context, zones: [...context.zones,
      { slug: "river-stage", name: "Track Stage", kind: "stage", capacity: null, isOpenAir: true }],
      timetable: [{ id: "known-set", stageSlug: "river-stage", act: "Local support", startsAt: "2026-10-07T04:00:00Z",
        endsAt: "2026-10-07T05:00:00Z", expectedPeople: 300 }] };
    for (const id of ["heat-water", "crowd-surge"] as const) {
      const input = SimulationInputSchema.parse(inputFor(id, twoStages));
      expect(input.upcomingSets).toHaveLength(2);
      expect(input.upcomingSets.map((entry) => entry.stageSlug)).toEqual(["lawn-stage", "river-stage"]);
      expect(input.upcomingSets[1].act).toBe("Local support");
      expect(input.upcomingSets[1].expectedPeople).toBeNull();
      expect(input.upcomingSets[1].startsInMinutes - input.upcomingSets[0].startsInMinutes).toBe(5);
      expect(validateScenario(input, twoStages)).toEqual([]);
    }
    expect(inputFor("heat-water", { ...twoStages, zones: twoStages.zones.map((entry) => ({ ...entry, capacity: null })) })
      .crowdByZone[0].estimatedPeople).toBe(220);
  });

  it("replaces every control and leaves no incompatible storm values in a normal preset", () => {
    const storm = buildScenario("storm", context).input;
    const normal = buildScenario("normal", context).input;
    expect(storm.weather.warning).toBe("storm");
    expect(normal.weather).toEqual({ temperatureC: 28, trendCPerHour: null, condition: "clear", warning: "none", warningInMinutes: null });
    expect(normal.upcomingSets).toEqual([]);
    expect(normal.recentIncidents).toEqual([]);
    expect(normal.observations.some((row) => row.key === "stageSafety.windLimitExceeded")).toBe(false);
    expect(normal.observations.find((row) => row.key === "casualtyEstimate")?.value).toBe(0);
    expect(Object.keys(normal).sort()).toEqual(["weather", "upcomingSets", "crowdByZone", "recentIncidents", "observations"].sort());
  });

  it("never supplies manufactured response plans, roster, or movement authorizations", () => {
    for (const scenario of MOBILIZATION_SCENARIOS) {
      const { input } = buildScenario(scenario.id, context);
      expect(Object.keys(input).sort()).toEqual(["weather", "upcomingSets", "crowdByZone", "recentIncidents", "observations"].sort());
      for (const row of input.observations) {
        if (OBSERVATION_CATALOG[row.key].approvalRequired || ["engineerAssessment", "lawEnforcementGuidance", "testResults"].includes(row.key))
          expect(row.value, `${scenario.id}: ${row.key}`).toBeNull();
        if (row.key === "audienceByZone" && row.kind === "zone_counts" && row.value)
          expect(row.value.coverage).toBe("partial");
      }
    }
  });

  it("provides realistic severe observations without treating fixture numbers as SOP thresholds", () => {
    const heat = buildScenario("heat-water", context).input;
    expect(heat.weather.temperatureC).toBe(41);
    expect(heat.observations.find((row) => row.key === "water.tankLevels")?.value).toBe(8);
    expect(buildScenario("crowd-surge", context).input.observations.find((row) => row.key === "crowd.densityByZone")?.value).toBe(5.5);
    expect(buildScenario("gate-breach", context).input.observations.find((row) => row.key === "siteCapacity")?.value).toBeNull();
    for (const scenario of MOBILIZATION_SCENARIOS)
      expect(scenario.summary.toLowerCase()).not.toContain("threshold");
  });
});
