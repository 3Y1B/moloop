import { describe, expect, it } from 'vitest';

import { needsFor } from './needs';
import type { Escalation, Proposal, Task, Volunteer } from './schema';

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
  lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null, helperIds: [], resolution: null, requestId: null, ...over,
});

const passedUp = (over: Partial<Escalation> = {}): Escalation => ({
  at: NOW - 3 * MIN, reason: 'He is not responding', level: 'coordinator', ownerId: 'mo', bumpedAt: NOW - MIN, response: null, ...over,
});

/** First Aid has a lead (Lee); Crowd has none, so its tasks come straight to Mo. */
function festival(tasks: Task[], proposals: Proposal[] = []) {
  const volunteers = [
    person('priya'), person('lee', { role: 'team_lead' }), person('sam', { teamSlug: 'crowd' }),
    person('mo', { role: 'coordinator', teamSlug: null }),
  ];
  return {
    volunteers: Object.fromEntries(volunteers.map((v) => [v.id, v])),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    proposals: Object.fromEntries(proposals.map((p) => [p.id, p])),
  };
}

describe('needsFor Mo', () => {
  it('puts a task a lead passed up at the top', () => {
    const world = festival([
      task('spill', { priority: 'P2', teamSlug: 'crowd' }),
      task('collapsed', { status: 'escalated', assigneeId: 'priya', escalation: passedUp() }),
    ]);
    expect(needsFor(world, 'mo').map((n) => [n.kind, n.task.id])).toEqual([['help', 'collapsed'], ['unassigned', 'spill']]);
  });

  it('asks Mo to approve the pick for a P1, even on a team with a lead', () => {
    const pick: Proposal = {
      id: 'pick', taskId: 'faint', candidates: [{ volunteerId: 'priya', rationale: 'free', distanceM: 80 }], createdAt: NOW - MIN,
      autoAssignAt: NOW + MIN, status: 'pending', volunteerId: null, decidedById: null, decidedAt: null,
    };
    const world = festival([task('faint', { priority: 'P1' })], [pick]);
    expect(needsFor(world, 'mo')).toEqual([expect.objectContaining({ kind: 'approval', proposal: pick })]);
  });

  it('shows unassigned P1 and P2 tasks but leaves P3s to assign themselves', () => {
    const world = festival([
      task('fight', { priority: 'P1', teamSlug: 'crowd' }),
      task('queue', { priority: 'P2', teamSlug: 'crowd' }),
      task('bin', { priority: 'P3', teamSlug: 'crowd' }),
    ]);
    expect(needsFor(world, 'mo').map((n) => n.task.id)).toEqual(['fight', 'queue']);
  });

  it('keeps a handover Mo sent until Mo marks it arrived', () => {
    const sent = { kind: 'handover' as const, byId: 'mo', at: NOW - MIN, target: 'medics' as const };
    const world = festival([
      task('collapsed', { status: 'escalated', assigneeId: 'priya', escalation: passedUp({ response: sent }) }),
      task('sprain', { status: 'escalated', assigneeId: 'priya', escalation: passedUp({ level: 'lead', response: { ...sent, byId: 'lee' } }) }),
    ]);
    expect(needsFor(world, 'mo').map((n) => [n.kind, n.task.id])).toEqual([['handover', 'collapsed']]);
  });
});
