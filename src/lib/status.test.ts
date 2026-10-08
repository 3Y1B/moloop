import { describe, expect, it } from 'vitest';

import { TEAMS } from '@/data/teams';
import type { GuestRequest, Task, Volunteer } from './schema';
import { guestStage, taskStatusFor } from './status';

const NOW = 1_800_000_000_000;

const person = (id: string, over: Partial<Volunteer> = {}): Volunteer => ({
  id, name: `${id[0].toUpperCase()}${id.slice(1)} Smith`, role: 'volunteer', teamSlug: 'first-aid', skills: [], languages: ['en'],
  zoneSlug: 'food-alley', duty: 'on_duty', shiftEndsAt: null, phone: null, ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 'collapsed', title: 'Collapsed', summary: 'Collapsed', category: 'medical', priority: 'P2', teamSlug: 'first-aid',
  zoneSlug: 'food-alley', locationHint: null, status: 'open', assigneeId: null,
  reporter: { kind: 'festivalgoer', name: 'Guest', quote: 'help', language: 'en' }, handledBy: 'ai', createdAt: NOW - 10_000,
  assignedAt: null, etaAt: null, lastActivityAt: NOW - 10_000, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null,
  resolvedAt: null, escalation: null, helpers: [], requiredCount: 1, resolution: null, requestId: 'r1', mobilizationId: null,
  ...over,
});

const request: GuestRequest = {
  id: 'r1', createdAt: NOW - 12_000, heard: 'help', zoneSlug: 'food-alley', locationHint: null, stage: 'finding',
  aiAnswer: null, taskId: 'collapsed', thread: [], reopenedAt: null,
};

const volunteers = Object.fromEntries(
  [person('lee', { role: 'team_lead' }), person('mo', { role: 'coordinator', teamSlug: null })].map((v) => [v.id, v]),
);
const teams = Object.fromEntries(TEAMS.map((t) => [t.slug, t]));

describe('awaiting approval', () => {
  it('tells the festival-goer a P2 is with the lead, and when it goes anyway', () => {
    const s = guestStage(request, task(), { volunteers, teams }, NOW);
    expect(s).toMatchObject({ stage: 'finding', label: 'Awaiting approval', detail: 'Sent to the First Aid lead', approveBy: NOW + 20_000 });
  });

  it('a P1 goes to the safety lead too', () => {
    expect(guestStage(request, task({ priority: 'P1' }), { volunteers, teams }, NOW).detail).toBe(
      'Sent to the First Aid lead and safety lead',
    );
  });

  it('a P3, or once the window has passed, is finding someone', () => {
    expect(guestStage(request, task({ priority: 'P3' }), { volunteers, teams }, NOW).label).toBe('Finding someone');
    expect(guestStage(request, task({ createdAt: NOW - 31_000 }), { volunteers, teams }, NOW).label).toBe('Finding someone');
  });

  it('staff see who approves instead of Unassigned', () => {
    expect(taskStatusFor('mo', task(), { volunteers }, NOW)).toMatchObject({ label: 'Awaiting approval', detail: 'Lee' });
    expect(taskStatusFor('mo', task({ priority: 'P1' }), { volunteers }, NOW).detail).toBe('Lee and Mo');
    expect(taskStatusFor('mo', task({ createdAt: NOW - 31_000 }), { volunteers }, NOW).label).toBe('Unassigned');
  });
});
