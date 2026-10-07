import { rankCandidates } from "@/lib/candidates";
import { TEAM_CATEGORY } from "@/lib/ai";
import { isFree } from "@/lib/lifecycle";
import { missingRequiredInputs } from "@/lib/mobilization-inputs";
import { ObservationSchema, observationReferenceErrors } from "@/lib/mobilization-observations";
import type {
  MobilizationOutput,
  PlanningSnapshot,
  PlaybookActionRef,
  SimulationContext,
  SimulationInput,
} from "@/lib/mobilization-contracts";
import type { MobilizationStep, Task, Volunteer } from "@/lib/schema";

const refKey = (ref: PlaybookActionRef) => `${ref.slug}:${ref.version}:${ref.actionId}`;
const bookKey = (ref: Pick<PlaybookActionRef, "slug" | "version">) => `${ref.slug}:${ref.version}`;

/** Facts may be hypothetical; their locations and basic consistency still have to be real. */
export function validateScenario(input: SimulationInput, context: SimulationContext): string[] {
  const errors: string[] = [];
  const zones = new Map(context.zones.map((zone) => [zone.slug, zone]));
  const seenStages = new Set<string>();
  for (const set of input.upcomingSets) {
    if (zones.get(set.stageSlug)?.kind !== "stage") errors.push(`Unknown stage ${set.stageSlug}`);
    if (seenStages.has(set.stageSlug)) errors.push(`Duplicate stage override ${set.stageSlug}`);
    seenStages.add(set.stageSlug);
  }
  const seenCrowdZones = new Set<string>();
  for (const crowd of input.crowdByZone) {
    if (!zones.has(crowd.zoneSlug)) errors.push(`Unknown crowd zone ${crowd.zoneSlug}`);
    if (seenCrowdZones.has(crowd.zoneSlug)) errors.push(`Duplicate crowd override ${crowd.zoneSlug}`);
    seenCrowdZones.add(crowd.zoneSlug);
  }
  for (const incident of input.recentIncidents) {
    if (incident.zoneSlug != null && !zones.has(incident.zoneSlug))
      errors.push(`Unknown incident zone ${incident.zoneSlug}`);
    if (incident.openCount > incident.count) errors.push("Open incidents cannot exceed total incidents");
  }
  const observations = [];
  for (const row of input.observations ?? []) {
    const parsed = ObservationSchema.safeParse(row);
    if (!parsed.success) errors.push(`Invalid observation ${row.key}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    else observations.push(parsed.data);
  }
  errors.push(...observationReferenceErrors(observations, context.zones.map((zone) => zone.slug)));
  return errors;
}

/** Checks relationships that JSON Schema cannot establish. It cannot prove a free-text causal claim. */
export function validateMobilizationOutput(
  output: MobilizationOutput,
  snapshot: PlanningSnapshot,
  skillSlugs: readonly string[],
): string[] {
  const errors: string[] = [];
  const evidence = new Set(snapshot.evidence.map((entry) => entry.ref));
  const zones = new Set(snapshot.zones.map((zone) => zone.slug));
  const teams = new Set(snapshot.teams.map((team) => team.slug));
  const skills = new Set(skillSlugs);
  const findings = new Map<string, MobilizationOutput["assessment"]["findings"][number]>();
  const published = new Map(
    snapshot.playbooks.filter((book) => book.status === "published").map((book) => [
      `${book.content.slug}:${book.version}`,
      book,
    ]),
  );
  const checkEvidence = (refs: string[], where: string) => {
    for (const ref of refs)
      if (!evidence.has(ref)) errors.push(`${where} cites unknown evidence ${ref}`);
  };
  for (const finding of output.assessment.findings) {
    if (findings.has(finding.id)) errors.push(`Duplicate finding ${finding.id}`);
    findings.set(finding.id, finding);
    checkEvidence(finding.evidenceRefs, `Finding ${finding.id}`);
  }
  const assessments = new Map<string, MobilizationOutput["assessment"]["playbookAssessments"][number]>();
  for (const assessment of output.assessment.playbookAssessments) {
    const key = bookKey(assessment);
    if (assessments.has(key)) errors.push(`Duplicate playbook assessment ${key}`);
    assessments.set(key, assessment);
    if (!published.has(key)) errors.push(`Unknown published playbook assessment ${key}`);
    checkEvidence(assessment.evidenceRefs, `Playbook assessment ${key}`);
    if (assessment.applicability === "insufficient_data" && !assessment.missingInputs.length)
      errors.push(`Playbook assessment ${key} must name its missing inputs`);
    const book = published.get(key);
    if (book) {
      const missing = missingRequiredInputs(book.content.requiredInputs, snapshot);
      for (const input of missing)
        if (!assessment.missingInputs.includes(input))
          errors.push(`Playbook assessment ${key} omits unknown required input ${input}`);
      if (missing.length && assessment.applicability === "applicable")
        errors.push(`Playbook assessment ${key} claims applicability with unknown required inputs`);
    }
  }
  for (const key of published.keys())
    if (!assessments.has(key)) errors.push(`Missing playbook assessment ${key}`);
  if (output.decision !== "propose" && output.mobilizations.length)
    errors.push(`${output.decision} cannot contain mobilization plans`);
  if (output.decision === "insufficient_data" && !output.assessment.missingInputs.length)
    errors.push("insufficient_data must identify missing information");
  if (output.decision === "propose" && !output.mobilizations.length)
    errors.push("propose must contain at least one mobilization");
  if (output.decision === "propose" && !findings.size)
    errors.push("A proposal must have evidence-backed findings");

  const addressed = new Set<string>();
  const distinctActions = new Set<string>();
  const covered = new Set<string>();
  const unmet = new Set<string>();
  const requiredBooks = new Set(
    [...assessments.entries()].filter(([, assessment]) => assessment.applicability === "applicable").map(([key]) => key),
  );
  for (const [planIndex, plan] of output.mobilizations.entries()) {
    const keys = new Set<string>();
    const resolveAction = (ref: PlaybookActionRef) => {
      requiredBooks.add(bookKey(ref));
      const book = published.get(bookKey(ref));
      const action = book?.content.actions.find((candidate) => candidate.id === ref.actionId);
      if (!action) errors.push(`Plan ${planIndex + 1} cites unknown published action ${refKey(ref)}`);
      if (assessments.get(bookKey(ref))?.applicability === "not_applicable")
        errors.push(`Plan ${planIndex + 1} cites a playbook it assessed as not applicable ${bookKey(ref)}`);
      return action;
    };
    for (const task of plan.tasks) {
      if (keys.has(task.key)) errors.push(`Duplicate task key ${task.key} within plan ${planIndex + 1}`);
      keys.add(task.key);
      if (!zones.has(task.zoneSlug)) errors.push(`Task ${task.key} has unknown zone ${task.zoneSlug}`);
      if (!teams.has(task.teamSlug)) errors.push(`Task ${task.key} has unknown team ${task.teamSlug}`);
      for (const skill of task.requiredSkills)
        if (!skills.has(skill)) errors.push(`Task ${task.key} requires unknown skill ${skill}`);
      checkEvidence(task.evidenceRefs, `Task ${task.key}`);
      for (const id of task.addressesFindingIds) {
        const finding = findings.get(id);
        if (!finding) errors.push(`Task ${task.key} addresses unknown finding ${id}`);
        else if (!finding.evidenceRefs.some((ref) => task.evidenceRefs.includes(ref)))
          errors.push(`Task ${task.key} does not cite evidence for finding ${id}`);
        addressed.add(id);
      }
      const duplicateKey = `${task.teamSlug}|${task.zoneSlug}|${task.instructions.trim().toLowerCase()}`;
      if (distinctActions.has(duplicateKey)) errors.push(`Repeated action task ${task.key}`);
      distinctActions.add(duplicateKey);
      for (const ref of task.playbookRefs) {
        const action = resolveAction(ref);
        covered.add(refKey(ref));
        if (!action) continue;
        if (action.teamSlug !== task.teamSlug)
          errors.push(`Task ${task.key} conflicts with playbook action team ${refKey(ref)}`);
        if (action.requiredSkills.some((skill) => !task.requiredSkills.includes(skill)))
          errors.push(`Task ${task.key} omits required playbook skills ${refKey(ref)}`);
        if (action.peopleNeeded != null && task.peopleNeeded < action.peopleNeeded)
          errors.push(`Task ${task.key} understates playbook staffing ${refKey(ref)}`);
      }
    }
    for (const requirement of plan.unmetRequirements) {
      resolveAction(requirement.playbookRef);
      const key = refKey(requirement.playbookRef);
      if (unmet.has(key)) errors.push(`Duplicate unmet requirement ${key}`);
      if (covered.has(key)) errors.push(`Action ${key} is both covered and unmet`);
      unmet.add(key);
    }
  }
  if (output.decision === "propose") {
    for (const key of requiredBooks) {
      const book = published.get(key);
      if (!book) continue;
      for (const action of book.content.actions) {
        const actionKey = `${key}:${action.id}`;
        if (action.requirement === "must" && !covered.has(actionKey) && !unmet.has(actionKey))
          errors.push(`Proposal omits required playbook action ${actionKey}`);
      }
    }
    for (const id of findings.keys())
      if (!addressed.has(id)) errors.push(`Finding ${id} has no response task`);
  }
  for (const key of covered)
    if (unmet.has(key)) errors.push(`Action ${key} is both covered and unmet`);
  return [...new Set(errors)];
}

/** Preview only: eligible, on-duty, free crew. One person cannot fill two simultaneous action slots. */
export function groundMobilizationPlans(
  output: MobilizationOutput,
  volunteers: Volunteer[],
  tasks: Task[],
  at: number,
): MobilizationStep[][] {
  const claimed = new Set<string>();
  return output.mobilizations.map((plan) =>
    plan.tasks.map((action) => {
      const eligible = volunteers.filter(
        (person) =>
          person.teamSlug === action.teamSlug && !claimed.has(person.id) &&
          isFree(person, action.requiredSkills, tasks, at),
      );
      const candidates = rankCandidates(
        {
          category: TEAM_CATEGORY[action.teamSlug],
          teamSlug: action.teamSlug,
          zoneSlug: action.zoneSlug,
          reporter: { kind: "system", quote: action.reason, language: "en" },
          helpers: [],
          assigneeId: null,
        },
        eligible,
        tasks,
        { limit: action.peopleNeeded },
      );
      for (const candidate of candidates) claimed.add(candidate.volunteerId);
      return {
        teamSlug: action.teamSlug,
        peopleNeeded: action.peopleNeeded,
        reason: action.reason,
        candidates,
        stepKey: action.key,
        title: action.title,
        instructions: action.instructions,
        zoneSlug: action.zoneSlug,
        requiredSkills: action.requiredSkills,
        completionCriteria: action.completionCriteria,
        evidenceRefs: action.evidenceRefs,
        addressesFindingIds: action.addressesFindingIds,
        playbookRefs: action.playbookRefs,
      };
    }),
  );
}
