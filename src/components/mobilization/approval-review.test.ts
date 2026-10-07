import { describe, expect, it } from "vitest";

import type { ManagedPlaybook, MobilizationOutput, PlanningSnapshot, SimulationRunResult } from "@/lib/mobilization-contracts";
import type { Mobilization, Task, Volunteer } from "@/lib/schema";
import { approvalAllowed, approvalCrewPreview, reviewApprovalAnalysis } from "./approval-review";

const ref = (actionId: string) => ({ slug: "heat", version: 1, actionId });
function fixture() {
  const book: ManagedPlaybook = {
    id: "book", version: 1, status: "published", createdAt: "at", updatedAt: "at", publishedAt: "at",
    content: { schemaVersion: 1, slug: "heat", title: "Heat response", appliesWhen: "Event heat threshold",
      requiredInputs: [], decisionPoints: [], constraints: [], source: "Unit fixture",
      actions: ["triage", "cooling"].map((id) => ({ id, requirement: "must", teamSlug: "first-aid",
        title: id, instructions: `Complete all ${id} instructions`, peopleNeeded: 1, staffingGuidance: "",
        requiredSkills: [], locationGuidance: "", completionCriteria: "" })) },
  };
  const task = (key: string, actionId?: string) => ({ key, title: key, instructions: key,
    teamSlug: "first-aid" as const, zoneSlug: "water-2", peopleNeeded: 1, reason: key,
    requiredSkills: ["first-aid-cert"], completionCriteria: "Recorded", addressesFindingIds: ["risk"],
    evidenceRefs: ["fact"], playbookRefs: actionId ? [ref(actionId)] : [] });
  const output: MobilizationOutput = { decision: "propose", assessment: { summary: "Heat risk", severity: "urgent",
    findings: [], missingInputs: ["Event heat threshold"], playbookAssessments: [{ slug: "heat", version: 1,
      applicability: "insufficient_data", reason: "Threshold unknown", evidenceRefs: ["fact"], missingInputs: ["Clinical status"] }] },
    mobilizations: [{ title: "Clinical response", priority: "P1", rationale: "Reported symptoms",
      tasks: [task("triage-task", "triage"), task("partial-support")],
      unmetRequirements: [{ playbookRef: ref("cooling"), reason: "Approved cooling location is unknown" }] }] };
  const mobilization: Mobilization = { id: "mob", title: "Clinical response", status: "proposed", urgency: "P1",
    rationale: "Reported symptoms", relatedPlaybooks: ["heat"], zoneSlug: "water-2", evidence: null,
    analysisRunId: "run", playbookSlug: null, createdAt: 1, decidedById: null, decidedAt: null,
    steps: output.mobilizations[0].tasks.map((task) => ({ ...task, stepKey: task.key, candidates: [] })) };
  const run: SimulationRunResult = { runId: "run", status: "completed", decision: "propose", output,
    mobilizationIds: ["mob"], validationErrors: [], error: null,
    snapshot: { playbooks: [book] } as PlanningSnapshot,
    promptVersion: "test", model: "test", createdAt: "at" };
  return { mobilization, run, output, task };
}
function volunteer(id: string, patch: Partial<Volunteer> = {}): Volunteer {
  return { id, name: "Test crew", role: "volunteer", teamSlug: "first-aid", skills: ["first-aid-cert"],
    languages: [], zoneSlug: "water-2", duty: "on_duty", shiftEndsAt: null, phone: null, ...patch };
}
const suggestion = (volunteerId: string) => ({ volunteerId, rationale: "Suggested", distanceM: 1 });

describe("Mo approval analysis review", () => {
  it("blocks linked plans until the matching validated analysis is available", () => {
    const { mobilization, run } = fixture();
    expect(reviewApprovalAnalysis(mobilization, null).ready).toBe(false);
    for (const patch of [{ runId: "other" }, { status: "running" }, { status: "failed" },
      { output: null }, { snapshot: null }, { validationErrors: ["invalid"] }, { mobilizationIds: ["other"] },
      { mobilizationIds: ["mob", "mob"] }])
      expect(reviewApprovalAnalysis(mobilization, { ...run, ...patch } as SimulationRunResult).ready).toBe(false);
    expect(reviewApprovalAnalysis(mobilization, run).ready).toBe(true);
  });

  it("matches saved IDs and step identity rather than proposal titles", () => {
    const { mobilization, run } = fixture();
    expect(reviewApprovalAnalysis({ ...mobilization, title: "Changed display name" }, run).ready).toBe(true);
    for (const patch of [{ stepKey: "other" }, { teamSlug: "crowd" }, { zoneSlug: "other" }, { peopleNeeded: 2 },
      { instructions: "Changed scope" }, { reason: "Different cause" }, { title: "Different task" },
      { completionCriteria: "Only draft" }, { requiredSkills: [] }, { evidenceRefs: ["other"] },
      { addressesFindingIds: ["other"] }, { playbookRefs: [] }]) {
      const changed = structuredClone(mobilization);
      Object.assign(changed.steps[0], patch);
      expect(reviewApprovalAnalysis(changed, run).ready).toBe(false);
    }
  });

  it("accepts identical saved action references regardless of JSON object property order", () => {
    const { mobilization, run } = fixture();
    mobilization.steps[0].playbookRefs = [{ actionId: "triage", version: 1, slug: "heat" }];
    expect(reviewApprovalAnalysis(mobilization, run).ready).toBe(true);
  });

  it("preserves full versus partial/unmet distinctions and exposes relevant unknowns", () => {
    const { mobilization, run } = fixture();
    const review = reviewApprovalAnalysis(mobilization, run);
    expect(review.requiredActions.map((row) => ({ id: row.ref.actionId, full: row.plannedBy.length, unmet: row.unmet.length })))
      .toEqual([{ id: "triage", full: 1, unmet: 0 }, { id: "cooling", full: 0, unmet: 1 }]);
    expect(review.requiredActions[1].unmet[0].reason).toBe("Approved cooling location is unknown");
    expect(review.missingInputs).toEqual(["Event heat threshold", "Clinical status"]);
    expect(run.output!.mobilizations[0].tasks[1].playbookRefs).toEqual([]);
  });

  it("labels sibling-plan coverage without implying that this approval activates it", () => {
    const { mobilization, run, task } = fixture();
    run.output!.mobilizations[0].unmetRequirements = [];
    run.output!.mobilizations.push({ title: "Cooling support", priority: "P1", rationale: "Unknown location",
      tasks: [task("cooling-a"), task("cooling-b")],
      unmetRequirements: [{ playbookRef: ref("cooling"), reason: "Location unverified" }] });
    run.mobilizationIds.push("sibling");
    const review = reviewApprovalAnalysis(mobilization, run);
    expect(review.ready).toBe(true);
    expect(review.siblingCount).toBe(1);
    expect(review.requiredActions[1].unmet[0]).toEqual({ title: "Cooling support", current: false, reason: "Location unverified" });
  });

  it("fails closed on absent source versions, unaccounted musts or covered-and-unmet conflicts", () => {
    for (const kind of ["source", "missing", "conflict"]) {
      const { mobilization, run } = fixture();
      if (kind === "source") run.snapshot!.playbooks = [];
      if (kind === "missing") run.output!.mobilizations[0].unmetRequirements = [];
      if (kind === "conflict") run.output!.mobilizations[0].unmetRequirements.push({ playbookRef: ref("triage"), reason: "Conflicting" });
      expect(reviewApprovalAnalysis(mobilization, run).ready).toBe(false);
    }
  });

  it("does not require nonexistent AI analysis for manual or legacy plans", () => {
    expect(reviewApprovalAnalysis({ ...fixture().mobilization, analysisRunId: null }, null).ready).toBe(true);
  });
});

describe("approval preview and explicit acknowledgement", () => {
  it("requires acknowledgement for gaps and never allows approval while loading or busy", () => {
    expect(approvalAllowed({ analysisReady: false, hasGaps: false, acknowledged: true, busy: false })).toBe(false);
    expect(approvalAllowed({ analysisReady: true, hasGaps: true, acknowledged: false, busy: false })).toBe(false);
    expect(approvalAllowed({ analysisReady: true, hasGaps: true, acknowledged: true, busy: false })).toBe(true);
    expect(approvalAllowed({ analysisReady: true, hasGaps: false, acknowledged: false, busy: false })).toBe(true);
    expect(approvalAllowed({ analysisReady: true, hasGaps: false, acknowledged: true, busy: true })).toBe(false);
  });

  it("counts each currently eligible suggestion once and keeps deficits visible", () => {
    const { mobilization } = fixture();
    mobilization.steps[0].candidates = [suggestion("valid"), suggestion("extra")];
    mobilization.steps[1].candidates = [suggestion("valid"), suggestion("extra")];
    expect(approvalCrewPreview(mobilization, { valid: volunteer("valid"), extra: volunteer("extra") }, [], 100))
      .toMatchObject({ required: 2, eligible: 2, gap: 0 });
    mobilization.steps[1].candidates = [suggestion("valid")];
    expect(approvalCrewPreview(mobilization, { valid: volunteer("valid") }, [], 100))
      .toMatchObject({ required: 2, eligible: 1, gap: 1 });
  });

  it("excludes busy, absent, wrong-team, unqualified, on-break, ended-shift and non-volunteer suggestions", () => {
    const { mobilization } = fixture();
    const people = {
      busy: volunteer("busy"), wrong: volunteer("wrong", { teamSlug: "crowd" }),
      skill: volunteer("skill", { skills: [] }), break: volunteer("break", { duty: "on_break" }),
      ended: volunteer("ended", { shiftEndsAt: 100 }), lead: volunteer("lead", { role: "team_lead" }),
    };
    mobilization.steps[0].candidates = [...Object.keys(people), "absent"].map(suggestion);
    const busyTask = { status: "accepted", assigneeId: "busy", helpers: [] } as unknown as Task;
    expect(approvalCrewPreview(mobilization, people, [busyTask], 100))
      .toMatchObject({ required: 2, eligible: 0, gap: 2 });
  });
});
