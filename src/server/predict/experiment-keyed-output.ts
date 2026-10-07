import { z } from 'zod';

import {
  MobilizationOutputSchema,
  type MobilizationOutput,
  type PlanningSnapshot,
  type PlaybookActionRef,
} from '@/lib/mobilization-contracts';
import { missingRequiredInputs } from '@/lib/mobilization-inputs';
import { createCompactMobilizationOutput } from './compact-output';
import { validateMobilizationOutput } from './validate';

const assessment = MobilizationOutputSchema.shape.assessment;
const review = assessment.shape.playbookAssessments.element;
const plan = MobilizationOutputSchema.shape.mobilizations.element;
const task = plan.shape.tasks.element;
const unmet = plan.shape.unmetRequirements.element;
const ActionKey = z.string().min(1);
const KeyedReviewSchema = review.omit({ slug: true, version: true, missingInputs: true }).extend({
  contextualMissingInputs: review.shape.missingInputs,
}).strict();
const KeyedTaskSchema = task.extend({ playbookRefs: z.array(ActionKey).max(30) }).strict();
const KeyedPlanSchema = plan.extend({
  tasks: z.array(KeyedTaskSchema).min(2).max(30),
  unmetRequirements: z.array(unmet.extend({ playbookRef: ActionKey }).strict()).max(30),
}).strict();
const KeyedOutputSchema = MobilizationOutputSchema.extend({
  assessment: assessment.extend({
    findings: z.array(assessment.shape.findings.element.strict()).max(20),
    playbookAssessments: z.record(z.string().min(1), KeyedReviewSchema),
  }).strict(),
  mobilizations: z.array(KeyedPlanSchema).max(8),
}).strict();

export type ExperimentKeyedMobilizationOutput = z.infer<typeof KeyedOutputSchema>;
export type ExperimentKeyedMobilizationOutputContract = {
  schema: z.ZodType<ExperimentKeyedMobilizationOutput>;
  expand: (output: unknown) => MobilizationOutput;
  promptSupplement: string;
};

const promptSupplement = `EXPERIMENTAL KEYED OUTPUT ENCODING ONLY. All existing safety, evidence, SOP retrieval,
approval, staffing and coverage requirements remain unchanged. Keep canonical descriptive field names,
teamSlug, zoneSlug, evidenceRefs, finding IDs, skills, headcounts and all operational content.
assessment.playbookAssessments is now a required object keyed by every exact published playbookKey
(“slug:version”), not an array. Each value contains applicability, reason, evidenceRefs and
contextualMissingInputs; do not repeat slug/version or playbookKey inside its value. Assess every key.
The server separately adds unavailable requiredInputs from each full SOP. A book with unknown required
inputs cannot be applicable: its schema permits only not_applicable or insufficient_data, and you must
choose based on evidence, not a default. Available inputs do not prove safe conditions or applicability.
task.playbookRefs contains exact enum strings “slug:version:actionId”, not reference objects or numeric
indices; unmetRequirements[].playbookRef uses the same exact string. These strings identify full SOP
actions, not approval or execution. Read full relevant SOPs as otherwise required. Do not cite a SOP
assessed not_applicable. An action cannot be both covered and unmet anywhere. Do not silently drop any
verdict, relevant contextual gap, finding, task, required skill, justified headcount, operational instruction,
uncertainty, measurable completion criterion or concrete unmet prerequisite to shorten the response.`;

const bookKey = (slug: string, version: number) => `${slug}:${version}`;
const actionKey = (ref: PlaybookActionRef) => `${bookKey(ref.slug, ref.version)}:${ref.actionId}`;
function unique(values: readonly string[], where: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${where}`);
}

/**
 * Separate readability-focused experiment. Only deterministic identities/gaps are expanded; no AI
 * decision or plan is repaired. Unknown-required-input applicability is rejected at schema time using
 * the same full-snapshot rule already enforced by the canonical semantic validator.
 */
export function createExperimentKeyedMobilizationOutput(
  snapshot: PlanningSnapshot,
): ExperimentKeyedMobilizationOutputContract {
  const immutableSnapshot = structuredClone(snapshot);
  const compact = createCompactMobilizationOutput(immutableSnapshot);
  const published = immutableSnapshot.playbooks.filter((book) => book.status === 'published');
  const evidenceIds = immutableSnapshot.evidence.map((entry) => entry.ref);
  unique(evidenceIds, 'evidence identity in planning snapshot');
  const evidenceRefs = z.array(z.enum(evidenceIds)).min(1).max(30);
  const actionEntries = published.flatMap((book) => book.content.actions.map((entry) => {
    const ref: PlaybookActionRef = { slug: book.content.slug, version: book.version, actionId: entry.id };
    return [actionKey(ref), ref] as const;
  }));
  unique(actionEntries.map(([key]) => key), 'published action identity in planning snapshot');
  const actions = new Map(actionEntries);
  const actionRef = actions.size ? z.enum([...actions.keys()]) : ActionKey;
  const reviewShape: Record<string, z.ZodType<z.infer<typeof KeyedReviewSchema>>> = {};
  for (const book of published) {
    const key = bookKey(book.content.slug, book.version);
    const missing = missingRequiredInputs(book.content.requiredInputs, immutableSnapshot);
    reviewShape[key] = KeyedReviewSchema.extend({
      applicability: missing.length ? z.enum(['not_applicable', 'insufficient_data']) : review.shape.applicability,
      evidenceRefs,
    });
  }
  const schema = KeyedOutputSchema.extend({
    assessment: KeyedOutputSchema.shape.assessment.extend({
      findings: z.array(assessment.shape.findings.element.extend({ evidenceRefs }).strict()).max(20),
      playbookAssessments: z.strictObject(reviewShape),
    }),
    mobilizations: z.array(KeyedPlanSchema.extend({
      tasks: z.array(KeyedTaskSchema.extend({
        evidenceRefs, playbookRefs: z.array(actionRef).max(actions.size ? 30 : 0),
      })).min(2).max(30),
      unmetRequirements: z.array(unmet.extend({ playbookRef: actionRef }).strict()).max(actions.size ? 30 : 0),
    })).max(8),
  });
  const resolveAction = (key: string) => {
    const ref = actions.get(key);
    if (!ref) throw new Error(`Unknown published action ${key}`);
    return { ...ref };
  };

  return {
    schema, promptSupplement,
    expand(output) {
      const wire = schema.parse(output);
      const expanded = compact.expand({
        ...wire,
        assessment: {
          ...wire.assessment,
          playbookAssessments: Object.entries(wire.assessment.playbookAssessments)
            .map(([playbookKey, judgement]) => ({ playbookKey, ...judgement })),
        },
        mobilizations: wire.mobilizations.map((entry) => ({
          ...entry,
          tasks: entry.tasks.map((item) => ({ ...item, playbookRefs: item.playbookRefs.map(resolveAction) })),
          unmetRequirements: entry.unmetRequirements.map((item) => ({ ...item, playbookRef: resolveAction(item.playbookRef) })),
        })),
      });
      const errors = validateMobilizationOutput(expanded, immutableSnapshot, immutableSnapshot.skills.map((skill) => skill.slug));
      if (errors.length) throw new Error(`Keyed output semantic validation failed: ${errors.join('; ')}`);
      return expanded;
    },
  };
}
