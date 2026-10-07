/** Pure presentation rules: no database, server, session or timers required. */
import type { Mobilization, Task, TeamSlug } from "../src/lib/schema";
import { mobilizationStatusFor, staffingNote } from "../src/lib/status";

let failures = 0;

function equal<T>(actual: T, expected: T, label: string) {
  if (actual !== expected)
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function notEqual<T>(actual: T, unexpected: T, label: string) {
  if (actual === unexpected) throw new Error(`${label}: expected something other than ${JSON.stringify(unexpected)}`);
}

function check(name: string, run: () => void) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const step = (teamSlug: TeamSlug, peopleNeeded: number, candidates = 0) => ({
  teamSlug,
  peopleNeeded,
  reason: `Respond with ${teamSlug}`,
  candidates: Array.from({ length: candidates }, (_, index) => ({
    volunteerId: `${teamSlug}-${index}`,
    rationale: "Nearby and available",
    distanceM: 100,
  })),
});

const mobilization = (overrides: Partial<Mobilization> = {}): Mobilization => ({
  id: "mobilization-test",
  title: "Heat response",
  status: "active",
  rationale: "Nearby heat incidents",
  relatedPlaybooks: [],
  urgency: "P2",
  zoneSlug: "water-2",
  steps: [step("first-aid", 3)],
  evidence: null,
  playbookSlug: null,
  createdAt: 1,
  decidedById: "mo",
  decidedAt: 2,
  ...overrides,
});

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task-first-aid",
  title: "Provide first aid",
  summary: "Respond to heat incidents",
  category: "heat",
  priority: "P2",
  teamSlug: "first-aid",
  zoneSlug: "water-2",
  locationHint: null,
  status: "assigned",
  assigneeId: "owner",
  reporter: { kind: "system", quote: "Heat response", language: "en" },
  handledBy: "ai",
  createdAt: 2,
  assignedAt: 2,
  etaAt: null,
  lastActivityAt: 2,
  nudgeCount: 0,
  lastNudgeAt: null,
  leadAlertedAt: null,
  resolvedAt: null,
  escalation: null,
  requiredCount: 3,
  helpers: [],
  resolution: null,
  requestId: null,
  mobilizationId: "mobilization-test",
  ...overrides,
});

check("proposed candidates are availability previews, never committed crew", () => {
  const status = mobilizationStatusFor(
    mobilization({ status: "proposed", steps: [step("first-aid", 3, 2)] }),
    [task({ status: "accepted" })],
  );
  equal(status.label, "Needs approval", "label");
  equal(status.steps[0].taskId, null, "steps[0].taskId");
  equal(status.summary.requiredCount, 3, "summary.requiredCount");
  equal(status.summary.previewCount, 2, "summary.previewCount");
  equal(status.summary.previewMissingCount, 1, "summary.previewMissingCount");
  equal(status.summary.confirmedCount, 0, "summary.confirmedCount");
  equal(status.summary.waitingCount, 0, "summary.waitingCount");
  equal(status.summary.missingCount, 0, "summary.missingCount");
});

check("notified owner and helper await replies; missing slots are separate", () => {
  const status = mobilizationStatusFor(mobilization(), [
    task({ helpers: [{ volunteerId: "helper", status: "notified", assignedAt: 2, respondedAt: null }] }),
  ]);
  equal(status.summary.confirmedCount, 0, "summary.confirmedCount");
  equal(status.summary.waitingCount, 2, "summary.waitingCount");
  equal(status.summary.missingCount, 1, "summary.missingCount");
  equal(status.tone, "warning", "tone");
});

check("accepted helpers count before an owner accepts; owner status is independent", () => {
  const assigned = task({
    helpers: [{ volunteerId: "helper", status: "accepted", assignedAt: 2, respondedAt: 3 }],
  });
  const before = mobilizationStatusFor(mobilization(), [assigned]);
  const after = mobilizationStatusFor(mobilization(), [{ ...assigned, status: "accepted" }]);
  equal(before.summary.confirmedCount, 1, "before.summary.confirmedCount");
  equal(before.summary.waitingCount, 1, "before.summary.waitingCount");
  equal(after.summary.confirmedCount, 2, "after.summary.confirmedCount");
  equal(after.summary.waitingCount, 0, "after.summary.waitingCount");
  equal(after.summary.missingCount, 1, "after.summary.missingCount");
});

check("fully invited teams show awaiting replies without claiming confirmed staffing", () => {
  const status = mobilizationStatusFor(mobilization(), [
    task({
      helpers: ["helper-1", "helper-2"].map((volunteerId) => ({
        volunteerId,
        status: "notified" as const,
        assignedAt: 2,
        respondedAt: null,
      })),
    }),
  ]);
  equal(status.summary.confirmedCount, 0, "summary.confirmedCount");
  equal(status.summary.waitingCount, 3, "summary.waitingCount");
  equal(status.summary.missingCount, 0, "summary.missingCount");
  equal(status.detail, "3 awaiting reply", "detail");
  notEqual(status.tone, "success", "tone");
});

check("a declined helper disappears and exposes a missing slot", () => {
  const status = mobilizationStatusFor(mobilization(), [task({ status: "accepted", helpers: [] })]);
  equal(status.summary.confirmedCount, 1, "summary.confirmedCount");
  equal(status.summary.waitingCount, 0, "summary.waitingCount");
  equal(status.summary.missingCount, 2, "summary.missingCount");
});

check("active staffing requirements come from the actual task", () => {
  const status = mobilizationStatusFor(mobilization(), [task({ requiredCount: 5 })]);
  equal(status.steps[0].requiredCount, 5, "steps[0].requiredCount");
  equal(status.summary.requiredCount, 5, "summary.requiredCount");
  equal(status.summary.outstandingRequiredCount, 5, "summary.outstandingRequiredCount");
  equal(status.summary.missingCount, 4, "summary.missingCount");
});

check("resolved teams do not count stale helpers or retain shortages", () => {
  const resolved = task({
    status: "resolved",
    resolution: "done",
    helpers: [{ volunteerId: "helper", status: "accepted", assignedAt: 2, respondedAt: 3 }],
  });
  const status = mobilizationStatusFor(mobilization(), [resolved]);
  equal(status.label, "Complete", "label");
  equal(status.tone, "success", "tone");
  equal(status.summary.completedTasks, 1, "summary.completedTasks");
  equal(status.summary.confirmedCount, 0, "summary.confirmedCount");
  equal(status.summary.outstandingRequiredCount, 0, "summary.outstandingRequiredCount");
  equal(status.summary.missingCount, 0, "summary.missingCount");
  equal(staffingNote(resolved), undefined, "staffingNote");
});

check("cancelled tasks are closed, never reported as successful completion", () => {
  const cancelled = task({
    status: "cancelled",
    resolution: "cancelled",
    helpers: [{ volunteerId: "helper", status: "accepted", assignedAt: 2, respondedAt: 3 }],
  });
  const status = mobilizationStatusFor(mobilization(), [cancelled]);
  equal(status.label, "Closed", "label");
  equal(status.tone, "neutral", "tone");
  equal(status.summary.cancelledTasks, 1, "summary.cancelledTasks");
  equal(status.summary.completedTasks, 0, "summary.completedTasks");
  equal(status.summary.confirmedCount, 0, "summary.confirmedCount");
  equal(status.summary.missingCount, 0, "summary.missingCount");
  equal(staffingNote(cancelled), undefined, "staffingNote");
});

check("completed and pending teams keep separate progress and current staffing", () => {
  const status = mobilizationStatusFor(mobilization({ steps: [step("first-aid", 3), step("crowd", 2)] }), [
    task({ status: "resolved", resolution: "done" }),
    task({ id: "task-crowd", teamSlug: "crowd", requiredCount: 2 }),
  ]);
  equal(status.label, "1 of 2 tasks done", "label");
  equal(status.summary.requiredCount, 5, "summary.requiredCount");
  equal(status.summary.outstandingRequiredCount, 2, "summary.outstandingRequiredCount");
  equal(status.summary.waitingCount, 1, "summary.waitingCount");
  equal(status.summary.missingCount, 1, "summary.missingCount");
});

check("a missing active child task is exposed as an unfilled team", () => {
  const status = mobilizationStatusFor(mobilization(), []);
  equal(status.steps[0].taskId, null, "steps[0].taskId");
  equal(status.summary.missingCount, 3, "summary.missingCount");
  equal(status.tone, "warning", "tone");
});

check("standing down the mobilization preserves independently running task counts", () => {
  const status = mobilizationStatusFor(mobilization({ status: "stood_down" }), [task({ status: "accepted" })]);
  equal(status.label, "Stood down", "label");
  equal(status.steps[0].taskStatus, "accepted", "steps[0].taskStatus");
  equal(status.summary.confirmedCount, 1, "summary.confirmedCount");
  equal(status.summary.missingCount, 2, "summary.missingCount");
});

check("same-team action status matches stable step keys, not the first task on that team", () => {
  const status = mobilizationStatusFor(mobilization({
    steps: [
      { ...step("first-aid", 2), stepKey: "water-assessment" },
      { ...step("first-aid", 1), stepKey: "stage-assessment" },
    ],
  }), [
    task({ id: "water-task", mobilizationStepKey: "water-assessment", requiredCount: 2, status: "resolved", resolution: "done" }),
    task({ id: "stage-task", mobilizationStepKey: "stage-assessment", requiredCount: 1, status: "assigned" }),
  ]);
  equal(status.steps[0].taskId, "water-task", "water task identity");
  equal(status.steps[1].taskId, "stage-task", "stage task identity");
  equal(status.steps[0].terminal, true, "water terminal state");
  equal(status.steps[1].waitingCount, 1, "stage invitation state");
  equal(status.summary.completedTasks, 1, "completed action count");
  equal(status.summary.outstandingRequiredCount, 1, "outstanding action demand");
  equal(status.label, "1 of 2 tasks done", "action progress label");
});

console.log(failures ? `\n${failures} failed` : "\nMobilization presentation rules passed.");
process.exit(failures ? 1 : 0);
