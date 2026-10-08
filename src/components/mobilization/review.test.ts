import { describe, expect, it } from 'vitest';

import type { Mobilization, MobilizationCause, Volunteer } from '@/lib/schema';
import { causeLines, shortfall } from './review';

const MIN = 60_000;
const now = 100 * MIN;
const place = (slug: string | null | undefined) => (slug === 'lawn-stage' ? 'Lawn Stage' : null);

describe('causeLines', () => {
  it('says a reading in plain words, latest value only', () => {
    const reading = (value: number, at: number): MobilizationCause => ({
      kind: 'reading', readingId: `r${value}`, key: 'weather.windSpeed', zoneSlug: 'lawn-stage', value,
      line: 'limit 60 km/h', source: 'simulated', at,
    });
    expect(causeLines([reading(55, now - 6 * MIN), reading(72, now - 2 * MIN)], now, place)).toEqual([
      'Wind 72 km/h at Lawn Stage (limit 60 km/h), 2 min ago',
    ]);
  });

  it('counts reports in one place, and names a lone one', () => {
    const report = (n: number, zoneSlug: string | null, at: number): MobilizationCause => ({
      kind: 'report', taskId: `t${n}`, title: `Crush at the barrier ${n}`, zoneSlug, priority: 'P1', at,
    });
    expect(causeLines([
      report(1, 'lawn-stage', now - 10 * MIN),
      report(2, 'lawn-stage', now - 5 * MIN),
      report(3, 'lawn-stage', now - 2 * MIN),
      report(4, null, now - 3 * MIN),
    ], now, place)).toEqual(['3 reports at Lawn Stage in 8 min', 'Crush at the barrier 4, 3 min ago']);
  });
});

describe('shortfall', () => {
  const person = (id: string, teamSlug: Volunteer['teamSlug']): Volunteer => ({
    id, name: id, role: 'volunteer', teamSlug, skills: [], languages: [], zoneSlug: null, duty: 'on_duty',
    shiftEndsAt: null, phone: null,
  });
  it('counts each free person once across steps', () => {
    const plan = {
      steps: [
        { teamSlug: 'crowd', peopleNeeded: 2, reason: '', candidates: [] },
        { teamSlug: 'crowd', peopleNeeded: 2, reason: '', candidates: [] },
      ],
    } as unknown as Mobilization;
    const volunteers = { a: person('a', 'crowd'), b: person('b', 'crowd'), c: person('c', 'ops') };
    expect(shortfall(plan, volunteers, [], now)).toBe(2);
  });
});
