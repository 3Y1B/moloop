import type { Mobilization, MobilizationStep, Task, Volunteer } from "@/lib/schema";
import type { MobilizationStepStatus } from "@/lib/status";

/** The same access rules apply to the overview and directly linked detail screens. */
export function canViewMobilization(plan: Mobilization, person: Volunteer | undefined) {
  return person?.role === "coordinator" || (person?.role === "team_lead" &&
    plan.status !== "proposed" && plan.steps.some((step) => step.teamSlug === person.teamSlug));
}

/** An index is an internal locator, not a displayed task number or identity. */
export function detailStep(plan: Mobilization, index: string | undefined, person: Volunteer | undefined) {
  if (!canViewMobilization(plan, person) || !index || !/^\d+$/.test(index)) return undefined;
  const step = plan.steps[Number(index)];
  return step && (person?.role === "coordinator" || step.teamSlug === person?.teamSlug) ? step : undefined;
}

export function taskForStep(plan: Mobilization, step: MobilizationStep, tasks: readonly Task[]) {
  if (plan.status === "proposed") return undefined;
  return tasks.find((task) => task.mobilizationId === plan.id &&
    (step.stepKey ? task.mobilizationStepKey === step.stepKey : task.teamSlug === step.teamSlug));
}

/** Live tasks, not the saved draft, supply operational details after approval. */
export function operationalDetails(plan: Mobilization, step: MobilizationStep, task?: Task) {
  const completionMatch = task?.summary.match(/(?:^|\n\s*\n)Done when:\s*([\s\S]*)$/i);
  return {
    title: task?.title ?? step.title ?? "Team task",
    teamSlug: task?.teamSlug ?? step.teamSlug,
    zoneSlug: task?.zoneSlug ?? step.zoneSlug ?? plan.zoneSlug,
    peopleNeeded: task?.requiredCount ?? step.peopleNeeded,
    // In older/manual plans, reason was the operational brief used to create the task.
    instructions: task ? task.summary.replace(/(?:^|\n\s*\n)Done when:\s*[\s\S]*$/i, "").trim()
      : step.instructions ?? (!plan.analysisRunId ? step.reason : undefined),
    completionCriteria: task ? completionMatch?.[1]?.trim() : step.completionCriteria,
    requiredSkills: task?.requiredSkills ?? step.requiredSkills ?? [],
  };
}

export function taskProgressLabel(plan: Mobilization, task: Task | undefined, status?: MobilizationStepStatus) {
  if (!task) return plan.status === "rejected" ? "Not created · plan rejected"
    : plan.status === "cancelled" ? "Not created · plan cancelled"
      : plan.status === "stood_down" ? "Not created · mobilization stood down" : "Task not yet created";
  if (task.status === "resolved") return "Task reported complete";
  if (task.status === "cancelled") return "Task closed";
  return status ? `${status.confirmedCount} accepted · ${status.waitingCount} awaiting reply · ${status.missingCount} unfilled` : "Staffing details unavailable";
}

/** A task ending is not evidence that every invited person accepted or completed it. */
export function crewReplyLabel(task: Task, accepted: boolean, owner = false) {
  const ended = task.status === "resolved" || task.status === "cancelled";
  if (ended && owner) return "Assigned before the task ended";
  if (ended) return accepted ? "Accepted before the task ended" : "Invitation was not accepted before the task ended";
  if (owner && task.status === "queued") return "Queued for this task";
  return accepted ? "Accepted" : "Awaiting reply";
}
