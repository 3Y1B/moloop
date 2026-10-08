import { describe, expect, it } from 'vitest';

import {
  PlaybookContentSchema,
  type ManagedPlaybook,
  type PlanningEvidence,
  type PlanningSnapshot,
} from '@/lib/mobilization-contracts';
import { inputAvailability } from '@/lib/mobilization-inputs';
import { OBSERVATION_CATALOG, observationIsMeaningful } from '@/lib/mobilization-observations';
import { compactPlanningInput, compactPlaybook, compactRoutes, playbookIndex } from './input-projection';

const evaluatedAt = '2026-10-08T12:30:00.000Z';
const atMinutesAgo = (minutes: number) => new Date(Date.parse(evaluatedAt) - minutes * 60_000).toISOString();

function book(slug = 'heat-response', version = 4): ManagedPlaybook {
  return {
    id: `admin-id-${slug}`, version, status: 'published',
    createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', publishedAt: evaluatedAt,
    content: PlaybookContentSchema.parse({
      schemaVersion: 1, slug, title: 'Heat response',
      appliesWhen: 'Rising heat together with increased heat-related incidents or unsafe crowd exposure.',
      requiredInputs: ['weather.temperature', 'medicalHeatCases', 'currentRoster', 'unconnectedSensor'],
      decisionPoints: [{ id: 'stage-hold', owner: 'mo', question: 'Should the upcoming performance be held?' }],
      constraints: [{ id: 'water-safe', instruction: 'Use only an approved potable source; ordinary routes are not evacuation authorization.' }],
      actions: [
        { id: 'treatment', requirement: 'must', teamSlug: 'first-aid', title: 'Assess heat casualties',
          instructions: 'Assess affected people and report severity to Mo.', peopleNeeded: null },
        { id: 'distribution', requirement: 'recommended', teamSlug: 'welfare', title: 'Distribute water',
          instructions: 'Prioritize exposed queues, and keep emergency lanes clear.', peopleNeeded: 3,
          staffingGuidance: 'At least one trained lead per distribution point.', requiredSkills: ['medical-cert'],
          locationGuidance: 'Use the occupied exposed queue, not an invented location.',
          completionCriteria: 'All sampled queues can access confirmed potable water.' },
      ], source: 'Festival SOP / heat section / version signed by Mo',
    }),
  };
}

function snapshot(): PlanningSnapshot {
  const value: PlanningSnapshot = {
    schemaVersion: 1, evaluatedAt,
    scenario: {
      requestId: 'private-idempotency-request-0001',
      weather: { temperatureC: 41, trendCPerHour: 2, condition: 'clear', warning: 'heat', warningInMinutes: 0 },
      upcomingSets: [{ stageSlug: 'lawn-stage', act: 'The Volunteers', startsInMinutes: 10, durationMinutes: 60, expectedPeople: 2000 }],
      crowdByZone: [{ zoneSlug: 'lawn-stage', estimatedPeople: 1800, trend: 'growing' }],
      recentIncidents: [{ category: 'heat', zoneSlug: 'lawn-stage', minutesAgo: 4, description: 'Three people dizzy in a hot queue.', count: 3, openCount: 2 }],
      observations: [
        { key: 'stageSafety.windLimitExceeded', kind: 'boolean', zoneSlug: 'lawn-stage', minutesAgo: 0, value: false },
        { key: 'weather.windSpeed', kind: 'number', zoneSlug: null, minutesAgo: 1, value: 0 },
        { key: 'approvedRoutes', kind: 'routes', zoneSlug: null, minutesAgo: 2,
          value: [{ fromZoneSlug: 'lawn-stage', toZoneSlug: 'water-point', status: 'restricted', approved: false }] },
      ],
    },
    zones: [
      { slug: 'lawn-stage', name: 'Lawn Stage', kind: 'stage', capacity: 2500, isOpenAir: true },
      { slug: 'water-point', name: 'Water Point', kind: 'water', capacity: null, isOpenAir: false },
    ],
    teams: [
      { slug: 'first-aid', name: 'First Aid', description: 'Medical assessment and treatment.' },
      { slug: 'welfare', name: 'Welfare', description: 'Audience welfare and water assistance.' },
    ],
    skills: [{ slug: 'medical-cert', name: 'First aid certified' }, { slug: 'crowd-cert', name: 'Crowd guidance trained' }],
    routes: [
      { from: 'lawn-stage', to: 'water-point', minutes: 3.5, meters: 120.25 },
      { from: 'water-point', to: 'lawn-stage', minutes: 4, meters: 126 },
    ],
    roster: [
      { id: 'volunteer-a', name: 'Alice', teamSlug: 'first-aid', zoneSlug: 'lawn-stage', duty: 'on_duty', skills: ['medical-cert'], free: true, shiftEndsAt: 1791469800000 },
      { id: 'volunteer-b', name: 'Bob', teamSlug: 'first-aid', zoneSlug: 'water-point', duty: 'on_duty', skills: ['crowd-cert'], free: true, shiftEndsAt: 1791469800000 },
      { id: 'volunteer-c', name: 'Charlie', teamSlug: 'welfare', zoneSlug: 'water-point', duty: 'on_duty', skills: [], free: true, shiftEndsAt: null },
      { id: 'lead-d', name: 'Dana', teamSlug: 'welfare', zoneSlug: 'lawn-stage', duty: 'on_duty', skills: ['medical-cert'], free: false, shiftEndsAt: null },
    ],
    existingResponses: [{ id: 'task-one', title: 'Open medical response', status: 'in_progress', teamSlug: 'first-aid',
      zoneSlug: 'lawn-stage', mobilizationId: 'mobilization-existing', requiredCount: 2 }],
    evidence: [], playbooks: [book(), book('storm-response', 7)],
  };
  const fact = (ref: string, kind: string, zoneSlug: string | null, source: PlanningEvidence['source'],
    content: object, observedAt = evaluatedAt): PlanningEvidence => ({ ref, kind, zoneSlug, source,
    observedAt, value: structuredClone(content) as Record<string, unknown> });
  value.evidence = [
    fact('demo-weather', 'weather', null, 'manual_demo', value.scenario.weather),
    ...value.zones.map((zone) => fact(`venue-${zone.slug}`, 'venue', zone.slug, 'database', zone)),
    ...value.scenario.upcomingSets.map((set, index) => fact(`demo-set-${index}`, 'upcoming_set', set.stageSlug,
      'manual_demo', { ...set, startsAt: '2026-10-08T12:40:00.000Z', endsAt: '2026-10-08T13:40:00.000Z' })),
    ...value.scenario.crowdByZone.map((crowd, index) => fact(`demo-crowd-${index}`, 'crowd', crowd.zoneSlug, 'manual_demo', crowd)),
    ...value.scenario.recentIncidents.map((incident, index) => fact(`demo-incident-${index}`, 'incident', incident.zoneSlug,
      'manual_demo', incident, atMinutesAgo(incident.minutesAgo))),
    ...(value.scenario.observations ?? []).filter(observationIsMeaningful).map((row, index) => {
      const definition = OBSERVATION_CATALOG[row.key];
      return fact(`observation-${index}`, 'observation', row.zoneSlug, 'manual_demo',
        { key: row.key, kind: row.kind, value: row.value, unit: definition.unit ?? null,
          scope: row.zoneSlug == null ? 'site' : 'zone', approvalRequired: definition.approvalRequired === true }, atMinutesAgo(row.minutesAgo));
    }),
    fact('roster-first-aid', 'roster', null, 'database', { teamSlug: 'first-aid', onDuty: 2, free: 2,
      freeBySkill: { 'medical-cert': 1, 'crowd-cert': 1 } }),
    fact('roster-welfare', 'roster', null, 'database', { teamSlug: 'welfare', onDuty: 1, free: 1,
      freeBySkill: { 'medical-cert': 0, 'crowd-cert': 0 } }),
  ];
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value != null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('compactPlaybook', () => {
  it('preserves all SOP rules, version, source and action order while removing only schema-defined empty defaults', () => {
    const original = book();
    const compact = compactPlaybook(original);
    expect(compact.playbookKey).toBe('heat-response:4');
    expect(compact.version).toBe(4);
    expect(PlaybookContentSchema.parse(compact.content)).toEqual(original.content);
    expect(compact.content.actions[0]).toEqual({ id: 'treatment', requirement: 'must', teamSlug: 'first-aid',
      title: 'Assess heat casualties', instructions: 'Assess affected people and report severity to Mo.', peopleNeeded: null });
    expect(compact.content.actions[1]).toEqual(original.content.actions[1]);
    expect(compact).not.toHaveProperty('id');
    expect(compact).not.toHaveProperty('status');
    expect(compact).not.toHaveProperty('createdAt');
    expect(compact).not.toHaveProperty('updatedAt');
    expect(compact).not.toHaveProperty('publishedAt');
  });

  it('retains explicit unknown headcounts and an empty source rather than inventing staffing or provenance', () => {
    const original = book();
    original.content.source = '';
    const compact = compactPlaybook(original);
    expect(compact.content.source).toBe('');
    expect(compact.content.actions[0].peopleNeeded).toBeNull();
    expect(compact.content.actions[1].peopleNeeded).toBe(3);
  });

  it('builds a routing index with exact applicability, keeping all rules only in full retrieval', () => {
    const original = book();
    expect(playbookIndex(original)).toEqual({
      playbookKey: 'heat-response:4', slug: original.content.slug, version: original.version,
      title: original.content.title, appliesWhen: original.content.appliesWhen,
    });
    for (const field of ['id', 'requiredInputs', 'constraints', 'decisionPoints', 'source', 'actions'])
      expect(playbookIndex(original)).not.toHaveProperty(field);
    const retrieved = compactPlaybook(original);
    expect(PlaybookContentSchema.parse(retrieved.content)).toEqual(original.content);
    expect(retrieved.content.requiredInputs).toEqual(original.content.requiredInputs);
    expect(retrieved.content.constraints).toEqual(original.content.constraints);
    expect(retrieved.content.decisionPoints).toEqual(original.content.decisionPoints);
    expect(retrieved.content.source).toBe(original.content.source);
    expect(retrieved.content.actions).toHaveLength(original.content.actions.length);
  });

  it('does not truncate, paraphrase or normalize MO-authored applicability text in the routing index', () => {
    const original = book();
    original.content.appliesWhen = 'MO 設定：\n' + '雷雨進場前，需同時確認舞台狀態、觀眾位置及核准路線；不可只靠溫度判斷。'.repeat(35);
    const indexed = playbookIndex(original);
    expect(indexed.appliesWhen).toBe(original.content.appliesWhen);
    expect(indexed.appliesWhen.length).toBeGreaterThan(1000);
    expect(compactPlaybook(original).content.appliesWhen).toBe(indexed.appliesWhen);
  });

  it.each(['draft', 'disabled'] as const)('refuses %s playbooks in both full and index modes', (status) => {
    const original = book();
    original.status = status;
    expect(() => compactPlaybook(original)).toThrow('Only published');
    expect(() => playbookIndex(original)).toThrow('Only published');
    const input = snapshot();
    input.playbooks = [original];
    expect(() => compactPlanningInput(input)).toThrow('Only published');
    expect(() => compactPlanningInput(input, { playbookMode: 'index_only' })).toThrow('Only published');
  });
});

describe('compactPlanningInput', () => {
  it('defaults to every published full SOP; tool-only index mode must be requested explicitly', () => {
    const input = snapshot();
    const projected = compactPlanningInput(input);
    expect(projected.playbookMode).toBe('all_full');
    expect(projected).toEqual(compactPlanningInput(input, { playbookMode: 'all_full' }));
    expect(projected.playbooks).toEqual(input.playbooks.map(compactPlaybook));
    const indexed = compactPlanningInput(input, { playbookMode: 'index_only' });
    expect(indexed.playbookMode).toBe('index_only');
    expect(indexed.playbooks).toEqual(input.playbooks.map(playbookIndex));
    expect(projected.playbooks).toHaveLength(input.playbooks.length);
    expect(indexed.playbooks).toHaveLength(input.playbooks.length);
  });

  it('does not mutate even a deeply frozen audit snapshot, and returns independent nested data', () => {
    const input = deepFreeze(snapshot());
    const saved = structuredClone(input);
    const projected = compactPlanningInput(input);
    projected.evidence[0].value.temperatureC = -10;
    projected.routes.values[0][2] = 999;
    projected.teams[0].name = 'Changed';
    projected.skills[0].name = 'Changed';
    projected.existingResponses[0].title = 'Changed';
    const full = projected.playbooks[0];
    if ('content' in full) {
      full.content.constraints[0].instruction = 'Changed';
      full.content.actions[1].requiredSkills?.push('Changed');
    }
    expect(input).toEqual(saved);
    const indexed = playbookIndex(input.playbooks[0]);
    indexed.appliesWhen = 'Changed';
    expect(input).toEqual(saved);
  });

  it('deduplicates venue fields only against the exact database fact and keeps every fact with its provenance', () => {
    const input = snapshot();
    const projected = compactPlanningInput(input);
    expect(projected.zones).toEqual([
      { slug: 'lawn-stage', evidenceRef: 'venue-lawn-stage' },
      { slug: 'water-point', evidenceRef: 'venue-water-point' },
    ]);
    expect(projected.evidence).toEqual(input.evidence);
    expect(projected.evidence.find((fact) => fact.ref === 'venue-lawn-stage')).toMatchObject({
      source: 'database', observedAt: evaluatedAt, value: input.zones[0],
    });
  });

  it.each(['capacity', 'kind', 'provenance', 'missing'] as const)('retains the full venue when %s cannot be deduplicated safely', (reason) => {
    const input = snapshot();
    const index = input.evidence.findIndex((fact) => fact.ref === 'venue-lawn-stage');
    if (reason === 'capacity') input.evidence[index].value.capacity = 2499;
    if (reason === 'kind') input.evidence[index].value.kind = 'shelter';
    if (reason === 'provenance') input.evidence[index].source = 'manual_demo';
    if (reason === 'missing') input.evidence.splice(index, 1);
    expect(compactPlanningInput(input).zones[0]).toEqual(input.zones[0]);
  });

  it('deduplicates exact weather, set, crowd, incident and observation facts without losing meaning or approval metadata', () => {
    const input = snapshot();
    const projected = compactPlanningInput(input);
    expect(projected).not.toHaveProperty('scenario');
    expect(projected.evidence).toEqual(input.evidence);
    expect(projected.evidence.find((fact) => fact.ref === 'demo-set-0')?.value).toHaveProperty('startsInMinutes', 10);
    expect(projected.evidence.find((fact) => fact.ref === 'demo-incident-0')).toMatchObject({
      observedAt: atMinutesAgo(4), value: { count: 3, openCount: 2, minutesAgo: 4 },
    });
    expect(projected.evidence.find((fact) => fact.ref === 'observation-2')).toMatchObject({
      source: 'manual_demo', observedAt: atMinutesAgo(2), value: { scope: 'site', unit: null, approvalRequired: true,
        value: [{ fromZoneSlug: 'lawn-stage', toZoneSlug: 'water-point', status: 'restricted', approved: false }] },
    });
    expect(JSON.stringify(projected)).not.toContain(input.scenario.requestId);
  });

  it('keeps false and zero explicit facts, but retains null and empty observations as unknown', () => {
    const input = snapshot();
    input.scenario.observations?.push(
      { key: 'medicalHeatCases', kind: 'number', zoneSlug: 'lawn-stage', minutesAgo: 0, value: null },
      { key: 'medicalReports', kind: 'text', zoneSlug: null, minutesAgo: 0, value: '' },
      { key: 'approvedShelterZones', kind: 'locations', zoneSlug: null, minutesAgo: 0, value: [] },
    );
    const projected = compactPlanningInput(input);
    expect(projected.scenario?.observations).toEqual(input.scenario.observations?.slice(3));
    expect(projected.evidence.find((fact) => fact.ref === 'observation-0')?.value.value).toBe(false);
    expect(projected.evidence.find((fact) => fact.ref === 'observation-1')?.value.value).toBe(0);
    expect(projected.inputAvailability['stageSafety.windLimitExceeded']).toMatchObject({ available: true, completeness: 'partial' });
    expect(projected.inputAvailability['weather.windSpeed']).toMatchObject({ available: true, completeness: 'complete' });
    for (const key of ['medicalHeatCases', 'medicalReports', 'approvedShelterZones'])
      expect(projected.inputAvailability[key]).toMatchObject({ available: false, completeness: 'unknown' });
  });

  it.each(['value', 'timestamp', 'kind'] as const)('keeps scenario facts when the evidence %s differs', (reason) => {
    const input = snapshot();
    const evidence = input.evidence.find((fact) => fact.ref === 'demo-weather')!;
    if (reason === 'value') evidence.value.temperatureC = 40;
    if (reason === 'timestamp') evidence.observedAt = atMinutesAgo(1);
    if (reason === 'kind') evidence.kind = 'weather_forecast';
    expect(compactPlanningInput(input).scenario?.weather).toEqual(input.scenario.weather);
  });

  it('does not erase a second identical observation using the first observation evidence', () => {
    const input = snapshot();
    input.scenario.recentIncidents.push(structuredClone(input.scenario.recentIncidents[0]));
    const projected = compactPlanningInput(input);
    expect(projected.scenario?.recentIncidents).toEqual([input.scenario.recentIncidents[1]]);
    expect(projected.evidence.filter((fact) => fact.kind === 'incident')).toHaveLength(1);
  });

  it('preserves structured partial evidence and distinguishes it from all-venue coverage', () => {
    const input = snapshot();
    input.scenario.observations?.push({ key: 'audienceByZone', kind: 'zone_counts', zoneSlug: null, minutesAgo: 0,
      value: { coverage: 'partial', entries: [{ zoneSlug: 'lawn-stage', count: 0 }] } });
    input.evidence.push({ ref: 'audience-sample', kind: 'observation', zoneSlug: null, source: 'manual_demo', observedAt: evaluatedAt,
      value: { key: 'audienceByZone', kind: 'zone_counts', value: { coverage: 'partial', entries: [{ zoneSlug: 'lawn-stage', count: 0 }] },
        unit: 'people', scope: 'site', approvalRequired: false } });
    const projected = compactPlanningInput(input);
    expect(projected).not.toHaveProperty('scenario');
    expect(projected.inputAvailability.audienceByZone).toMatchObject({ available: true, completeness: 'partial' });
    expect(projected.evidence.at(-1)?.value.value).toEqual({ coverage: 'partial', entries: [{ zoneSlug: 'lawn-stage', count: 0 }] });
  });

  it('preserves availability for every required/catalog key and explicit aliases without redundant catalog labels', () => {
    const input = snapshot();
    const projected = compactPlanningInput(input);
    const availability = inputAvailability(input);
    expect(Object.keys(projected.inputAvailability)).toEqual(Object.keys(availability));
    for (const [key, item] of Object.entries(availability)) {
      expect(projected.inputAvailability[key]).toEqual({ source: item.source, available: item.available, completeness: item.completeness,
        ...(key !== item.canonicalKey ? { canonicalKey: item.canonicalKey } : {}) });
      expect(projected.inputAvailability[key]).not.toHaveProperty('label');
    }
    expect(projected.inputAvailability['weather.temperature']).toHaveProperty('canonicalKey', 'weather.temperatureC');
    expect(projected.inputAvailability.currentRoster).toHaveProperty('canonicalKey', 'roster');
    expect(projected.inputAvailability['weather.temperatureC']).not.toHaveProperty('canonicalKey');
    expect(projected.inputAvailability.unconnectedSensor).toEqual({ source: 'unsupported', available: false, completeness: 'unknown' });
  });

  it('keeps unmatched scenario data independent of the audit snapshot', () => {
    const input = snapshot();
    input.evidence = [];
    const saved = structuredClone(input);
    const projected = compactPlanningInput(input);
    expect(projected.scenario).toEqual({ weather: input.scenario.weather, upcomingSets: input.scenario.upcomingSets,
      crowdByZone: input.scenario.crowdByZone, recentIncidents: input.scenario.recentIncidents, observations: input.scenario.observations });
    projected.scenario!.weather!.temperatureC = 0;
    projected.scenario!.observations![0].value = null;
    projected.zones[0].slug = 'changed';
    expect(input).toEqual(saved);
  });
});

describe('roster capacity projection', () => {
  it('uses complete database aggregates, not named crew or an invented joint-skill count', () => {
    const input = snapshot();
    const projected = compactPlanningInput(input);
    expect(projected.roster).toMatchObject({ projection: 'volunteer_capacity_by_team', source: 'database',
      evidenceRefs: ['roster-first-aid', 'roster-welfare'], allocation: 'server_only' });
    expect(Array.isArray(projected.roster)).toBe(false);
    if (!Array.isArray(projected.roster)) {
      expect(projected.roster.note).toContain('not proof that the same people hold multiple skills');
      expect(projected.roster.note).toContain('not leads or Mo');
    }
    expect(JSON.stringify(projected.roster)).not.toContain('Alice');
    expect(JSON.stringify(projected.roster)).not.toContain('volunteer-a');
    expect(projected.evidence.filter((fact) => fact.kind === 'roster')).toEqual(input.evidence.filter((fact) => fact.kind === 'roster'));
  });

  it.each(['missing_team', 'missing_skill', 'wrong_free', 'wrong_skill', 'wrong_source', 'duplicate', 'orphan_free',
    'negative_count', 'more_free_than_on_duty', 'noninteger_skill', 'missing_skills', 'no_teams'] as const)(
    'keeps the full roster when aggregates are unverified: %s', (reason) => {
      const input = snapshot();
      const fact = input.evidence.find((entry) => entry.ref === 'roster-first-aid')!;
      if (reason === 'missing_team') input.evidence = input.evidence.filter((entry) => entry.ref !== 'roster-welfare');
      if (reason === 'missing_skill') delete (fact.value.freeBySkill as Record<string, unknown>)['medical-cert'];
      if (reason === 'wrong_free') fact.value.free = 1;
      if (reason === 'wrong_skill') (fact.value.freeBySkill as Record<string, unknown>)['medical-cert'] = 2;
      if (reason === 'wrong_source') fact.source = 'manual_demo';
      if (reason === 'duplicate') input.evidence.push(structuredClone(fact));
      if (reason === 'orphan_free') input.roster[0].teamSlug = null;
      if (reason === 'negative_count') fact.value.free = -1;
      if (reason === 'more_free_than_on_duty') fact.value.onDuty = 1;
      if (reason === 'noninteger_skill') (fact.value.freeBySkill as Record<string, unknown>)['medical-cert'] = 0.5;
      if (reason === 'missing_skills') fact.value.freeBySkill = null;
      if (reason === 'no_teams') input.teams = [];
      const projected = compactPlanningInput(input);
      expect(projected.roster).toEqual(input.roster);
      expect(projected.roster).not.toBe(input.roster);
      if (Array.isArray(projected.roster)) projected.roster[0].skills.push('changed');
      expect(input.roster[0].skills).not.toContain('changed');
    });

  it('keeps a genuinely queried empty roster as zero capacity, not an unknown named roster', () => {
    const input = snapshot();
    input.roster = [];
    for (const fact of input.evidence.filter((entry) => entry.kind === 'roster'))
      fact.value = { teamSlug: fact.value.teamSlug, onDuty: 0, free: 0, freeBySkill: { 'medical-cert': 0, 'crowd-cert': 0 } };
    const projected = compactPlanningInput(input);
    expect(projected.roster).toMatchObject({ projection: 'volunteer_capacity_by_team', source: 'database' });
    expect(projected.inputAvailability.roster).toMatchObject({ available: true, completeness: 'complete' });
  });
});

describe('compactRoutes', () => {
  it('round-trips every named route and its exact directional values without granting emergency approval', () => {
    const routes = [...snapshot().routes, { from: 'gate', to: 'first-aid', minutes: 0, meters: 0 }];
    const table = compactRoutes(routes);
    expect(table.columns).toEqual(['from', 'to', 'minutes', 'meters']);
    expect(table.kind).toBe('ordinary_walking_distances_not_emergency_authorizations');
    expect(table.values.map(([from, to, minutes, meters]) => ({ from, to, minutes, meters }))).toEqual(routes);
    expect(table.values[0]).toEqual(['lawn-stage', 'water-point', 3.5, 120.25]);
    expect(table.values[1]).toEqual(['water-point', 'lawn-stage', 4, 126]);
    table.values[0][0] = 'changed';
    expect(routes[0].from).toBe('lawn-stage');
  });

  it('supports an empty route result without inventing connectivity', () => {
    expect(compactRoutes([]).values).toEqual([]);
  });

  it('reduces repeated keys at realistic route volume while retaining all 210 directional rows', () => {
    const routes = Array.from({ length: 210 }, (_, i) => ({ from: `zone-${i % 15}`, to: `zone-${(i + 1) % 15}`,
      minutes: i / 10, meters: i * 1.25 }));
    const table = compactRoutes(routes);
    expect(table.values).toHaveLength(210);
    expect(table.values.map(([from, to, minutes, meters]) => ({ from, to, minutes, meters }))).toEqual(routes);
    expect(JSON.stringify(table).length).toBeLessThan(JSON.stringify(routes).length);
  });
});
