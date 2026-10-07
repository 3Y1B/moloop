/** Pure regression checks for proposal approval and action staffing; never touches the server/DB. */
import { Batch, CommandError, type World } from "../src/lib/batch";
import * as C from "../src/lib/commands";
import type { MobilizationStep, Task, Volunteer } from "../src/lib/schema";

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}
function ok(value: unknown, label: string) { if (!value) throw new Error(label); }
function rejects(action: () => unknown, label: string) {
  try { action(); } catch (error) { if (error instanceof CommandError) return; throw error; }
  throw new Error(label);
}
function check(label: string, action: () => void) { action(); console.log(`ok   ${label}`); }

const at = Date.parse("2026-10-07T04:00:00Z");
const person = (id: string, over: Partial<Volunteer> = {}): Volunteer => ({
  id, name: id, role: "volunteer", teamSlug: "first-aid", skills: ["first-aid-cert"],
  languages: ["en"], zoneSlug: "water-2", duty: "on_duty", shiftEndsAt: null, phone: null, ...over,
});
const existingTask = (over: Partial<Task> = {}): Task => ({
  id: "busy-task", title: "Existing incident", summary: "Existing work", category: "heat", priority: "P2",
  teamSlug: "first-aid", zoneSlug: "water-2", locationHint: null, status: "accepted", assigneeId: "preview-busy",
  reporter: { kind: "staff", quote: "Existing incident", language: "en" }, handledBy: "human",
  createdAt: at - 5000, assignedAt: at - 5000, etaAt: null, lastActivityAt: at - 5000,
  nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null,
  requiredCount: 1, helpers: [], resolution: null, requestId: null, mobilizationId: null, ...over,
});
function batch() {
  let nextId = 0;
  const volunteers = [person("mo", { role: "coordinator", teamSlug: null }),
    person("lead", { role: "team_lead" }), person("eligible-a"), person("eligible-b"),
    person("preview-busy"), person("wrong-team", { teamSlug: "ops" }),
    person("unqualified", { skills: [] }), person("off-duty", { duty: "off_shift" })];
  const world: World = {
    volunteers: Object.fromEntries(volunteers.map((volunteer) => [volunteer.id, volunteer])),
    tasks: { "busy-task": existingTask() }, proposals: {}, requests: {}, mobilizations: {},
    teams: { "first-aid": { name: "First Aid" }, ops: { name: "Operations" } },
  };
  return new Batch(world, { now: at, id: (kind) => `${kind}-${++nextId}` });
}
const actions: MobilizationStep[] = [
  { stepKey: "assess-water", teamSlug: "first-aid", peopleNeeded: 2, reason: "Assess heat symptoms",
    title: "Assess people at Water 2", instructions: "Assess and cool people at Water 2", zoneSlug: "water-2",
    requiredSkills: ["first-aid-cert"], completionCriteria: "People assessed and escalation documented",
    candidates: [{ volunteerId: "preview-busy", rationale: "Previously free", distanceM: 0 }] },
  { stepKey: "assess-stage", teamSlug: "first-aid", peopleNeeded: 1, reason: "Provide an assessment point",
    title: "Create a stage assessment point", instructions: "Set up an assessment point near the stage", zoneSlug: "lawn-stage",
    requiredSkills: ["first-aid-cert"], completionCriteria: "Assessment point staffed and radio contact confirmed",
    candidates: [] },
];
const propose = (b: Batch, title = "Heat coordination") => C.proposeMobilization(b, {
  title, rationale: "Related heat observations need coordinated work", urgency: "P2", zoneSlug: "water-2",
  relatedPlaybooks: [], analysisRunId: "analysis-run", steps: actions,
});

check("proposing and rejecting never create a task or reserve crew", () => {
  const b = batch();
  const proposal = propose(b);
  equal(proposal.status, "proposed", "proposal state");
  equal(b.dirty.tasks.size, 0, "dirty task count before approval");
  equal(Object.keys(b.tasks).length, 1, "only original task exists");
  rejects(() => C.approveMobilization(b, "lead", proposal.id), "Team lead approved venue response");
  C.rejectMobilization(b, "mo", proposal.id);
  equal(b.dirty.tasks.size, 0, "dirty task count after rejection");
});

check("approval creates distinct same-team action tasks with their own locations and keys", () => {
  const b = batch();
  const proposal = propose(b);
  const approved = C.approveMobilization(b, "mo", proposal.id);
  equal(approved.taskIds.length, 2, "action count");
  const first = b.tasks[approved.taskIds[0]];
  const second = b.tasks[approved.taskIds[1]];
  equal(first.mobilizationStepKey, "assess-water", "first key");
  equal(second.mobilizationStepKey, "assess-stage", "second key");
  equal(first.zoneSlug, "water-2", "first zone");
  equal(second.zoneSlug, "lawn-stage", "second zone");
  equal(first.title, actions[0].title, "action title");
  ok(first.summary.includes(actions[0].instructions!), "Concrete instructions were lost");
  ok(first.summary.includes(actions[0].completionCriteria!), "Completion criteria were lost");
  ok(first.requiredSkills?.includes("first-aid-cert"), "Required skills were lost");
  equal(first.requiredCount, 2, "first demand");
  equal(second.requiredCount, 1, "second demand");
  equal(second.status, "open", "understaffed task remains open");
  equal(second.assigneeId, null, "understaffed task has no fabricated owner");
  rejects(() => C.approveMobilization(b, "mo", proposal.id), "Second approval duplicated tasks");
});

check("stale previews do not book busy crew, and distinct actions never reuse the same person", () => {
  const b = batch();
  const approved = C.approveMobilization(b, "mo", propose(b).id);
  const crew = approved.taskIds.flatMap((id) => {
    const task = b.tasks[id];
    return [task.assigneeId, ...task.helpers.map((helper) => helper.volunteerId)].filter(Boolean);
  });
  equal(new Set(crew).size, crew.length, "distinct roster reservations");
  ok(!crew.includes("preview-busy"), "Stale busy candidate was assigned");
  ok(crew.every((id) => id === "eligible-a" || id === "eligible-b"), "Ineligible crew was recruited");
  ok(b.events.some((event) => event.text.includes("no longer free")), "Preview substitution was not recorded");
});

check("manual assignment and backup cannot bypass staffing skill/team requirements", () => {
  const b = batch();
  const approved = C.approveMobilization(b, "mo", propose(b).id);
  const task = b.tasks[approved.taskIds[0]];
  for (const id of ["unqualified", "wrong-team", "off-duty", "preview-busy"])
    rejects(() => C.assign(b, "mo", task.id, id), `Unsafe manual assignment to ${id}`);
  b.task({ ...task, status: "escalated", escalation: { at, reason: "Need help", level: "coordinator", ownerId: "mo", bumpedAt: at, response: null } });
  for (const id of ["unqualified", "wrong-team", "off-duty", "preview-busy"])
    rejects(() => C.respond(b, "mo", task.id, { kind: "backup", volunteerId: id }), `Unsafe backup to ${id}`);
});

check("distinct same-zone plans in one AI run do not collapse into one mobilization", () => {
  const b = batch();
  const first = propose(b, "Heat assessment");
  const second = propose(b, "Separate preparation");
  ok(first.id !== second.id, "Distinct plans collapsed");
  equal(propose(b, "Heat assessment").id, first.id, "identical same-run plan dedupes");
});
console.log("Mobilization command checks passed (pure state transitions only).");
