import type { TeamSlug } from '@/lib/schema';

/**
 * The weekend roster: which volunteers work which shifts, from when each said they're free. Pure; scripts/roster.ts
 * loads the people, makes the shifts and writes what this decides.
 *
 * Hard rules: your own team, the whole shift inside a time you said you're free, every certificate the shift needs
 * (in date), no two shifts at once, at most RULES.perDay a day and RULES.total all weekend, and never more than
 * RULES.firstTimersPerReturning first-timers for each returning volunteer on a shift. Within those, shifts fill
 * one place at a time, emptiest first, so a shortage lands evenly instead of emptying one shift; each place goes
 * to whoever has the fewest shifts so far, then whoever could do the fewest others, then someone with a radio if
 * the shift has none yet. What can't be filled comes back as a gap with the reason.
 */

export const TIME_ZONE = 'Australia/Melbourne';

/** Each day's shifts, in local hours: gates open at 11, the last set ends at 11. */
export const BLOCKS: readonly (readonly [number, number])[] = [[10, 14], [14, 18], [18, 23]];

/** People per shift, by team and block. Evenings need more on the gates and security. */
export const NEED: Record<TeamSlug, readonly [number, number, number]> = {
  'first-aid': [6, 6, 6],
  welfare: [5, 5, 4],
  crowd: [8, 9, 11],
  security: [3, 4, 5],
  info: [6, 6, 5],
  artist: [3, 3, 4],
  vendors: [4, 4, 4],
  ops: [8, 8, 8],
};

/** What everyone on a team's shift must hold. Other teams only want a radio somewhere on each shift. */
export const REQUIRES: Partial<Record<TeamSlug, string[]>> = {
  'first-aid': ['first-aid-cert'],
  welfare: ['wwcc'],
  security: ['security-licence'],
};

export const RULES = { perDay: 2, total: 3, firstTimersPerReturning: 2 };

export type Window = { from: number; to: number };
export type RosterPerson = { id: string; teamSlug: TeamSlug; skills: string[]; firstTimer: boolean; windows: Window[] };
export type RosterShift = { id: string; teamSlug: TeamSlug; startsAt: number; endsAt: number; need: number; requires: string[] };
export type Gap = { shiftId: string; short: number; why: string };
export type Roster = { on: Record<string, string[]>; gaps: Gap[] };

/** Epoch ms of a wall-clock hour on a festival day ('2026-10-10'), in Melbourne whatever the server's zone. */
export function localTime(day: string, hour: number) {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const name = new Intl.DateTimeFormat('en-AU', { timeZone: TIME_ZONE, timeZoneName: 'longOffset' })
    .formatToParts(guess).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const [, sign, hh, mm] = /GMT([+-])(\d\d):?(\d\d)?/.exec(name) ?? [];
  const offset = sign ? (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm ?? 0)) * 60_000 : 0;
  return guess - offset;
}

/** The Melbourne date of a moment, '2026-10-10'. */
export const localDay = (at: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(at);

/** The festival's shifts: every team, every block, every day. */
export function makeShifts(days: string[]): RosterShift[] {
  return days.flatMap((day) => BLOCKS.flatMap(([from, to], block) => (Object.keys(NEED) as TeamSlug[]).map((teamSlug) => ({
    id: `${teamSlug} ${day} ${from}`, teamSlug, startsAt: localTime(day, from), endsAt: localTime(day, to),
    need: NEED[teamSlug][block], requires: REQUIRES[teamSlug] ?? [],
  }))));
}

const free = (p: RosterPerson, s: RosterShift) => p.windows.some((w) => w.from <= s.startsAt && w.to >= s.endsAt);
const holds = (p: RosterPerson, s: RosterShift) => s.requires.every((k) => p.skills.includes(k));

export function roster(shifts: RosterShift[], people: RosterPerson[], rules = RULES): Roster {
  const on: Record<string, string[]> = Object.fromEntries(shifts.map((s) => [s.id, []]));
  const mine = new Map<string, RosterShift[]>(people.map((p) => [p.id, []]));
  const byId = new Map(people.map((p) => [p.id, p]));
  const can = new Map(shifts.map((s) => [s.id, people.filter((p) => p.teamSlug === s.teamSlug && free(p, s) && holds(p, s))]));
  const options = new Map(people.map((p) => [p.id, shifts.filter((s) => can.get(s.id)!.includes(p)).length]));

  /** Still has room for this one: not on it or anything overlapping, under the day and weekend limits. */
  const room = (p: RosterPerson, s: RosterShift) => {
    const has = mine.get(p.id)!;
    return !on[s.id].includes(p.id)
      && has.every((x) => x.endsAt <= s.startsAt || x.startsAt >= s.endsAt)
      && has.length < rules.total
      && has.filter((x) => localDay(x.startsAt) === localDay(s.startsAt)).length < rules.perDay;
  };
  /** Adding them keeps enough returning volunteers on the shift to look after its first-timers. */
  const mix = (p: RosterPerson, s: RosterShift) => {
    if (!p.firstTimer) return true;
    const firstTimers = on[s.id].filter((id) => byId.get(id)!.firstTimer).length;
    return firstTimers + 1 <= rules.firstTimersPerReturning * (on[s.id].length - firstTimers);
  };
  const radio = (s: RosterShift) => on[s.id].some((id) => byId.get(id)!.skills.includes('radio-trained'));

  for (let placed = true; placed;) {
    placed = false;
    const open = shifts
      .filter((s) => on[s.id].length < s.need)
      .sort((a, b) => on[a.id].length / a.need - on[b.id].length / b.need || can.get(a.id)!.length - can.get(b.id)!.length || a.startsAt - b.startsAt);
    for (const s of open) {
      const best = can.get(s.id)!
        .filter((p) => room(p, s) && mix(p, s))
        .sort((a, b) =>
          mine.get(a.id)!.length - mine.get(b.id)!.length
          || options.get(a.id)! - options.get(b.id)!
          || (radio(s) ? 0 : Number(b.skills.includes('radio-trained')) - Number(a.skills.includes('radio-trained')))
          || a.id.localeCompare(b.id))[0];
      if (!best) continue;
      on[s.id].push(best.id);
      mine.get(best.id)!.push(s);
      placed = true;
    }
  }

  const gaps = shifts.filter((s) => on[s.id].length < s.need).map((s) => ({ shiftId: s.id, short: s.need - on[s.id].length, why: whyShort(s) }));
  return { on, gaps };

  function whyShort(s: RosterShift) {
    const around = people.filter((p) => p.teamSlug === s.teamSlug && free(p, s) && !on[s.id].includes(p.id));
    if (!around.length) return 'nobody else on the team is free then';
    const qualified = around.filter((p) => holds(p, s));
    if (!qualified.length) return `nobody else free holds ${s.requires.join(' and ')}`;
    if (!qualified.some((p) => room(p, s))) return 'everyone else free already has their shifts';
    return 'the rest free are first-timers, and it needs more returning volunteers';
  }
}
