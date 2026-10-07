import { describe, expect, it } from 'vitest';

import { lastLine, taskLog } from './task-log';
import type { Task, TaskEvent } from './schema';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, summary: id, category: 'medical', priority: 'P2', teamSlug: 'first-aid', zoneSlug: 'food-alley',
  locationHint: null, status: 'open', assigneeId: null, reporter: { kind: 'volunteer', name: 'Sam Smith', quote: id, language: 'en' },
  handledBy: 'human', createdAt: NOW - 60 * MIN, assignedAt: null, etaAt: null, lastActivityAt: NOW - 60 * MIN, nudgeCount: 0,
  lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null, helpers: [], requiredCount: 1, resolution: null, requestId: null, mobilizationId: null, ...over,
});

let n = 0;
const event = (taskId: string, minsAgo: number, text = 'Note', over: Partial<TaskEvent> = {}): TaskEvent => ({
  id: `e${++n}`, taskId, at: NOW - minsAgo * MIN, kind: 'note', actor: { kind: 'system' }, text, ...over,
});

const world = (tasks: Task[], events: TaskEvent[]) => ({ tasks: Object.fromEntries(tasks.map((t) => [t.id, t])), events });

describe('taskLog', () => {
  it('lists every task with its newest event, the most recent activity first', () => {
    const s = world(
      [task('spill'), task('faint'), task('lost')],
      [event('spill', 50, 'Reported'), event('faint', 30, 'Reported'), event('spill', 2, 'Assigned to Kai'), event('lost', 10, 'Reported')],
    );
    const { rows } = taskLog(s, { status: 'all', team: null });
    expect(rows.map((r) => [r.task.id, r.last?.text])).toEqual([['spill', 'Assigned to Kai'], ['lost', 'Reported'], ['faint', 'Reported']]);
  });

  const shift = world(
    [
      task('spill'), task('queued', { status: 'queued', assigneeId: 'kai' }),
      task('faint', { status: 'in_progress', assigneeId: 'priya' }), task('asked', { status: 'escalated', assigneeId: 'tom' }),
      task('done', { status: 'resolved' }), task('dropped', { status: 'cancelled' }),
      task('lost', { status: 'resolved', teamSlug: 'welfare' }),
    ],
    [],
  );
  const ids = (status: 'all' | 'open' | 'active' | 'done', team: 'first-aid' | null = null) =>
    taskLog(shift, { status, team }).rows.map((r) => r.task.id).sort();

  it('filters to open (unassigned or queued), active, or done (resolved or cancelled)', () => {
    expect(ids('open')).toEqual(['queued', 'spill']);
    expect(ids('active')).toEqual(['asked', 'faint']);
    expect(ids('done')).toEqual(['done', 'dropped', 'lost']);
  });

  it("narrows to a team's tasks, and counts that team's shift whatever the status filter", () => {
    const log = taskLog(shift, { status: 'done', team: 'first-aid' });
    expect(log.rows.map((r) => r.task.id).sort()).toEqual(['done', 'dropped']);
    expect(log.counts).toEqual({ total: 6, open: 2, active: 2, done: 2 });
  });
});

describe('lastLine', () => {
  it('says who replied, by first name', () => {
    const accepted = event('faint', 2, 'Accepted', { kind: 'reply', reply: 'accept', actor: { kind: 'human', id: 'priya', name: 'Priya Shah' } });
    expect(lastLine(accepted)).toBe('Priya: Accepted');
  });

  it('reads the system and the AI as they wrote it', () => {
    const assigned = event('spill', 0, 'Assigned to Kai Walker', { kind: 'assigned', actor: { kind: 'agent', name: 'Dispatcher' } });
    expect(lastLine(assigned)).toBe('Assigned to Kai Walker');
  });
});
