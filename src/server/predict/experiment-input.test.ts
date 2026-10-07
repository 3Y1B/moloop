import { describe, expect, it } from 'vitest';
import type { PlanningSnapshot } from '@/lib/mobilization-contracts';
import { compactExperimentInput } from './experiment-input';
import { compactPlanningInput } from './input-projection';

const snapshot = (): PlanningSnapshot => ({ schemaVersion: 1, evaluatedAt: '2026-10-08T00:00:00Z',
  scenario: { requestId: 'test', weather: { temperatureC: 41, trendCPerHour: null, condition: 'clear', warning: 'heat', warningInMinutes: 0 },
    upcomingSets: [], crowdByZone: [], recentIncidents: [], observations: [] },
  zones: [{ slug: 'a', name: 'A', kind: 'stage', capacity: 500, isOpenAir: true },
    { slug: 'b', name: 'B', kind: 'other', capacity: null, isOpenAir: false }],
  teams: [], skills: [], routes: [{ from: 'a', to: 'b', minutes: 2.5, meters: 140 }],
  roster: [], existingResponses: [], playbooks: [], evidence: [],
});

describe('lossless experimental input tables', () => {
  it('round-trips every walking route without granting an emergency authorization', () => {
    const value = snapshot(), before = structuredClone(value);
    const projected = compactExperimentInput(value, 'index_only');
    expect(projected.routes.kind).toBe('ordinary_walking_distances_not_emergency_authorizations');
    expect('zoneSlugs' in projected.routes).toBe(true);
    if (!('zoneSlugs' in projected.routes)) throw new Error('Expected known endpoints');
    const { zoneSlugs } = projected.routes;
    expect(projected.routes.values.map(([from, to, minutes, meters]) => ({
      from: zoneSlugs[from as number], to: zoneSlugs[to as number], minutes, meters,
    }))).toEqual(value.routes);
    expect(value).toEqual(before);
  });

  it('keeps unknown endpoints unmodified instead of dropping them', () => {
    const value = snapshot();
    value.routes.push({ from: 'a', to: 'outside', minutes: 4, meters: 220 });
    expect(compactExperimentInput(value, 'index_only').routes).toEqual(compactPlanningInput(value).routes);
  });

  it('round-trips every source, unknown/partial status and alias without invented values', () => {
    const value = snapshot(), before = structuredClone(value);
    const standard = compactPlanningInput(value, { playbookMode: 'index_only' });
    const table = compactExperimentInput(value, 'index_only').inputAvailability;
    expect(table.columns).toEqual(['key', 'source', 'available', 'completeness', 'canonicalKey']);
    const restored = Object.fromEntries(table.values.map(([key, source, available, completeness, canonicalKey]) =>
      [key, { source, available, completeness, ...(canonicalKey !== key ? { canonicalKey } : {}) }]));
    expect(restored).toEqual(standard.inputAvailability);
    expect(value).toEqual(before);
  });
});
