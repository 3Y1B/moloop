import { describe, expect, it } from 'vitest';

import { crewFor, teamStats } from './crew';
import type { Task, Volunteer } from './schema';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const person = (id: string, over: Partial<Volunteer> = {}): Volunteer => ({
  id, name: `${id[0].toUpperCase()}${id.slice(1)} Smith`, role: 'volunteer', teamSlug: 'first-aid', skills: [], languages: ['en'],
  zoneSlug: 'food-alley', duty: 'on_duty', shiftEndsAt: null, phone: null, ...over,
});

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, summary: id, category: 'medical', priority: 'P2', teamSlug: 'first-aid', zoneSlug: 'food-alley',
  locationHint: null, status: 'open', assigneeId: null, reporter: { kind: 'volunteer', name: 'Sam Smith', quote: id, language: 'en' },
  handledBy: 'human', createdAt: NOW - 10 * MIN, assignedAt: null, etaAt: null, lastActivityAt: NOW - 10 * MIN, nudgeCount: 0,
  lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null, helpers: [], requiredCount: 1, resolution: null, requestId: null, mobilizationId: null, ...over,
});

function festival(volunteers: Volunteer[], tasks: Task[] = []) {
  return {
    volunteers: Object.fromEntries(volunteers.map((v) => [v.id, v])),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    zones: {},
    now: NOW,
  };
}

const mo = person('mo', { role: 'coordinator', teamSlug: null });

describe('teamStats', () => {
  it('counts everyone on shift per team, in the usual team order, leaving out teams nobody is rostered on', () => {
    const world = festival([
      mo,
      person('linh', { teamSlug: 'welfare' }),
      person('priya'), person('tom', { duty: 'on_break' }), person('ana', { duty: 'off_shift' }),
    ]);
    expect(teamStats(world, 'mo').map((t) => [t.slug, t.onDuty])).toEqual([['first-aid', 2], ['welfare', 1]]);
  });

  it('splits the shift into on a task (owning or helping), free and on break, and names the lead', () => {
    const world = festival(
      [
        mo,
        person('jordan', { role: 'team_lead' }),
        person('priya'), person('tom'), person('kai'), person('ana', { duty: 'on_break' }), person('zed', { duty: 'off_shift' }),
      ],
      [
        task('collapsed', { status: 'in_progress', assigneeId: 'priya', helpers: [{ volunteerId: 'tom', status: 'accepted', assignedAt: NOW, respondedAt: NOW }] }),
        task('done', { status: 'resolved', assigneeId: 'kai' }),
      ],
    );
    expect(teamStats(world, 'mo')).toEqual([{ slug: 'first-aid', leadId: 'jordan', onDuty: 5, onTask: 2, free: 2, onBreak: 1 }]);
  });
});

describe('crewFor', () => {
  const asked = { at: NOW - 3 * MIN, reason: 'Needs a hand', level: 'lead' as const, ownerId: 'jordan', bumpedAt: null, response: null };
  const world = festival(
    [
      mo,
      person('tom'), person('al'), person('ana', { duty: 'off_shift' }), person('bea'), person('priya'),
      person('linh', { teamSlug: 'welfare' }),
    ],
    [
      task('collapsed', { status: 'escalated', assigneeId: 'priya', helpers: [{ volunteerId: 'bea', status: 'accepted', assignedAt: NOW, respondedAt: NOW }], escalation: asked }),
      task('sunburn', { priority: 'P3' }),
      task('faint', { priority: 'P1' }),
      task('queued', { status: 'queued', assigneeId: 'tom' }),
      task('lost', { teamSlug: 'welfare', createdAt: NOW - 20 * MIN }),
    ],
  );

  it("lists one team's people, most urgent first, then by name, with off shift last; each with the task they're on", () => {
    const { members } = crewFor(world, 'mo', 'first-aid');
    expect(members.map((m) => [m.volunteer.id, m.task?.id ?? m.helping?.id ?? null])).toEqual([
      ['priya', 'collapsed'], ['bea', 'collapsed'], ['al', null], ['tom', null], ['ana', null],
    ]);
  });

  it("lists the team's unassigned and queued tasks, most urgent first", () => {
    expect(crewFor(world, 'mo', 'first-aid').openTasks.map((t) => t.id)).toEqual(['faint', 'queued', 'sunburn']);
  });

  it('lists everyone but me, and every open task, for All', () => {
    const all = crewFor(world, 'mo', null);
    expect(all.members.map((m) => m.volunteer.id)).toEqual(['priya', 'bea', 'al', 'linh', 'tom', 'ana']);
    expect(all.openTasks.map((t) => t.id)).toEqual(['faint', 'lost', 'queued', 'sunburn']);
  });
});
