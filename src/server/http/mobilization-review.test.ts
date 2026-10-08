import { describe, expect, it } from 'vitest';
import type { Mobilization } from '@/lib/schema';
import type { MobilizationOutput } from '@/lib/mobilization-contracts';
import { assertMobilizationReview, type ReviewRun } from './mobilization-review';

const output = (): MobilizationOutput => ({
  decision: 'propose', assessment: { summary: 'Test', severity: 'urgent', findings: [],
    missingInputs: [], playbookAssessments: [] },
  mobilizations: [{ title: 'Test', priority: 'P1', rationale: 'Test', tasks: ['a', 'b'].map((key) => ({
    key, title: 'Check', instructions: 'Check and report', teamSlug: 'crowd', zoneSlug: 'water-2',
    peopleNeeded: 1, reason: 'Test', requiredSkills: [], completionCriteria: 'Report delivered',
    addressesFindingIds: ['finding'], evidenceRefs: ['demo-weather'], playbookRefs: [],
  })), unmetRequirements: [] }],
});
const proposal = (): Mobilization => ({
  id: 'mob', status: 'proposed', title: 'Test', urgency: 'P1', rationale: 'Test',
  zoneSlug: 'water-2', relatedPlaybooks: [], playbookSlug: null, evidence: null,
  createdAt: 1, decidedAt: null, decidedById: null, analysisRunId: 'run',
  steps: output().mobilizations[0].tasks.map(({ key, ...task }) => ({ ...task, stepKey: key, candidates: [] })),
});
const run = (): ReviewRun => ({ id: 'run', status: 'completed', result: output(),
  input_snapshot: { schemaVersion: 1 }, validation_errors: [], mobilization_ids: ['mob'] });

describe('Mo approves the plan he reviewed', () => {
  it('permits a reviewed, valid plan', () => {
    expect(() => assertMobilizationReview(proposal(), run(), { reviewedRunId: 'run' })).not.toThrow();
  });
  it.each([undefined, 'other'])('rejects missing or stale reviewed run identity %s', (reviewedRunId) => {
    expect(() => assertMobilizationReview(proposal(), run(), { reviewedRunId })).toThrow('Load and review');
  });
  it.each(['running', 'failed', 'configuration_required'])('rejects a %s analysis', (status) => {
    expect(() => assertMobilizationReview(proposal(), { ...run(), status }, { reviewedRunId: 'run' }))
      .toThrow('unavailable or invalid');
  });
  it.each([
    null, { ...run(), id: 'wrong' }, { ...run(), result: null }, { ...run(), input_snapshot: null },
    { ...run(), validation_errors: ['invalid'] }, { ...run(), validation_errors: null },
    { ...run(), mobilization_ids: ['other'] }, { ...run(), mobilization_ids: ['mob', 'mob'] },
  ])('rejects an unavailable, unmapped or invalid audit', (row) => {
    expect(() => assertMobilizationReview(proposal(), row, { reviewedRunId: 'run' })).toThrow();
  });
  it('uses immutable ID ordering, not matching titles, when two plans exist', () => {
    const value = run(); const data = output();
    data.mobilizations.push({ ...structuredClone(data.mobilizations[0]),
      tasks: data.mobilizations[0].tasks.map((task) => ({ ...task, key: `other-${task.key}` })) });
    value.result = data; value.mobilization_ids = ['other', 'mob'];
    expect(() => assertMobilizationReview(proposal(), value, { reviewedRunId: 'run' })).toThrow('no longer matches');
  });
  it.each(['stepKey', 'teamSlug', 'zoneSlug', 'peopleNeeded'] as const)('rejects modified %s rather than approving another scope', (key) => {
    const value = proposal();
    Object.assign(value.steps[0], { [key]: key === 'peopleNeeded' ? 2 : 'different' });
    expect(() => assertMobilizationReview(value, run(), { reviewedRunId: 'run' })).toThrow('no longer matches');
  });
  it.each(['title', 'instructions', 'reason', 'completionCriteria'] as const)('rejects modified operational %s', (key) => {
    const value = proposal(); value.steps[0][key] = 'Changed since analysis';
    expect(() => assertMobilizationReview(value, run(), { reviewedRunId: 'run' })).toThrow('no longer matches');
  });
  it('approves with unmet SOP actions or missing inputs: Mo saw them, nothing to tick', () => {
    const value = run(); const data = output();
    data.mobilizations[0].unmetRequirements = [{ playbookRef: { slug: 'heat', version: 1, actionId: 'water' }, reason: 'Assets unverified' }];
    data.assessment.missingInputs = ['event heat threshold'];
    value.result = data;
    expect(() => assertMobilizationReview(proposal(), value, { reviewedRunId: 'run' })).not.toThrow();
  });
  it('a plan without an analysis (the playbook\'s own) needs no review run', () => {
    expect(() => assertMobilizationReview({ ...proposal(), analysisRunId: null }, null, {})).not.toThrow();
  });
});
