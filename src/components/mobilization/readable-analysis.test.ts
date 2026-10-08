import { describe, expect, it } from "vitest";

import type { PlanningEvidence } from "@/lib/mobilization-contracts";
import { describeEvidence, humanizeMissingInputs, readableName, readableText } from "./readable-analysis";

const lookups = {
  zones: { "water-2": { name: "East water point" }, "oval-stage": { name: "Oval Stage" } },
  teams: [{ slug: "first-aid", name: "First Aid" }, { slug: "crowd", name: "Crowd Safety" }],
  skills: [{ slug: "first-aid-cert", name: "First aid certification" }],
};
const fact = (value: Record<string, unknown>, patch: Partial<PlanningEvidence> = {}): PlanningEvidence => ({
  ref: "observation-8", kind: "observation", zoneSlug: "water-2", source: "manual_demo",
  observedAt: "2026-10-07T16:00:00.000Z", value, ...patch,
});

describe("readable mobilization language", () => {
  it("uses venue, team, skill and observation labels without changing facts", () => {
    expect(readableText("water-2", lookups)).toBe("East water point");
    expect(readableText("first-aid", lookups)).toBe("First Aid");
    expect(readableText("crowd", lookups)).toBe("Crowd Safety");
    expect(readableText("41°C at water-2; weather.heatIndex is unknown; first-aid-cert needed.", lookups))
      .toBe("41°C at East water point; Heat index is unknown; First aid certification needed.");
  });
  it("does not turn ordinary prose into team labels or suppress negation", () => {
    expect(readableText("The crowd is growing; heat-related symptoms are not a confirmed diagnosis.", lookups))
      .toBe("The crowd is growing; heat-related symptoms are not a confirmed diagnosis.");
  });
  it("maps mixed-case known stage slugs in prose without changing unrelated natural words", () => {
    const stages = { ...lookups, zones: {
      ...lookups.zones, "lawn-stage": { name: "Oval Stage" }, "river-stage": { name: "Track Stage" },
    } };
    expect(readableText("Lawn-stage and River-stage need checks before the next performances; the Crowd is growing.", stages))
      .toBe("Oval Stage and Track Stage need checks before the next performances; the Crowd is growing.");
    expect(readableText("FIRST-AID and First-Aid-Cert support at WATER-2", stages))
      .toBe("First Aid and First aid certification support at East water point");
    expect(readableText("CROWD", stages)).toBe("Crowd Safety");
  });
  it("removes raw observation references and identities from prose", () => {
    const result = readableText("See observation-8, demo-set-0 and incident-7a8b. Item 5523f239-ff07-4ee8-81d3-deb2deb02c79 remains unapproved.");
    expect(result).not.toMatch(/observation-8|demo-set-0|incident-7a8b|5523f239/);
    expect(result).toContain("remains unapproved");
  });
  it("humanizes unknown camel, snake and dotted field paths", () => {
    const result = readableText("latestSensorReading and evacuation_route_status plus clinical.assessmentStatus are unknown.");
    expect(result).toBe("Latest sensor reading and Evacuation route status plus Clinical assessment status are unknown.");
    expect(result).not.toMatch(/latestSensorReading|evacuation_route_status|clinical\./);
  });
  it("turns JSON into labelled prose, without identifiers or JSON punctuation", () => {
    expect(readableText('{"taskId":"secret-id","zoneSlug":"water-2","count":0,"approved":false}', lookups))
      .toBe("Location: East water point; Reported count: 0; Approval: Not approved");
  });
  it("does not expose identifiers hidden inside JSON within an ordinary sentence", () => {
    expect(readableText('Observed {"assetId":"private-asset","zoneSlug":"water-2","count":2} remains unconfirmed.', lookups))
      .toBe("Observed Location: East water point; Reported count: 2 remains unconfirmed.");
  });
  it("does not mistake ordinary hyphenated risk language for an identifier", () => {
    expect(readableText("Use a risk-based approach with a task-force; the incident-related cause is uncertain."))
      .toBe("Use a risk-based approach with a task-force; the incident-related cause is uncertain.");
  });
  it("does not leave raw task keys after a reference label", () => {
    expect(readableText("Task key heat-check-a remains proposed; finding ID local-pressure is uncertain."))
      .toBe("related Task remains proposed; related finding is uncertain.");
  });
  it("deduplicates missing inputs after aliases are made readable, without losing distinct scopes", () => {
    expect(humanizeMissingInputs(["weather.temperatureC", "weather.temperature", "Temperature", "", "medicalHeatCases at water-2", "medicalHeatCases at oval-stage"], lookups))
      .toEqual(["Temperature", "Heat-related medical cases at East water point", "Heat-related medical cases at Oval Stage"]);
  });
  it("splits bare technical input lists before deduplicating their individual requirements", () => {
    expect(humanizeMissingInputs(["crowd.densityByZone; crowd.flowDirection; barrierStatus",
      "crowd.flowDirection", "barrierStatus, weather.heatIndex", "weather.heatIndex"], lookups))
      .toEqual(["Crowd density", "Crowd flow direction", "Barrier condition", "Heat index"]);
  });
  it("keeps scoped, conditional and natural-language missing observations intact", () => {
    const scoped = "crowd.densityByZone; medicalHeatCases at water-2 must be checked together";
    const sentence = "Check both stages, not only the nearest stage; access is unconfirmed";
    expect(humanizeMissingInputs([scoped, sentence, "weather.heatIndex; no clinical severity is confirmed"], lookups))
      .toEqual(["Crowd density; Heat-related medical cases at East water point must be checked together",
        sentence, "Heat index; no clinical severity is confirmed"]);
  });
});

describe("field-aware public names", () => {
  it.each([
    ["first-aid-cert", "First Aid Certificate"], ["wwcc", "Working With Children Check"],
    ["radio-trained", "Radio trained"], ["rsa", "Responsible Service of Alcohol"],
    ["crowd-control", "Crowd control certificate"], ["multilingual", "Speaks a language other than English"],
  ])("uses the public name for %s without an AI snapshot or skills lookup", (slug, expected) => {
    expect(readableName("skill", slug)).toBe(expected);
    expect(readableName("skill", slug.toUpperCase())).toBe(expected);
    expect(readableText(slug)).toBe(expected);
    expect(readableText(slug.toUpperCase())).toBe(expected);
  });
  it("uses the provided current public name before a qualification fallback", () => {
    const custom = { skills: [{ slug: "radio-trained", name: "Event radio training" }] };
    expect(readableName("skill", "RADIO-TRAINED", custom)).toBe("Event radio training");
    expect(readableText("Radio-trained crew must use the designated channel.", custom))
      .toBe("Event radio training crew must use the designated channel.");
    expect(readableName("skill", "first-aid-cert", lookups)).toBe("First aid certification");
  });
  it("uses named location and team lookups without case-sensitive fallback leaks", () => {
    expect(readableName("zone", "WATER-2", lookups)).toBe("East water point");
    expect(readableName("team", "FIRST-AID", lookups)).toBe("First Aid");
  });
  it("never prints an unfamiliar identity or invents no qualification", () => {
    expect(readableName("zone", "unknown-zone", lookups)).toBe("Location name unavailable");
    expect(readableName("team", "unknown-team", lookups)).toBe("Team name unavailable");
    expect(readableName("skill", "unknown-required-training", lookups)).toBe("Qualification name unavailable");
    expect(readableName("skill", "unknown-required-training", lookups)).not.toMatch(/none|not required|unknown-required/i);
  });
  it("distinguishes an unspecified field from a missing public name", () => {
    expect(readableName("zone", null)).toBe("Location not specified");
    expect(readableName("team", null)).toBe("Team not specified");
    expect(readableName("skill", null)).toBe("Qualification not specified");
  });
  it("does not rewrite ordinary natural-language uses of qualification keywords", () => {
    expect(readableText("The multilingual crew member can help; ask the crowd to wait."))
      .toBe("The multilingual crew member can help; ask the crowd to wait.");
  });
});

describe("readable evidence", () => {
  it("labels hypothetical facts, location and time, without returning a reference", () => {
    const result = describeEvidence(fact({ key: "weather.heatIndex", kind: "number", value: 46, unit: "°C" }), lookups);
    expect(result).toEqual({ title: "Heat index", source: "Hypothetical observation", location: "East water point",
      observedAt: "7 Oct 2026, 16:00 UTC", facts: ["46 °C"] });
    expect(result).not.toHaveProperty("ref");
  });
  it("preserves explicit zero, false and unknown without treating them as safe", () => {
    expect(describeEvidence(fact({ key: "medicalHeatCases", value: 0 })).facts).toEqual(["0 cases"]);
    expect(describeEvidence(fact({ key: "stageSafety.windLimitExceeded", value: false })).facts).toEqual(["No"]);
    expect(describeEvidence(fact({ key: "stageSafety.windLimitExceeded", value: null })).facts).toEqual(["Unknown"]);
  });
  it("keeps directional route access and rejected approval distinct", () => {
    const result = describeEvidence(fact({ key: "approvedRoutes", approvalRequired: true,
      value: [{ fromZoneSlug: "water-2", toZoneSlug: "oval-stage", status: "open", approved: false }] }), lookups);
    expect(result.facts).toEqual(["From location: East water point", "To location: Oval Stage",
      "Condition: open", "Approval: Not approved", "Mo approval is required; review each supplied approval."]);
    expect(result.facts.join(" ")).not.toContain("approved: true");
  });
  it("does not turn an approval requirement into an actual approval", () => {
    const result = describeEvidence(fact({ key: "approvedShelterZones", approvalRequired: true,
      value: [{ zoneSlug: "water-2", capacity: null, status: "closed", approved: true }] }), lookups);
    expect(result.source).toBe("Hypothetical observation");
    expect(result.facts).toContain("Approval: Approved");
    expect(result.facts).toContain("Capacity: Unknown");
    expect(result.facts).toContain("Condition: closed");
  });
  it("shows crew numbers and named qualifications instead of internal roster keys", () => {
    const result = describeEvidence(fact({ teamSlug: "first-aid", onDuty: 4, free: 1,
      freeBySkill: { "first-aid-cert": 1 } }, { kind: "roster", source: "database", zoneSlug: null }), lookups);
    expect(result.facts).toEqual(["Team: First Aid", "Crew on duty: 4", "Available crew: 1",
      "Available crew by skill — First aid certification: 1"]);
    expect(result.source).toBe("Recorded observation");
  });
  it("maps known mixed-case identifiers in structured evidence as well as narrative text", () => {
    expect(describeEvidence(fact({ teamSlug: "FIRST-AID", freeBySkill: { "FIRST-AID-CERT": 2 } },
      { kind: "roster", zoneSlug: "WATER-2" }), lookups)).toMatchObject({
      location: "East water point", facts: ["Team: First Aid", "Available crew by skill — First aid certification: 2"],
    });
  });
  it("retains the recorded-report limitation rather than claiming no incidents exist", () => {
    const result = describeEvidence(fact({ windowMinutes: 20, sourceReportCount: 0, possiblyTruncated: false,
      note: "Not proof that no unreported incident exists" }, { kind: "incident_window", source: "database" }));
    expect(result.facts).toContain("Recorded source reports: 0");
    expect(result.facts).toContain("The recorded list may be incomplete: No");
    expect(result.facts).toContain("Note: Not proof that no unreported incident exists");
  });
  it("handles unfamiliar nested structures without JSON, identity leakage or value loss", () => {
    const result = describeEvidence(fact({ inspectionReading: { reportId: "private-report", gas_level: 0,
      inspectorConfirmed: false, alternatePoint: { zoneSlug: "water-2", engineerAssessment: null } } },
    { kind: "engineer_reading" }), lookups);
    expect(result.title).toBe("Engineer reading");
    expect(result.facts.join(" ")).not.toMatch(/reportId|private-report|gas_level|inspectionReading|[{}]/);
    expect(result.facts.join(" ")).toContain("Gas level: 0");
    expect(result.facts.join(" ")).toContain("Inspector confirmed: No");
    expect(result.facts.join(" ")).toContain("Engineer assessment: Unknown");
  });
  it("handles circular malformed structures without throwing", () => {
    const nested: Record<string, unknown> = { count: 2 };
    nested.nestedValue = nested;
    expect(describeEvidence(fact(nested, { kind: "incident" })).facts).toEqual([
      "Reported count: 2", "Nested value: Further details unavailable",
    ]);
  });
  it("does not expose an invalid timestamp or internal identity-only payload", () => {
    expect(describeEvidence(fact({ taskId: "private", reportId: "private" }, { kind: "incident", observedAt: "bad-camelValue" })))
      .toMatchObject({ observedAt: "Observation time unavailable", facts: ["No readable observations supplied"] });
  });
  it("does not guess unknown venue or team identifiers into real places or teams", () => {
    const result = describeEvidence(fact({ zoneSlug: "unknown-venue-key", teamSlug: "unknown-team-key", count: 2 },
      { kind: "incident", zoneSlug: "unknown-venue-key" }), lookups);
    expect(result.location).toBe("Location not identified");
    expect(result.facts).toEqual(["Location: Location not identified", "Team: Team not identified", "Reported count: 2"]);
    expect(result.facts.join(" ")).not.toContain("unknown-");
  });
  it("retains partial coverage and each supplied count without claiming a site-wide total", () => {
    const result = describeEvidence(fact({ key: "audienceByZone", value: { coverage: "partial",
      entries: [{ zoneSlug: "water-2", count: 120 }] } }), lookups);
    expect(result.facts).toEqual(["Observation coverage: Only the supplied locations",
      "Locations — Location: East water point", "Locations — Reported count: 120"]);
    expect(result.facts.join(" ")).not.toContain("Whole venue");
  });
});
