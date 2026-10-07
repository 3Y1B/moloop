import { describe, expect, it } from 'vitest';

import { Batch, type World } from './batch';
import * as C from './commands';
import type { RosteredShift, Task, Volunteer } from './schema';

const MIN = 60_000;
const START = 1_800_000_000_000;
const END = START + 4 * 60 * MIN;

const person = (id: string, over: Partial<Volunteer> = {}): Volunteer => ({
  id, name: `${id[0].toUpperCase()}${id.slice(1)} Smith`, role: 'volunteer', teamSlug: 'first-aid', skills: ['first-aid-cert'], languages: ['en'],
  zoneSlug: 'food-alley', duty: 'off_shift', shiftEndsAt: null, phone: null, ...over,
});
const shift = (id: string, over: Partial<RosteredShift> = {}): RosteredShift => ({
  id, volunteerId: 'tom', teamSlug: 'first-aid', startsAt: START, endsAt: END, requires: ['first-aid-cert'], status: 'assigned', remindedAt: null, ...over,
});
const onTask = (volunteerId: string): Task => ({
  id: 'collapsed', title: 'Man collapsed', summary: 'Near the food trucks.', category: 'medical', priority: 'P2', teamSlug: 'first-aid',
  zoneSlug: 'food-alley', locationHint: null, status: 'accepted', assigneeId: volunteerId, reporter: { kind: 'festivalgoer', quote: 'collapsed', language: 'en' },
  handledBy: 'human', createdAt: END - 10 * MIN, assignedAt: END - 10 * MIN, etaAt: null, lastActivityAt: END, nudgeCount: 0, lastNudgeAt: null,
  leadAlertedAt: null, resolvedAt: null, escalation: null, helpers: [], requiredCount: 1, resolution: null, requestId: null, mobilizationId: null,
});

function day(now: number, { shifts = [shift('s1')], people = [person('tom')], tasks = [] as Task[] } = {}) {
  const volunteers = [...people, person('jordan', { role: 'team_lead', duty: 'on_duty' }), person('mo', { role: 'coordinator', teamSlug: null, duty: 'on_duty' })];
  const world: World = {
    volunteers: Object.fromEntries(volunteers.map((v) => [v.id, v])),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])), proposals: {}, requests: {}, mobilizations: {}, teams: { 'first-aid': { name: 'First Aid' } },
    shifts: Object.fromEntries(shifts.map((s) => [s.id, s])),
    availability: { ana: [{ from: START, to: END }], kai: [{ from: START, to: START + 60 * MIN }] },
  };
  let n = 0;
  return new Batch(world, { now, id: (kind) => `${kind}-${++n}` });
}

describe('a shift starting', () => {
  it('pings the volunteer once, shortly before', () => {
    const b = day(START - 5 * MIN);

    C.schedulerStep(b);
    C.schedulerStep(b);

    expect(b.messages.filter((m) => m.recipientId === 'tom')).toEqual([expect.objectContaining({ kind: 'system', delivery: 'ping', body: expect.stringMatching(/^Shift at .*: First Aid till .*\. Go on duty when you’re there\.$/) })]);
    expect(b.shifts.s1.remindedAt).toBe(START - 5 * MIN);
  });

  it('checks them in when they go on duty, late or not', () => {
    const b = day(START + 20 * MIN, { shifts: [shift('s1', { status: 'no_show' })] });

    C.setDuty(b, 'tom', 'on_duty');

    expect(b.shifts.s1.status).toBe('checked_in');
  });

  it('checks in anyone already on duty without pinging them', () => {
    const b = day(START - 5 * MIN, { people: [person('tom', { duty: 'on_duty' })] });

    C.schedulerStep(b);

    expect(b.shifts.s1.status).toBe('checked_in');
    expect(b.messages).toEqual([]);
  });
});

describe('a no-show', () => {
  it('tells the lead, with who is free to cover all that is left of it', () => {
    const people = [person('tom'), person('ana'), person('kai'), person('lee', { skills: [] })];
    const b = day(START + 16 * MIN, { shifts: [shift('s1', { remindedAt: START - 10 * MIN })], people });

    C.schedulerStep(b);

    expect(b.shifts.s1.status).toBe('no_show');
    // Kai is only free for the first hour; Lee has no first aid certificate.
    expect(b.messages).toEqual([expect.objectContaining({ recipientId: 'jordan', kind: 'escalation', body: expect.stringMatching(/^Tom Smith not in for .*\. Free to cover: Ana Smith\.$/) })]);
  });
});

describe('a shift ending', () => {
  it('takes them off duty', () => {
    const b = day(END, { shifts: [shift('s1', { status: 'checked_in' })], people: [person('tom', { duty: 'on_duty' })] });

    C.schedulerStep(b);

    expect(b.shifts.s1.status).toBe('completed');
    expect(b.volunteers.tom.duty).toBe('off_shift');
    expect(b.messages).toEqual([expect.objectContaining({ recipientId: 'tom', body: 'Shift done. Thanks, Tom!' })]);
  });

  it('lets them finish the task they are on first', () => {
    const b = day(END, { shifts: [shift('s1', { status: 'checked_in' })], people: [person('tom', { duty: 'on_duty' })], tasks: [onTask('tom')] });

    C.schedulerStep(b);

    expect(b.shifts.s1.status).toBe('checked_in');
    expect(b.volunteers.tom.duty).toBe('on_duty');
  });

  it('carries straight on into a back-to-back shift', () => {
    const next = shift('s2', { startsAt: END, endsAt: END + 4 * 60 * MIN });
    const b = day(END, { shifts: [shift('s1', { status: 'checked_in' }), next], people: [person('tom', { duty: 'on_duty' })] });

    C.schedulerStep(b);

    expect(b.shifts.s1.status).toBe('completed');
    expect(b.shifts.s2.status).toBe('checked_in');
    expect(b.volunteers.tom.duty).toBe('on_duty');
  });
});
