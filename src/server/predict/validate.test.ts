import { describe, expect, it } from 'vitest';

import { MobilizationOutputSchema, SimulationInputSchema, type MobilizationOutput, type PlanningSnapshot } from '@/lib/mobilization-contracts';
import type { Volunteer } from '@/lib/schema';
import { groundMobilizationPlans, validateMobilizationOutput } from './validate';

const at = 1_800_000_000_000;
function fixture() {
  const snapshot: PlanningSnapshot = {
    schemaVersion: 1, evaluatedAt: new Date(at).toISOString(),
    scenario: { requestId: 'large-demand-test-001', weather: { temperatureC: 41, trendCPerHour: null,
      condition: 'clear', warning: 'heat', warningInMinutes: 0 }, upcomingSets: [], crowdByZone: [], recentIncidents: [] },
    zones: [{ slug: 'water-2', name: 'Water Station 2', kind: 'water', capacity: null, isOpenAir: true }],
    teams: [{ slug: 'first-aid', name: 'First Aid', description: 'Clinical response' },
      { slug: 'ops', name: 'Operations', description: 'Site support' }],
    skills: [{ slug: 'first-aid-cert', name: 'First aid certificate' }], routes: [], roster: [], existingResponses: [],
    evidence: [{ ref: 'fact', kind: 'weather', zoneSlug: null, observedAt: new Date(at).toISOString(),
      source: 'manual_demo', value: { temperatureC: 41 } }],
    playbooks: [{ id: 'book', version: 3, status: 'published', createdAt: 'at', updatedAt: 'at', publishedAt: 'at',
      content: { schemaVersion: 1, slug: 'mo-custom-heat', title: 'Mo custom heat SOP', appliesWhen: 'Heat exposure',
        requiredInputs: [], decisionPoints: [], constraints: [], source: 'Test only', actions: [{
          id: 'assess', requirement: 'must', teamSlug: 'first-aid', title: 'Assess visitors', instructions: 'Assess and report',
          peopleNeeded: 12, staffingGuidance: 'Demo demand', requiredSkills: ['first-aid-cert'], locationGuidance: '', completionCriteria: '',
        }] } }],
  };
  const output: MobilizationOutput = { decision: 'propose', assessment: { summary: 'Heat exposure', severity: 'urgent',
    findings: [{ id: 'heat', risk: 'Heat exposure', possibleCause: 'Heat may contribute', uncertainty: 'No clinical diagnosis', evidenceRefs: ['fact'] }],
    missingInputs: [], playbookAssessments: [{ slug: 'mo-custom-heat', version: 3, applicability: 'applicable',
      reason: 'Heat reported', evidenceRefs: ['fact'], missingInputs: [] }] },
    mobilizations: [{ title: 'Heat response', priority: 'P1', rationale: 'Heat exposure', tasks: [{
      key: 'clinical', title: 'Assess', instructions: 'Assess visitors and report findings', teamSlug: 'first-aid', zoneSlug: 'water-2',
      peopleNeeded: 20, reason: 'Visitors are exposed', requiredSkills: ['first-aid-cert'], completionCriteria: 'Assessment delivered',
      addressesFindingIds: ['heat'], evidenceRefs: ['fact'], playbookRefs: [{ slug: 'mo-custom-heat', version: 3, actionId: 'assess' }],
    }, { key: 'support', title: 'Support', instructions: 'Provide support and report progress', teamSlug: 'ops', zoneSlug: 'water-2',
      peopleNeeded: 12, reason: 'Visitors need support', requiredSkills: [], completionCriteria: 'Support delivered',
      addressesFindingIds: ['heat'], evidenceRefs: ['fact'], playbookRefs: [],
    }], unmetRequirements: [] }] };
  return { snapshot, output };
}
function volunteer(id: string, teamSlug: Volunteer['teamSlug'], patch: Partial<Volunteer> = {}): Volunteer {
  return { id, name: id, role: 'volunteer', teamSlug, skills: ['first-aid-cert'], languages: ['en'], zoneSlug: 'water-2',
    duty: 'on_duty', shiftEndsAt: at + 60_000, phone: null, ...patch };
}

describe('dynamic SOP staffing and truthful allocation', () => {
  it('retains demand above ten and free capacity for any Mo-authored published SOP', () => {
    const { snapshot, output } = fixture();
    expect(MobilizationOutputSchema.safeParse(output).success).toBe(true);
    expect(validateMobilizationOutput(output, snapshot, ['first-aid-cert'])).toEqual([]);
    const steps = groundMobilizationPlans(output, [volunteer('medic', 'first-aid'), volunteer('supporter', 'ops')], [], at)[0];
    expect(steps.map((step) => step.peopleNeeded)).toEqual([20, 12]);
    expect(steps.map((step) => step.candidates.length)).toEqual([1, 1]);
    expect(output.mobilizations[0].tasks.map((task) => task.peopleNeeded)).toEqual([20, 12]);
  });

  it('rejects a full SOP citation below its twelve-person minimum', () => {
    const { snapshot, output } = fixture(); output.mobilizations[0].tasks[0].peopleNeeded = 11;
    expect(validateMobilizationOutput(output, snapshot, ['first-aid-cert']))
      .toContain('Task clinical understates playbook staffing mo-custom-heat:3:assess');
  });

  it('keeps unknown weather null and requires it to remain a named missing input', () => {
    const { snapshot, output } = fixture();
    snapshot.scenario.weather = { temperatureC: null, trendCPerHour: null, condition: null, warning: null, warningInMinutes: null };
    expect(SimulationInputSchema.parse(snapshot.scenario).weather.temperatureC).toBeNull();
    snapshot.playbooks[0].content.requiredInputs = ['weather.temperatureC'];
    expect(validateMobilizationOutput(output, snapshot, ['first-aid-cert']))
      .toContain('Playbook assessment mo-custom-heat:3 omits unknown required input weather.temperatureC');
    output.assessment.playbookAssessments[0].missingInputs = ['weather.temperatureC'];
    expect(validateMobilizationOutput(output, snapshot, ['first-aid-cert']))
      .toContain('Playbook assessment mo-custom-heat:3 claims applicability with unknown required inputs');
  });

  it('excludes ineligible crew at the captured evaluation time and never double-counts candidates', () => {
    const { output } = fixture();
    output.mobilizations[0].tasks[1].teamSlug = 'first-aid';
    output.mobilizations[0].tasks[1].requiredSkills = ['first-aid-cert'];
    const people = [volunteer('valid', 'first-aid'), volunteer('unqualified', 'first-aid', { skills: [] }),
      volunteer('off-duty', 'first-aid', { duty: 'on_break' }), volunteer('ended', 'first-aid', { shiftEndsAt: at }),
      volunteer('lead', 'first-aid', { role: 'team_lead' }), volunteer('wrong-team', 'ops')];
    const steps = groundMobilizationPlans(output, people, [], at)[0];
    expect(steps[0].candidates.map((candidate) => candidate.volunteerId)).toEqual(['valid']);
    expect(steps[1].candidates).toEqual([]);
    expect(steps.map((step) => step.peopleNeeded)).toEqual([20, 12]);
  });
});
