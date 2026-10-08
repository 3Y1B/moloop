import { CommandError } from '@/lib/batch';
import type { MobilizationReview } from '@/data/repo';
import { MobilizationOutputSchema } from '@/lib/mobilization-contracts';
import type { Mobilization, Task } from '@/lib/schema';

export type ReviewRun = {
  id: string; status: string; result: unknown; input_snapshot: unknown;
  validation_errors: unknown; mobilization_ids: string[];
};

/** Called inside the approval transaction; failure rolls back every assignment and message. */
export function assertMobilizationReview(
  mobilization: Mobilization,
  run: ReviewRun | null,
  review: MobilizationReview,
  allocatedTasks: readonly Pick<Task, 'assigneeId' | 'helpers' | 'requiredCount'>[],
): void {
  let unmet = false;
  if (mobilization.analysisRunId) {
    if (review.reviewedRunId !== mobilization.analysisRunId)
      throw new CommandError('conflict', 'Load and review the linked analysis before approval');
    const parsed = MobilizationOutputSchema.safeParse(run?.result);
    const index = run?.mobilization_ids.indexOf(mobilization.id) ?? -1;
    if (!run || run.id !== mobilization.analysisRunId || run.status !== 'completed' ||
      !run.input_snapshot || !Array.isArray(run.validation_errors) || run.validation_errors.length ||
      !parsed.success || parsed.data.decision !== 'propose' || index < 0 ||
      new Set(run.mobilization_ids).size !== run.mobilization_ids.length ||
      run.mobilization_ids.length !== parsed.data.mobilizations.length)
      throw new CommandError('conflict', 'The linked analysis is unavailable or invalid; reload before approval');
    const plan = parsed.data.mobilizations[index];
    if (plan.tasks.length !== mobilization.steps.length || plan.tasks.some((task, i) => {
      const step = mobilization.steps[i];
      return step.stepKey !== task.key || step.teamSlug !== task.teamSlug ||
        step.zoneSlug !== task.zoneSlug || step.peopleNeeded !== task.peopleNeeded ||
        step.title !== task.title || step.instructions !== task.instructions || step.reason !== task.reason ||
        step.completionCriteria !== task.completionCriteria ||
        JSON.stringify(step.requiredSkills) !== JSON.stringify(task.requiredSkills) ||
        JSON.stringify(step.evidenceRefs) !== JSON.stringify(task.evidenceRefs) ||
        JSON.stringify(step.addressesFindingIds) !== JSON.stringify(task.addressesFindingIds) ||
        JSON.stringify((step.playbookRefs ?? []).map((ref) => `${ref.slug}:${ref.version}:${ref.actionId}`)) !==
          JSON.stringify(task.playbookRefs.map((ref) => `${ref.slug}:${ref.version}:${ref.actionId}`));
    })) throw new CommandError('conflict', 'Mobilization no longer matches the reviewed analysis');
    // Review is for the coordinated analysis, not just the currently opened sibling plan.
    // A direct API caller must acknowledge the same relevant gaps shown by Mo's review UI.
    const relevantBooks = new Set(parsed.data.assessment.playbookAssessments
      .filter((item) => item.applicability !== 'not_applicable')
      .map((item) => `${item.slug}:${item.version}`));
    for (const item of parsed.data.mobilizations) {
      for (const task of item.tasks)
        for (const ref of task.playbookRefs) relevantBooks.add(`${ref.slug}:${ref.version}`);
      for (const gap of item.unmetRequirements)
        relevantBooks.add(`${gap.playbookRef.slug}:${gap.playbookRef.version}`);
    }
    unmet = parsed.data.mobilizations.some((item) => item.unmetRequirements.length > 0) ||
      parsed.data.assessment.missingInputs.length > 0 ||
      parsed.data.assessment.playbookAssessments.some((item) =>
        relevantBooks.has(`${item.slug}:${item.version}`) && item.missingInputs.length > 0);
  }
  const staffGap = allocatedTasks.some((task) => {
    const people = new Set([
      ...(task.assigneeId ? [task.assigneeId] : []),
      ...task.helpers.map((helper) => helper.volunteerId),
    ]);
    return people.size < task.requiredCount;
  });
  if ((unmet || staffGap) && review.acknowledgeGaps !== true)
    throw new CommandError('conflict', 'Review and acknowledge the SOP or staffing gaps before approval');
}
