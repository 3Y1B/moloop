import { z } from 'zod';

import {
  MobilizationOutputSchema,
  type MobilizationOutput,
  type PlanningSnapshot,
  type PlaybookActionRef,
} from '@/lib/mobilization-contracts';
import { createCompactMobilizationOutput } from './compact-output';
import { validateMobilizationOutput } from './validate';

const assessment = MobilizationOutputSchema.shape.assessment;
const finding = assessment.shape.findings.element;
const review = assessment.shape.playbookAssessments.element;
const plan = MobilizationOutputSchema.shape.mobilizations.element;
const task = plan.shape.tasks.element;
const unmet = plan.shape.unmetRequirements.element;
const Index = z.number().int().min(0);

const ExperimentFindingSchema = z.strictObject({
  id: finding.shape.id, r: finding.shape.risk, c: finding.shape.possibleCause,
  e: z.array(Index).min(1).max(30), u: finding.shape.uncertainty,
});
const ExperimentReviewSchema = z.strictObject({
  p: Index, v: review.shape.applicability, r: review.shape.reason,
  e: z.array(Index).min(1).max(30), g: review.shape.missingInputs,
});
const ExperimentTaskSchema = z.strictObject({
  k: task.shape.key, t: task.shape.title, i: task.shape.instructions,
  tm: Index, z: Index, n: task.shape.peopleNeeded, r: task.shape.reason,
  sk: task.shape.requiredSkills, c: task.shape.completionCriteria,
  f: task.shape.addressesFindingIds, e: z.array(Index).min(1).max(30), a: z.array(Index).max(30),
});
const ExperimentUnmetSchema = z.strictObject({ a: Index, r: unmet.shape.reason });
const ExperimentPlanSchema = z.strictObject({
  t: plan.shape.title, p: plan.shape.priority, r: plan.shape.rationale,
  x: z.array(ExperimentTaskSchema).min(2).max(30), u: z.array(ExperimentUnmetSchema).max(30),
});
const ExperimentOutputSchema = z.strictObject({
  d: MobilizationOutputSchema.shape.decision,
  a: z.strictObject({
    s: assessment.shape.summary, v: assessment.shape.severity,
    f: z.array(ExperimentFindingSchema).max(20), g: assessment.shape.missingInputs,
    p: z.array(ExperimentReviewSchema),
  }),
  m: z.array(ExperimentPlanSchema).max(8),
});

export type ExperimentCompactMobilizationOutput = z.infer<typeof ExperimentOutputSchema>;
export type ExperimentOutputDictionaries = {
  evidence: readonly string[];
  playbooks: readonly string[];
  /** [playbook dictionary index, exact actionId]. These are identities, not SOP content. */
  actions: readonly (readonly [number, string])[];
  zones: readonly string[];
  teams: readonly PlanningSnapshot['teams'][number]['slug'][];
};
export type ExperimentCompactMobilizationOutputContract = {
  schema: z.ZodType<ExperimentCompactMobilizationOutput>;
  expand: (output: unknown) => MobilizationOutput;
  promptSupplement: string;
  supplementalInput: {
    wireVersion: 'mobilization.output-experiment.v1';
    dictionaries: ExperimentOutputDictionaries;
  };
};

// Explicit mappings supplement, not a replacement for the current safety/SOP assessment prompt.
const promptSupplement = `EXPERIMENTAL OUTPUT ENCODING ONLY: use the supplied short-key JSON schema instead of canonical output keys.
All assessment, evidence, uncertainty, SOP retrieval, approval, coverage and staffing rules remain unchanged.
supplementalInput.dictionaries contains 0-based arrays. e indexes evidence IDs; p in SOP reviews indexes
exact published playbook keys; task tm/z index team/zone slugs; a indexes exact action identities.
Each actions entry is [playbook dictionary index, exact actionId]. Dictionaries identify facts/actions;
they do NOT provide SOP rules or prove applicability. Read full relevant SOP content as otherwise required.
Never invent an index or duplicate an index inside one reference array. Keep finding IDs and task keys
as your own valid string IDs; task f links exactly to finding id. Return every published SOP verdict once.
Root: d=decision, a=assessment, m=mobilizations. Assessment: s=summary, v=severity, f=findings,
g=global missingInputs, p=playbookAssessments. Finding: id=id, r=risk, c=possibleCause, e=evidenceRefs,
u=uncertainty. SOP review: p=playbook index, v=applicability, r=reason, e=evidenceRefs,
g=contextualMissingInputs; the server separately adds exact unavailable requiredInputs from the full SOP.
Plan: t=title, p=priority, r=rationale, x=tasks, u=unmetRequirements. Task: k=key, t=title,
i=instructions, tm=team index, z=zone index, n=peopleNeeded, r=reason, sk=requiredSkills,
c=completionCriteria, f=addressesFindingIds, e=evidenceRefs, a=playbookRefs action indices.
Unmet requirement: a=exact action index, r=reason. An action cannot be both cited by a task and unmet
anywhere. Preserve every relevant task, gap, finding, skill, justified headcount, instruction and measurable
completion criterion. Short keys are transport encoding only: do not shorten operational content, omit
relevant actions, default missing verdicts, or infer decisions from dictionary membership.`;

const keyOf = (ref: Pick<PlaybookActionRef, 'slug' | 'version'>) => `${ref.slug}:${ref.version}`;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function assertUnique<T>(values: readonly T[], where: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${where}`);
}
const boundedIndex = (size: number) => Index.max(Math.max(0, size - 1));

/**
 * Isolated wire experiment: no provider, live input, persistence or active pipeline changes. Expansion
 * restores only exact dictionary identities and deterministic missing inputs, then rejects unchanged
 * canonical/semantic violations. No verdict, task, text, staffing quantity or SOP coverage is repaired.
 */
export function createExperimentCompactMobilizationOutput(
  snapshot: PlanningSnapshot,
): ExperimentCompactMobilizationOutputContract {
  const immutableSnapshot = structuredClone(snapshot);
  const compact = createCompactMobilizationOutput(immutableSnapshot);
  const published = immutableSnapshot.playbooks.filter((book) => book.status === 'published')
    .sort((a, b) => compare(keyOf({ slug: a.content.slug, version: a.version }), keyOf({ slug: b.content.slug, version: b.version })));
  const evidence = immutableSnapshot.evidence.map((entry) => entry.ref).sort(compare);
  const playbooks = published.map((book) => keyOf({ slug: book.content.slug, version: book.version }));
  const zones = immutableSnapshot.zones.map((zone) => zone.slug).sort(compare);
  const teams = immutableSnapshot.teams.map((team) => team.slug).sort(compare);
  const actions: PlaybookActionRef[] = published.flatMap((book) => [...book.content.actions]
    .sort((a, b) => compare(a.id, b.id))
    .map((action) => ({ slug: book.content.slug, version: book.version, actionId: action.id })));
  assertUnique(evidence, 'evidence identity in planning snapshot');
  assertUnique(zones, 'zone identity in planning snapshot');
  assertUnique(teams, 'team identity in planning snapshot');
  assertUnique(actions.map((action) => `${keyOf(action)}:${action.actionId}`), 'published action identity in planning snapshot');

  const evidenceRefs = z.array(boundedIndex(evidence.length)).min(1).max(30);
  const actionRefs = z.array(boundedIndex(actions.length)).max(actions.length ? 30 : 0);
  const schema = ExperimentOutputSchema.extend({
    a: ExperimentOutputSchema.shape.a.extend({
      f: z.array(ExperimentFindingSchema.extend({ e: evidenceRefs })).max(20),
      p: z.array(ExperimentReviewSchema.extend({ p: boundedIndex(playbooks.length), e: evidenceRefs })).length(playbooks.length),
    }),
    m: z.array(ExperimentPlanSchema.extend({
      x: z.array(ExperimentTaskSchema.extend({
        tm: boundedIndex(teams.length), z: boundedIndex(zones.length), e: evidenceRefs, a: actionRefs,
      })).min(2).max(30),
      u: z.array(ExperimentUnmetSchema.extend({ a: boundedIndex(actions.length) })).max(actions.length ? 30 : 0),
    })).max(8),
  });
  const get = <T>(dictionary: readonly T[], index: number, where: string): T => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= dictionary.length)
      throw new Error(`Unknown ${where} index ${index}`);
    return dictionary[index];
  };
  const refs = (indices: number[], where: string) => {
    assertUnique(indices, `evidence reference in ${where}`);
    return indices.map((index) => get(evidence, index, 'evidence'));
  };
  const action = (index: number) => ({ ...get(actions, index, 'published action') });
  const dictionaries: ExperimentOutputDictionaries = Object.freeze({
    evidence: Object.freeze([...evidence]), playbooks: Object.freeze([...playbooks]),
    actions: Object.freeze(actions.map((ref) => Object.freeze([
      playbooks.indexOf(keyOf(ref)), ref.actionId,
    ] as const))),
    zones: Object.freeze([...zones]), teams: Object.freeze([...teams]),
  });

  return {
    schema, promptSupplement,
    supplementalInput: Object.freeze({ wireVersion: 'mobilization.output-experiment.v1', dictionaries }),
    expand(output) {
      const wire = schema.parse(output);
      assertUnique(wire.a.p.map((entry) => entry.p), 'playbook assessment index');
      const expanded = compact.expand({
        decision: wire.d,
        assessment: {
          summary: wire.a.s, severity: wire.a.v, missingInputs: wire.a.g,
          findings: wire.a.f.map((entry) => ({ id: entry.id, risk: entry.r, possibleCause: entry.c,
            uncertainty: entry.u, evidenceRefs: refs(entry.e, `finding ${entry.id}`) })),
          playbookAssessments: wire.a.p.map((entry) => ({
            playbookKey: get(playbooks, entry.p, 'published playbook'), applicability: entry.v,
            reason: entry.r, evidenceRefs: refs(entry.e, `playbook ${entry.p}`), contextualMissingInputs: entry.g,
          })),
        },
        mobilizations: wire.m.map((entry) => ({
          title: entry.t, priority: entry.p, rationale: entry.r,
          tasks: entry.x.map((item) => {
            assertUnique(item.a, `action reference in task ${item.k}`);
            assertUnique(item.f, `finding reference in task ${item.k}`);
            return {
              key: item.k, title: item.t, instructions: item.i,
              teamSlug: get(teams, item.tm, 'team'), zoneSlug: get(zones, item.z, 'zone'),
              peopleNeeded: item.n, reason: item.r, requiredSkills: item.sk,
              completionCriteria: item.c, addressesFindingIds: item.f,
              evidenceRefs: refs(item.e, `task ${item.k}`), playbookRefs: item.a.map(action),
            };
          }),
          unmetRequirements: entry.u.map((item) => ({ playbookRef: action(item.a), reason: item.r })),
        })),
      });
      const errors = validateMobilizationOutput(expanded, immutableSnapshot, immutableSnapshot.skills.map((skill) => skill.slug));
      if (errors.length) throw new Error(`Experimental output semantic validation failed: ${errors.join('; ')}`);
      return expanded;
    },
  };
}
