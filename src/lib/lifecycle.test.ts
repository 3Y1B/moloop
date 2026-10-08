import { describe, expect, it } from 'vitest';

import { POLICY, tick } from '@/lib/lifecycle';
import type { HelperAssignment, Task } from '@/lib/schema';

const helper = (volunteerId: string, status: HelperAssignment['status']): HelperAssignment =>
  ({ volunteerId, status, assignedAt: 0, respondedAt: status === 'accepted' ? 0 : null });

const task = (helpers: HelperAssignment[]): Task => ({
  id: 'task', title: 'Carry water', summary: 'Water to the Lawn Stage', category: 'other', priority: 'P3', teamSlug: 'ops',
  zoneSlug: null, locationHint: null, status: 'accepted', assigneeId: 'owner', reporter: { kind: 'system', quote: 'Test', language: 'en' },
  handledBy: 'human', createdAt: 0, assignedAt: 0, etaAt: null, lastActivityAt: 0, nudgeCount: 0, lastNudgeAt: null,
  leadAlertedAt: null, resolvedAt: null, escalation: null, requiredCount: 1 + helpers.length, helpers,
  resolution: null, requestId: null, mobilizationId: null,
});

describe('silent helpers', () => {
  const window = POLICY.ackTimeoutMs + POLICY.nudgeGapMs;

  it('keeps a notified helper until the window is up', () => {
    expect(tick(task([helper('h', 'notified')]), window)).toBeNull();
  });

  it('releases a notified helper after the window, and only them', () => {
    const r = tick(task([helper('h', 'notified'), helper('ok', 'accepted')]), window + 1);
    expect(r?.task.helpers.map((h) => h.volunteerId)).toEqual(['ok']);
    expect(r?.alerts).toEqual([expect.objectContaining({ kind: 'helper_released', volunteerId: 'h' })]);
  });

  it('leaves helpers on a finished task alone', () => {
    expect(tick({ ...task([helper('h', 'notified')]), status: 'resolved' }, window + 1)).toBeNull();
  });
});
