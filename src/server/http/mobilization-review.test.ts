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
const allocated = { requiredCount: 1, assigneeId: 'crew', helpers: [] };

describe('transactional Mo analysis review gate', () => {
  it('permits a reviewed, valid and fully staffed plan without gaps', () => {
    expect(() => assertMobilizationReview(proposal(), run(), { reviewedRunId: 'run' }, [allocated])).not.toThrow();
  });
  it.each([undefined, 'other'])('rejects missing or stale reviewed run identity %s', (reviewedRunId) => {
    expect(() => assertMobilizationReview(proposal(), run(), { reviewedRunId }, [allocated])).toThrow('Load and review');
  });
  it.each(['running', 'failed', 'configuration_required'])('rejects non-completed %s analyses even with acknowledgement', (status) => {
    expect(() => assertMobilizationReview(proposal(), { ...run(), status },
      { reviewedRunId: 'run', acknowledgeGaps: true }, [allocated])).toThrow('unavailable or invalid');
  });
  it.each([
    null, { ...run(), id: 'wrong' }, { ...run(), result: null }, { ...run(), input_snapshot: null },
    { ...run(), validation_errors: ['invalid'] }, { ...run(), validation_errors: null },
    { ...run(), mobilization_ids: ['other'] }, { ...run(), mobilization_ids: ['mob', 'mob'] },
  ])('rejects an unavailable, unmapped or invalid audit', (row) => {
    expect(() => assertMobilizationReview(proposal(), row, { reviewedRunId: 'run' }, [allocated])).toThrow();
  });
  it('uses immutable ID ordering, not matching titles, when two plans exist', () => {
    const value = run(); const data = output();
    data.mobilizations.push({ ...structuredClone(data.mobilizations[0]),
      tasks: data.mobilizations[0].tasks.map((task) => ({ ...task, key: `other-${task.key}` })) });
    value.result = data; value.mobilization_ids = ['other', 'mob'];
    expect(() => assertMobilizationReview(proposal(), value, { reviewedRunId: 'run' }, [allocated])).toThrow('no longer matches');
  });
  it.each(['stepKey', 'teamSlug', 'zoneSlug', 'peopleNeeded'] as const)('rejects modified %s rather than approving another scope', (key) => {
    const value = proposal();
    Object.assign(value.steps[0], { [key]: key === 'peopleNeeded' ? 2 : 'different' });
    expect(() => assertMobilizationReview(value, run(), { reviewedRunId: 'run' }, [allocated])).toThrow('no longer matches');
  });
  it.each(['title', 'instructions', 'reason', 'completionCriteria'] as const)('rejects modified operational %s', (key) => {
    const value = proposal(); value.steps[0][key] = 'Changed since analysis';
    expect(() => assertMobilizationReview(value, run(), { reviewedRunId: 'run' }, [allocated])).toThrow('no longer matches');
  });
  it('requires explicit acknowledgement of unmet full SOP actions', () => {
    const value = run(); const data = output();
    data.mobilizations[0].unmetRequirements = [{ playbookRef: { slug: 'heat', version: 1, actionId: 'water' }, reason: 'Assets unverified' }];
    value.result = data;
    expect(() => assertMobilizationReview(proposal(), value, { reviewedRunId: 'run' }, [allocated])).toThrow('acknowledge');
    expect(() => assertMobilizationReview(proposal(), value, { reviewedRunId: 'run', acknowledgeGaps: true }, [allocated])).not.toThrow();
  });
  it('checks actual allocation, not stale preview counts', () => {
    const gap = { requiredCount: 2, assigneeId: 'crew', helpers: [] };
    expect(() => assertMobilizationReview(proposal(), run(), { reviewedRunId: 'run' }, [gap])).toThrow('acknowledge');
    expect(() => assertMobilizationReview(proposal(), run(), { reviewedRunId: 'run', acknowledgeGaps: true }, [gap])).not.toThrow();
  });
  it('requires acknowledgement for an unmet action on a sibling plan', () => {
    const value = run(); const data = output();
    data.mobilizations.push({ ...structuredClone(data.mobilizations[0]),
      tasks: data.mobilizations[0].tasks.map((task) => ({ ...task, key: `other-${task.key}` })),
      unmetRequirements: [{ playbookRef: { slug: 'heat', version: 1, actionId: 'water' }, reason: 'Unverified location' }] });
    value.result = data; value.mobilization_ids = ['mob', 'other'];
    expect(() => assertMobilizationReview(proposal(), value, { reviewedRunId: 'run' }, [allocated])).toThrow('acknowledge');
    expect(() => assertMobilizationReview(proposal(), value, { reviewedRunId: 'run', acknowledgeGaps: true }, [allocated])).not.toThrow();
  });
  it.each(['global', 'relevant'] as const)('requires acknowledgement of %s missing inputs', (scope) => {
    const value = run(); const data = output();
    if (scope === 'global') data.assessment.missingInputs = ['event heat threshold'];
    else data.assessment.playbookAssessments = [{ slug: 'heat', version: 1,
      applicability: 'insufficient_data', reason: 'Observed heat; threshold unknown',
      evidenceRefs: ['demo-weather'], missingInputs: ['event heat threshold'] }];
    value.result = data;
    expect(() => assertMobilizationReview(proposal(), value, { reviewedRunId: 'run' }, [allocated])).toThrow('acknowledge');
    expect(() => assertMobilizationReview(proposal(), value, { reviewedRunId: 'run', acknowledgeGaps: true }, [allocated])).not.toThrow();
  });
  it('does not make unrelated unmeasured sensors an acknowledgement prerequisite', () => {
    const value = run(); const data = output();
    data.assessment.playbookAssessments = [{ slug: 'gate', version: 1,
      applicability: 'not_applicable', reason: 'No gate trigger evidence',
      evidenceRefs: ['demo-weather'], missingInputs: ['gate sensors'] }];
    value.result = data;
    expect(() => assertMobilizationReview(proposal(), value, { reviewedRunId: 'run' }, [allocated])).not.toThrow();
  });
  it('counts unique recruited people and includes notified helpers', () => {
    const helper = { volunteerId: 'crew-2', status: 'notified' as const, assignedAt: 1, respondedAt: null };
    const staffed = { requiredCount: 2, assigneeId: 'crew', helpers: [helper] };
    expect(() => assertMobilizationReview(proposal(), run(), { reviewedRunId: 'run' }, [staffed])).not.toThrow();
    expect(() => assertMobilizationReview(proposal(), run(), { reviewedRunId: 'run' },
      [{ ...staffed, helpers: [{ ...helper, volunteerId: 'crew' }] }])).toThrow('acknowledge');
  });
  it('keeps manual proposals independent of AI audit availability but acknowledges staff gaps', () => {
    const manual = { ...proposal(), analysisRunId: null };
    expect(() => assertMobilizationReview(manual, null, {}, [allocated])).not.toThrow();
    expect(() => assertMobilizationReview(manual, null, {}, [{ ...allocated, assigneeId: null }])).toThrow('acknowledge');
  });
});
