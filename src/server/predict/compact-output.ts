import { z } from "zod";

import {
  MobilizationOutputSchema,
  type MobilizationOutput,
  type PlanningSnapshot,
} from "@/lib/mobilization-contracts";
import { inputAvailability, missingRequiredInputs } from "@/lib/mobilization-inputs";

const assessment = MobilizationOutputSchema.shape.assessment;
const review = assessment.shape.playbookAssessments.element;
const CompactReviewSchema = review.omit({ slug: true, version: true, missingInputs: true }).extend({
  playbookKey: z.string().min(1),
  // Only contextual gaps require model judgement; exact unavailable requiredInputs are recomputed.
  contextualMissingInputs: review.shape.missingInputs,
});
const CompactOutputSchema = MobilizationOutputSchema.extend({
  assessment: assessment.extend({ playbookAssessments: z.array(CompactReviewSchema) }),
});

export type CompactMobilizationOutput = z.infer<typeof CompactOutputSchema>;
export type CompactMobilizationOutputContract = {
  schema: z.ZodType<CompactMobilizationOutput>;
  expand: (output: unknown) => MobilizationOutput;
};

/**
 * Endpoint-independent wire contract. The AI still assesses every published SOP and supplies its
 * judgement, evidence and contextual gaps. Expansion restores only deterministic metadata; it does
 * not repair references, change a verdict, invent tasks or replace the existing semantic validator.
 */
export function createCompactMobilizationOutput(snapshot: PlanningSnapshot): CompactMobilizationOutputContract {
  // Bind references and missing-input calculations to the exact audited input, not later mutations.
  const immutableSnapshot = structuredClone(snapshot);
  const published = immutableSnapshot.playbooks.filter((book) => book.status === "published");
  const books = new Map(published.map((book) => [`${book.content.slug}:${book.version}`, book]));
  if (books.size !== published.length) throw new Error("Duplicate published playbook key in planning snapshot");
  const evidenceIds = [...new Set(immutableSnapshot.evidence.map((entry) => entry.ref))];
  if (!evidenceIds.length) throw new Error("Planning snapshot has no evidence references");

  // Enumerate valid evidence IDs in three shared field shapes, never in every individual task/SOP.
  // Other bounds come directly from the canonical schemas.
  const evidenceId = z.enum(evidenceIds);
  const findings = assessment.shape.findings.element.extend({
    evidenceRefs: z.array(evidenceId).min(1).max(30),
  });
  const tasks = MobilizationOutputSchema.shape.mobilizations.element.shape.tasks.element.extend({
    evidenceRefs: z.array(evidenceId).min(1).max(30),
  });
  const compactReview = CompactReviewSchema.extend({
    playbookKey: books.size ? z.enum([...books.keys()]) : CompactReviewSchema.shape.playbookKey,
    evidenceRefs: z.array(evidenceId).min(1).max(30),
  });
  const schema = CompactOutputSchema.extend({
    assessment: assessment.extend({
      findings: z.array(findings).max(20),
      playbookAssessments: z.array(compactReview).length(books.size),
    }),
    mobilizations: z.array(MobilizationOutputSchema.shape.mobilizations.element.extend({
      tasks: z.array(tasks).min(2).max(30),
    })).max(8),
  });
  const availability = inputAvailability(immutableSnapshot);
  const checkContextualGaps = (gaps: string[], where: string) => {
    for (const gap of gaps) {
      const key = gap.trim();
      if (!key) throw new Error(`${where} contains an empty contextual gap`);
      const input = availability[key];
      // Partial coverage can legitimately need more scoped evidence; known complete values cannot
      // be described as unknown by their exact input key. Unsafe known values belong in findings.
      if (input?.available && input.completeness === "complete")
        throw new Error(`${where} lists known complete input ${key} as missing`);
    }
  };

  return {
    schema,
    expand(output) {
      const wire = schema.parse(output);
      checkContextualGaps(wire.assessment.missingInputs, "Assessment");
      const seen = new Set<string>();
      const playbookAssessments = wire.assessment.playbookAssessments.map((entry) => {
        const { playbookKey, contextualMissingInputs, ...judgement } = entry;
        if (seen.has(playbookKey)) throw new Error(`Duplicate playbook assessment ${playbookKey}`);
        seen.add(playbookKey);
        const book = books.get(playbookKey);
        if (!book) throw new Error(`Unknown published playbook assessment ${playbookKey}`);
        checkContextualGaps(contextualMissingInputs, `Playbook assessment ${playbookKey}`);
        return {
          ...judgement, slug: book.content.slug, version: book.version,
          missingInputs: [...new Set([
            ...missingRequiredInputs(book.content.requiredInputs, immutableSnapshot),
            ...contextualMissingInputs,
          ])],
        };
      });
      for (const key of books.keys())
        if (!seen.has(key)) throw new Error(`Missing playbook assessment ${key}`);
      // Reject overflow rather than truncate gaps or relax any canonical field/array bounds.
      return MobilizationOutputSchema.parse({
        ...wire, assessment: { ...wire.assessment, playbookAssessments },
      });
    },
  };
}
