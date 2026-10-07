import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  MobilizationOutputSchema,
  type ManagedPlaybook,
  type PlanningSnapshot,
} from '@/lib/mobilization-contracts';
import { createCompactMobilizationOutput, type CompactMobilizationOutput } from './compact-output';
import {
  createExperimentCompactMobilizationOutput,
  type ExperimentCompactMobilizationOutput,
} from './experiment-compact-output';
import { validateMobilizationOutput } from './validate';

const at = '2026-10-08T04:00:00.000Z';
function book(slug: string, requiredInputs: string[]): ManagedPlaybook {
  return {
    id: slug, version: 2, status: 'published', createdAt: at, updatedAt: at, publishedAt: at,
    content: {
      schemaVersion: 1, slug, title: slug, appliesWhen: 'Test condition', requiredInputs,
      constraints: [], decisionPoints: [], source: 'Unit test fixture only',
      actions: [{ id: 'assess', requirement: 'must', teamSlug: 'first-aid', title: 'Assess',
        instructions: 'Assess the affected visitors', peopleNeeded: 1, requiredSkills: ['medical-cert'],
        staffingGuidance: 'One certified responder', locationGuidance: 'Affected zone', completionCriteria: 'Record assessment' }],
    },
  };
}
function snapshot(): PlanningSnapshot {
  const heat = book('heat-response', ['weather.temperature', 'weather.trendCPerHour', 'unknownSensor']);
  heat.content.actions.push({ id: 'water-support', requirement: 'must', teamSlug: 'welfare', title: 'Water support',
    instructions: 'Distribute only approved potable water', peopleNeeded: 3, requiredSkills: [],
    staffingGuidance: 'Three responders', locationGuidance: 'Affected queue', completionCriteria: 'Queue can access safe water' });
  return {
    schemaVersion: 1, evaluatedAt: at,
    scenario: {
      requestId: 'experiment-output-test-001',
      weather: { temperatureC: 41, trendCPerHour: null, condition: 'clear', warning: 'heat', warningInMinutes: 0 },
      upcomingSets: [], crowdByZone: [{ zoneSlug: 'water-2', estimatedPeople: 220, trend: 'growing' }],
      recentIncidents: [], observations: [{ key: 'audienceByZone', kind: 'zone_counts', minutesAgo: 2, zoneSlug: null,
        value: { coverage: 'partial', entries: [{ zoneSlug: 'water-2', count: 220 }] } }],
    },
    zones: [
      { slug: 'water-2', name: 'Water Station 2', kind: 'water', capacity: null, isOpenAir: true },
      { slug: 'oval-stage', name: 'Oval Stage', kind: 'stage', capacity: 2500, isOpenAir: true },
    ],
    teams: [{ slug: 'welfare', name: 'Welfare', description: 'Audience welfare' },
      { slug: 'first-aid', name: 'First Aid', description: 'Clinical assessment' }],
    skills: [{ slug: 'medical-cert', name: 'First aid certified' }], routes: [], roster: [], existingResponses: [],
    evidence: [
      { ref: 'z-weather', kind: 'weather', zoneSlug: null, observedAt: at, source: 'manual_demo', value: { temperatureC: 41 } },
      { ref: 'a-crowd', kind: 'crowd', zoneSlug: 'water-2', observedAt: at, source: 'manual_demo', value: { estimatedPeople: 220 } },
    ],
    playbooks: [book('wind-response', ['weather.windSpeed']), heat],
  };
}

function compactWire(): CompactMobilizationOutput {
  return {
    decision: 'propose',
    assessment: {
      summary: 'Assess the affected visitors', severity: 'urgent',
      findings: [{ id: 'heat-risk', risk: 'Heat exposure requires assessment', possibleCause: 'Heat may contribute',
        uncertainty: 'No clinical cause is established', evidenceRefs: ['z-weather', 'a-crowd'] }],
      missingInputs: ['Current patient status'],
      playbookAssessments: [
        { playbookKey: 'heat-response:2', applicability: 'insufficient_data',
          reason: 'Heat is supplied, but trend and a sensor are unknown', evidenceRefs: ['z-weather'],
          contextualMissingInputs: ['audienceByZone: current oval-stage count', 'weather.trendCPerHour'] },
        { playbookKey: 'wind-response:2', applicability: 'insufficient_data',
          reason: 'Wind speed is unknown', evidenceRefs: ['z-weather'], contextualMissingInputs: [] },
      ],
    },
    mobilizations: [{ title: 'Independent protective assessment', priority: 'P1', rationale: 'Assess before choosing a full SOP response',
      tasks: [
        { key: 'group-one', title: 'Assess group one', instructions: 'Assess group one at water-2 and report any deterioration',
          teamSlug: 'first-aid', zoneSlug: 'water-2', peopleNeeded: 2, requiredSkills: ['medical-cert'],
          reason: 'Hypothetical heat and crowd warrant assessment', completionCriteria: 'Record clinical status for group one',
          addressesFindingIds: ['heat-risk'], evidenceRefs: ['z-weather', 'a-crowd'], playbookRefs: [] },
        { key: 'group-two', title: 'Guide group two', instructions: 'Guide group two away from the exposed queue at oval-stage without claiming an evacuation route',
          teamSlug: 'welfare', zoneSlug: 'oval-stage', peopleNeeded: 3, requiredSkills: [],
          reason: 'Hypothetical heat warrants independent welfare assessment', completionCriteria: 'Confirm a safe queue and report welfare needs',
          addressesFindingIds: ['heat-risk'], evidenceRefs: ['z-weather'], playbookRefs: [] },
      ], unmetRequirements: [] }],
  };
}

function wire(): ExperimentCompactMobilizationOutput {
  return {
    d: 'propose',
    a: {
      s: 'Assess the affected visitors', v: 'urgent',
      f: [{ id: 'heat-risk', r: 'Heat exposure requires assessment', c: 'Heat may contribute',
        u: 'No clinical cause is established', e: [1, 0] }], g: ['Current patient status'],
      p: [
        { p: 0, v: 'insufficient_data', r: 'Heat is supplied, but trend and a sensor are unknown', e: [1],
          g: ['audienceByZone: current oval-stage count', 'weather.trendCPerHour'] },
        { p: 1, v: 'insufficient_data', r: 'Wind speed is unknown', e: [1], g: [] },
      ],
    },
    m: [{ t: 'Independent protective assessment', p: 'P1', r: 'Assess before choosing a full SOP response',
      x: [
        { k: 'group-one', t: 'Assess group one', i: 'Assess group one at water-2 and report any deterioration',
          tm: 0, z: 1, n: 2, sk: ['medical-cert'], r: 'Hypothetical heat and crowd warrant assessment',
          c: 'Record clinical status for group one', f: ['heat-risk'], e: [1, 0], a: [] },
        { k: 'group-two', t: 'Guide group two', i: 'Guide group two away from the exposed queue at oval-stage without claiming an evacuation route',
          tm: 1, z: 0, n: 3, sk: [], r: 'Hypothetical heat warrants independent welfare assessment',
          c: 'Confirm a safe queue and report welfare needs', f: ['heat-risk'], e: [1], a: [] },
      ], u: [] }],
  };
}

describe('experimental dictionary output', () => {
  it('expands into the exact existing canonical output without changing any AI judgement or task content', () => {
    const input = snapshot();
    const expected = createCompactMobilizationOutput(input).expand(compactWire());
    const expanded = createExperimentCompactMobilizationOutput(input).expand(wire());
    expect(expanded).toEqual(expected);
    expect(MobilizationOutputSchema.safeParse(expanded).success).toBe(true);
    expect(validateMobilizationOutput(expanded, input, ['medical-cert'])).toEqual([]);
    expect(expanded.assessment.playbookAssessments[0].missingInputs).toEqual([
      'weather.trendCPerHour', 'unknownSensor', 'audienceByZone: current oval-stage count',
    ]);
  });

  it('exports deterministic, immutable dictionaries of exact identities without SOP decision defaults', () => {
    const input = snapshot();
    const contract = createExperimentCompactMobilizationOutput(input);
    expect(contract.supplementalInput).toEqual({ wireVersion: 'mobilization.output-experiment.v1', dictionaries: {
      evidence: ['a-crowd', 'z-weather'], playbooks: ['heat-response:2', 'wind-response:2'],
      actions: [[0, 'assess'], [0, 'water-support'], [1, 'assess']],
      zones: ['oval-stage', 'water-2'], teams: ['first-aid', 'welfare'],
    } });
    input.evidence.reverse(); input.playbooks.reverse(); input.zones.reverse(); input.teams.reverse();
    input.playbooks[0].content.actions.reverse();
    expect(createExperimentCompactMobilizationOutput(input).supplementalInput).toEqual(contract.supplementalInput);
    expect(Object.isFrozen(contract.supplementalInput)).toBe(true);
    expect(Object.isFrozen(contract.supplementalInput.dictionaries.evidence)).toBe(true);
    expect(Object.isFrozen(contract.supplementalInput.dictionaries.actions[0])).toBe(true);
    expect(contract.promptSupplement).toContain('transport encoding only');
    expect(contract.promptSupplement).toContain('do NOT provide SOP rules or prove applicability');
    expect(contract.promptSupplement).toContain('Return every published SOP verdict once');
  });

  it('retains long operational instructions, uncertainty, completion criteria, skills and justified demand', () => {
    const output = wire();
    output.m[0].x[0].i = 'Assess each affected visitor and communicate objective findings to Mo. '.repeat(20);
    output.m[0].x[0].c = 'Record each assessed visitor and confirm there are no unassessed visitors in the assigned group. '.repeat(10);
    output.a.f[0].u = 'The scenario supplies heat, not a diagnosis; clinical confirmation is unavailable. '.repeat(10);
    output.m[0].x[0].n = 500;
    const expanded = createExperimentCompactMobilizationOutput(snapshot()).expand(output);
    expect(expanded.mobilizations[0].tasks[0].instructions).toBe(output.m[0].x[0].i.trim());
    expect(expanded.mobilizations[0].tasks[0].completionCriteria).toBe(output.m[0].x[0].c.trim());
    expect(expanded.mobilizations[0].tasks[0].peopleNeeded).toBe(500);
    expect(expanded.mobilizations[0].tasks[0].requiredSkills).toEqual(['medical-cert']);
    expect(expanded.assessment.findings[0].uncertainty).toBe(output.a.f[0].u);
  });

  it('restores exact SOP action coverage and concrete unmet prerequisites without filling either side', () => {
    const output = wire();
    output.m[0].x[0].a = [0];
    output.m[0].u = [{ a: 1, r: 'No approved potable water source has been supplied.' }];
    const expanded = createExperimentCompactMobilizationOutput(snapshot()).expand(output);
    expect(expanded.mobilizations[0].tasks[0].playbookRefs).toEqual([{ slug: 'heat-response', version: 2, actionId: 'assess' }]);
    expect(expanded.mobilizations[0].unmetRequirements).toEqual([{ playbookRef: {
      slug: 'heat-response', version: 2, actionId: 'water-support',
    }, reason: output.m[0].u[0].r }]);
    expect(expanded.assessment.playbookAssessments[0].applicability).toBe('insufficient_data');
  });

  it.each(['evidence', 'playbook', 'action', 'unmet_action', 'team', 'zone', 'negative', 'fractional'] as const)(
    'rejects an unknown or non-index %s reference rather than aliasing or repairing it', (where) => {
      const output = wire();
      if (where === 'evidence') output.a.f[0].e = [2];
      if (where === 'playbook') output.a.p[0].p = 2;
      if (where === 'action') output.m[0].x[0].a = [3];
      if (where === 'unmet_action') output.m[0].u = [{ a: 3, r: 'Unknown action' }];
      if (where === 'team') output.m[0].x[0].tm = 2;
      if (where === 'zone') output.m[0].x[0].z = 2;
      if (where === 'negative') output.a.f[0].e = [-1];
      if (where === 'fractional') output.m[0].x[0].z = 0.5;
      const contract = createExperimentCompactMobilizationOutput(snapshot());
      expect(contract.schema.safeParse(output).success).toBe(false);
      expect(() => contract.expand(output)).toThrow();
    });

  it('requires every published verdict, without defaulting a missing review', () => {
    const output = wire();
    output.a.p.pop();
    const contract = createExperimentCompactMobilizationOutput(snapshot());
    expect(contract.schema.safeParse(output).success).toBe(false);
    expect(() => contract.expand(output)).toThrow();
  });

  it('rejects repeated verdict indices even if review count is correct', () => {
    const output = wire();
    output.a.p[1] = structuredClone(output.a.p[0]);
    expect(() => createExperimentCompactMobilizationOutput(snapshot()).expand(output)).toThrow('Duplicate playbook assessment index');
  });

  it.each(['finding', 'review', 'task', 'action', 'finding_link'] as const)(
    'rejects duplicate references within one %s reference array', (where) => {
      const output = wire();
      if (where === 'finding') output.a.f[0].e = [1, 1];
      if (where === 'review') output.a.p[0].e = [1, 1];
      if (where === 'task') output.m[0].x[0].e = [1, 1];
      if (where === 'action') output.m[0].x[0].a = [0, 0];
      if (where === 'finding_link') output.m[0].x[0].f = ['heat-risk', 'heat-risk'];
      expect(() => createExperimentCompactMobilizationOutput(snapshot()).expand(output)).toThrow('Duplicate');
    });

  it.each(['findings', 'task_keys', 'unmet_actions'] as const)('keeps existing semantic duplicate %s checks', (where) => {
    const output = wire();
    if (where === 'findings') output.a.f.push(structuredClone(output.a.f[0]));
    if (where === 'task_keys') output.m[0].x[1].k = output.m[0].x[0].k;
    if (where === 'unmet_actions') output.m[0].u = [{ a: 0, r: 'Missing clinical status' }, { a: 0, r: 'Still missing clinical status' }];
    expect(() => createExperimentCompactMobilizationOutput(snapshot()).expand(output)).toThrow('Duplicate');
  });

  it.each(['same_plan', 'unmet_first', 'covered_first'] as const)(
    'rejects covered/unmet overlap across all mobilizations: %s', (where) => {
      const output = wire();
      output.m[0].x[0].a = [0];
      const gap = { a: 0, r: 'No clinical status supplied' };
      if (where === 'same_plan') output.m[0].u = [gap];
      else {
        const other = structuredClone(output.m[0]);
        other.t = 'Distinct second plan';
        other.x.forEach((item) => { item.k += '-next'; item.i += ' for a separate group'; item.a = []; });
        other.u = [gap];
        if (where === 'unmet_first') output.m.unshift(other);
        else output.m.push(other);
      }
      expect(() => createExperimentCompactMobilizationOutput(snapshot()).expand(output)).toThrow('is both covered and unmet');
    });

  it.each(['global', 'review'] as const)('does not label known complete inputs as missing in %s gaps', (where) => {
    const output = wire();
    if (where === 'global') output.a.g = ['weather.temperatureC'];
    else output.a.p[0].g = [' weather.temperature '];
    expect(() => createExperimentCompactMobilizationOutput(snapshot()).expand(output)).toThrow('known complete input');
  });

  it('preserves partial coverage gaps and fails unknown-required-input applicability rather than changing verdicts', () => {
    const output = wire();
    output.a.p[0].g = ['audienceByZone'];
    const contract = createExperimentCompactMobilizationOutput(snapshot());
    expect(contract.expand(output).assessment.playbookAssessments[0].missingInputs)
      .toEqual(['weather.trendCPerHour', 'unknownSensor', 'audienceByZone']);
    output.a.p[0].v = 'applicable';
    expect(() => contract.expand(output)).toThrow('claims applicability with unknown required inputs');
    expect(output.a.p[0].v).toBe('applicable');
  });

  it.each(['missing_action', 'wrong_team', 'wrong_skill', 'unknown_skill', 'insufficient_staff', 'unaddressed_finding', 'no_findings', 'no_plans'] as const)(
    'preserves canonical semantic safety for %s', (where) => {
      const output = wire();
      if (where === 'missing_action') output.m[0].x[0].a = [0];
      if (where === 'wrong_team') { output.m[0].x[1].a = [0]; output.m[0].u = [{ a: 1, r: 'Water approval missing' }]; }
      if (where === 'wrong_skill') { output.m[0].x[0].a = [0]; output.m[0].x[0].sk = []; output.m[0].u = [{ a: 1, r: 'Water approval missing' }]; }
      if (where === 'unknown_skill') output.m[0].x[0].sk = ['invented-cert'];
      if (where === 'insufficient_staff') { output.m[0].x[1].a = [1]; output.m[0].x[1].n = 2; output.m[0].u = [{ a: 0, r: 'Clinical status missing' }]; }
      if (where === 'unaddressed_finding') output.a.f.push({ ...output.a.f[0], id: 'other-risk' });
      if (where === 'no_findings') output.a.f = [];
      if (where === 'no_plans') output.m = [];
      expect(() => createExperimentCompactMobilizationOutput(snapshot()).expand(output)).toThrow('semantic validation failed');
    });

  it('retains the full canonical relevant-task allowance rather than limiting plans for speed', () => {
    const output = wire();
    output.m[0].x = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(output.m[0].x[0]),
      k: `group-${i}`, i: `Assess distinct group ${i} at water-2 and record its status`, t: `Assess group ${i}` }));
    expect(createExperimentCompactMobilizationOutput(snapshot()).expand(output).mobilizations[0].tasks).toHaveLength(30);
    output.m[0].x.push(structuredClone(output.m[0].x[0]));
    expect(() => createExperimentCompactMobilizationOutput(snapshot()).expand(output)).toThrow();
  });

  it.each(['one_task', 'finding_overflow', 'global_gap_overflow', 'merged_gap_overflow', 'task_text_overflow', 'headcount_zero'] as const)(
    'rejects %s without truncation or weaker canonical bounds', (where) => {
      const input = snapshot();
      const output = wire();
      if (where === 'one_task') output.m[0].x.pop();
      if (where === 'finding_overflow') output.a.f = Array.from({ length: 21 }, (_, i) => ({ ...output.a.f[0], id: `risk-${i}` }));
      if (where === 'global_gap_overflow') output.a.g = Array.from({ length: 31 }, (_, i) => `gap-${i}`);
      if (where === 'merged_gap_overflow') input.playbooks.find((item) => item.content.slug === 'heat-response')!.content.requiredInputs =
        Array.from({ length: 31 }, (_, i) => `unknown-sensor-${i}`);
      if (where === 'task_text_overflow') output.m[0].x[0].i = 'x'.repeat(2001);
      if (where === 'headcount_zero') output.m[0].x[0].n = 0;
      expect(() => createExperimentCompactMobilizationOutput(input).expand(output)).toThrow();
    });

  it('does not silently strip unknown extra keys from an experimental wire response', () => {
    const output = { ...wire(), inventedDecisionOverride: 'no_mobilization' };
    expect(() => createExperimentCompactMobilizationOutput(snapshot()).expand(output)).toThrow();
    const nested = wire();
    Object.assign(nested.m[0].x[0], { skipMoApproval: true });
    expect(() => createExperimentCompactMobilizationOutput(snapshot()).expand(nested)).toThrow();
  });

  it('supports empty published SOP dictionaries and independent actions, never inventing reviews', () => {
    const input = snapshot(); input.playbooks = [];
    const output = wire(); output.a.p = [];
    const contract = createExperimentCompactMobilizationOutput(input);
    expect(contract.supplementalInput.dictionaries.actions).toEqual([]);
    expect(contract.expand(output).assessment.playbookAssessments).toEqual([]);
    output.m[0].x[0].a = [0];
    expect(contract.schema.safeParse(output).success).toBe(false);
    expect(() => contract.expand(output)).toThrow();
  });

  it('ignores nonpublished books and actions, while retaining every published identity', () => {
    const input = snapshot();
    input.playbooks.push({ ...book('draft-only', []), status: 'draft' }, { ...book('disabled-only', []), status: 'disabled' });
    const contract = createExperimentCompactMobilizationOutput(input);
    expect(contract.supplementalInput.dictionaries.playbooks).toEqual(['heat-response:2', 'wind-response:2']);
    expect(contract.supplementalInput.dictionaries.actions).toHaveLength(3);
    expect(contract.expand(wire()).assessment.playbookAssessments).toHaveLength(2);
  });

  it('binds dictionaries and all validation to the immutable original audited snapshot', () => {
    const input = snapshot();
    const saved = structuredClone(input);
    const contract = createExperimentCompactMobilizationOutput(input);
    expect(input).toEqual(saved);
    input.scenario.weather.trendCPerHour = 2;
    input.playbooks[1].content.slug = 'changed-book';
    input.zones[0].slug = 'changed-zone'; input.teams[0].slug = 'ops'; input.evidence = [];
    const expanded = contract.expand(wire());
    expect(expanded.assessment.playbookAssessments[0].slug).toBe('heat-response');
    expect(expanded.assessment.playbookAssessments[0].missingInputs).toContain('weather.trendCPerHour');
    expect(expanded.mobilizations[0].tasks[0].zoneSlug).toBe('water-2');
    expect(expanded.mobilizations[0].tasks[1].teamSlug).toBe('welfare');
    expect(expanded.assessment.findings[0].evidenceRefs).toEqual(['z-weather', 'a-crowd']);
  });

  it.each(['evidence', 'book', 'action', 'zone', 'team', 'no_evidence'] as const)(
    'fails closed for ambiguous snapshot dictionary input: %s', (where) => {
      const input = snapshot();
      if (where === 'evidence') input.evidence.push(structuredClone(input.evidence[0]));
      if (where === 'book') input.playbooks.push(structuredClone(input.playbooks[0]));
      if (where === 'action') input.playbooks[0].content.actions.push(structuredClone(input.playbooks[0].content.actions[0]));
      if (where === 'zone') input.zones.push(structuredClone(input.zones[0]));
      if (where === 'team') input.teams.push(structuredClone(input.teams[0]));
      if (where === 'no_evidence') input.evidence = [];
      expect(() => createExperimentCompactMobilizationOutput(input)).toThrow();
    });

  it('exports a strict object JSON schema with bounded integer references and unchanged canonical task bounds', () => {
    const jsonSchema = z.toJSONSchema(createExperimentCompactMobilizationOutput(snapshot()).schema);
    const nested = (value: unknown, ...keys: string[]) => keys.reduce<unknown>((node, key) =>
      node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined, value);
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.additionalProperties).toBe(false);
    expect(nested(jsonSchema, 'properties', 'a', 'properties', 'p')).toMatchObject({ minItems: 2, maxItems: 2 });
    const taskSchema = nested(jsonSchema, 'properties', 'm', 'items', 'properties', 'x', 'items');
    expect(nested(taskSchema, 'properties', 'e', 'items')).toMatchObject({ type: 'integer', minimum: 0, maximum: 1 });
    expect(nested(taskSchema, 'properties', 'a', 'items')).toMatchObject({ type: 'integer', minimum: 0, maximum: 2 });
    expect(nested(jsonSchema, 'properties', 'm', 'items', 'properties', 'x')).toMatchObject({ minItems: 2, maxItems: 30 });
    expect(nested(taskSchema, 'properties', 'i')).toMatchObject({ maxLength: 2000 });
    expect(nested(taskSchema, 'properties', 'n')).toMatchObject({ minimum: 1, maximum: 500 });
    expect(JSON.stringify(jsonSchema)).not.toContain('heat-response:2');
  });

  it('reduces output encoding bytes, not judgement content or allowed tasks', () => {
    expect(JSON.stringify(wire()).length).toBeLessThan(JSON.stringify(compactWire()).length);
    const expanded = createExperimentCompactMobilizationOutput(snapshot()).expand(wire());
    expect(expanded.mobilizations[0].tasks).toHaveLength(compactWire().mobilizations[0].tasks.length);
    expect(expanded.assessment.playbookAssessments).toHaveLength(compactWire().assessment.playbookAssessments.length);
  });
});
