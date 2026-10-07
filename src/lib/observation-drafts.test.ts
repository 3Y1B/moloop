import { describe, expect, it } from 'vitest';

import type { MobilizationObservation } from './mobilization-observations';
import { observationInputsToDrafts } from './observation-drafts';

const base = { zoneSlug: null, minutesAgo: 0 };
const inputs: MobilizationObservation[] = [
  { ...base, key: 'weather.windSpeed', kind: 'number', value: 82.5 },
  { ...base, key: 'stageSafety.windLimitExceeded', zoneSlug: 'main-stage', kind: 'boolean', value: false },
  { ...base, key: 'stageStatus', kind: 'status', value: 'held', minutesAgo: 12 },
  { ...base, key: 'medicalReports', kind: 'text', value: 'Heat symptoms near water point.' },
  { ...base, key: 'incidentLocation', kind: 'location', value: 'water-1' },
  { ...base, key: 'audienceByZone', kind: 'zone_counts', value: {
    coverage: 'all_venue', entries: [{ zoneSlug: 'main-stage', count: 0 }, { zoneSlug: 'bar', count: 1200 }],
  } },
  { ...base, key: 'approvedShelterZones', kind: 'locations', value: [
    { zoneSlug: 'first-aid', status: 'open', capacity: null, approved: false },
    { zoneSlug: 'bar', status: 'restricted', capacity: 0, approved: true },
  ] },
  { ...base, key: 'approvedEvacuationRoutes', kind: 'routes', value: [
    { fromZoneSlug: 'main-stage', toZoneSlug: 'bar', status: 'restricted', approved: false },
  ] },
];

describe('observationInputsToDrafts', () => {
  it('converts all eight kinds into their matching editable shapes', () => {
    expect(observationInputsToDrafts(inputs)).toEqual([
      { id: 'preset-0-weather.windSpeed', key: 'weather.windSpeed', kind: 'number', zoneSlug: '', minutesAgo: '0', value: '82.5' },
      { id: 'preset-1-stageSafety.windLimitExceeded', key: 'stageSafety.windLimitExceeded', kind: 'boolean', zoneSlug: 'main-stage', minutesAgo: '0', value: false },
      { id: 'preset-2-stageStatus', key: 'stageStatus', kind: 'status', zoneSlug: '', minutesAgo: '12', value: 'held' },
      { id: 'preset-3-medicalReports', key: 'medicalReports', kind: 'text', zoneSlug: '', minutesAgo: '0', value: 'Heat symptoms near water point.' },
      { id: 'preset-4-incidentLocation', key: 'incidentLocation', kind: 'location', zoneSlug: '', minutesAgo: '0', value: 'water-1' },
      { id: 'preset-5-audienceByZone', key: 'audienceByZone', kind: 'zone_counts', zoneSlug: '', minutesAgo: '0', value: {
        coverage: 'all_venue', entries: [{ zoneSlug: 'main-stage', count: '0' }, { zoneSlug: 'bar', count: '1200' }],
      } },
      { id: 'preset-6-approvedShelterZones', key: 'approvedShelterZones', kind: 'locations', zoneSlug: '', minutesAgo: '0', value: [
        { zoneSlug: 'first-aid', status: 'open', capacity: '', approved: false },
        { zoneSlug: 'bar', status: 'restricted', capacity: '0', approved: true },
      ] },
      { id: 'preset-7-approvedEvacuationRoutes', key: 'approvedEvacuationRoutes', kind: 'routes', zoneSlug: '', minutesAgo: '0', value: [
        { fromZoneSlug: 'main-stage', toZoneSlug: 'bar', status: 'restricted', approved: false },
      ] },
    ]);
  });

  it('keeps null values unknown rather than inventing numbers, text or approvals', () => {
    const unknown: MobilizationObservation[] = [
      { ...base, kind: 'number', key: 'weather.windSpeed', value: null },
      { ...base, kind: 'boolean', key: 'stageSafety.windLimitExceeded', value: null },
      { ...base, kind: 'status', key: 'stageStatus', value: null },
      { ...base, kind: 'text', key: 'medicalReports', value: null },
      { ...base, kind: 'location', key: 'incidentLocation', value: null },
      { ...base, kind: 'zone_counts', key: 'audienceByZone', value: null },
      { ...base, kind: 'locations', key: 'approvedShelterZones', value: null },
      { ...base, kind: 'routes', key: 'approvedEvacuationRoutes', value: null },
    ];
    expect(observationInputsToDrafts(unknown).map((draft) => draft.value)).toEqual([
      '', null, null, '', null, { coverage: null, entries: [] }, [], [],
    ]);
  });

  it('preserves zero, fractional numeric values, false and the maximum observation age', () => {
    const rows: MobilizationObservation[] = [
      { ...base, key: 'weather.windSpeed', kind: 'number', value: 0, minutesAgo: 1440 },
      { ...base, key: 'crowd.densityByZone', kind: 'number', value: 0.25, zoneSlug: 'main-stage' },
      { ...base, key: 'stageSafety.windLimitExceeded', kind: 'boolean', value: false, zoneSlug: 'main-stage' },
    ];
    const drafts = observationInputsToDrafts(rows);
    expect(drafts[0]).toMatchObject({ value: '0', minutesAgo: '1440' });
    expect(drafts[1]).toMatchObject({ value: '0.25', zoneSlug: 'main-stage' });
    expect(drafts[2].value).toBe(false);
  });

  it('retains partial coverage and empty known collection shapes', () => {
    const rows: MobilizationObservation[] = [
      { ...base, key: 'gateCounts', kind: 'zone_counts', value: { coverage: 'partial', entries: [] } },
      { ...base, key: 'shelters', kind: 'locations', value: [] },
      { ...base, key: 'approvedRoutes', kind: 'routes', value: [] },
    ];
    expect(observationInputsToDrafts(rows).map((draft) => draft.value)).toEqual([
      { coverage: 'partial', entries: [] }, [], [],
    ]);
  });

  it('makes stable unique IDs even when one key is measured in different zones', () => {
    const rows: MobilizationObservation[] = [
      { ...base, key: 'crowd.densityByZone', kind: 'number', value: 5, zoneSlug: 'main-stage' },
      { ...base, key: 'crowd.densityByZone', kind: 'number', value: 6, zoneSlug: 'bar' },
    ];
    const ids = observationInputsToDrafts(rows).map((draft) => draft.id);
    expect(new Set(ids).size).toBe(rows.length);
    expect(observationInputsToDrafts(rows).map((draft) => draft.id)).toEqual(ids);
  });

  it('creates fresh nested collections and entries on every invocation', () => {
    const before = structuredClone(inputs);
    const first = observationInputsToDrafts(inputs);
    const next = observationInputsToDrafts(inputs);
    for (let index = 0; index < first.length; index++) expect(first[index]).not.toBe(next[index]);

    const counts = first.find((draft) => draft.kind === 'zone_counts')!;
    const locations = first.find((draft) => draft.kind === 'locations')!;
    const routes = first.find((draft) => draft.kind === 'routes')!;
    counts.value.entries[0].count = '99';
    locations.value[0].approved = true;
    locations.value[0].capacity = '500';
    routes.value[0].toZoneSlug = 'water-1';
    expect(inputs).toEqual(before);
    expect(next).toEqual(observationInputsToDrafts(inputs));
  });

  it('accepts a readonly frozen array without mutating its rows', () => {
    const rows: readonly MobilizationObservation[] = Object.freeze([
      Object.freeze({ ...base, key: 'weather.windSpeed', kind: 'number' as const, value: 0 }),
    ]);
    expect(observationInputsToDrafts(rows)[0].value).toBe('0');
    expect(observationInputsToDrafts([])).toEqual([]);
  });
});
