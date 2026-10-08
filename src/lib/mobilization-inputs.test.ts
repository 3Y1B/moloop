import { describe, expect, it } from 'vitest';

import type { PlanningSnapshot } from './mobilization-contracts';
import { inputAvailability, missingRequiredInputs, MOBILIZATION_INPUT_SOURCES } from './mobilization-inputs';

function snapshot(): PlanningSnapshot {
  return { schemaVersion: 1, evaluatedAt: '2026-10-08T00:00:00Z',
    scenario: { requestId: 'input-source-test-001', weather: { temperatureC: null, trendCPerHour: null,
      condition: null, warning: null, warningInMinutes: null }, upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [] },
    zones: [], teams: [], skills: [], routes: [], roster: [], existingResponses: [], evidence: [], playbooks: [] };
}

describe('manual simulation input provenance and unknown weather', () => {
  it.each(['weather.temperatureC', 'weather.temperature', 'weather.trendCPerHour', 'weather.condition',
    'weather.warning', 'weatherStatus', 'crowdByZone', 'weather.windSpeed', 'approvedRoutes'])(
    'does not mislabel hypothetical %s as a database sensor', (key) => {
      expect(MOBILIZATION_INPUT_SOURCES[key].source).toBe('manual_demo');
    });

  it('keeps actual roster, venue and workload queries database-backed', () => {
    for (const key of ['roster', 'currentRoster', 'venue', 'existingResponses'])
      expect(MOBILIZATION_INPUT_SOURCES[key].source).toBe('database');
    expect(MOBILIZATION_INPUT_SOURCES.upcomingSets.source).toBe('scenario_or_database');
    expect(MOBILIZATION_INPUT_SOURCES.recentIncidents.source).toBe('scenario_or_database');
  });

  it('treats every null weather field and alias as unavailable, not clear or safe', () => {
    const value = snapshot(); const availability = inputAvailability(value);
    const keys = ['weather.temperatureC', 'weather.temperature', 'weather.trendCPerHour', 'weather.condition', 'weather.warning', 'weatherStatus'];
    for (const key of keys)
      expect(availability[key]).toMatchObject({ available: false, completeness: 'unknown', source: 'manual_demo' });
    expect(missingRequiredInputs(keys, value)).toEqual(keys);
  });

  it('retains explicit zero temperature, clear conditions and no warning as known scenario inputs', () => {
    const value = snapshot(); value.scenario.weather = { temperatureC: 0, trendCPerHour: 0,
      condition: 'clear', warning: 'none', warningInMinutes: null };
    const availability = inputAvailability(value);
    for (const key of ['weather.temperatureC', 'weather.trendCPerHour', 'weather.condition', 'weather.warning'])
      expect(availability[key]).toMatchObject({ available: true, completeness: 'complete', source: 'manual_demo' });
  });
});
