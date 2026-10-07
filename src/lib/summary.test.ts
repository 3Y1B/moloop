import { describe, expect, it } from 'vitest';

import { checkSummary, fallbackSummary } from './summary';
import type { Task, TaskEvent } from './schema';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, summary: id, category: 'medical', priority: 'P2', teamSlug: 'first-aid', zoneSlug: 'food-alley',
  locationHint: null, status: 'open', assigneeId: null, reporter: { kind: 'volunteer', name: 'Sam Smith', quote: id, language: 'en' },
  handledBy: 'human', createdAt: NOW - 60 * MIN, assignedAt: null, etaAt: null, lastActivityAt: NOW - 60 * MIN, nudgeCount: 0,
  lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null, helperIds: [], resolution: null, requestId: null, ...over,
});

const world = { tasks: { faint: task('faint'), spill: task('spill') } };

describe('checkSummary', () => {
  it('keeps at most three points, and drops task and team links that point at nothing', () => {
    const raw = {
      headline: '  Busy at Food Alley  ',
      points: [
        { text: '2 P1s in 20 min, both handled', taskId: 'faint' },
        { text: 'A task the model made up', taskId: 'ghost' },
        { text: 'Welfare is stretched: 1 of 3 free', teamSlug: 'welfare' },
        { text: 'A team that does not exist', teamSlug: 'catering' },
        { text: 'One too many', taskId: 'spill' },
      ],
    };
    expect(checkSummary(raw, world)).toEqual({
      headline: 'Busy at Food Alley',
      points: [
        { text: '2 P1s in 20 min, both handled', taskId: 'faint' },
        { text: 'A task the model made up' },
        { text: 'Welfare is stretched: 1 of 3 free', teamSlug: 'welfare' },
      ],
    });
  });

  it('drops empty points, and says nothing rather than an empty headline', () => {
    expect(checkSummary({ headline: ' ', points: [{ text: '  ' }] }, world)).toBeNull();
    expect(checkSummary({ headline: 'Quiet shift', points: [{ text: '' }] }, world)).toEqual({ headline: 'Quiet shift', points: [] });
  });
});

describe('fallbackSummary', () => {
  const ev = (taskId: string, minsAgo: number, text: string, over: Partial<TaskEvent> = {}): TaskEvent => ({
    id: `${taskId}-${minsAgo}`, taskId, at: NOW - minsAgo * MIN, kind: 'note', actor: { kind: 'system' }, text, ...over,
  });
  const shift = {
    tasks: {
      spill: task('spill'),
      faint: task('faint', { status: 'in_progress', assigneeId: 'priya' }),
      lost: task('lost', { status: 'resolved' }),
      bin: task('bin', { status: 'cancelled' }),
    },
    events: [ev('faint', 9, 'Reported'), ev('faint', 2, 'Accepted', { kind: 'reply', reply: 'accept', actor: { kind: 'human', name: 'Priya Shah' } })],
  };

  it("counts the shift's tasks when there's no AI summary", () => {
    expect(fallbackSummary(shift, { scope: 'shift' })).toEqual({ headline: '4 tasks: 1 open, 1 active, 2 done', points: [] });
  });

  it("says what happened last on a task, or that nothing has yet", () => {
    expect(fallbackSummary(shift, { scope: 'task', taskId: 'faint' })).toEqual({ headline: 'Latest: Priya: Accepted', points: [] });
    expect(fallbackSummary(shift, { scope: 'task', taskId: 'spill' })).toEqual({ headline: 'No updates yet', points: [] });
  });
});
