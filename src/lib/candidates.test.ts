import { describe, expect, it } from 'vitest';

import { laneCandidates, speakerNeeded, withSpeaker } from './candidates';
import type { Task, Volunteer } from './schema';

const NOW = 1_800_000_000_000;

const task = (over: Partial<Task> = {}): Task => ({
  id: 'collapsed', title: 'Man collapsed', summary: 'A man has collapsed by the food trucks.', category: 'medical',
  priority: 'P1', teamSlug: 'first-aid', zoneSlug: 'food-alley', locationHint: null, status: 'open', assigneeId: null,
  reporter: { kind: 'festivalgoer', quote: 'a man collapsed', language: 'en' }, handledBy: 'human',
  createdAt: NOW, assignedAt: null, etaAt: null, lastActivityAt: NOW, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null,
  resolvedAt: null, escalation: null, helperIds: [], resolution: null, requestId: null, ...over,
});

const vol = (id: string, over: Partial<Volunteer> = {}): Volunteer => ({
  id, name: id, role: 'volunteer', teamSlug: 'ops', skills: [], languages: ['en'], zoneSlug: 'food-alley', duty: 'on_duty',
  shiftEndsAt: null, phone: null, ...over,
});

/** `id` is busy on another task. */
const busyWith = (id: string) => task({ id: `other-${id}`, status: 'in_progress', assigneeId: id });

const ids = (xs: { volunteerId: string }[]) => xs.map((x) => x.volunteerId);
const lanes = (t: Task, vs: Volunteer[], tasks: Task[] = [], { qualified = null, size = 2 }: { qualified?: string[] | null; size?: number } = {}) =>
  laneCandidates(t, vs, tasks, { qualified, size, now: NOW });
const needs = (speakerNeeded: string) => task({ reporter: { kind: 'festivalgoer', quote: 'a man collapsed', language: 'en', speakerNeeded } });

describe('laneCandidates', () => {
  it('takes the qualified lane in the order given, in turn with the nearest', () => {
    const vs = [
      vol('nurse', { zoneSlug: 'gate-a' }),
      vol('speaker', { zoneSlug: 'gate-a' }),
      vol('plain', { zoneSlug: 'gate-a' }),
      vol('here1'),
      vol('here2'),
    ];
    expect(ids(lanes(task(), vs, [], { qualified: ['nurse', 'plain', 'speaker'] }))).toEqual(['nurse', 'here1', 'plain', 'here2']);
  });

  it('falls back to the rules when there is no qualified order: a free first aider from another team, not busy teammates', () => {
    const vs = [
      vol('teammate1', { teamSlug: 'first-aid', skills: ['first-aid-cert'] }),
      vol('teammate2', { teamSlug: 'first-aid', skills: ['first-aid-cert'] }),
      vol('certified', { skills: ['first-aid-cert'], zoneSlug: 'gate-a' }),
      vol('nearby'),
    ];
    const got = lanes(task(), vs, [busyWith('teammate1'), busyWith('teammate2')]);
    expect(ids(got)).toEqual(['certified', 'nearby']);
    expect(got[0].rationale).toMatch(/^free · .+ · first aid cert$/);
  });

  it('gives the nearest speaker a seat of their own when neither lane has one', () => {
    const vs = [
      vol('cert1', { zoneSlug: 'gate-a' }),
      vol('cert2', { zoneSlug: 'gate-a' }),
      vol('here1'),
      vol('here2'),
      vol('speaker', { languages: ['en', 'zh'], zoneSlug: 'gate-b' }),
    ];
    const got = lanes(needs('zh'), vs, [], { qualified: ['cert1', 'cert2'] });
    expect(ids(got)).toEqual(['cert1', 'here1', 'cert2', 'here2', 'speaker']);
    expect(got[4].rationale).toContain('speaks Chinese');
  });

  it('adds no seat when a lane already has a speaker', () => {
    const vs = [vol('speaker', { languages: ['en', 'zh'], zoneSlug: 'gate-a' }), vol('here'), vol('far', { languages: ['en', 'zh'], zoneSlug: 'gate-b' })];
    expect(ids(lanes(needs('zh'), vs, [], { qualified: ['speaker'], size: 1 }))).toEqual(['speaker', 'here']);
  });

  it('lists nobody twice when the nearest is also the most qualified', () => {
    const vs = [vol('best'), vol('far', { zoneSlug: 'gate-a' })];
    expect(ids(lanes(task(), vs, [], { qualified: ['best', 'far'] }))).toEqual(['best', 'far']);
  });

  it('skips qualified ids that are busy, off duty, leads, already on it or unknown', () => {
    const vs = [
      vol('busy'), vol('lead', { role: 'team_lead' }), vol('off', { duty: 'off_shift' }), vol('assigned'),
      vol('free1', { zoneSlug: 'gate-a' }), vol('free2'),
    ];
    const got = lanes(task({ assigneeId: 'assigned' }), vs, [busyWith('busy')], { qualified: ['busy', 'lead', 'off', 'assigned', 'ghost', 'free1'] });
    expect(ids(got)).toEqual(['free1', 'free2']);
  });

  it('falls back to busy people when nobody is free, and never offers leads or anyone off duty', () => {
    const vs = [vol('busy'), vol('lead', { role: 'team_lead' }), vol('off', { duty: 'off_shift' })];
    expect(ids(lanes(task(), vs, [busyWith('busy')]))).toEqual(['busy']);
    expect(ids(lanes(task(), vs, [busyWith('busy')], { qualified: ['lead', 'busy'] }))).toEqual(['busy']);
  });
});

describe('withSpeaker', () => {
  const speaks = (id: string) => id.startsWith('zh');

  it('leaves the crew alone when one of them speaks it already', () => {
    expect(withSpeaker(['a', 'zh1', 'b'], 2, speaks, 3)).toEqual({ order: ['a', 'zh1', 'b'], people: 2 });
  });

  it('adds the best-placed speaker as one more person while the priority allows', () => {
    expect(withSpeaker(['a', 'b', 'zh1', 'zh2'], 1, speaks, 2)).toEqual({ order: ['a', 'zh1', 'b', 'zh2'], people: 2 });
  });

  it('puts them in place of the last one when the crew is already as big as it can be', () => {
    expect(withSpeaker(['a', 'b', 'c', 'zh1'], 2, speaks, 2)).toEqual({ order: ['a', 'zh1', 'b', 'c'], people: 2 });
  });

  it('changes nothing when nobody listed speaks it', () => {
    expect(withSpeaker(['a', 'b'], 1, speaks, 2)).toEqual({ order: ['a', 'b'], people: 1 });
  });
});

describe('speakerNeeded', () => {
  it('is what intake said, else the report’s own language when it isn’t English', () => {
    const r = (language: string, speakerNeeded?: string | null) => task({ reporter: { kind: 'festivalgoer', quote: '', language, speakerNeeded } });
    expect(speakerNeeded(r('en', 'zh'))).toBe('zh');
    expect(speakerNeeded(r('vi', null))).toBeNull();
    expect(speakerNeeded(r('vi'))).toBe('vi');
    expect(speakerNeeded(r('en'))).toBeNull();
  });
});
