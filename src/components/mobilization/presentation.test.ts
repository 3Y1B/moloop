import { describe, expect, it } from "vitest";

import type { Mobilization, MobilizationStep, Task, Volunteer } from "@/lib/schema";
import { mobilizationStatusFor } from "@/lib/status";
import { canViewMobilization, crewReplyLabel, detailStep, operationalDetails, taskForStep, taskProgressLabel } from "./presentation";

const NOW = 1_800_000_000_000;
const person = (overrides: Partial<Volunteer> = {}): Volunteer => ({
  id: "crew", name: "Test crew", role: "volunteer", teamSlug: "first-aid", skills: [], languages: ["en"],
  zoneSlug: "water-2", duty: "on_duty", shiftEndsAt: null, phone: null, ...overrides,
});
const step = (overrides: Partial<MobilizationStep> = {}): MobilizationStep => ({
  stepKey: "assessment", title: "Assess reported symptoms", teamSlug: "first-aid", zoneSlug: "water-2",
  peopleNeeded: 2, reason: "Reported symptoms need assessment", candidates: [],
  instructions: "Assess the people reporting symptoms", completionCriteria: "Clinical assessment recorded",
  requiredSkills: ["first-aid-cert"], ...overrides,
});
const plan = (overrides: Partial<Mobilization> = {}): Mobilization => ({
  id: "mobilization", title: "Heat response", status: "active", rationale: "Reported local heat concerns",
  urgency: "P1", zoneSlug: "water-2", steps: [step(), step({ stepKey: "cooling", title: "Arrange cooling" }),
    step({ stepKey: "water-queue", title: "Manage the water queue", teamSlug: "crowd", zoneSlug: "oval-stage" })],
  relatedPlaybooks: [], evidence: null, playbookSlug: null, createdAt: NOW,
  decidedAt: NOW, decidedById: "mo", ...overrides,
});
const task = (overrides: Partial<Task> = {}): Task => ({
  id: "assessment-task", title: "Live clinical assessment", summary: "Check and record current symptoms",
  category: "medical", priority: "P1", teamSlug: "first-aid", zoneSlug: "water-2", locationHint: null,
  status: "assigned", assigneeId: "crew", reporter: { kind: "system", quote: "Heat response", language: "en" },
  handledBy: "ai", createdAt: NOW, assignedAt: NOW, etaAt: null, lastActivityAt: NOW,
  nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null,
  requiredCount: 2, helpers: [], resolution: null, requestId: null, mobilizationId: "mobilization",
  mobilizationStepKey: "assessment", requiredSkills: ["first-aid-cert"], ...overrides,
});
const mo = person({ role: "coordinator", teamSlug: null });
const lead = person({ role: "team_lead" });

describe("mobilization presentation access", () => {
  it.each(["proposed", "active", "rejected", "stood_down", "cancelled"] as const)("allows Mo to view %s plans", (status) => {
    expect(canViewMobilization(plan({ status }), mo)).toBe(true);
  });
  it("allows a participating team lead after approval, but not another team or a volunteer", () => {
    expect(canViewMobilization(plan(), lead)).toBe(true);
    expect(canViewMobilization(plan(), person({ role: "team_lead", teamSlug: "crowd" }))).toBe(true);
    expect(canViewMobilization(plan(), person({ role: "team_lead", teamSlug: "security" }))).toBe(false);
    expect(canViewMobilization(plan(), person())).toBe(false);
    expect(canViewMobilization(plan(), undefined)).toBe(false);
  });
  it("does not let a participating lead open a pending proposal", () => {
    const pending = plan({ status: "proposed", decidedAt: null, decidedById: null });
    expect(canViewMobilization(pending, lead)).toBe(false);
    expect(detailStep(pending, "0", lead)).toBeUndefined();
    expect(detailStep(pending, "0", mo)).toBe(pending.steps[0]);
  });
  it("lets a lead open only their own team's directly linked task detail", () => {
    const response = plan();
    expect(detailStep(response, "0", lead)).toBe(response.steps[0]);
    expect(detailStep(response, "1", lead)).toBe(response.steps[1]);
    expect(detailStep(response, "2", lead)).toBeUndefined();
    expect(detailStep(response, "2", mo)).toBe(response.steps[2]);
    expect(detailStep(response, "0", person())).toBeUndefined();
  });
  it.each([undefined, "", "-1", "1.5", "abc", "1e0", "Infinity", " 0 ", "3", "999999999999999999999"])(
    "rejects invalid or out-of-range detail indexes: %s", (index) => {
      expect(detailStep(plan(), index, mo)).toBeUndefined();
    },
  );
});

describe("mobilization task identity", () => {
  it("links separate actions for the same team by stable action key, not by team or array order", () => {
    const response = plan();
    const assessment = task();
    const cooling = task({ id: "cooling-task", mobilizationStepKey: "cooling" });
    const unrelated = task({ id: "other-plan-task", mobilizationId: "other-plan" });
    const sameTeamWithoutKey = task({ id: "legacy-task", mobilizationStepKey: null });
    const tasks = [unrelated, sameTeamWithoutKey, cooling, assessment];
    expect(taskForStep(response, response.steps[0], tasks)).toBe(assessment);
    expect(taskForStep(response, response.steps[1], tasks)).toBe(cooling);
    expect(taskForStep(response, response.steps[2], tasks)).toBeUndefined();
  });
  it("does not fall back to a different action on the same team when a stable key is missing", () => {
    const response = plan();
    expect(taskForStep(response, response.steps[0], [task({ mobilizationStepKey: "cooling" })])).toBeUndefined();
  });
  it("never displays an existing task as dispatched for a still-proposed plan", () => {
    const response = plan({ status: "proposed" });
    expect(taskForStep(response, response.steps[0], [task()])).toBeUndefined();
  });
  it("supports legacy steps without a stable key, scoped to their own mobilization", () => {
    const legacyStep = step({ stepKey: undefined });
    const correct = task({ mobilizationStepKey: null });
    expect(taskForStep(plan({ steps: [legacyStep] }), legacyStep, [task({ mobilizationId: "other" }), correct]))
      .toBe(correct);
  });
});

describe("operational task details", () => {
  it("uses actual title, team, location, staffing, skills and instructions after approval", () => {
    const actual = task({ title: "Revised assessment at the gate", teamSlug: "welfare", zoneSlug: "north-gate",
      requiredCount: 3, requiredSkills: ["radio-trained"],
      summary: "Check the three reported cases at the gate\n\nDone when: Record each assessment and escalation" });
    expect(operationalDetails(plan(), step(), actual)).toEqual({
      title: "Revised assessment at the gate", teamSlug: "welfare", zoneSlug: "north-gate", peopleNeeded: 3,
      instructions: "Check the three reported cases at the gate",
      completionCriteria: "Record each assessment and escalation", requiredSkills: ["radio-trained"],
    });
  });
  it("preserves multiline actual completion conditions without showing the internal Done when marker", () => {
    const actual = task({ summary: "Verify access first\n\nDONE WHEN: Confirm access\nRecord the verification" });
    expect(operationalDetails(plan(), step(), actual)).toMatchObject({ instructions: "Verify access first",
      completionCriteria: "Confirm access\nRecord the verification" });
  });
  it("does not restore saved draft skills or completion criteria when the actual task has none", () => {
    const actual = task({ summary: "Updated operational instructions", requiredSkills: [] });
    expect(operationalDetails(plan(), step(), actual)).toMatchObject({
      instructions: "Updated operational instructions", completionCriteria: undefined, requiredSkills: [],
    });
  });
  it("does not mistake a Done when phrase within an instruction for a separate completion block", () => {
    const actual = task({ summary: "Ask the lead to clarify Done when: do not improvise a clinical diagnosis" });
    expect(operationalDetails(plan(), step(), actual)).toMatchObject({
      instructions: actual.summary, completionCriteria: undefined,
    });
  });
  it("shows proposed operational details only when there is no materialized task", () => {
    const draft = step();
    expect(operationalDetails(plan({ status: "proposed" }), draft)).toEqual({
      title: draft.title, teamSlug: draft.teamSlug, zoneSlug: draft.zoneSlug, peopleNeeded: draft.peopleNeeded,
      instructions: draft.instructions, completionCriteria: draft.completionCriteria, requiredSkills: draft.requiredSkills,
    });
  });
  it("has neutral operational fallbacks without using internal action keys as titles", () => {
    const draft = step({ title: undefined, zoneSlug: undefined, requiredSkills: undefined });
    expect(operationalDetails(plan({ zoneSlug: "food-alley" }), draft)).toMatchObject({
      title: "Team task", zoneSlug: "food-alley", requiredSkills: [],
    });
  });
  it("preserves the operational brief used by older manual plans without introducing an AI staffing rationale", () => {
    const legacy = step({ instructions: undefined, reason: "Check the water supply and tell Mo the result" });
    expect(operationalDetails(plan({ analysisRunId: null }), legacy).instructions).toBe(legacy.reason);
    expect(operationalDetails(plan({ analysisRunId: "saved-analysis" }), legacy).instructions).toBeUndefined();
  });
});

describe("task progress without fake staffing", () => {
  it.each(["active", "rejected", "cancelled", "stood_down"] as const)("does not display zero unfilled places for an uncreated task in a %s plan", (status) => {
    const response = plan({ status });
    const progress = mobilizationStatusFor(response, []).steps[0];
    expect(taskProgressLabel(response, undefined, progress)).toMatch(/not created|not yet created/i);
    expect(taskProgressLabel(response, undefined, progress)).not.toMatch(/0 unfilled|accepted|awaiting reply/);
  });
  it("keeps accepted and waiting people separate for a real task", () => {
    const response = plan();
    const actual = task();
    expect(taskProgressLabel(response, actual, mobilizationStatusFor(response, [actual]).steps[0]))
      .toBe("0 accepted · 1 awaiting reply · 1 unfilled");
  });
  it.each(["resolved", "cancelled"] as const)("describes the whole %s task without claiming any person's completion", (status) => {
    const actual = task({ status });
    expect(taskProgressLabel(plan(), actual)).toBe(status === "resolved" ? "Task reported complete" : "Task closed");
  });
});

describe("crew reply presentation", () => {
  it.each(["resolved", "cancelled"] as const)("does not claim an unaccepted helper personally completed a %s task", (status) => {
    const ended = task({ status, helpers: [{ volunteerId: "helper", status: "notified", assignedAt: NOW, respondedAt: null }] });
    const label = crewReplyLabel(ended, false);
    expect(label).toBe("Invitation was not accepted before the task ended");
    expect(label).not.toMatch(/completed|confirmed|ready|done/i);
  });
  it.each(["resolved", "cancelled"] as const)("only reports the accepted helper's reply history for %s tasks", (status) => {
    expect(crewReplyLabel(task({ status }), true)).toBe("Accepted before the task ended");
  });
  it.each(["resolved", "cancelled"] as const)("does not infer owner acceptance from the %s terminal status", (status) => {
    for (const accepted of [false, true])
      expect(crewReplyLabel(task({ status }), accepted, true)).toBe("Assigned before the task ended");
  });
  it("distinguishes live reply acceptance, waiting and a queued owner", () => {
    expect(crewReplyLabel(task({ status: "accepted" }), false)).toBe("Awaiting reply");
    expect(crewReplyLabel(task({ status: "accepted" }), true)).toBe("Accepted");
    expect(crewReplyLabel(task({ status: "assigned" }), false, true)).toBe("Awaiting reply");
    expect(crewReplyLabel(task({ status: "accepted" }), true, true)).toBe("Accepted");
    expect(crewReplyLabel(task({ status: "queued" }), false, true)).toBe("Queued for this task");
  });
});
