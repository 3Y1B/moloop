import type { MobilizationOutput, PlaybookActionRef, SimulationRunResult } from "@/lib/mobilization-contracts";
import type { Mobilization, Task, Volunteer } from "@/lib/schema";
import { isFree } from "@/lib/lifecycle";

type Plan = MobilizationOutput["mobilizations"][number];
const refKey = (ref: PlaybookActionRef) => `${ref.slug}:${ref.version}:${ref.actionId}`;
export type RequiredActionReview = {
  ref: PlaybookActionRef;
  playbookTitle: string;
  title: string;
  instructions: string;
  teamSlug: Mobilization["steps"][number]["teamSlug"];
  plannedBy: { title: string; current: boolean }[];
  unmet: { title: string; current: boolean; reason: string }[];
};
export type ApprovalAnalysisReview = {
  ready: boolean;
  error: string | null;
  plan: Plan | null;
  requiredActions: RequiredActionReview[];
  missingInputs: string[];
  siblingCount: number;
};

/** Saved IDs, not mutable titles, associate an approval with its exact AI plan. */
export function reviewApprovalAnalysis(
  mobilization: Mobilization,
  analysis: SimulationRunResult | null,
): ApprovalAnalysisReview {
  const unavailable = (error: string): ApprovalAnalysisReview => ({
    ready: false, error, plan: null, requiredActions: [], missingInputs: [], siblingCount: 0,
  });
  if (!mobilization.analysisRunId)
    return { ready: true, error: null, plan: null, requiredActions: [], missingInputs: [], siblingCount: 0 };
  if (!analysis || analysis.runId !== mobilization.analysisRunId)
    return unavailable("Load the saved analysis before approving this mobilization.");
  if (analysis.status !== "completed" || analysis.output?.decision !== "propose" ||
      !analysis.snapshot || analysis.validationErrors.length)
    return unavailable("The linked analysis is not a validated, completed proposal. Do not approve it.");
  if (analysis.mobilizationIds.length !== analysis.output.mobilizations.length ||
      new Set(analysis.mobilizationIds).size !== analysis.mobilizationIds.length)
    return unavailable("Saved plan identities are incomplete or ambiguous. Do not approve this analysis.");
  const index = analysis.mobilizationIds.indexOf(mobilization.id);
  const plan = index < 0 ? undefined : analysis.output.mobilizations[index];
  if (!plan || plan.tasks.length !== mobilization.steps.length ||
      plan.tasks.some((task, i) => task.key !== mobilization.steps[i].stepKey ||
        task.teamSlug !== mobilization.steps[i].teamSlug ||
        task.zoneSlug !== mobilization.steps[i].zoneSlug ||
        task.peopleNeeded !== mobilization.steps[i].peopleNeeded ||
        task.title !== mobilization.steps[i].title ||
        task.instructions !== mobilization.steps[i].instructions ||
        task.reason !== mobilization.steps[i].reason ||
        task.completionCriteria !== mobilization.steps[i].completionCriteria ||
        JSON.stringify(task.requiredSkills) !== JSON.stringify(mobilization.steps[i].requiredSkills ?? []) ||
        JSON.stringify(task.evidenceRefs) !== JSON.stringify(mobilization.steps[i].evidenceRefs ?? []) ||
        JSON.stringify(task.addressesFindingIds) !== JSON.stringify(mobilization.steps[i].addressesFindingIds ?? []) ||
        JSON.stringify(task.playbookRefs.map(refKey)) !== JSON.stringify((mobilization.steps[i].playbookRefs ?? []).map(refKey))))
    return unavailable("This mobilization could not be matched to its saved analysis. Reload before approving.");

  const output = analysis.output;
  const neededBooks = new Set(output.assessment.playbookAssessments
    .filter((review) => review.applicability !== "not_applicable")
    .map((review) => `${review.slug}:${review.version}`));
  for (const proposal of output.mobilizations) {
    for (const task of proposal.tasks)
      for (const ref of task.playbookRefs) neededBooks.add(`${ref.slug}:${ref.version}`);
    for (const item of proposal.unmetRequirements)
      neededBooks.add(`${item.playbookRef.slug}:${item.playbookRef.version}`);
  }
  const requiredActions: RequiredActionReview[] = [];
  for (const bookKey of neededBooks) {
    const book = analysis.snapshot.playbooks.find((book) => `${book.content.slug}:${book.version}` === bookKey);
    if (!book) return unavailable("A saved playbook version is missing. Reload the analysis before approving.");
    for (const action of book.content.actions.filter((action) => action.requirement === "must")) {
      const ref = { slug: book.content.slug, version: book.version, actionId: action.id };
      const key = refKey(ref);
      const plannedBy = output.mobilizations.flatMap((proposal, i) =>
        proposal.tasks.some((task) => task.playbookRefs.some((ref) => refKey(ref) === key))
          ? [{ title: proposal.title, current: i === index }] : []);
      const unmet = output.mobilizations.flatMap((proposal, i) =>
        proposal.unmetRequirements.filter((item) => refKey(item.playbookRef) === key)
          .map((item) => ({ title: proposal.title, current: i === index, reason: item.reason })));
      if ((!plannedBy.length && !unmet.length) || (plannedBy.length && unmet.length))
        return unavailable("The saved required-action coverage is incomplete or conflicting. Do not approve it.");
      requiredActions.push({ ref, playbookTitle: book.content.title, title: action.title,
        instructions: action.instructions, teamSlug: action.teamSlug, plannedBy, unmet });
    }
  }
  const missingInputs = [...new Set([
    ...output.assessment.missingInputs,
    ...output.assessment.playbookAssessments
      .filter((review) => neededBooks.has(`${review.slug}:${review.version}`))
      .flatMap((review) => review.missingInputs),
  ])];
  return { ready: true, error: null, plan, requiredActions,
    missingInputs, siblingCount: output.mobilizations.length - 1 };
}

/** Saved suggestions only; never imply that a preview assigns crew or reflects a fresh server rank. */
export function approvalCrewPreview(
  mobilization: Mobilization,
  volunteers: Record<string, Volunteer>,
  tasks: Task[],
  at: number,
) {
  const claimed = new Set<string>();
  const steps = mobilization.steps.map((step) => {
    let eligible = 0;
    for (const candidate of step.candidates) {
      if (eligible >= step.peopleNeeded) break;
      const person = volunteers[candidate.volunteerId];
      if (!person || claimed.has(person.id) || person.teamSlug !== step.teamSlug ||
          !isFree(person, step.requiredSkills ?? [], tasks, at)) continue;
      claimed.add(person.id);
      eligible += 1;
    }
    return { stepKey: step.stepKey, required: step.peopleNeeded, eligible, gap: step.peopleNeeded - eligible };
  });
  return { steps, required: steps.reduce((sum, step) => sum + step.required, 0),
    eligible: steps.reduce((sum, step) => sum + step.eligible, 0),
    gap: steps.reduce((sum, step) => sum + step.gap, 0) };
}

export function approvalAllowed(input: { analysisReady: boolean; hasGaps: boolean; acknowledged: boolean; busy: boolean }) {
  return input.analysisReady && !input.busy && (!input.hasGaps || input.acknowledged);
}
