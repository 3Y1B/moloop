/// <reference types="node" />
import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";
import { describe, expect, it } from "vitest";

import {
  PlaybookContentSchema,
  type MobilizationOutput,
  type PlanningSnapshot,
  type PlaybookContent,
} from "./mobilization-contracts";
import {
  DEMO_STAFFING_FACTOR,
  DEMO_STAFFING_REVISION_NOTE,
  DEMO_UNSPECIFIED_CREW,
  additionalDemoStaffingRevisionNote,
  reviseDemoStaffing,
  type DemoStaffingRevisionOptions,
} from "./playbook-staffing";
import { validateMobilizationOutput } from "../server/predict/validate";

function fixture(): PlaybookContent {
  return {
    schemaVersion: 1,
    slug: "staffing-test",
    title: "Staffing test SOP",
    appliesWhen: "Only for this offline staffing test.",
    requiredInputs: [],
    decisionPoints: [{ id: "review", owner: "mo", question: "Should this test response be approved?" }],
    constraints: [{ id: "no-dispatch", instruction: "Do not dispatch without Mo approval." }],
    actions: [{
      id: "assessment",
      requirement: "must",
      teamSlug: "first-aid",
      title: "Assess reported symptoms",
      instructions: " Assess safely; record uncertainty; do not enter any hazard zone. ",
      peopleNeeded: 2,
      staffingGuidance: "Use responders with the existing qualification requirements.",
      requiredSkills: ["first-aid-cert"],
      locationGuidance: "Use the approved safe assessment area.",
      completionCriteria: "Record findings and report unresolved gaps to Mo.",
    }],
    source: "User-provided SOP; sha256:original-source-digest",
  };
}

function sourceBooks(): PlaybookContent[] {
  return parseAllDocuments(readFileSync("supabase/playbooks/festival-emergency.yaml", "utf8"))
    .map((document) => PlaybookContentSchema.parse({
      ...document.toJSON(),
      source: "User-provided festival_emergency_playbooks.yaml; sha256:original-source-digest",
    }));
}

describe("one-off 300-volunteer demo playbook staffing revision", () => {
  it("sets all 80 actions across the 10 imported SOPs to six people", () => {
    const books = sourceBooks();
    expect(books).toHaveLength(10);
    expect(books.flatMap((book) => book.actions)).toHaveLength(80);
    expect(books.flatMap((book) => book.actions).filter((action) => action.peopleNeeded === null)).toHaveLength(70);
    expect(books.flatMap((book) => book.actions).filter((action) => action.peopleNeeded === 2)).toHaveLength(10);
    for (const book of books) {
      const result = reviseDemoStaffing(book);
      expect(result.alreadyApplied).toBe(false);
      expect(result.changes).toHaveLength(book.actions.length);
      expect(result.content.actions.every((action) => action.peopleNeeded === 6)).toBe(true);
      expect(result.content.actions.reduce((sum, action) => sum + action.peopleNeeded!, 0)).toBe(48);
      expect(PlaybookContentSchema.safeParse(result.content).success).toBe(true);
    }
  });

  it("uses the announced fixed factor and unspecified baseline rather than an availability cap", () => {
    expect(DEMO_STAFFING_FACTOR).toBe(3);
    expect(DEMO_UNSPECIFIED_CREW).toBe(6);
    const book = fixture();
    book.actions.push({ ...book.actions[0], id: "support", peopleNeeded: null });
    book.actions.push({ ...book.actions[0], id: "larger-response", peopleNeeded: 12 });
    expect(reviseDemoStaffing(book).changes).toEqual([
      { actionId: "assessment", title: book.actions[0].title, before: 2, after: 6 },
      { actionId: "support", title: book.actions[1].title, before: null, after: 6 },
      { actionId: "larger-response", title: book.actions[2].title, before: 12, after: 36 },
    ]);
  });

  it("preserves every original instruction, safety rule, decision, skill and unrelated field exactly", () => {
    const book = fixture();
    const before = structuredClone(book);
    const result = reviseDemoStaffing(book);
    expect(book).toEqual(before);
    const { actions: originalActions, source: originalSource, ...originalFields } = before;
    const { actions: revisedActions, source: revisedSource, ...revisedFields } = result.content;
    expect(revisedFields).toEqual(originalFields);
    for (const [index, action] of revisedActions.entries()) {
      const { peopleNeeded: _oldCount, staffingGuidance: originalGuidance, ...original } = originalActions[index];
      const { peopleNeeded: _newCount, staffingGuidance: revisedGuidance, ...revised } = action;
      expect(revised).toEqual(original);
      expect(revisedGuidance.startsWith(`${originalGuidance}\n\n`)).toBe(true);
    }
    expect(revisedSource).toBe(`${originalSource}\n\n${DEMO_STAFFING_REVISION_NOTE}`);
    expect(revisedSource).toContain("sha256:original-source-digest");
  });

  it("owns all returned nested data and never mutates the input", () => {
    const book = fixture();
    const before = structuredClone(book);
    const result = reviseDemoStaffing(book);
    result.content.actions[0].requiredSkills.push("new-skill");
    result.content.constraints[0].instruction = "changed";
    result.content.decisionPoints[0].question = "changed";
    expect(book).toEqual(before);
  });

  it("adds compact, explicit demo guidance without implying professional staffing certification", () => {
    const book = fixture();
    book.actions[0].staffingGuidance = "";
    const guidance = reviseDemoStaffing(book).content.actions[0].staffingGuidance;
    expect(guidance).toContain("300-volunteer DEMO planning baseline: 6 people");
    expect(guidance).toContain("related safe assessment/support work");
    expect(guidance).toContain("Scale up for workload");
    expect(guidance).toContain("qualified, on-duty crew only");
    expect(guidance).toContain("report shortages");
    expect(guidance).toContain("not a certified clinical or security staffing ratio");
    expect(guidance.split(/\s+/).length).toBeGreaterThanOrEqual(30);
    expect(guidance.split(/\s+/).length).toBeLessThanOrEqual(45);
    expect(guidance.startsWith("\n")).toBe(false);
  });

  it("is idempotent and preserves Mo's later custom counts and guidance", () => {
    const first = reviseDemoStaffing(fixture());
    const edited = structuredClone(first.content);
    edited.actions[0].peopleNeeded = 9;
    edited.actions[0].staffingGuidance = "Mo revised this task to nine qualified responders.";
    const repeated = reviseDemoStaffing(edited);
    expect(repeated).toEqual({ content: edited, alreadyApplied: true, changes: [] });
    repeated.content.actions[0].peopleNeeded = 18;
    expect(edited.actions[0].peopleNeeded).toBe(9);
  });

  it("does not mistake a vaguely similar source note for the exact applied marker", () => {
    const book = fixture();
    book.source += "\nA 300-volunteer demo was discussed, without changing staffing.";
    expect(reviseDemoStaffing(book).alreadyApplied).toBe(false);
    expect(reviseDemoStaffing(book).content.actions[0].peopleNeeded).toBe(6);
  });

  it("rejects quantities beyond the schema limit instead of silently clamping them", () => {
    const book = fixture();
    book.actions[0].peopleNeeded = 166;
    expect(reviseDemoStaffing(book).content.actions[0].peopleNeeded).toBe(498);
    book.actions[0].peopleNeeded = 167;
    const before = structuredClone(book);
    expect(() => reviseDemoStaffing(book)).toThrow("501 people");
    expect(book).toEqual(before);
  });

  it.each([0, -1, 1.5, 501, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid original quantity %s", (quantity) => {
    const book = fixture();
    book.actions[0].peopleNeeded = quantity;
    expect(() => reviseDemoStaffing(book)).toThrow();
    book.source += DEMO_STAFFING_REVISION_NOTE;
    expect(() => reviseDemoStaffing(book)).toThrow();
  });

  it("fails rather than truncating existing human guidance or provenance", () => {
    const tooMuchGuidance = fixture();
    tooMuchGuidance.actions[0].staffingGuidance = "x".repeat(1000);
    const beforeGuidance = structuredClone(tooMuchGuidance);
    expect(() => reviseDemoStaffing(tooMuchGuidance)).toThrow("staffing guidance would exceed 1000");
    expect(tooMuchGuidance).toEqual(beforeGuidance);
    const tooMuchSource = fixture();
    tooMuchSource.source = "x".repeat(1000);
    const beforeSource = structuredClone(tooMuchSource);
    expect(() => reviseDemoStaffing(tooMuchSource)).toThrow("Playbook source would exceed 1000");
    expect(tooMuchSource).toEqual(beforeSource);
  });

  it("uses the existing semantic validator to reject cited tasks below the newly published minimum", () => {
    const content = reviseDemoStaffing(fixture()).content;
    const at = "2026-10-08T04:00:00.000Z";
    const snapshot: PlanningSnapshot = {
      schemaVersion: 1, evaluatedAt: at,
      scenario: { requestId: "offline-staffing-test-001", weather: { temperatureC: 41, trendCPerHour: null,
        condition: "clear", warning: "heat", warningInMinutes: null },
      upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [] },
      zones: [{ slug: "water-2", name: "Water Station 2", kind: "water", capacity: null, isOpenAir: true }],
      teams: [{ slug: "first-aid", name: "First Aid", description: "Assessment" },
        { slug: "info", name: "Information", description: "Information" }],
      skills: [{ slug: "first-aid-cert", name: "First Aid Certificate" }],
      routes: [], roster: [], existingResponses: [],
      evidence: [{ ref: "recorded-weather", kind: "weather", zoneSlug: null, observedAt: at,
        source: "database", value: { temperatureC: 41 } }],
      playbooks: [{ id: "offline-book", version: 2, status: "published", content,
        createdAt: at, updatedAt: at, publishedAt: at }],
    };
    const task = {
      key: "assess", title: "Assess reported symptoms", instructions: "Assess from a confirmed safe location.",
      teamSlug: "first-aid" as const, zoneSlug: "water-2", peopleNeeded: 6,
      reason: "Provide six qualified assessment positions", requiredSkills: ["first-aid-cert"],
      completionCriteria: "Report patient status to Mo.", addressesFindingIds: ["heat"],
      evidenceRefs: ["recorded-weather"], playbookRefs: [{ slug: content.slug, version: 2, actionId: "assessment" }],
    };
    const output: MobilizationOutput = {
      decision: "propose",
      assessment: { summary: "Assess potential heat illness", severity: "urgent", missingInputs: [],
        findings: [{ id: "heat", risk: "Potential heat illness", possibleCause: "Heat exposure may contribute",
          uncertainty: "Clinical findings remain unknown", evidenceRefs: ["recorded-weather"] }],
        playbookAssessments: [{ slug: content.slug, version: 2, applicability: "applicable",
          reason: "Offline validator fixture", evidenceRefs: ["recorded-weather"], missingInputs: [] }] },
      mobilizations: [{ title: "Heat assessment", priority: "P1", rationale: "Assessment and patron guidance",
        tasks: [task, { ...task, key: "inform", title: "Inform patrons", instructions: "Share Mo-approved guidance.",
          teamSlug: "info", requiredSkills: [], playbookRefs: [] }], unmetRequirements: [] }],
    };
    expect(validateMobilizationOutput(output, snapshot, ["first-aid-cert"])).toEqual([]);
    output.mobilizations[0].tasks[0].peopleNeeded = 5;
    expect(validateMobilizationOutput(output, snapshot, ["first-aid-cert"]))
      .toContain("Task assess understates playbook staffing staffing-test:2:assessment");
  });
});

const additionalOptions = (factor: 2 | 3): DemoStaffingRevisionOptions => ({
  factor,
  unspecifiedCrew: factor === 2 ? 12 : 18,
  revisionNote: additionalDemoStaffingRevisionNote(factor),
});

describe("intentional additional demo staffing revision", () => {
  it.each([2, 3] as const)("increases all 80 six-person actions by factor %s without contradictory generated guidance", (factor) => {
    for (const book of sourceBooks()) {
      const first = reviseDemoStaffing(book).content;
      const before = structuredClone(first);
      const result = reviseDemoStaffing(first, additionalOptions(factor));
      expect(result.alreadyApplied).toBe(false);
      expect(result.changes).toHaveLength(8);
      expect(result.changes.every((change) => change.before === 6 && change.after === 6 * factor)).toBe(true);
      expect(result.content.actions.every((action) => action.peopleNeeded === 6 * factor)).toBe(true);
      expect(result.content.actions.reduce((sum, action) => sum + action.peopleNeeded!, 0)).toBe(48 * factor);
      for (const action of result.content.actions) {
        expect(action.staffingGuidance).toContain(`DEMO planning baseline: ${6 * factor} people`);
        expect(action.staffingGuidance).not.toContain("DEMO planning baseline: 6 people");
        expect(action.staffingGuidance.match(/DEMO planning baseline:/g)).toHaveLength(1);
      }
      expect(result.content.source).toBe(`${first.source}\n\n${additionalDemoStaffingRevisionNote(factor)}`);
      expect(result.content.source).toContain(DEMO_STAFFING_REVISION_NOTE);
      expect(result.content.source).toContain("sha256:original-source-digest");
      expect(first).toEqual(before);
      expect(PlaybookContentSchema.safeParse(result.content).success).toBe(true);
    }
  });

  it.each([2, 3] as const)("uses the factor %s baseline for newly unspecified tasks", (factor) => {
    const book = fixture();
    book.actions[0].peopleNeeded = null;
    const result = reviseDemoStaffing(book, additionalOptions(factor));
    expect(result.changes[0]).toMatchObject({ before: null, after: factor === 2 ? 12 : 18 });
  });

  it.each([2, 3] as const)("reruns factor %s without multiplying again and preserves Mo's subsequent edits", (factor) => {
    const first = reviseDemoStaffing(fixture()).content;
    const options = additionalOptions(factor);
    const second = reviseDemoStaffing(first, options).content;
    const repeated = reviseDemoStaffing(second, options);
    expect(repeated).toEqual({ content: second, alreadyApplied: true, changes: [] });
    second.actions[0].peopleNeeded = 17;
    second.actions[0].staffingGuidance = "Mo chose seventeen qualified responders after reviewing the workload.";
    const retained = reviseDemoStaffing(second, options);
    expect(retained).toEqual({ content: second, alreadyApplied: true, changes: [] });
    retained.content.actions[0].requiredSkills.push("additional-training");
    expect(second.actions[0].requiredSkills).toEqual(["first-aid-cert"]);
  });

  it("replaces only its own exact guidance block and preserves human instructions and later comments", () => {
    const original = fixture();
    original.actions[0].staffingGuidance = "Keep six people at the existing information desk; assess extra workload separately.\n";
    const first = reviseDemoStaffing(original).content;
    first.actions[0].peopleNeeded = 9;
    first.actions[0].staffingGuidance += "\n\nMo requires a trained lead and a separate relief position.";
    const before = structuredClone(first);
    const second = reviseDemoStaffing(first, additionalOptions(2)).content;
    expect(second.actions[0].peopleNeeded).toBe(18);
    expect(second.actions[0].staffingGuidance).toContain(`${original.actions[0].staffingGuidance}\n\nMo requires a trained lead and a separate relief position.`);
    expect(second.actions[0].staffingGuidance).toContain("DEMO planning baseline: 18 people");
    expect(second.actions[0].staffingGuidance).not.toContain("DEMO planning baseline: 6 people");
    const { actions: beforeActions, source: _oldSource, ...beforeFields } = before;
    const { actions: afterActions, source: _newSource, ...afterFields } = second;
    expect(afterFields).toEqual(beforeFields);
    const { peopleNeeded: _beforeCount, staffingGuidance: _beforeGuidance, ...beforeAction } = beforeActions[0];
    const { peopleNeeded: _afterCount, staffingGuidance: _afterGuidance, ...afterAction } = afterActions[0];
    expect(afterAction).toEqual(beforeAction);
    expect(first).toEqual(before);
  });

  it("retains human-edited wording rather than treating a similar sentence as owned guidance", () => {
    const first = reviseDemoStaffing(fixture()).content;
    first.actions[0].staffingGuidance = "300-volunteer DEMO planning baseline: 6 people, unless Mo confirms a different assessment layout.";
    const humanGuidance = first.actions[0].staffingGuidance;
    const second = reviseDemoStaffing(first, additionalOptions(2)).content;
    expect(second.actions[0].staffingGuidance.startsWith(`${humanGuidance}\n\n`)).toBe(true);
    expect(second.actions[0].staffingGuidance).toContain("DEMO planning baseline: 12 people");
  });

  it("does not remove exact-looking human guidance without the prior source ownership marker", () => {
    const first = reviseDemoStaffing(fixture()).content;
    const book = fixture();
    book.actions[0].staffingGuidance = first.actions[0].staffingGuidance;
    const second = reviseDemoStaffing(book, additionalOptions(2)).content;
    expect(second.actions[0].staffingGuidance.startsWith(`${book.actions[0].staffingGuidance}\n\n`)).toBe(true);
  });

  it("replaces a previous owned additional block when a distinct intentional revision is requested", () => {
    const first = reviseDemoStaffing(fixture()).content;
    const second = reviseDemoStaffing(first, additionalOptions(2)).content;
    const third = reviseDemoStaffing(second, additionalOptions(3)).content;
    expect(third.actions[0].peopleNeeded).toBe(36);
    expect(third.actions[0].staffingGuidance).toContain("DEMO planning baseline: 36 people");
    expect(third.actions[0].staffingGuidance).not.toContain("DEMO planning baseline: 6 people");
    expect(third.actions[0].staffingGuidance).not.toContain("DEMO planning baseline: 12 people");
    expect(third.source).toContain(additionalDemoStaffingRevisionNote(2));
    expect(third.source).toContain(additionalDemoStaffingRevisionNote(3));
  });

  it("preserves original guidance exactly when replacing adjacent owned blocks", () => {
    const original = fixture();
    original.actions[0].staffingGuidance = "";
    const first = reviseDemoStaffing(original).content;
    const generated = first.actions[0].staffingGuidance;
    first.actions[0].staffingGuidance = `${generated}\n\n${generated}\n\nMo added a separate relief position.`;
    const second = reviseDemoStaffing(first, additionalOptions(2)).content;
    expect(second.actions[0].staffingGuidance.startsWith("Mo added a separate relief position.\n\n")).toBe(true);
    expect(second.actions[0].staffingGuidance.match(/DEMO planning baseline:/g)).toHaveLength(1);
  });

  it("fails on quantity or text overflow and never clamps, truncates or mutates the source", () => {
    const quantity = fixture();
    quantity.actions[0].peopleNeeded = 250;
    expect(reviseDemoStaffing(quantity, additionalOptions(2)).content.actions[0].peopleNeeded).toBe(500);
    quantity.actions[0].peopleNeeded = 251;
    const beforeQuantity = structuredClone(quantity);
    expect(() => reviseDemoStaffing(quantity, additionalOptions(2))).toThrow("502 people");
    expect(quantity).toEqual(beforeQuantity);
    const longGuidance = fixture();
    longGuidance.actions[0].staffingGuidance = "x".repeat(1000);
    expect(() => reviseDemoStaffing(longGuidance, additionalOptions(2))).toThrow("1000 characters");
    const longSource = fixture();
    longSource.source = "x".repeat(1000);
    expect(() => reviseDemoStaffing(longSource, additionalOptions(3))).toThrow("1000 characters");
  });

  it("rejects invalid option combinations and empty revision markers instead of skipping work", () => {
    const book = fixture();
    expect(() => reviseDemoStaffing(book, { ...additionalOptions(2), unspecifiedCrew: 18 })).toThrow("factor 2 with baseline 12");
    expect(() => reviseDemoStaffing(book, { ...additionalOptions(2), factor: 4 as 2 })).toThrow("factor 2 with baseline 12");
    expect(() => reviseDemoStaffing(book, { ...additionalOptions(2), revisionNote: " " })).toThrow("nonempty source marker");
    expect(() => reviseDemoStaffing(book, { ...additionalOptions(2), revisionNote: "x".repeat(1001) })).toThrow("1000 characters");
    expect(() => additionalDemoStaffingRevisionNote(4 as 2)).toThrow("must be 2 or 3");
  });
});
