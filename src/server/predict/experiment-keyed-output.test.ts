import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MobilizationOutputSchema, type ManagedPlaybook, type PlanningSnapshot } from '@/lib/mobilization-contracts';
import { createCompactMobilizationOutput, type CompactMobilizationOutput } from './compact-output';
import { createExperimentKeyedMobilizationOutput, type ExperimentKeyedMobilizationOutput } from './experiment-keyed-output';
import { validateMobilizationOutput } from './validate';

const at = '2026-10-08T04:00:00.000Z';
function book(slug: string, requiredInputs: string[]): ManagedPlaybook {
  return {
    id: slug, version: 2, status: 'published', createdAt: at, updatedAt: at, publishedAt: at,
    content: { schemaVersion: 1, slug, title: slug, appliesWhen: 'Test condition', requiredInputs,
      constraints: [], decisionPoints: [], source: 'Unit test fixture only',
      actions: [{ id: 'assess', requirement: 'must', teamSlug: 'first-aid', title: 'Assess',
        instructions: 'Assess the affected visitors', peopleNeeded: 1, requiredSkills: [],
        staffingGuidance: 'One responder', locationGuidance: 'Affected zone', completionCriteria: 'Record assessment' }] },
  };
}
function snapshot(): PlanningSnapshot {
  return {
    schemaVersion: 1, evaluatedAt: at,
    scenario: { requestId: 'keyed-output-test-001',
      weather: { temperatureC: 41, trendCPerHour: null, condition: 'clear', warning: 'heat', warningInMinutes: 0 },
      upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [{
        key: 'audienceByZone', kind: 'zone_counts', minutesAgo: 2, zoneSlug: null,
        value: { coverage: 'partial', entries: [{ zoneSlug: 'water-2', count: 220 }] },
      }] },
    zones: [{ slug: 'water-2', name: 'Water Station 2', kind: 'water', capacity: null, isOpenAir: true }],
    teams: [{ slug: 'first-aid', name: 'First Aid', description: 'Clinical assessment' }],
    skills: [], routes: [], roster: [], existingResponses: [],
    evidence: [{ ref: 'demo-weather', kind: 'weather', zoneSlug: null, observedAt: at,
      source: 'manual_demo', value: { temperatureC: 41 } }],
    playbooks: [book('heat-response', ['weather.temperature', 'weather.trendCPerHour', 'unknownSensor']),
      book('wind-response', ['weather.condition'])],
  };
}
function compactWire(): CompactMobilizationOutput {
  const task = (key: string) => ({
    key, title: `Assess ${key}`, instructions: `Assess the visitor group ${key} at water-2`,
    teamSlug: 'first-aid' as const, zoneSlug: 'water-2', peopleNeeded: 1, requiredSkills: [],
    reason: 'Reported hypothetical heat warrants assessment', completionCriteria: `Record status for ${key}`,
    addressesFindingIds: ['heat-risk'], evidenceRefs: ['demo-weather'], playbookRefs: [],
  });
  return {
    decision: 'propose', assessment: {
      summary: 'Assess the affected visitors', severity: 'urgent',
      findings: [{ id: 'heat-risk', risk: 'Heat exposure requires assessment', possibleCause: 'Heat may contribute',
        uncertainty: 'No clinical cause is established', evidenceRefs: ['demo-weather'] }],
      missingInputs: ['Current patient status'], playbookAssessments: [
        { playbookKey: 'heat-response:2', applicability: 'insufficient_data',
          reason: 'Heat is supplied, but trend and a sensor are unknown', evidenceRefs: ['demo-weather'],
          contextualMissingInputs: ['audienceByZone: current oval-stage count', 'weather.trendCPerHour'] },
        { playbookKey: 'wind-response:2', applicability: 'not_applicable',
          reason: 'Scenario supplies clear weather, not a wind warning', evidenceRefs: ['demo-weather'], contextualMissingInputs: [] },
      ],
    }, mobilizations: [{ title: 'Independent protective assessment', priority: 'P1', rationale: 'Assess before choosing a full SOP response',
      tasks: [task('group-one'), task('group-two')], unmetRequirements: [] }],
  };
}
function wire(): ExperimentKeyedMobilizationOutput {
  const compact = compactWire();
  return {
    ...compact,
    assessment: { ...compact.assessment, playbookAssessments: Object.fromEntries(compact.assessment.playbookAssessments
      .map(({ playbookKey, ...value }) => [playbookKey, value])) },
    mobilizations: compact.mobilizations.map((entry) => ({ ...entry,
      tasks: entry.tasks.map((task) => ({ ...task, playbookRefs: [] })), unmetRequirements: [] })),
  };
}

describe('experimental exact-key output', () => {
  it('restores exact canonical judgements and operational content without numeric identity mapping', () => {
    const input = snapshot();
    const contract = createExperimentKeyedMobilizationOutput(input);
    const expanded = contract.expand(wire());
    expect(expanded).toEqual(createCompactMobilizationOutput(input).expand(compactWire()));
    expect(MobilizationOutputSchema.safeParse(expanded).success).toBe(true);
    expect(validateMobilizationOutput(expanded, input, [])).toEqual([]);
    expect(expanded.mobilizations[0].tasks[0].teamSlug).toBe('first-aid');
    expect(expanded.mobilizations[0].tasks[0].zoneSlug).toBe('water-2');
    expect(expanded.assessment.findings[0].evidenceRefs).toEqual(['demo-weather']);
    expect(contract.promptSupplement).toContain('not reference objects or numeric');
  });

  it('moves unknown-required-input applicability rejection into schema without choosing another verdict', () => {
    const output = wire();
    const contract = createExperimentKeyedMobilizationOutput(snapshot());
    output.assessment.playbookAssessments['heat-response:2'].applicability = 'applicable';
    expect(contract.schema.safeParse(output).success).toBe(false);
    expect(() => contract.expand(output)).toThrow();
    expect(output.assessment.playbookAssessments['heat-response:2'].applicability).toBe('applicable');
    for (const verdict of ['not_applicable', 'insufficient_data'] as const) {
      output.assessment.playbookAssessments['heat-response:2'].applicability = verdict;
      expect(contract.expand(output).assessment.playbookAssessments[0].applicability).toBe(verdict);
    }
  });

  it('keeps all three verdict choices when required inputs are known, not a forced applicability decision', () => {
    const contract = createExperimentKeyedMobilizationOutput(snapshot());
    for (const verdict of ['applicable', 'not_applicable', 'insufficient_data'] as const) {
      const output = wire();
      output.assessment.playbookAssessments['wind-response:2'].applicability = verdict;
      expect(contract.schema.safeParse(output).success).toBe(true);
    }
  });

  it('does not convert partial availability into a missing-required-input guard or invent full coverage', () => {
    const input = snapshot();
    input.playbooks[0].content.requiredInputs = ['audienceByZone'];
    const output = wire();
    output.assessment.playbookAssessments['heat-response:2'].applicability = 'applicable';
    output.assessment.playbookAssessments['heat-response:2'].contextualMissingInputs = ['audienceByZone: current oval-stage count'];
    const contract = createExperimentKeyedMobilizationOutput(input);
    expect(contract.schema.safeParse(output).success).toBe(true);
    output.assessment.playbookAssessments['heat-response:2'].applicability = 'insufficient_data';
    expect(contract.expand(output).assessment.playbookAssessments[0].missingInputs).toEqual(['audienceByZone: current oval-stage count']);
  });

  it.each(['missing', 'unknown', 'wrong_version', 'extra_value_identity'] as const)(
    'requires exactly all published review keys: %s', (kind) => {
      const output = wire();
      if (kind === 'missing') delete output.assessment.playbookAssessments['wind-response:2'];
      if (kind === 'unknown') output.assessment.playbookAssessments['invented:2'] = structuredClone(output.assessment.playbookAssessments['heat-response:2']);
      if (kind === 'wrong_version') {
        output.assessment.playbookAssessments['heat-response:3'] = output.assessment.playbookAssessments['heat-response:2'];
        delete output.assessment.playbookAssessments['heat-response:2'];
      }
      if (kind === 'extra_value_identity') Object.assign(output.assessment.playbookAssessments['heat-response:2'], { playbookKey: 'wind-response:2' });
      const contract = createExperimentKeyedMobilizationOutput(snapshot());
      expect(contract.schema.safeParse(output).success).toBe(false);
      expect(() => contract.expand(output)).toThrow();
    });

  it('restores an exact enum action identity without changing coverage claims', () => {
    const output = wire();
    output.mobilizations[0].tasks[0].playbookRefs = ['heat-response:2:assess'];
    expect(createExperimentKeyedMobilizationOutput(snapshot()).expand(output).mobilizations[0].tasks[0].playbookRefs)
      .toEqual([{ slug: 'heat-response', version: 2, actionId: 'assess' }]);
    output.mobilizations[0].tasks[0].playbookRefs = [];
    output.mobilizations[0].unmetRequirements = [{ playbookRef: 'heat-response:2:assess', reason: 'Specific clinical prerequisite missing' }];
    expect(createExperimentKeyedMobilizationOutput(snapshot()).expand(output).mobilizations[0].unmetRequirements)
      .toEqual([{ playbookRef: { slug: 'heat-response', version: 2, actionId: 'assess' }, reason: 'Specific clinical prerequisite missing' }]);
  });

  it.each(['unknown_action', 'wrong_version', 'unknown_unmet', 'numeric_action', 'object_action', 'unknown_evidence'] as const)(
    'strictly rejects invalid readable references: %s', (where) => {
      const output = wire();
      if (where === 'unknown_action') output.mobilizations[0].tasks[0].playbookRefs = ['heat-response:2:invented'];
      if (where === 'wrong_version') output.mobilizations[0].tasks[0].playbookRefs = ['heat-response:3:assess'];
      if (where === 'unknown_unmet') output.mobilizations[0].unmetRequirements = [{ playbookRef: 'unknown:2:assess', reason: 'Unknown' }];
      if (where === 'numeric_action') Object.assign(output.mobilizations[0].tasks[0], { playbookRefs: [0] });
      if (where === 'object_action') Object.assign(output.mobilizations[0].tasks[0], { playbookRefs: [{ slug: 'heat-response', version: 2, actionId: 'assess' }] });
      if (where === 'unknown_evidence') output.assessment.findings[0].evidenceRefs = ['existingResponses'];
      const contract = createExperimentKeyedMobilizationOutput(snapshot());
      expect(contract.schema.safeParse(output).success).toBe(false);
      expect(() => contract.expand(output)).toThrow();
    });

  it('retains canonical covered/unmet and not-applicable citation checks instead of repairing the proposal', () => {
    const output = wire();
    output.mobilizations[0].tasks[0].playbookRefs = ['heat-response:2:assess'];
    output.mobilizations[0].unmetRequirements = [{ playbookRef: 'heat-response:2:assess', reason: 'Specific prerequisite missing' }];
    expect(() => createExperimentKeyedMobilizationOutput(snapshot()).expand(output)).toThrow('is both covered and unmet');
    output.mobilizations[0].unmetRequirements = [];
    output.assessment.playbookAssessments['heat-response:2'].applicability = 'not_applicable';
    expect(() => createExperimentKeyedMobilizationOutput(snapshot()).expand(output)).toThrow('assessed as not applicable');
  });

  it.each(['global', 'review'] as const)('retains known-complete input rejection in %s contextual gaps', (where) => {
    const output = wire();
    if (where === 'global') output.assessment.missingInputs = ['weather.temperatureC'];
    else output.assessment.playbookAssessments['heat-response:2'].contextualMissingInputs = ['weather.temperature'];
    expect(() => createExperimentKeyedMobilizationOutput(snapshot()).expand(output)).toThrow('known complete input');
  });

  it('does not truncate contextual gap overflow or long operational content', () => {
    const input = snapshot();
    input.playbooks[0].content.requiredInputs = Array.from({ length: 31 }, (_, i) => `unknown-${i}`);
    expect(() => createExperimentKeyedMobilizationOutput(input).expand(wire())).toThrow();
    const output = wire();
    output.mobilizations[0].tasks[0].instructions = 'Assess each affected visitor and record objective findings. '.repeat(25);
    output.mobilizations[0].tasks[0].peopleNeeded = 500;
    const expanded = createExperimentKeyedMobilizationOutput(snapshot()).expand(output);
    expect(expanded.mobilizations[0].tasks[0].instructions).toBe(output.mobilizations[0].tasks[0].instructions.trim());
    expect(expanded.mobilizations[0].tasks[0].peopleNeeded).toBe(500);
    expect(expanded.assessment.findings[0].uncertainty).toBe(output.assessment.findings[0].uncertainty);
  });

  it('retains canonical 30-task allowance and refuses a one-task plan', () => {
    const output = wire();
    output.mobilizations[0].tasks = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(output.mobilizations[0].tasks[0]),
      key: `task-${i}`, instructions: `Assess distinct group ${i}` }));
    expect(createExperimentKeyedMobilizationOutput(snapshot()).expand(output).mobilizations[0].tasks).toHaveLength(30);
    output.mobilizations[0].tasks = [output.mobilizations[0].tasks[0]];
    expect(() => createExperimentKeyedMobilizationOutput(snapshot()).expand(output)).toThrow();
  });

  it('supports no published playbooks without synthesizing reviews or citations', () => {
    const input = snapshot(); input.playbooks = [];
    const output = wire(); output.assessment.playbookAssessments = {};
    const contract = createExperimentKeyedMobilizationOutput(input);
    expect(contract.expand(output).assessment.playbookAssessments).toEqual([]);
    output.mobilizations[0].tasks[0].playbookRefs = ['heat-response:2:assess'];
    expect(contract.schema.safeParse(output).success).toBe(false);
  });

  it('ignores draft/disabled content while preserving all published SOP keys', () => {
    const input = snapshot();
    input.playbooks.push({ ...book('draft-only', []), status: 'draft' }, { ...book('disabled-only', []), status: 'disabled' });
    expect(createExperimentKeyedMobilizationOutput(input).expand(wire()).assessment.playbookAssessments).toHaveLength(2);
  });

  it('binds missing-input guards, enum identities and expansion to the immutable audited input', () => {
    const input = snapshot();
    const saved = structuredClone(input);
    const contract = createExperimentKeyedMobilizationOutput(input);
    expect(input).toEqual(saved);
    input.scenario.weather.trendCPerHour = 2;
    input.playbooks[0].content.slug = 'changed'; input.playbooks[0].content.requiredInputs = [];
    input.evidence = [];
    const output = wire();
    expect(contract.expand(output).assessment.playbookAssessments[0].missingInputs).toContain('weather.trendCPerHour');
    output.assessment.playbookAssessments['heat-response:2'].applicability = 'applicable';
    expect(contract.schema.safeParse(output).success).toBe(false);
  });

  it.each(['book', 'action', 'evidence', 'no_evidence'] as const)('refuses ambiguous snapshot identities: %s', (where) => {
    const input = snapshot();
    if (where === 'book') input.playbooks.push(structuredClone(input.playbooks[0]));
    if (where === 'action') input.playbooks[0].content.actions.push(structuredClone(input.playbooks[0].content.actions[0]));
    if (where === 'evidence') input.evidence.push(structuredClone(input.evidence[0]));
    if (where === 'no_evidence') input.evidence = [];
    expect(() => createExperimentKeyedMobilizationOutput(input)).toThrow();
  });

  it('exports required exact-key reviews, per-book availability verdict enums and readable exact action enums', () => {
    const jsonSchema = z.toJSONSchema(createExperimentKeyedMobilizationOutput(snapshot()).schema);
    const nested = (value: unknown, ...keys: string[]) => keys.reduce<unknown>((node, key) =>
      node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined, value);
    const keyed = nested(jsonSchema, 'properties', 'assessment', 'properties', 'playbookAssessments');
    expect(keyed).toMatchObject({ type: 'object', required: ['heat-response:2', 'wind-response:2'], additionalProperties: false });
    expect(nested(keyed, 'properties', 'heat-response:2', 'properties', 'applicability')).toMatchObject({
      enum: ['not_applicable', 'insufficient_data'],
    });
    expect(nested(keyed, 'properties', 'wind-response:2', 'properties', 'applicability')).toMatchObject({
      enum: ['applicable', 'not_applicable', 'insufficient_data'],
    });
    expect(nested(jsonSchema, 'properties', 'mobilizations', 'items', 'properties', 'tasks', 'items', 'properties', 'playbookRefs', 'items'))
      .toMatchObject({ type: 'string', enum: ['heat-response:2:assess', 'wind-response:2:assess'] });
    expect(nested(jsonSchema, 'properties', 'mobilizations', 'items', 'properties', 'tasks')).toMatchObject({ minItems: 2, maxItems: 30 });
    expect(jsonSchema.additionalProperties).toBe(false);
  });
});
