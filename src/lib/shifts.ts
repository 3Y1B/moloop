import type { Batch } from '@/lib/batch';
import { clockTime } from '@/lib/format';
import { isBusy } from '@/lib/lifecycle';
import type { RosteredShift, Volunteer } from '@/lib/schema';

/**
 * The roster on the day, one scheduler pass at a time. Going on duty is still the volunteer's own tap: the roster
 * says when they're due, the tap says they're actually there, and only people on duty get tasks.
 *
 *  - Starting: a short ping before it starts, once. Anyone already on duty is simply checked in.
 *  - Going on duty from 30 min before a shift until it ends checks them in (a late arrival too).
 *  - Not in by noShowMs after it starts: a no-show. Their lead hears, with who's free to cover: same team, not on a
 *    shift now, said they're free until it ends, holds what it needs.
 *  - Ending: checked out and off duty, unless another shift follows straight on, or they're still on a task, in which
 *    case they finish it first and go off on a later pass.
 */

const MIN = 60_000;
export const SHIFTS = { remindBeforeMs: 10 * MIN, checkInEarlyMs: 30 * MIN, noShowMs: 15 * MIN };

const first = (v: Volunteer) => v.name.split(' ')[0];
const live = (s: RosteredShift) => s.status === 'assigned' || s.status === 'checked_in';

/** The shift someone is working right now, for "until 6pm". */
export const currentShift = (shifts: Record<string, RosteredShift>, volunteerId: string, at: number) =>
  Object.values(shifts).find((s) => s.volunteerId === volunteerId && live(s) && s.startsAt <= at && at < s.endsAt);

/** On duty: checked into the shift they're due on now, late or not. */
export function checkIn(b: Batch, volunteerId: string) {
  for (const s of Object.values(b.shifts)) {
    const due = s.startsAt - SHIFTS.checkInEarlyMs <= b.now && b.now < s.endsAt;
    if (s.volunteerId === volunteerId && due && (s.status === 'assigned' || s.status === 'no_show')) b.shift({ ...s, status: 'checked_in' });
  }
}

/** Who could step in for a no-show, best first: free for all that's left of it. */
export function coverFor(b: Batch, s: RosteredShift): Volunteer[] {
  const rostered = new Set(Object.values(b.shifts).filter((x) => live(x) && x.startsAt <= b.now && b.now < x.endsAt).map((x) => x.volunteerId));
  return Object.values(b.volunteers)
    .filter((v) => v.role === 'volunteer' && v.teamSlug === s.teamSlug && v.id !== s.volunteerId && !rostered.has(v.id)
      && s.requires.every((k) => v.skills.includes(k))
      && (b.availability[v.id] ?? []).some((w) => w.from <= b.now && w.to >= s.endsAt)
      && !isBusy(b.all(), v.id))
    .sort((a, c) => Number(c.duty === 'on_duty') - Number(a.duty === 'on_duty') || a.name.localeCompare(c.name));
}

export function shiftStep(b: Batch) {
  for (const s of Object.values(b.shifts).sort((a, c) => a.startsAt - c.startsAt)) {
    const v = b.volunteers[s.volunteerId];
    if (!v) continue;
    const team = (s.teamSlug && b.teams[s.teamSlug]?.name) || 'your team';

    if (s.status === 'assigned' && s.remindedAt === null && b.now >= s.startsAt - SHIFTS.remindBeforeMs && b.now < s.endsAt) {
      if (v.duty === 'on_duty') {
        b.shift({ ...s, status: 'checked_in', remindedAt: b.now });
        continue;
      }
      b.shift({ ...s, remindedAt: b.now });
      b.send(v.id, 'system', `Shift at ${clockTime(s.startsAt)}: ${team} till ${clockTime(s.endsAt)}. Go on duty when you’re there.`, { delivery: 'ping' });
      continue;
    }

    if (s.status === 'assigned' && v.duty !== 'on_duty' && b.now >= s.startsAt + SHIFTS.noShowMs && b.now < s.endsAt) {
      b.shift({ ...b.shifts[s.id], status: 'no_show' });
      const lead = b.leadFor(s.teamSlug) ?? b.coordinator();
      const cover = coverFor(b, s).slice(0, 2).map((c) => c.name);
      if (lead) {
        b.send(lead.id, 'escalation', `${v.name} not in for ${clockTime(s.startsAt)}. ${cover.length ? `Free to cover: ${cover.join(', ')}.` : 'Nobody free to cover.'}`);
      }
      continue;
    }

    if (s.status === 'checked_in' && b.now >= s.endsAt) {
      const next = Object.values(b.shifts).find((x) => x.volunteerId === v.id && x.id !== s.id && x.status === 'assigned' && x.startsAt <= b.now && b.now < x.endsAt);
      if (next) {
        b.shift({ ...s, status: 'completed' });
        b.shift({ ...next, status: 'checked_in', remindedAt: b.now });
        continue;
      }
      if (isBusy(b.all(), v.id)) continue;
      b.shift({ ...s, status: 'completed' });
      if (v.duty === 'off_shift') continue;
      b.volunteer({ ...v, duty: 'off_shift' });
      b.send(v.id, 'system', `Shift done. Thanks, ${first(v)}!`, { delivery: 'ping', quiet: true });
    }
  }
}
