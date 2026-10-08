import { describe, expect, it, vi } from 'vitest';

import type { ManagedPlaybook, PlanningEvidence, PlanningSnapshot } from '@/lib/mobilization-contracts';
import { compactPlanningInput } from './input-projection';
import * as projection from './input-projection';
import { focusedPlanningInput } from './focused-input';

const at = '2026-10-08T12:30:00.000Z';
const before = (minutes: number) => new Date(Date.parse(at) - minutes * 60_000).toISOString();
function book(): ManagedPlaybook {
  return { id: 'test-book', version: 3, status: 'published', createdAt: at, updatedAt: at, publishedAt: at,
    content: { schemaVersion: 1, slug: 'heat-response', title: 'Heat response',
      appliesWhen: 'Actual heat exposure and reported symptoms require assessment',
      requiredInputs: ['weather.temperature', 'currentRoster', 'unknownSensor'], source: 'Test SOP',
      constraints: [{ id: 'no-unapproved-route', instruction: 'Only use approved emergency routes' }],
      decisionPoints: [{ id: 'stage-hold', owner: 'mo', question: 'Should the set be held?' }],
      actions: [{ id: 'assess', requirement: 'must', teamSlug: 'first-aid', title: 'Assess',
        instructions: 'Assess reported casualties', peopleNeeded: null, requiredSkills: ['medical-cert'],
        staffingGuidance: 'Use qualified staff', locationGuidance: 'Reported zone', completionCriteria: 'Record severity' }] } };
}
function snapshot(): PlanningSnapshot {
  const input: PlanningSnapshot = { schemaVersion: 1, evaluatedAt: at,
    scenario: { requestId: 'focused-input-test-0001',
      weather: { temperatureC: 41, trendCPerHour: null, condition: 'clear', warning: 'heat', warningInMinutes: 0 },
      upcomingSets: [{ stageSlug: 'lawn-stage', act: 'Test act', startsInMinutes: 10, durationMinutes: 60, expectedPeople: 2000 }],
      crowdByZone: [{ zoneSlug: 'lawn-stage', estimatedPeople: 0, trend: 'stable' }],
      recentIncidents: [{ category: 'heat', zoneSlug: 'lawn-stage', minutesAgo: 3, description: 'Reported dizziness', count: 1, openCount: 1 }],
      observations: [
        { key: 'weather.windSpeed', kind: 'number', zoneSlug: null, minutesAgo: 1, value: 0 },
        { key: 'stageSafety.windLimitExceeded', kind: 'boolean', zoneSlug: 'lawn-stage', minutesAgo: 0, value: false },
        { key: 'audienceByZone', kind: 'zone_counts', zoneSlug: null, minutesAgo: 2,
          value: { coverage: 'partial', entries: [{ zoneSlug: 'lawn-stage', count: 0 }] } },
        { key: 'approvedRoutes', kind: 'routes', zoneSlug: null, minutesAgo: 4,
          value: [{ fromZoneSlug: 'lawn-stage', toZoneSlug: 'water-point', status: 'restricted', approved: false }] },
        { key: 'medicalHeatCases', kind: 'number', zoneSlug: 'lawn-stage', minutesAgo: 0, value: null },
      ] },
    zones: [{ slug: 'lawn-stage', name: 'Lawn Stage', kind: 'stage', capacity: 2500, isOpenAir: true },
      { slug: 'water-point', name: 'Water Point', kind: 'water', capacity: null, isOpenAir: false }],
    teams: [{ slug: 'first-aid', name: 'First Aid', description: 'Assessment' },
      { slug: 'welfare', name: 'Welfare', description: 'Audience support' }],
    skills: [{ slug: 'medical-cert', name: 'Medical certified' }],
    routes: [{ from: 'lawn-stage', to: 'water-point', minutes: 3.5, meters: 140.25 }],
    roster: [{ id: 'crew-one', name: 'Crew One', teamSlug: 'first-aid', zoneSlug: 'lawn-stage',
      duty: 'on_duty', skills: ['medical-cert'], free: true, shiftEndsAt: null },
      { id: 'crew-two', name: 'Crew Two', teamSlug: 'welfare', zoneSlug: 'water-point',
        duty: 'on_duty', skills: [], free: true, shiftEndsAt: 1791471600000 }],
    existingResponses: [{ id: 'response-one', title: 'Existing assessment', status: 'in_progress',
      teamSlug: 'first-aid', zoneSlug: 'lawn-stage', mobilizationId: 'mob-existing', requiredCount: 2 }],
    evidence: [], playbooks: [book()] };
  const fact = (ref: string, kind: string, zoneSlug: string | null, value: object,
    source: PlanningEvidence['source'] = 'manual_demo', observedAt = at): PlanningEvidence => ({
      ref, kind, zoneSlug, source, observedAt, value: structuredClone(value) as Record<string, unknown>,
    });
  input.evidence = [fact('weather', 'weather', null, input.scenario.weather),
    fact('venue-lawn', 'venue', 'lawn-stage', input.zones[0], 'database'),
    fact('roster-first-aid', 'roster', null, { teamSlug: 'first-aid', onDuty: 1, free: 1,
      freeBySkill: { 'medical-cert': 1 } }, 'database'),
    fact('roster-welfare', 'roster', null, { teamSlug: 'welfare', onDuty: 1, free: 1,
      freeBySkill: { 'medical-cert': 0 } }, 'database'),
    ...input.scenario.observations!.filter((row) => row.value !== null).map((row, i) => fact(`observation-${i}`,
      'observation', row.zoneSlug, { key: row.key, kind: row.kind, value: row.value,
        approvalRequired: row.key === 'approvedRoutes', scope: row.zoneSlug == null ? 'site' : 'zone' },
      'manual_demo', before(row.minutesAgo)))];
  return input;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

describe('focused experimental input projection (offline only)', () => {
  it('accepts an empty available-entry dictionary without defaults, retaining the explicit scope note', () => {
    const input = snapshot(); const standard = compactPlanningInput(input, { playbookMode: 'index_only' });
    // Real snapshots currently have verified built-in DB statuses. Exercise the filter's empty edge
    // directly without changing that upstream truth policy or inventing a fake database snapshot.
    const stub = vi.spyOn(projection, 'compactPlanningInput').mockReturnValueOnce({
      ...standard, inputAvailability: {},
    });
    try {
      const focused = focusedPlanningInput(input);
      expect(focused.inputAvailability).toEqual({});
      expect(focused.inputAvailabilityScope.included).toBe('available_entries_only');
      expect(focused.inputAvailabilityScope.note).toContain('Absent keys mean unknown or unsupplied');
      expect(focused.evidence).toEqual(standard.evidence);
    } finally { stub.mockRestore(); }
  });

  it('changes only routes and the availability dictionary, adding an explicit dictionary scope', () => {
    const input = snapshot(); const standard = compactPlanningInput(input, { playbookMode: 'index_only' });
    const focused = focusedPlanningInput(input);
    const { routes: _routes, inputAvailability: availability, ...unchanged } = standard;
    const { routes: _focusedRoutes, inputAvailability: available, inputAvailabilityScope: _scope, ...rest } = focused;
    expect(rest).toEqual(unchanged);
    expect(available).toEqual(Object.fromEntries(Object.entries(availability).filter(([, entry]) => entry.available)));
    expect(focused.playbookMode).toBe('index_only');
    expect(focused.evidence).toEqual(input.evidence);
    expect(focused.existingResponses).toEqual(input.existingResponses);
    expect(focused.teams).toEqual(input.teams); expect(focused.skills).toEqual(input.skills);
    expect(focused.inputAvailability).not.toHaveProperty('unknownSensor');
    expect(focused.inputAvailability).not.toHaveProperty('weather.trendCPerHour');
    expect(focused.inputAvailabilityScope.note).toContain('unknown or unsupplied, never zero, false');
    expect(focused.inputAvailabilityScope.note).toContain('requiredInputChecks[].unavailableRequiredInputs');
  });

  it('keeps explicit zero, false, scoped partial completeness and canonical aliases', () => {
    const input = snapshot(); const focused = focusedPlanningInput(input);
    expect(focused.inputAvailability['weather.windSpeed']).toMatchObject({ available: true, completeness: 'complete', source: 'database' });
    expect(focused.inputAvailability['stageSafety.windLimitExceeded']).toMatchObject({ available: true, completeness: 'partial' });
    expect(focused.inputAvailability.audienceByZone).toMatchObject({ available: true, completeness: 'partial' });
    expect(focused.inputAvailability['weather.temperature']).toMatchObject({ canonicalKey: 'weather.temperatureC', source: 'database' });
    expect(focused.inputAvailability.currentRoster).toMatchObject({ canonicalKey: 'roster', source: 'database' });
    expect(focused.evidence.find((row) => row.ref === 'observation-0')?.value.value).toBe(0);
    expect(focused.evidence.find((row) => row.ref === 'observation-1')?.value.value).toBe(false);
    expect(focused.evidence.find((row) => row.ref === 'observation-2')?.value.value)
      .toEqual({ coverage: 'partial', entries: [{ zoneSlug: 'lawn-stage', count: 0 }] });
    expect(focused.scenario?.crowdByZone?.[0].estimatedPeople).toBe(0);
    expect(focused.inputAvailability).not.toHaveProperty('medicalHeatCases');
    expect(focused.scenario?.observations).toContainEqual(input.scenario.observations!.at(-1));
  });

  it('keeps route/approval evidence unchanged while ordinary walking data stays server-side', () => {
    const input = snapshot(); const focused = focusedPlanningInput(input);
    expect(focused.routes).toMatchObject({ kind: 'ordinary_walking_routes_kept_server_side', allocation: 'server_only' });
    expect(focused.routes).not.toHaveProperty('values'); expect(focused.routes).not.toHaveProperty('minutes');
    expect(focused.routes.note).toContain('No ETA'); expect(focused.routes.note).toContain('not an emergency movement approval');
    expect(focused.evidence.find((row) => row.ref === 'observation-3')).toEqual(input.evidence.find((row) => row.ref === 'observation-3'));
    expect(focused.inputAvailability.approvedRoutes).toMatchObject({ available: true, completeness: 'partial' });
    expect(focused.evidence.find((row) => row.ref === 'observation-3')?.value.value)
      .toEqual([{ fromZoneSlug: 'lawn-stage', toZoneSlug: 'water-point', status: 'restricted', approved: false }]);
    expect(input.routes).toEqual([{ from: 'lawn-stage', to: 'water-point', minutes: 3.5, meters: 140.25 }]);
  });

  it('retains the exact verified roster aggregates and their evidence provenance', () => {
    const input = snapshot(); const focused = focusedPlanningInput(input);
    expect(focused.roster).toEqual(compactPlanningInput(input, { playbookMode: 'index_only' }).roster);
    expect(focused.roster).toMatchObject({ projection: 'volunteer_capacity_by_team', allocation: 'server_only',
      evidenceRefs: ['roster-first-aid', 'roster-welfare'] });
    expect(focused.evidence.filter((row) => row.kind === 'roster')).toEqual(input.evidence.filter((row) => row.kind === 'roster'));
  });

  it.each(['missing', 'contradictory', 'partial_skill_counts'] as const)('retains full fallback roster when aggregate is %s', (reason) => {
    const input = snapshot();
    if (reason === 'missing') input.evidence = input.evidence.filter((row) => row.ref !== 'roster-welfare');
    if (reason === 'contradictory') input.evidence.find((row) => row.ref === 'roster-first-aid')!.value.free = 99;
    if (reason === 'partial_skill_counts') input.evidence.find((row) => row.ref === 'roster-first-aid')!.value.freeBySkill = {};
    expect(focusedPlanningInput(input).roster).toEqual(input.roster);
  });

  it('never mutates a frozen saved snapshot or shares nested factual references with it', () => {
    const input = freeze(snapshot()); const saved = structuredClone(input); const focused = focusedPlanningInput(input);
    focused.evidence[0].value.temperatureC = -20;
    focused.teams[0].name = 'Changed'; focused.skills[0].name = 'Changed';
    focused.existingResponses[0].title = 'Changed';
    focused.scenario!.upcomingSets![0].act = 'Changed';
    focused.inputAvailability['weather.temperature'].canonicalKey = 'Changed';
    expect(input).toEqual(saved);
    const fallback = snapshot(); fallback.evidence = [];
    const projection = focusedPlanningInput(fallback);
    if (!Array.isArray(projection.roster)) throw new Error('Expected full fallback roster');
    projection.roster[0].skills.push('Changed');
    expect(fallback.roster[0].skills).toEqual(['medical-cert']);
  });

  it('does not invent positive capacity from an empty roster or zero free crew', () => {
    const input = snapshot(); input.roster = [];
    for (const row of input.evidence.filter((row) => row.kind === 'roster'))
      row.value = { teamSlug: row.value.teamSlug, onDuty: 0, free: 0, freeBySkill: { 'medical-cert': 0 } };
    const focused = focusedPlanningInput(input);
    expect(focused.inputAvailability.roster).toMatchObject({ available: true, completeness: 'complete' });
    expect(focused.evidence.filter((row) => row.kind === 'roster').every((row) => row.value.free === 0)).toBe(true);
    expect(focused.roster).toMatchObject({ projection: 'volunteer_capacity_by_team' });
  });
});
