import { describe, expect, it } from 'vitest';

import { localDay, localTime, makeShifts, roster, type RosterPerson, type RosterShift } from './roster';

const SAT = '2026-10-10';
const SUN = '2026-10-11';
const at = localTime;

const shift = (id: string, over: Partial<RosterShift> = {}): RosterShift => ({
  id, teamSlug: 'crowd', startsAt: at(SAT, 10), endsAt: at(SAT, 14), need: 1, requires: [], ...over,
});
const person = (id: string, over: Partial<RosterPerson> = {}): RosterPerson => ({
  id, teamSlug: 'crowd', skills: [], firstTimer: false, windows: [{ from: at(SAT, 10), to: at(SUN, 23) }], ...over,
});

describe('localTime', () => {
  it('is Melbourne wall-clock time, daylight saving included', () => {
    expect(new Date(at(SAT, 14)).toISOString()).toBe('2026-10-10T03:00:00.000Z');
    expect(new Date(at('2026-07-04', 14)).toISOString()).toBe('2026-07-04T04:00:00.000Z');
    expect(localDay(at(SAT, 23))).toBe(SAT);
  });
});

describe('makeShifts', () => {
  it('makes every team three shifts a day', () => {
    const shifts = makeShifts([SAT, SUN]);

    expect(shifts).toHaveLength(2 * 3 * 8);
    expect(shifts.find((s) => s.id === `first-aid ${SAT} 14`)).toMatchObject({ need: 6, requires: ['first-aid-cert'], endsAt: at(SAT, 18) });
  });
});

describe('roster', () => {
  it('only puts people on shifts inside the times they said they are free', () => {
    const sat = shift('sat');
    const sun = shift('sun', { startsAt: at(SUN, 10), endsAt: at(SUN, 14) });
    const saturdayOnly = person('ana', { windows: [{ from: at(SAT, 10), to: at(SAT, 23) }] });

    const { on, gaps } = roster([sat, sun], [saturdayOnly]);

    expect(on).toEqual({ sat: ['ana'], sun: [] });
    expect(gaps).toEqual([{ shiftId: 'sun', short: 1, why: 'nobody else on the team is free then' }]);
  });

  it('keeps people to their own team and the certificates the shift needs', () => {
    const firstAid = shift('fa', { teamSlug: 'first-aid', requires: ['first-aid-cert'], need: 2 });
    const people = [person('cert', { teamSlug: 'first-aid', skills: ['first-aid-cert'] }), person('nocert', { teamSlug: 'first-aid' }), person('crowd', { skills: ['first-aid-cert'] })];

    const { on, gaps } = roster([firstAid], people);

    expect(on.fa).toEqual(['cert']);
    expect(gaps[0].why).toBe('nobody else free holds first-aid-cert');
  });

  it('never puts more than two first-timers with each returning volunteer', () => {
    const big = shift('big', { need: 5 });
    const people = [person('ret'), ...['a', 'b', 'c', 'd'].map((id) => person(id, { firstTimer: true }))];

    const { on, gaps } = roster([big], people);

    expect(on.big.sort()).toEqual(['a', 'b', 'ret']);
    expect(gaps[0]).toMatchObject({ short: 2, why: 'the rest free are first-timers, and it needs more returning volunteers' });
  });

  it('caps shifts a day and all weekend, and shares them out evenly', () => {
    const shifts = [10, 14, 18].flatMap((h) => [SAT, SUN].map((d) => shift(`${d} ${h}`, { startsAt: at(d, h), endsAt: at(d, h + 4), need: 1 })));

    const { on } = roster(shifts, [person('keen'), person('also')]);

    const count = (id: string) => Object.values(on).filter((ids) => ids.includes(id)).length;
    expect(count('keen')).toBe(3);
    expect(count('also')).toBe(3);
    for (const day of [SAT, SUN]) {
      expect(Object.entries(on).filter(([id, ids]) => id.startsWith(day) && ids.includes('keen')).length).toBeLessThanOrEqual(2);
    }
  });

  it('spreads a shortage instead of emptying one shift', () => {
    const early = shift('early', { need: 3 });
    const late = shift('late', { startsAt: at(SAT, 14), endsAt: at(SAT, 18), need: 3 });
    const people = ['a', 'b', 'c'].map((id) => person(id));

    const { on } = roster([early, late], people, { perDay: 1, total: 1, firstTimersPerReturning: 2 });

    expect([on.early.length, on.late.length].sort()).toEqual([1, 2]);
  });

  it('gets a radio onto each shift when it can', () => {
    const s = shift('s', { need: 1 });

    const { on } = roster([s], [person('a'), person('b', { skills: ['radio-trained'] })]);

    expect(on.s).toEqual(['b']);
  });
});
