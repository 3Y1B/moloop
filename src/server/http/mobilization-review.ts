import { CommandError } from '@/lib/batch';
import type { MobilizationReview } from '@/data/repo';
import { MobilizationOutputSchema } from '@/lib/mobilization-contracts';
import type { Mobilization } from '@/lib/schema';

export type ReviewRun = {
  id: string; status: string; result: unknown; input_snapshot: unknown;
  validation_errors: unknown; mobilization_ids: string[];
};

/**
 * Called inside the approval transaction; failure rolls back every assignment and message. Mo approves what he saw:
 * the plan still matches the run he reviewed. Gaps don't block: Mo sees the shortfall on the review, and unstaffed
 * steps keep being retried after approval.
 */
export function assertMobilizationReview(
  mobilization: Mobilization,
  run: ReviewRun | null,
  review: Pick<MobilizationReview, 'reviewedRunId'>,
): void {
  if (!mobilization.analysisRunId) return;
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
}
