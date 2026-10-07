import { z } from 'zod';

import {
  MobilizationOutputSchema,
  type MobilizationOutput,
  type PlanningSnapshot,
  type PlaybookActionRef,
} from '@/lib/mobilization-contracts';
import { createCompactMobilizationOutput } from './compact-output';

const assessment = MobilizationOutputSchema.shape.assessment;
const review = assessment.shape.playbookAssessments.element;
const plan = MobilizationOutputSchema.shape.mobilizations.element;
const task = plan.shape.tasks.element;
const CompactReview = review.omit({ slug: true, version: true, missingInputs: true }).extend({
  playbookKey: z.string().min(1), contextualMissingInputs: review.shape.missingInputs,
}).strict();
// Every slot is an explicit AI choice. Null is a value, never an omitted/defaulted decision.
const ActionChoice = z.strictObject({
  taskKey: task.shape.key.nullable(),
  blocker: plan.shape.unmetRequirements.element.shape.reason.nullable(),
}).meta({ id: 'mobilization_action_choice' });
const ActionTask = task.omit({ playbookRefs: true, addressesFindingIds: true }).extend({
  // The model explicitly chooses one primary finding; expansion never repairs or deletes links.
  addressesFindingId: task.shape.addressesFindingIds.element,
}).strict();
const ActionPlan = plan.omit({ unmetRequirements: true }).extend({
  tasks: z.array(ActionTask).min(2).max(30),
}).strict();
const ActionOutput = MobilizationOutputSchema.extend({
  assessment: assessment.extend({
    findings: z.array(assessment.shape.findings.element.strict()).max(20),
    playbookAssessments: z.array(CompactReview),
  }).strict(),
  mobilizations: z.array(ActionPlan).max(8),
  actionCoverage: z.record(z.string(), ActionChoice),
}).strict();

export type ActionMobilizationOutput = z.infer<typeof ActionOutput>;
export type ActionMobilizationOutputContract = {
  /** Resolve after the one audited SOP read. Subsequent uses retain that exact selected key set. */
  schema: () => z.ZodType<ActionMobilizationOutput>;
  expand: (output: unknown) => MobilizationOutput;
  promptSupplement: string;
};

const promptSupplement = `REQUIRED ACTION ACCOUNTING WIRE FORMAT. Preserve all existing safety,
evidence, SOP retrieval, approval, staffing and judgement requirements and all readable task content.
Keep the canonical compact review array: playbookKey, applicability, reason, evidenceRefs and
contextualMissingInputs. Do not put playbookRefs in tasks or unmetRequirements in plans.
In this wire format each task uses singular addressesFindingId, NOT addressesFindingIds. Choose one
primary safety finding and cite at least one of its actual evidenceRefs. Every finding in a proposal
must have at least one task choosing it as primary; consolidate overlapping risks if appropriate.
The server expands that exact primary choice to a one-element canonical array, never filling or
dropping a model's link. Multiple tasks may share a primary finding; no task may claim a second one.
The tool's requiredInputChecks lists each selected playbookKey and unavailableRequiredInputs.
Use those exact deterministic checks: a nonempty unavailableRequiredInputs forbids applicable;
choose insufficient_data or not_applicable from the observed trigger evidence, never by default.
Instead actionCoverage is a strict object with one REQUIRED exact "slug:version:actionId" slot for
EVERY action in the SOPs actually read by get_playbooks (no slots for unread/unrelated SOPs).
Every value must include BOTH taskKey and blocker. Choose the exact globally unique task key only
when that task fully proposes the source action, with its original team, required skills, minimum
staffing and complete operational instructions; otherwise choose a concrete blocker and taskKey:null.
Never choose both. For a retrieved SOP assessed not_applicable, BOTH values must be null. For a
relevant MUST action in a proposal, exactly one value must be non-null: an omission is forbidden.
Recommended actions may explicitly use null/null when not proposed. A no-plan decision may use
null/null, but cannot contain an orphan task reference or blocker. Blockers are retained on the first
canonical plan; they do not become tasks, invent approvals or silently authorize partial SOP execution.
All task keys must be unique ACROSS all plans. No numeric aliases, defaults or implicit decisions.
Do not drop findings, contextual gaps, uncertainty, operational instructions or completion criteria
to shorten output. Canonical semantic and full-retrieval checks still run after exact expansion.`;

/** The same contract when the server read the one triggered SOP and put it in the prompt (no get_playbooks call). */
export const TRIGGERED_SUPPLEMENT = promptSupplement
  .replace("The tool's requiredInputChecks lists each selected playbookKey", 'retrievedPlaybooks.requiredInputChecks lists the playbookKey')
  .replace('EVERY action in the SOPs actually read by get_playbooks', 'EVERY action in the SOP in retrievedPlaybooks');
if (TRIGGERED_SUPPLEMENT.includes('get_playbooks') || TRIGGERED_SUPPLEMENT.includes("The tool's"))
  throw new Error('Triggered prompt supplement still refers to the retrieval tool');

const bookKey = (slug: string, version: number) => `${slug}:${version}`;
const actionKey = (ref: PlaybookActionRef) => `${bookKey(ref.slug, ref.version)}:${ref.actionId}`;
const unique = (values: readonly string[], where: string) => {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${where}`);
};

/**
 * Immutable and lossless action identity expansion. Required choices are generated
 * from the actual read, not fabricated for every published SOP. This neither repairs AI decisions
 * nor replaces the caller's unchanged canonical semantic/retrieval validation.
 */
export function createActionMobilizationOutput(
  snapshot: PlanningSnapshot,
  getSelectedKeys: () => readonly string[],
  supplement = promptSupplement,
): ActionMobilizationOutputContract {
  const captured = structuredClone(snapshot);
  const compact = createCompactMobilizationOutput(captured);
  const published = captured.playbooks.filter((book) => book.status === 'published');
  const books = new Map(published.map((book) => [bookKey(book.content.slug, book.version), book]));
  const evidenceIds = captured.evidence.map((entry) => entry.ref);
  unique(evidenceIds, 'evidence identity in planning snapshot');
  const evidenceRefs = z.array(z.enum(evidenceIds)).min(1).max(30);
  const allActions = published.flatMap((book) => book.content.actions.map((action) => {
    const ref: PlaybookActionRef = { slug: book.content.slug, version: book.version, actionId: action.id };
    return [actionKey(ref), { ref, action }] as const;
  }));
  unique(allActions.map(([key]) => key), 'published action identity in planning snapshot');
  let schema: z.ZodType<ActionMobilizationOutput> | undefined;
  let selectedActions = new Map<string, typeof allActions[number][1]>();

  const resolveSchema = () => {
    if (schema) return schema;
    const selected = getSelectedKeys();
    if (!Array.isArray(selected) || !selected.every((key) => typeof key === 'string' && books.has(key)))
      throw new Error('Invalid retrieved published playbook selection');
    unique(selected, 'retrieved published playbook key');
    const selectedSet = new Set(selected);
    const entries = allActions.filter(([, entry]) => selectedSet.has(bookKey(entry.ref.slug, entry.ref.version)));
    const choices = Object.fromEntries(entries.map(([key]) => [key, ActionChoice]));
    const candidate = ActionOutput.extend({
      assessment: ActionOutput.shape.assessment.extend({
        findings: z.array(assessment.shape.findings.element.extend({ evidenceRefs }).strict()).max(20),
        playbookAssessments: z.array(CompactReview.extend({
          playbookKey: books.size ? z.enum([...books.keys()]) : CompactReview.shape.playbookKey,
          evidenceRefs,
        }).strict()).length(books.size),
      }).strict(),
      mobilizations: z.array(ActionPlan.extend({
        tasks: z.array(ActionTask.extend({ evidenceRefs }).strict()).min(2).max(30),
      }).strict()).max(8),
      actionCoverage: z.strictObject(choices),
    }).strict();
    selectedActions = new Map(entries);
    schema = candidate;
    return schema;
  };

  return {
    schema: resolveSchema, promptSupplement: supplement,
    expand(output) {
      const wire = resolveSchema().parse(output);
      const { actionCoverage, ...value } = wire;
      const expandedPlans = value.mobilizations.map((entry) => ({
        ...entry,
        tasks: entry.tasks.map(({ addressesFindingId, ...item }) => ({ ...item,
          addressesFindingIds: [addressesFindingId], playbookRefs: [] as PlaybookActionRef[] })),
        unmetRequirements: [] as MobilizationOutput['mobilizations'][number]['unmetRequirements'],
      }));
      const taskEntries = expandedPlans.flatMap((entry) => entry.tasks.map((item) => [item.key, item] as const));
      unique(taskEntries.map(([key]) => key), 'task key across plans');
      const tasks = new Map(taskEntries);
      const reviews = new Map(value.assessment.playbookAssessments.map((entry) => [entry.playbookKey, entry]));
      unique(value.assessment.playbookAssessments.map((entry) => entry.playbookKey), 'playbook assessment');
      for (const [key, { ref, action }] of selectedActions) {
        const choice = actionCoverage[key];
        if (!choice) throw new Error(`Missing action choice ${key}`);
        const judgement = reviews.get(bookKey(ref.slug, ref.version));
        if (!judgement) throw new Error(`Missing playbook assessment ${bookKey(ref.slug, ref.version)}`);
        const chosenTask = choice.taskKey !== null;
        const blocked = choice.blocker !== null;
        if (chosenTask && blocked) throw new Error(`Action ${key} is both covered and unmet`);
        if (judgement.applicability === 'not_applicable') {
          if (chosenTask || blocked) throw new Error(`Action ${key} cites a not-applicable playbook`);
          continue;
        }
        if (!chosenTask && !blocked) {
          if (wire.decision === 'propose' && action.requirement === 'must')
            throw new Error(`Missing required action decision ${key}`);
          continue;
        }
        if (chosenTask) {
          const target = tasks.get(choice.taskKey!);
          if (!target) throw new Error(`Action ${key} cites unknown task ${choice.taskKey}`);
          if (target.teamSlug !== action.teamSlug) throw new Error(`Action ${key} conflicts with task team`);
          if (action.requiredSkills.some((skill) => !target.requiredSkills.includes(skill)))
            throw new Error(`Action ${key} omits required task skills`);
          if (action.peopleNeeded != null && target.peopleNeeded < action.peopleNeeded)
            throw new Error(`Action ${key} understates task staffing`);
          target.playbookRefs.push({ ...ref });
        } else {
          if (!expandedPlans[0]) throw new Error(`Action ${key} has no plan for its blocker`);
          expandedPlans[0].unmetRequirements.push({ playbookRef: { ...ref }, reason: choice.blocker! });
        }
      }
      // Expansion adds identities and deterministic gaps only. The caller must still validate
      // semantics and that every relevant SOP was fully retrieved; no blanket pass is implied.
      return compact.expand({ ...value, mobilizations: expandedPlans });
    },
  };
}
