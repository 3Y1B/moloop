import { describe, expect, it } from "vitest";

import { PlaybookContentSchema, type ManagedPlaybook, type MobilizationOutput, type PlanningSnapshot } from "@/lib/mobilization-contracts";
import { createPlaybookRetrieval } from "./playbook-retrieval";
import { MOBILIZATION_TOOL_PROMPT_VERSION, MOBILIZATION_TOOL_SYSTEM_PROMPT } from "./prompts/mobilization-tools";

const at = "2026-10-08T00:00:00.000Z";
const book: ManagedPlaybook = {
  id: "book", version: 3, status: "published", createdAt: at, updatedAt: at, publishedAt: at,
  content: PlaybookContentSchema.parse({
    schemaVersion: 1, slug: "heat", title: "Heat", appliesWhen: "Extreme heat",
    requiredInputs: ["weather.temperatureC"], constraints: [{ id: "approval", instruction: "Mo must approve" }],
    actions: [{ id: "assessment", requirement: "must", teamSlug: "welfare", title: "Assess",
      instructions: "Assess the affected people without claiming a diagnosis", peopleNeeded: 2 }], source: "Unit test SOP",
  }),
};
const snapshot = (): PlanningSnapshot => ({
  schemaVersion: 1, evaluatedAt: at,
  scenario: { requestId: "test-playbook-retrieval", weather: {
    temperatureC: 41, trendCPerHour: null, condition: "clear", warning: "heat", warningInMinutes: 0,
  }, upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [] },
  zones: [], teams: [], skills: [], routes: [], roster: [], existingResponses: [],
  evidence: [{ ref: "demo-weather", kind: "weather", source: "manual_demo", zoneSlug: null,
    observedAt: at, value: { temperatureC: 41 } }],
  playbooks: [structuredClone(book), { ...structuredClone(book), id: "draft", version: 4, status: "draft" }],
});
const output = (applicability: "applicable" | "not_applicable" | "insufficient_data" = "not_applicable"): MobilizationOutput => ({
  decision: "no_mobilization", assessment: {
    summary: "Test review", severity: "minor", findings: [], missingInputs: [],
    playbookAssessments: [{ slug: "heat", version: 3, applicability, reason: "Test fixture only",
      evidenceRefs: ["demo-weather"], missingInputs: [] }],
  }, mobilizations: [],
});

describe("snapshot-scoped read-only SOP retrieval", () => {
  it("reads exact captured published content without changing the audit snapshot", () => {
    const input = snapshot();
    const before = structuredClone(input);
    const reader = createPlaybookRetrieval(input);
    const selected = reader.read({ playbookKeys: ["heat:3"] });
    expect(JSON.stringify(selected)).toContain(book.content.actions[0].instructions);
    expect(JSON.stringify(selected)).toContain(book.content.constraints[0].instruction);
    expect(input).toEqual(before);
    expect(reader.validate(output("applicable"))).toEqual([]);
  });

  it("keeps the captured version independent of later caller mutations", () => {
    const input = snapshot();
    const reader = createPlaybookRetrieval(input);
    input.playbooks[0].content.actions[0].instructions = "A changed instruction outside this run";
    input.playbooks[0].version = 99;
    const selected = reader.read({ playbookKeys: ["heat:3"] });
    expect(selected.playbooks[0].version).toBe(3);
    expect(selected.playbooks[0].content.actions[0].instructions).toBe(book.content.actions[0].instructions);
  });

  it("reports deterministic unavailable inputs from the same immutable snapshot without deciding applicability", () => {
    const input = snapshot();
    input.playbooks[0].content.requiredInputs.push("weather.trendCPerHour");
    const reader = createPlaybookRetrieval(input);
    input.scenario.weather.trendCPerHour = 2;
    const selected = reader.read({ playbookKeys: ["heat:3"] });
    expect(selected.requiredInputChecks).toEqual([{ playbookKey: "heat:3", unavailableRequiredInputs: ["weather.trendCPerHour"] }]);
    expect(selected.requiredInputChecks[0]).not.toHaveProperty("applicability");
  });

  it.each([
    { playbookKeys: ["heat:4"] }, { playbookKeys: ["heat:99"] }, { playbookKeys: ["unknown:3"] },
    { playbookKeys: ["heat:3", "heat:3"] }, { playbookKeys: ["heat:3"], approve: true },
  ])("rejects unknown, draft, duplicate, or mutated selection arguments %j", (args) => {
    expect(() => createPlaybookRetrieval(snapshot()).read(args)).toThrow("Invalid published playbook selection");
  });

  it("allows index-based supported exclusions, but requires full content for uncertainty or applicability", () => {
    const reader = createPlaybookRetrieval(snapshot());
    expect(reader.read({ playbookKeys: [] })).toEqual({ playbooks: [], requiredInputChecks: [] });
    expect(reader.validate(output())).toEqual([]);
    expect(reader.validate(output("applicable"))).toHaveLength(1);
    expect(reader.validate(output("insufficient_data"))).toHaveLength(1);
  });

  it("requires retrieval for any action citation even if the review claims non-applicability", () => {
    const reader = createPlaybookRetrieval(snapshot());
    const result = output();
    result.mobilizations = [{ title: "Test", priority: "P1", rationale: "Test only", tasks: [],
      unmetRequirements: [{ playbookRef: { slug: "heat", version: 3, actionId: "assessment" }, reason: "Unknown approval" }] }];
    expect(reader.validate(result)).toHaveLength(1);
    reader.read({ playbookKeys: ["heat:3"] });
    expect(reader.validate(result)).toEqual([]);
  });

  it("allows an empty tool batch when there are no published books", () => {
    const input = snapshot();
    input.playbooks = [];
    const reader = createPlaybookRetrieval(input);
    expect(reader.read({ playbookKeys: [] })).toEqual({ playbooks: [], requiredInputChecks: [] });
    expect(() => reader.read({ playbookKeys: ["heat:3"] })).toThrow();
  });

  it("pins the tool workflow and keeps coverage, approval, scope and uncertainty rules explicit", () => {
    expect(MOBILIZATION_TOOL_PROMPT_VERSION).toBe("mobilization.v16.escalation-evidence");
    for (const invariant of ["read-only get_playbooks once", "Assess EVERY", "mutually\nexclusive across ALL",
      "playbookRefs: []", "Mo alone approves", "NOT approved emergency routes", "Root cause may remain unknown",
      "server adds\nmissing requiredInputs deterministically", "Existing responses are coverage/workload"])
      expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain(invariant);
  });

  it("requires unknown activation conditions to remain unknown even outside requiredInputs", () => {
    for (const rule of ["Activation conditions written in appliesWhen", "unknown event heat-response threshold",
      "in contextualMissingInputs and global missingInputs", "Independent protective work can still be justified"])
      expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain(rule);
  });

  it("distinguishes partial preparations from complete proposed SOP action coverage", () => {
    for (const rule of ["ENTIRE source action (title AND instructions)", "publishing by preparing a draft",
      "checking which route is authorized", "queue with no known approved alternative",
      "independent partial tasks plus concrete unmet blockers", "account for both scopes"])
      expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain(rule);
  });

  it("does not confuse an empty selection with an empty published index", () => {
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain("empty retrieval selection still needs one not_applicable review per indexed SOP");
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain("published index means no SOP assessments or references");
  });

  it("preserves safe fact gathering and both upcoming stage scopes without pretending unknown resources are absent", () => {
    for (const rule of ["safe verification or coordination task", "Never enter a hazard zone just to collect facts",
      "Consider both upcoming sets", "including backstage", 'say "not supplied/verified"'])
      expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain(rule);
  });

  it("does not let insufficient_data plus independent tasks hide uncovered must actions", () => {
    const reader = createPlaybookRetrieval(snapshot());
    reader.read({ playbookKeys: ["heat:3"] });
    const result = output("insufficient_data");
    result.decision = "propose";
    result.mobilizations = [{ title: "Protective preparations", priority: "P1", rationale: "Test only",
      tasks: [], unmetRequirements: [] }];
    expect(reader.validate(result)).toEqual(["Proposal omits required playbook action heat:3:assessment"]);
    result.mobilizations[0].unmetRequirements = [{ playbookRef: {
      slug: "heat", version: 3, actionId: "assessment",
    }, reason: "Unknown clinical assessment capacity; only preparation is proposed" }];
    expect(reader.validate(result)).toEqual([]);
  });

  it("requires every affected backstage scope and unambiguous deadlines", () => {
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain("that stage's own backstage scope");
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain("relative minutes or exact ISO startsAt with timezone");
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain("never turn UTC evidence into an unlabelled local clock time");
  });

  it("retains safe root-cause verification demand and source-specific clinical priorities", () => {
    for (const rule of ["For unexplained collapses, assign safe remote review", "No free crew is a staffing gap",
      '"Not proposed" is not an external SOP prerequisite blocker', "source's explicit clinical priority categories"])
      expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain(rule);
  });
  it("cannot promise unknown emergency resources into full coverage or leave staffing as an unaddressed risk", () => {
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain('corridor/access itself is unknown');
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain('promising to verify it later is partial preparation');
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain('not an unaddressed\nextra finding');
  });
  it("does not mistake a plausible crowd mechanism or extraction need for verified cause or completed rescue", () => {
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain('A possible heat or crowd-pressure');
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain('Ask Mo for the escalation decision');
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain('not evidence that extraction already occurred');
  });

  it("does not demand unrelated excluded SOP actions merely because a sensor is unknown", () => {
    const reader = createPlaybookRetrieval(snapshot());
    reader.read({ playbookKeys: ["heat:3"] });
    const result = output("not_applicable");
    result.decision = "propose";
    expect(reader.validate(result)).toEqual([]);
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain("NOT that the hazard is");
    expect(MOBILIZATION_TOOL_SYSTEM_PROMPT).toContain("Empty references do not waive relevant SOP accountability");
  });
});
