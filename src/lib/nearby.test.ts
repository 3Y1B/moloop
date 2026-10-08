import { describe, expect, it } from 'vitest';

import { nearbyOpenTasks } from './nearby';
import type { Task } from './schema';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, summary: id, category: 'medical', priority: 'P2', teamSlug: 'first-aid', zoneSlug: 'food-alley', locationHint: null,
  status: 'accepted', assigneeId: 'priya', reporter: { kind: 'volunteer', quote: id, language: 'en' }, handledBy: 'human',
  createdAt: NOW - 5 * MIN, assignedAt: null, etaAt: null, lastActivityAt: NOW, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null,
  resolvedAt: null, escalation: null, requiredCount: 1, helpers: [], resolution: null, requestId: null, mobilizationId: null, ...over,
});

const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe('nearbyOpenTasks: what a new report might be about', () => {
  it('does not treat a Mobilization operation or future report as an existing incident', () => {
    const tasks = [task('incident'), task('crowd-operation', { mobilizationId: 'mobilization' }), task('future', { createdAt: NOW + MIN })];
    expect(ids(nearbyOpenTasks(tasks, 'food-alley', NOW))).toEqual(['incident']);
  });

  it('is the open tasks in the same zone or a short walk away, not across the site', () => {
    const tasks = [
      task('here'),
      task('next-door', { zoneSlug: 'river-stage' }), // 97 m, down on the lower terrace below the Federation Bells
      task('far', { zoneSlug: 'pavilion' }), // 172 m, ArtPlay at the Fed Square end
    ];

    expect(ids(nearbyOpenTasks(tasks, 'food-alley', NOW))).toEqual(['here', 'next-door']);
  });

  it('leaves out what is finished, and anything reported over 20 minutes ago', () => {
    const tasks = [
      task('done', { status: 'resolved' }),
      task('cancelled', { status: 'cancelled' }),
      task('stale', { createdAt: NOW - 21 * MIN }),
      task('waiting', { status: 'open', assigneeId: null }),
      task('queued', { status: 'queued' }),
    ];

    expect(ids(nearbyOpenTasks(tasks, 'food-alley', NOW))).toEqual(['waiting', 'queued']);
  });

  it('puts the nearest first and stops at five', () => {
    const tasks = [
      task('97m', { zoneSlug: 'river-stage' }),
      task('83m', { zoneSlug: 'water-1' }),
      ...['a', 'b', 'c', 'd'].map((id) => task(id)),
    ];

    expect(ids(nearbyOpenTasks(tasks, 'food-alley', NOW))).toEqual(['a', 'b', 'c', 'd', '83m']);
  });
});
