import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PlanningSnapshot } from '@/lib/mobilization-contracts';
import { createMobilizationPlanningRequest } from './planning-request';
import { focusedPlanningInput } from './focused-input';
import { MOBILIZATION_TOOL_PROMPT_VERSION, MOBILIZATION_TOOL_SYSTEM_PROMPT } from './prompts/mobilization-tools';

const at = '2026-10-08T00:00:00Z';
function snapshot(): PlanningSnapshot {
  return { schemaVersion: 1, evaluatedAt: at,
    scenario: { requestId: 'planning-request-test', weather: { temperatureC: 41,
      trendCPerHour: null, condition: 'clear', warning: 'heat', warningInMinutes: 0 },
      upcomingSets: [], crowdByZone: [], recentIncidents: [] },
    zones: [], teams: [], skills: [], routes: [], roster: [], existingResponses: [],
    evidence: [{ ref: 'demo-weather', kind: 'weather', source: 'manual_demo',
      observedAt: at, zoneSlug: null, value: { temperatureC: 41 } }],
    playbooks: [{ id: 'book', version: 1, status: 'published', createdAt: at, updatedAt: at,
      publishedAt: at, content: { schemaVersion: 1, slug: 'heat', title: 'Heat',
        appliesWhen: 'Test heat condition', requiredInputs: ['weather.trendCPerHour'],
        constraints: [], decisionPoints: [], source: 'Unit-test fixture only', actions: [{
          id: 'assess', requirement: 'must', teamSlug: 'first-aid', title: 'Assess',
          instructions: 'Assess and report', peopleNeeded: 1, requiredSkills: [],
          staffingGuidance: '', locationGuidance: '', completionCriteria: 'Reported',
        }] } }],
  };
}
const noPlan = () => ({ decision: 'insufficient_data', assessment: {
  summary: 'Unknown temperature trend', severity: 'minor', findings: [], missingInputs: ['weather.trendCPerHour'],
  playbookAssessments: [{ playbookKey: 'heat:1', applicability: 'insufficient_data',
    reason: 'Trend unknown', evidenceRefs: ['demo-weather'], contextualMissingInputs: [] }],
}, mobilizations: [], actionCoverage: { 'heat:1:assess': { taskKey: null, blocker: null } } });

describe('production immutable planning request', () => {
  it('uses the exact effective system, focused wire and explicit wire version for the audit', () => {
    const input = snapshot(); const before = structuredClone(input);
    const request = createMobilizationPlanningRequest(input);
    expect(request.system.startsWith(`${MOBILIZATION_TOOL_SYSTEM_PROMPT}\n`)).toBe(true);
    expect(request.system).toContain('REQUIRED ACTION ACCOUNTING WIRE FORMAT');
    expect(request.promptVersion).toBe(`${MOBILIZATION_TOOL_PROMPT_VERSION}.required-actions.v2`);
    const wire = JSON.parse(request.prompt);
    expect(wire).toEqual(focusedPlanningInput(input));
    expect(wire.routes.allocation).toBe('server_only');
    expect(input).toEqual(before);
  });
  it('cannot resolve or expand before the mandatory tool audit finishes', async () => {
    const request = createMobilizationPlanningRequest(snapshot());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reading = request.read({ playbookKeys: ['heat:1'] }, () => gate);
    expect(() => request.schema()).toThrow('audited SOP read');
    expect(() => request.expand(noPlan())).toThrow('audited SOP read');
    release(); await reading;
    expect(z.toJSONSchema(request.schema()).properties?.actionCoverage).toMatchObject({
      required: ['heat:1:assess'], additionalProperties: false,
    });
    expect(request.validate(request.expand(noPlan()))).toEqual([]);
  });
  it('retains the full captured source and deterministic input gaps despite caller mutations', async () => {
    const input = snapshot(); const request = createMobilizationPlanningRequest(input);
    input.scenario.weather.trendCPerHour = 2;
    input.playbooks[0].content.actions[0].instructions = 'Changed outside request';
    let audited: unknown;
    const raw = await request.read({ playbookKeys: ['heat:1'] }, async (result) => { audited = structuredClone(result); });
    expect(JSON.parse(raw)).toEqual(audited);
    expect(raw).toContain('Assess and report');
    expect(raw).not.toContain('Changed outside request');
    expect(JSON.parse(raw).requiredInputChecks[0].unavailableRequiredInputs).toEqual(['weather.trendCPerHour']);
    const output = request.expand(noPlan());
    expect(output.assessment.playbookAssessments[0].missingInputs).toContain('weather.trendCPerHour');
    output.assessment.playbookAssessments[0].applicability = 'applicable';
    expect(request.validate(output)).toContain('Playbook assessment heat:1 claims applicability with unknown required inputs');
  });
  it('fails closed after a failed mandatory audit, with no second batch or inferred selection', async () => {
    const request = createMobilizationPlanningRequest(snapshot());
    await expect(request.read({ playbookKeys: ['heat:1'] }, async () => { throw new Error('Audit failed'); })).rejects.toThrow('Audit failed');
    expect(() => request.schema()).toThrow('audited SOP read');
    await expect(request.read({ playbookKeys: ['heat:1'] }, async () => {})).rejects.toThrow('Only one');
  });
  it('pins selected keys before asynchronous audit even if caller arguments change', async () => {
    const request = createMobilizationPlanningRequest(snapshot());
    const args = { playbookKeys: ['heat:1'] };
    await request.read(args, async () => { args.playbookKeys.length = 0; });
    expect(z.toJSONSchema(request.schema()).properties?.actionCoverage).toMatchObject({
      required: ['heat:1:assess'], additionalProperties: false,
    });
  });
  it('handles an audited empty selection without weakening full-SOP validation', async () => {
    const request = createMobilizationPlanningRequest(snapshot());
    await request.read({ playbookKeys: [] }, async () => {});
    const wire = noPlan(); wire.actionCoverage = {} as typeof wire.actionCoverage;
    const output = request.expand(wire);
    expect(request.validate(output)).toContain('Playbook heat:1 requires full SOP retrieval before assessment or citation');
  });
});
