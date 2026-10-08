/** Typed observation boundary checks; uses the supplied 10-SOP file, no DB or live model. */
import { parseAllDocuments } from "yaml";
import { inputAvailability } from "../src/lib/mobilization-inputs";
import { SimulationInputSchema, type PlanningSnapshot, type SimulationContext, type SimulationInput } from "../src/lib/mobilization-contracts";
import { OBSERVATION_CATALOG, ObservationSchema, observationIsMeaningful, observationReferenceErrors, type MobilizationObservation } from "../src/lib/mobilization-observations";
import { buildEvidence } from "../src/server/predict/simulation";
import { validateMobilizationOutput, validateScenario } from "../src/server/predict/validate";

declare const Bun: { file(path: string): { text(): Promise<string> } };
function ok(value: unknown, message: string) { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(message); }
function check(label: string, action: () => void) { action(); console.log(`ok   ${label}`); }
const row = (over: Record<string, unknown> = {}) => ({ key: "weather.windSpeed", kind: "number", zoneSlug: null, minutesAgo: 0, value: 80, ...over });
const input: SimulationInput = {
  requestId: "observation-check-001", weather: { temperatureC: 38, trendCPerHour: null, condition: "storm", warning: "storm", warningInMinutes: 0 },
  upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [],
};
const context: SimulationContext = {
  zones: [{ slug: "lawn-stage", name: "Stage", kind: "stage", capacity: 5000, isOpenAir: true },
    { slug: "water-2", name: "Water 2", kind: "water", capacity: 500, isOpenAir: true }],
  teams: [], skills: [], timetable: [], playbooks: [], modelReady: false, modelConfigurationMessage: "Not configured",
};
const evaluatedAt = "2026-10-07T04:00:00.000Z";
const snapshot = (observations: MobilizationObservation[]): PlanningSnapshot => ({
  schemaVersion: 1, evaluatedAt, scenario: { ...input, observations }, zones: context.zones,
  teams: [], skills: [], routes: [], roster: [], existingResponses: [], playbooks: [],
  evidence: buildEvidence({ ...input, observations }, context, [], evaluatedAt),
});

const supplied = parseAllDocuments(await Bun.file("supabase/playbooks/festival-emergency.yaml").text());
check("catalog covers every required input in all 10 supplied SOPs", () => {
  equal(supplied.length, 10, "Expected 10 SOP documents");
  const keys = [...new Set(supplied.flatMap((document) => (document.toJSON() as { requiredInputs: string[] }).requiredInputs))];
  for (const key of keys) ok(OBSERVATION_CATALOG[key], `Missing catalog input ${key}`);
});
check("unknown keys, wrong kinds, numeric bounds, future ages and built-in overrides reject", () => {
  for (const invalid of [row({ key: "invented" }), row({ kind: "text", value: "80" }),
    row({ value: 301 }), row({ value: -1 }), row({ minutesAgo: -1 }), row({ key: "weather.temperature", value: 38 })])
    ok(!ObservationSchema.safeParse(invalid).success, "Invalid row was accepted");
  ok(!ObservationSchema.safeParse(row({ key: "stageStatus", kind: "status", value: "invented-status" })).success, "Unknown status accepted");
  ok(!ObservationSchema.safeParse(row({ key: "stageSafety.windLimitExceeded", kind: "boolean", value: 1, zoneSlug: "lawn-stage" })).success, "Numeric boolean accepted");
});
check("zero and false are facts, while null/blank/empty collections remain unknown", () => {
  ok(observationIsMeaningful(ObservationSchema.parse(row({ value: 0 }))), "Zero was treated as unknown");
  ok(observationIsMeaningful(ObservationSchema.parse(row({ key: "stageSafety.windLimitExceeded", kind: "boolean", zoneSlug: "lawn-stage", value: false }))), "False was treated as unknown");
  for (const unknown of [row({ value: null }), row({ key: "medicalReports", kind: "text", value: "  " }),
    row({ key: "approvedRoutes", kind: "routes", value: [] })])
    ok(!observationIsMeaningful(ObservationSchema.parse(unknown)), "Empty input became a fact");
  equal(SimulationInputSchema.parse({ ...input, observations: undefined }).observations.length, 0, "Omitted observations default failed");
});
check("all observation kinds validate real zones and duplicate scopes", () => {
  const invalidLocation = ObservationSchema.parse(row({ key: "incidentLocation", kind: "location", value: "invented" }));
  ok(observationReferenceErrors([invalidLocation], context.zones.map((zone) => zone.slug)).length, "Unknown location accepted");
  const good = ObservationSchema.parse(row());
  ok(validateScenario({ ...input, observations: [good, good] }, context).some((error) => error.includes("Duplicate observation")), "Duplicate scope accepted");
  const collection = ObservationSchema.parse(row({ key: "shelters", kind: "locations", value: [
    { zoneSlug: "invented", status: "open", capacity: 200, approved: true },
  ] }));
  ok(observationReferenceErrors([collection], context.zones.map((zone) => zone.slug)).length, "Unknown approved shelter accepted");
  ok(validateScenario({ ...input, crowdByZone: [
    { zoneSlug: "lawn-stage", estimatedPeople: 100, trend: null }, { zoneSlug: "lawn-stage", estimatedPeople: 200, trend: null },
  ] }, context).some((error) => error.includes("Duplicate crowd override")), "Conflicting built-in crowd samples accepted");
});
check("approval routes use real distinct endpoints and preserve directed approvals", () => {
  const route = { fromZoneSlug: "lawn-stage", toZoneSlug: "water-2", status: "open", approved: false };
  const observation = ObservationSchema.parse(row({ key: "approvedRoutes", kind: "routes", value: [route] }));
  equal(observationReferenceErrors([observation], context.zones.map((zone) => zone.slug)).length, 0, "Valid explicit route rejected");
  ok(observationIsMeaningful(observation), "Explicit unapproved route became unknown");
  ok(!ObservationSchema.safeParse(row({ key: "approvedRoutes", kind: "routes", value: [{ ...route, approved: undefined }] })).success, "Missing approval became implicit approval");
  const reversed = ObservationSchema.parse(row({ key: "approvedRoutes", kind: "routes", value: [route,
    { ...route, fromZoneSlug: "water-2", toZoneSlug: "lawn-stage", approved: true }] }));
  equal(observationReferenceErrors([reversed], context.zones.map((zone) => zone.slug)).length, 0, "Independent reverse direction rejected");
  const duplicate = ObservationSchema.parse(row({ key: "approvedRoutes", kind: "routes", value: [route, { ...route, approved: true }] }));
  ok(observationReferenceErrors([duplicate], context.zones.map((zone) => zone.slug)).some((error) => error.includes("Duplicate approved route")), "Conflicting same-direction route accepted");
});
check("explicit audience samples remain partial and full census claims must be complete", () => {
  const partial = ObservationSchema.parse(row({ key: "audienceByZone", kind: "zone_counts", value: {
    coverage: "partial", entries: [{ zoneSlug: "lawn-stage", count: 0 }],
  } }));
  equal(inputAvailability(snapshot([partial])).audienceByZone.available, true, "Explicit named partial sample became unavailable");
  equal(inputAvailability(snapshot([partial])).audienceByZone.completeness, "partial", "Partial became full census");
  const full = ObservationSchema.parse(row({ key: "audienceByZone", kind: "zone_counts", value: {
    coverage: "all_venue", entries: [{ zoneSlug: "lawn-stage", count: 2000 }, { zoneSlug: "water-2", count: 0 }],
  } }));
  equal(inputAvailability(snapshot([full])).audienceByZone.available, true, "Full valid census unknown");
  equal(inputAvailability(snapshot([full])).audienceByZone.completeness, "complete", "Full valid census labelled partial");
  const missing = ObservationSchema.parse(row({ key: "audienceByZone", kind: "zone_counts", value: {
    coverage: "all_venue", entries: [{ zoneSlug: "lawn-stage", count: 2000 }],
  } }));
  ok(observationReferenceErrors([missing], context.zones.map((zone) => zone.slug)).length, "False full coverage accepted");
});
check("typed observations become past-timestamped citeable evidence with canonical units", () => {
  const observation = ObservationSchema.parse(row({ minutesAgo: 5 }));
  const snap = snapshot([observation]);
  const evidence = snap.evidence.find((entry) => entry.ref === "observation-0")!;
  equal(evidence.source, "manual_demo", "Demo was reported as real data");
  equal(evidence.observedAt, "2026-10-07T03:55:00.000Z", "Age timestamp failed");
  equal(evidence.value.unit, "km/h", "Canonical unit lost");
  equal(inputAvailability(snap)["weather.windSpeed"].available, true, "Known wind observation unavailable");
  const errors = validateMobilizationOutput({ decision: "no_mobilization", assessment: { summary: "A wind reading exists but no coordinated response is proposed",
    severity: "minor", findings: [{ id: "wind", risk: "Recorded elevated wind", possibleCause: "Weather", uncertainty: "Local stage tolerance unknown", evidenceRefs: ["observation-0"] }],
    missingInputs: [], playbookAssessments: [] }, mobilizations: [] }, snap, []);
  equal(errors.length, 0, "Valid observation citation rejected");
});
console.log("Mobilization observation checks passed (typed demo facts only).");
