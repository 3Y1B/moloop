import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MobilizationOutputSchema, type ManagedPlaybook, type PlanningSnapshot } from '@/lib/mobilization-contracts';
import { createActionMobilizationOutput, type ActionMobilizationOutput } from './action-output';
import { createPlaybookRetrieval } from './playbook-retrieval';
import { validateMobilizationOutput } from './validate';

const at = '2026-10-08T04:00:00.000Z';
function book(slug: string): ManagedPlaybook {
  return { id: slug, version: 2, status: 'published', createdAt: at, updatedAt: at, publishedAt: at,
    content: { schemaVersion: 1, slug, title: slug, appliesWhen: 'Test condition', requiredInputs: ['weather.trendCPerHour'],
      constraints: [], decisionPoints: [], source: 'Unit test fixture only', actions: [{
        id: 'assess', requirement: 'must', teamSlug: 'first-aid', title: 'Assess',
        instructions: 'Assess the affected visitors', peopleNeeded: 2, requiredSkills: ['clinical'],
        staffingGuidance: 'Two qualified responders', locationGuidance: 'Affected zone', completionCriteria: 'Record assessment',
      }] } };
}
function snapshot(): PlanningSnapshot {
  const heat = book('heat-response');
  heat.content.actions.push({ ...heat.content.actions[0], id: 'supply', teamSlug: 'ops', requiredSkills: [], peopleNeeded: 1 });
  heat.content.actions.push({ ...heat.content.actions[0], id: 'observe', requirement: 'recommended', requiredSkills: [] });
  return { schemaVersion: 1, evaluatedAt: at,
    scenario: { requestId: 'action-output-test-001',
      weather: { temperatureC: 41, trendCPerHour: null, condition: 'clear', warning: 'heat', warningInMinutes: 0 },
      upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [] },
    zones: [{ slug: 'water-2', name: 'Water Station 2', kind: 'water', capacity: null, isOpenAir: true }],
    teams: [{ slug: 'first-aid', name: 'First Aid', description: 'Assessment' },
      { slug: 'ops', name: 'Operations', description: 'Supply' }],
    skills: [{ slug: 'clinical', name: 'Clinical qualification' }], routes: [], roster: [], existingResponses: [],
    evidence: [{ ref: 'demo-weather', kind: 'weather', zoneSlug: null, observedAt: at,
      source: 'manual_demo', value: { temperatureC: 41 } }],
    playbooks: [heat, book('wind-response')],
  };
}
function wire(): ActionMobilizationOutput {
  const task = (key: string) => ({ key, title: `Assess ${key}`, instructions: `Assess the visitor group ${key} at water-2`,
    teamSlug: 'first-aid' as const, zoneSlug: 'water-2', peopleNeeded: 2, requiredSkills: ['clinical'],
    reason: 'Reported heat warrants assessment', completionCriteria: `Record status for ${key}`,
    addressesFindingId: 'heat-risk', evidenceRefs: ['demo-weather'] });
  return { decision: 'propose', assessment: {
    summary: 'Assess the affected visitors', severity: 'urgent',
    findings: [{ id: 'heat-risk', risk: 'Heat exposure warrants assessment', possibleCause: 'Heat may contribute',
      uncertainty: 'No clinical cause is established', evidenceRefs: ['demo-weather'] }], missingInputs: ['Current patient status'],
    playbookAssessments: [
      { playbookKey: 'heat-response:2', applicability: 'insufficient_data', reason: 'The temperature trend is unknown',
        evidenceRefs: ['demo-weather'], contextualMissingInputs: ['Current patient status'] },
      { playbookKey: 'wind-response:2', applicability: 'not_applicable', reason: 'No wind trigger in this input',
        evidenceRefs: ['demo-weather'], contextualMissingInputs: [] },
    ],
  }, mobilizations: [{ title: 'Protective assessment', priority: 'P1', rationale: 'Assess before any wider action',
    tasks: [task('group-one'), task('group-two')] }], actionCoverage: {
    'heat-response:2:assess': { taskKey: 'group-one', blocker: null },
    'heat-response:2:supply': { taskKey: null, blocker: 'No approved water supply is established' },
    'heat-response:2:observe': { taskKey: null, blocker: null },
  } };
}
const contract = (input = snapshot(), keys: string[] = ['heat-response:2']) =>
  createActionMobilizationOutput(input, () => keys);
const nested = (value: unknown, ...keys: string[]) => keys.reduce<unknown>((node, key) =>
  node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined, value);

describe('required retrieved-action output (offline only)', () => {
  it('requires every selected action slot and both nullable choices without repeated per-task refs', () => {
    const schema = z.toJSONSchema(contract().schema());
    expect(nested(schema, 'properties', 'actionCoverage')).toMatchObject({ type: 'object',
      required: ['heat-response:2:assess', 'heat-response:2:supply', 'heat-response:2:observe'], additionalProperties: false });
    expect(nested(schema, '$defs', 'mobilization_action_choice')).toMatchObject({
      type: 'object', required: ['taskKey', 'blocker'], additionalProperties: false,
    });
    expect(nested(schema, 'properties', 'actionCoverage', 'properties', 'heat-response:2:assess'))
      .toEqual({ $ref: '#/$defs/mobilization_action_choice' });
    expect(nested(schema, 'properties', 'mobilizations', 'items', 'properties')).not.toHaveProperty('unmetRequirements');
    expect(nested(schema, 'properties', 'mobilizations', 'items', 'properties', 'tasks', 'items', 'properties'))
      .not.toHaveProperty('playbookRefs');
    expect(JSON.stringify(nested(schema, 'properties', 'actionCoverage'))).not.toContain('wind-response');
  });

  it('expands the exact AI choices into canonical task references and blockers, retaining content', () => {
    const input = snapshot(); const output = wire(); const result = contract(input).expand(output);
    const { addressesFindingId, ...wireTask } = output.mobilizations[0].tasks[0];
    expect(result.mobilizations[0].tasks[0]).toEqual({ ...wireTask, addressesFindingIds: [addressesFindingId],
      playbookRefs: [{ slug: 'heat-response', version: 2, actionId: 'assess' }] });
    expect(result.mobilizations[0].tasks[1].playbookRefs).toEqual([]);
    expect(result.mobilizations[0].unmetRequirements).toEqual([{ playbookRef: {
      slug: 'heat-response', version: 2, actionId: 'supply' }, reason: output.actionCoverage['heat-response:2:supply'].blocker }]);
    expect(result.assessment.playbookAssessments[0].missingInputs)
      .toEqual(['weather.trendCPerHour', 'Current patient status']);
    expect(result.assessment.findings).toEqual(output.assessment.findings);
    expect(MobilizationOutputSchema.safeParse(result).success).toBe(true);
    expect(validateMobilizationOutput(result, input, ['clinical'])).toEqual([]);
    const retrieval = createPlaybookRetrieval(input); retrieval.read({ playbookKeys: ['heat-response:2'] });
    expect(retrieval.validate(result)).toEqual([]);
    expect(output.mobilizations[0].tasks[0]).not.toHaveProperty('playbookRefs');
  });

  it.each(['missing_slot', 'extra_slot', 'wrong_version', 'missing_taskKey', 'missing_blocker', 'extra_choice_field', 'numeric_taskKey'])(
    'rejects %s without filling any decision', (kind) => {
      const output = wire();
      if (kind === 'missing_slot') delete output.actionCoverage['heat-response:2:supply'];
      if (kind === 'extra_slot') output.actionCoverage['wind-response:2:assess'] = { taskKey: null, blocker: null };
      if (kind === 'wrong_version') {
        output.actionCoverage['heat-response:3:assess'] = output.actionCoverage['heat-response:2:assess'];
        delete output.actionCoverage['heat-response:2:assess'];
      }
      const value = output.actionCoverage['heat-response:2:supply'];
      if (kind === 'missing_taskKey') Reflect.deleteProperty(value, 'taskKey');
      if (kind === 'missing_blocker') Reflect.deleteProperty(value, 'blocker');
      if (kind === 'extra_choice_field') Object.assign(value, { approve: true });
      if (kind === 'numeric_taskKey') Object.assign(value, { taskKey: 0 });
      expect(contract().schema().safeParse(output).success).toBe(false);
      expect(() => contract().expand(output)).toThrow();
    });

  it.each(['none', 'both', 'unknown_task', 'blank_blocker', 'wrong_team', 'missing_skill', 'too_few_people'])(
    'rejects invalid required action choice %s, without repair', (kind) => {
      const output = wire(); const choice = output.actionCoverage['heat-response:2:assess'];
      if (kind === 'none') choice.taskKey = null;
      if (kind === 'both') choice.blocker = 'A concrete blocker';
      if (kind === 'unknown_task') choice.taskKey = 'invented';
      if (kind === 'blank_blocker') { choice.taskKey = null; choice.blocker = ' '; }
      if (kind === 'wrong_team') output.mobilizations[0].tasks[0].teamSlug = 'ops' as never;
      if (kind === 'missing_skill') output.mobilizations[0].tasks[0].requiredSkills = [];
      if (kind === 'too_few_people') output.mobilizations[0].tasks[0].peopleNeeded = 1;
      expect(() => contract().expand(output)).toThrow();
    });

  it('requires explicit null/null for retrieved not-applicable SOPs, with no fabricated unmet action', () => {
    const output = wire(); output.actionCoverage['wind-response:2:assess'] = { taskKey: null, blocker: null };
    const c = contract(snapshot(), ['heat-response:2', 'wind-response:2']);
    const result = c.expand(output);
    expect(result.mobilizations[0].unmetRequirements).toHaveLength(1);
    output.actionCoverage['wind-response:2:assess'].blocker = 'Not applicable is not a blocker';
    expect(() => c.expand(output)).toThrow('not-applicable');
  });

  it('can explicitly cite or skip a recommended action without losing full-citation capability', () => {
    const output = wire(); const c = contract();
    expect(c.expand(output).mobilizations[0].tasks[1].playbookRefs).toEqual([]);
    output.actionCoverage['heat-response:2:observe'] = { taskKey: 'group-two', blocker: null };
    expect(c.expand(output).mobilizations[0].tasks[1].playbookRefs)
      .toEqual([{ slug: 'heat-response', version: 2, actionId: 'observe' }]);
  });

  it('rejects duplicate task keys across plans and attaches blockers to the first plan only', () => {
    const output = wire(); output.mobilizations.push(structuredClone(output.mobilizations[0]));
    expect(() => contract().expand(output)).toThrow('task key across plans');
    output.mobilizations[1].tasks.forEach((task, i) => { task.key = `other-${i}`; });
    output.actionCoverage['heat-response:2:assess'].taskKey = 'other-0';
    const result = contract().expand(output);
    expect(result.mobilizations[1].tasks[0].playbookRefs).toHaveLength(1);
    expect(result.mobilizations[0].unmetRequirements).toHaveLength(1);
    expect(result.mobilizations[1].unmetRequirements).toEqual([]);
  });

  it.each(['no_mobilization', 'insufficient_data'] as const)('supports %s without fabricating plans or orphan blockers', (decision) => {
    const output = wire(); output.decision = decision; output.mobilizations = [];
    for (const value of Object.values(output.actionCoverage)) { value.taskKey = null; value.blocker = null; }
    expect(contract().expand(output).mobilizations).toEqual([]);
    output.actionCoverage['heat-response:2:supply'].blocker = 'A concrete prerequisite is unavailable';
    expect(() => contract().expand(output)).toThrow('no plan for its blocker');
    output.actionCoverage['heat-response:2:supply'].blocker = null;
    output.actionCoverage['heat-response:2:assess'].taskKey = 'group-one';
    expect(() => contract().expand(output)).toThrow('unknown task');
  });

  it('supports an empty retrieved selection while retaining external retrieval safety checks', () => {
    const input = snapshot(); const output = wire(); output.actionCoverage = {};
    const result = contract(input, []).expand(output);
    expect(result.mobilizations[0].tasks.every((task) => task.playbookRefs.length === 0)).toBe(true);
    expect(createPlaybookRetrieval(input).validate(result)).toContain(
      'Playbook heat-response:2 requires full SOP retrieval before assessment or citation');
    const none = wire(); none.decision = 'no_mobilization'; none.mobilizations = []; none.actionCoverage = {};
    none.assessment.playbookAssessments.forEach((review) => { review.applicability = 'not_applicable'; });
    expect(contract(input, []).expand(none).decision).toBe('no_mobilization');
  });

  it.each([{ keys: ['unknown:2'] }, { keys: ['heat-response:3'] }, { keys: ['heat-response:2', 'heat-response:2'] }])(
    'rejects invalid retrieved selection $keys during schema resolution', ({ keys }) => {
      expect(() => contract(snapshot(), keys).schema()).toThrow();
    });

  it('captures the published snapshot and selected keys at resolution, not later mutations', () => {
    const input = snapshot(); let selected: string[] = [];
    const c = createActionMobilizationOutput(input, () => selected);
    selected = ['heat-response:2']; input.playbooks[0].content.actions[0].teamSlug = 'ops';
    const resolved = c.schema(); selected.push('wind-response:2');
    expect(c.schema()).toBe(resolved);
    expect(c.expand(wire()).mobilizations[0].tasks[0].playbookRefs).toHaveLength(1);
  });

  it('does not accept legacy hidden refs or unmet arrays alongside mandatory choices', () => {
    for (const field of ['playbookRefs', 'unmetRequirements', 'addressesFindingIds']) {
      const output = wire();
      if (field === 'playbookRefs') Object.assign(output.mobilizations[0].tasks[0], { playbookRefs: [] });
      else if (field === 'unmetRequirements') Object.assign(output.mobilizations[0], { unmetRequirements: [] });
      else Object.assign(output.mobilizations[0].tasks[0], { addressesFindingIds: ['heat-risk'] });
      expect(contract().schema().safeParse(output).success).toBe(false);
    }
  });
  it('requires an explicit primary finding and preserves that exact choice without auto-repair', () => {
    const output = wire(); const c = contract();
    expect(c.expand(output).mobilizations[0].tasks[0].addressesFindingIds).toEqual(['heat-risk']);
    Reflect.deleteProperty(output.mobilizations[0].tasks[0], 'addressesFindingId');
    expect(() => c.expand(output)).toThrow();
  });
});
