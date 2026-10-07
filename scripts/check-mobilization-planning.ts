/** Contract/grounding/network-seam checks, not a claim about live model reasoning quality. */

import {
  MobilizationOutputSchema,
  type ManagedPlaybook,
  type MobilizationOutput,
  type PlanningSnapshot,
  type SimulationContext,
  type SimulationInput,
} from "../src/lib/mobilization-contracts";
import type { Task, Volunteer } from "../src/lib/schema";
import { inputAvailability, missingRequiredInputs } from "../src/lib/mobilization-inputs";
import { buildEvidence, MOBILIZATION_OUTPUT_TOKEN_BUDGET } from "../src/server/predict/simulation";
import { groundMobilizationPlans, validateMobilizationOutput, validateScenario } from "../src/server/predict/validate";

const assert = {
  ok(value: unknown) { if (!value) throw new Error("Assertion failed"); },
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Values differ");
  },
  async rejects(promise: Promise<unknown>, pattern: RegExp) {
    try { await promise; } catch (error) {
      if (error instanceof Error && pattern.test(error.message)) return;
      throw error;
    }
    throw new Error("Expected promise to reject");
  },
};

const input: SimulationInput = {
  requestId: "planning-check-001",
  weather: { temperatureC: 38, trendCPerHour: 2, condition: "clear", warning: "heat", warningInMinutes: 0 },
  upcomingSets: [{ stageSlug: "lawn-stage", act: "Next set", startsInMinutes: 10, durationMinutes: 60, expectedPeople: 3000 }],
  crowdByZone: [],
  recentIncidents: [{ category: "heat", zoneSlug: "water-2", minutesAgo: 5, description: "Two people feeling faint", count: 2, openCount: 2 }],
};
const context: SimulationContext = {
  zones: [
    { slug: "lawn-stage", name: "Oval Stage", kind: "stage", capacity: 5000, isOpenAir: true },
    { slug: "water-2", name: "Water Station 2", kind: "water", capacity: null, isOpenAir: true },
  ],
  teams: [{ slug: "first-aid", name: "First Aid", description: "Medical attention" }, { slug: "ops", name: "Operations", description: "Facilities" }],
  skills: [{ slug: "first-aid-cert", name: "First aid certificate" }],
  timetable: [{ id: "set-baseline", stageSlug: "lawn-stage", act: "Scheduled original", startsAt: "2026-10-08T05:00:00Z", endsAt: "2026-10-08T06:00:00Z", expectedPeople: 2000 }],
  playbooks: [], modelReady: true, modelConfigurationMessage: null,
};
const at = "2026-10-07T04:00:00Z";
const snapshot: PlanningSnapshot = {
  schemaVersion: 1, evaluatedAt: at, scenario: input,
  zones: context.zones, teams: context.teams, skills: context.skills, routes: [], roster: [], existingResponses: [],
  evidence: buildEvidence(input, context, [], at), playbooks: [],
};
const action = (key: string, zoneSlug: string) => ({
  key, title: `Assess people at ${zoneSlug}`, instructions: `Assess heat symptoms and move affected people to shade at ${zoneSlug}`,
  teamSlug: "first-aid" as const, zoneSlug, peopleNeeded: 2,
  reason: "Protect people while the possible contribution of heat is assessed",
  requiredSkills: ["first-aid-cert"], completionCriteria: "Affected people assessed and escalation recorded",
  addressesFindingIds: ["heat-risk"], evidenceRefs: ["demo-weather", "demo-incident-0"], playbookRefs: [],
});
const output: MobilizationOutput = {
  decision: "propose",
  assessment: { summary: "Coordinated assessment is warranted", severity: "concerning",
    findings: [{ id: "heat-risk", risk: "People are feeling faint in high temperatures",
      possibleCause: "Heat may contribute", uncertainty: "Symptoms do not establish a diagnosis",
      evidenceRefs: ["demo-weather", "demo-incident-0"] }], missingInputs: [], playbookAssessments: [] },
  mobilizations: [{ title: "Heat response", priority: "P2", rationale: "Assess and protect people in separate locations",
    tasks: [action("assess-water", "water-2"), action("assess-stage", "lawn-stage")], unmetRequirements: [] }],
};

function check(label: string, run: () => void) {
  run();
  console.log(`ok   ${label}`);
}
const copy = <T>(value: T): T => structuredClone(value);
const errorsFor = (value: MobilizationOutput, snap = snapshot) =>
  validateMobilizationOutput(value, snap, context.skills.map((skill) => skill.slug));

check("coordinated-plan token budget remain explicit", () => {
  assert.equal(MOBILIZATION_OUTPUT_TOKEN_BUDGET, 12_000);
});
check("same team can perform multiple distinct action tasks", () => {
  assert.ok(MobilizationOutputSchema.safeParse(output).success);
  assert.deepEqual(errorsFor(output), []);
});
check("no mobilization is a valid assessment outcome; insufficient data names gaps", () => {
  assert.deepEqual(errorsFor({ ...output, decision: "no_mobilization", mobilizations: [] }), []);
  assert.ok(errorsFor({ ...output, decision: "insufficient_data", mobilizations: [] }).length);
  assert.deepEqual(errorsFor({ ...output, decision: "insufficient_data", mobilizations: [],
    assessment: { ...output.assessment, missingInputs: ["Current crowd count"] } }), []);
});
check("unknown evidence, locations, skills and finding links are rejected", () => {
  const invalid = copy(output);
  const task = invalid.mobilizations[0].tasks[0];
  task.evidenceRefs = ["invented-source"];
  task.zoneSlug = "invented-zone";
  task.requiredSkills = ["invented-skill"];
  task.addressesFindingIds = ["invented-finding"];
  const errors = errorsFor(invalid);
  assert.ok(errors.some((error) => error.includes("unknown evidence")));
  assert.ok(errors.some((error) => error.includes("unknown zone")));
  assert.ok(errors.some((error) => error.includes("unknown skill")));
  assert.ok(errors.some((error) => error.includes("unknown finding")));
});
check("each finding needs a targeted task sharing its factual evidence", () => {
  const invalid = copy(output);
  invalid.assessment.findings.push({ ...invalid.assessment.findings[0], id: "unaddressed" });
  assert.ok(errorsFor(invalid).some((error) => error.includes("no response task")));
});
const book: ManagedPlaybook = {
  id: "book", version: 2, status: "published", createdAt: at, updatedAt: at, publishedAt: at,
  content: { schemaVersion: 1, slug: "heat-response", title: "Test procedure", appliesWhen: "Heat symptoms",
    requiredInputs: ["weather.temperatureC"], constraints: [], decisionPoints: [], source: "Test fixture, not an official SOP",
    actions: ["assess", "recheck"].map((id) => ({ id, requirement: "must", teamSlug: "first-aid",
      title: id, instructions: id, peopleNeeded: 2, staffingGuidance: "Two certified crew",
      requiredSkills: ["first-aid-cert"], locationGuidance: "Affected zone", completionCriteria: "Document assessment" })) },
};
check("cited published playbook must actions are covered or explicitly unmet", () => {
  const value = copy(output);
  value.mobilizations[0].tasks[0].playbookRefs.push({ slug: "heat-response", version: 2, actionId: "assess" });
  value.assessment.playbookAssessments.push({ slug: "heat-response", version: 2, applicability: "applicable",
    reason: "Heat symptoms are reported", evidenceRefs: ["demo-incident-0"], missingInputs: [] });
  const withBook = { ...snapshot, playbooks: [book] };
  assert.ok(errorsFor(value, withBook).some((error) => error.includes("omits required playbook action")));
  value.mobilizations[0].unmetRequirements.push({ playbookRef: { slug: "heat-response", version: 2, actionId: "recheck" }, reason: "Needs later specialist review" });
  assert.deepEqual(errorsFor(value, withBook), []);
  assert.ok(errorsFor(value, { ...withBook, playbooks: [{ ...book, status: "draft" }] }).length);
});
check("every supplied published SOP gets an auditable applicability assessment", () => {
  const withBook = { ...snapshot, playbooks: [book] };
  assert.ok(errorsFor(output, withBook).some((error) => error.includes("Missing playbook assessment")));
  const value = copy(output);
  const review: MobilizationOutput["assessment"]["playbookAssessments"][number] = {
    slug: "heat-response", version: 2, applicability: "not_applicable", reason: "Test exclusion reason",
    evidenceRefs: ["demo-weather"], missingInputs: [],
  };
  value.assessment.playbookAssessments = [review];
  assert.deepEqual(errorsFor(value, withBook), []);
  value.assessment.playbookAssessments.push(review);
  assert.ok(errorsFor(value, withBook).some((error) => error.includes("Duplicate playbook assessment")));
  value.assessment.playbookAssessments = [{ ...review, applicability: "insufficient_data" }];
  assert.ok(errorsFor(value, withBook).some((error) => error.includes("must name its missing inputs")));
  value.assessment.playbookAssessments = [{ ...review, applicability: "applicable" }];
  assert.ok(errorsFor(value, withBook).some((error) => error.includes("omits required playbook action")));
});
check("unsupported SOP facts never become zero counts or approved routes", () => {
  assert.deepEqual(missingRequiredInputs([
    "weather.temperatureC", "weather.windSpeed", "audienceByZone", "approvedRoutes", "crowdByZone",
  ], snapshot), ["weather.windSpeed", "audienceByZone", "approvedRoutes", "crowdByZone"]);
  assert.deepEqual(missingRequiredInputs(["weather.trendCPerHour"], {
    ...snapshot, scenario: { ...input, weather: { ...input.weather, trendCPerHour: null } },
  }), ["weather.trendCPerHour"]);
  assert.equal(inputAvailability(snapshot)["weather.temperature"].available, true);
  assert.equal(inputAvailability(snapshot).currentRoster.available, true);
  assert.equal(inputAvailability({ ...snapshot, evidence: [] }).recentIncidents.available, false);
});
check("scenario locations and incident counts remain internally consistent", () => {
  const value = copy(input);
  value.upcomingSets[0].stageSlug = "water-2";
  value.recentIncidents[0].openCount = 3;
  assert.equal(validateScenario(value, context).length, 2);
});
check("demo overrides do not duplicate the DB schedule; future source incidents are excluded", () => {
  const future = { id: "future", report_id: "report-future", title: "Future report", summary: "Not known yet",
    category: "heat" as const, status: "open" as const, zone_slug: "water-2", created_at: "2026-10-07T04:01:00Z" };
  const evidence = buildEvidence(input, context, [future], at);
  assert.ok(evidence.some((entry) => entry.ref === "demo-set-0"));
  assert.ok(!evidence.some((entry) => entry.ref === "timetable-set-baseline"));
  assert.ok(!evidence.some((entry) => entry.ref === "incident-future"));
});

const volunteer = (id: string, over: Partial<Volunteer> = {}): Volunteer => ({
  id, name: id, role: "volunteer", teamSlug: "first-aid", skills: ["first-aid-cert"], languages: ["en"],
  zoneSlug: "water-2", duty: "on_duty", shiftEndsAt: null, phone: null, ...over,
});
check("capacity is grounded without busy/wrong-team/unqualified/ended-shift crew or double booking", () => {
  const people = [volunteer("eligible"), volunteer("busy"), volunteer("off", { duty: "off_shift" }),
    volunteer("wrong-team", { teamSlug: "ops" }), volunteer("unqualified", { skills: [] }),
    volunteer("shift-ended", { shiftEndsAt: Date.parse(at) - 1 })];
  const work = [{ id: "busy-task", status: "assigned", assigneeId: "busy", helpers: [] } as unknown as Task];
  const grounded = groundMobilizationPlans(output, people, work, Date.parse(at));
  assert.deepEqual(grounded[0][0].candidates.map((candidate) => candidate.volunteerId), ["eligible"]);
  assert.equal(grounded[0][0].peopleNeeded, 2);
  assert.equal(grounded[0][1].candidates.length, 0);
});

console.log("Mobilization planning contract checks passed (live model not exercised).");
