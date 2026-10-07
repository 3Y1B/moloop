import { z } from "zod";

import type { MobilizationOutput, PlanningSnapshot } from "@/lib/mobilization-contracts";
import { missingRequiredInputs } from "@/lib/mobilization-inputs";
import { compactPlaybook } from "./input-projection";

export const playbookKey = (slug: string, version: number) => `${slug}:${version}`;

/** Read only the versioned, immutable snapshot; never query a newer SOP mid-run. */
export function createPlaybookRetrieval(snapshot: PlanningSnapshot) {
  const capturedSnapshot = structuredClone(snapshot);
  const captured = capturedSnapshot.playbooks.filter((book) => book.status === "published");
  const published = new Map(captured
    .map((book) => [playbookKey(book.content.slug, book.version), book]));
  if (published.size !== captured.length) throw new Error("Duplicate published playbook key in planning snapshot");
  const keys = [...published.keys()];
  const selection = keys.length ? z.enum(keys as [string, ...string[]]) : z.string();
  const args = z.strictObject({ playbookKeys: z.array(selection).max(keys.length) });
  const retrieved = new Set<string>();

  const read = (value: unknown) => {
    const parsed = args.safeParse(value);
    if (!parsed.success || new Set(parsed.data.playbookKeys).size !== parsed.data.playbookKeys.length)
      throw new Error("Invalid published playbook selection");
    const books = parsed.data.playbookKeys.map((key) => {
      const book = published.get(key);
      if (!book) throw new Error("Invalid published playbook selection");
      return compactPlaybook(book);
    });
    for (const key of parsed.data.playbookKeys) retrieved.add(key);
    return {
      playbooks: books,
      // Deterministic availability, not an applicability verdict or a causal interpretation.
      requiredInputChecks: parsed.data.playbookKeys.map((key) => ({
        playbookKey: key,
        unavailableRequiredInputs: missingRequiredInputs(published.get(key)!.content.requiredInputs, capturedSnapshot),
      })),
    };
  };

  const validate = (output: MobilizationOutput): string[] => {
    const required = new Set(output.assessment.playbookAssessments
      .filter((review) => review.applicability !== "not_applicable")
      .map((review) => playbookKey(review.slug, review.version)));
    for (const plan of output.mobilizations) {
      for (const task of plan.tasks)
        for (const ref of task.playbookRefs) required.add(playbookKey(ref.slug, ref.version));
      for (const requirement of plan.unmetRequirements)
        required.add(playbookKey(requirement.playbookRef.slug, requirement.playbookRef.version));
    }
    const errors = [...required].filter((key) => !retrieved.has(key))
      .map((key) => `Playbook ${key} requires full SOP retrieval before assessment or citation`);
    if (output.decision === "propose") {
      const accounted = new Set(output.mobilizations.flatMap((plan) => [
        ...plan.tasks.flatMap((task) => task.playbookRefs),
        ...plan.unmetRequirements.map((requirement) => requirement.playbookRef),
      ]).map((ref) => `${playbookKey(ref.slug, ref.version)}:${ref.actionId}`));
      // A relevant trigger with unknown prerequisites still needs honest action accounting. Otherwise
      // an insufficient_data verdict plus empty task refs could hide every blocked must action.
      for (const review of output.assessment.playbookAssessments) {
        if (review.applicability !== "insufficient_data") continue;
        const key = playbookKey(review.slug, review.version);
        if (!retrieved.has(key)) continue;
        for (const action of published.get(key)?.content.actions ?? []) {
          const actionKey = `${key}:${action.id}`;
          if (action.requirement === "must" && !accounted.has(actionKey))
            errors.push(`Proposal omits required playbook action ${actionKey}`);
        }
      }
    }
    return errors;
  };

  return { args, read, validate };
}
