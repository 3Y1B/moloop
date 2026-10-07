import { describe, expect, it } from 'vitest';

import { firstAidNeeded, laneCandidates, speakerNeeded, withNeeded } from './candidates';
import type { Task, Volunteer } from './schema';

const NOW = 1_800_000_000_000;

const task = (over: Partial<Task> = {}): Task => ({
  id: 'collapsed', title: 'Man collapsed', summary: 'A man has collapsed by the food trucks.', category: 'medical',
  priority: 'P1', teamSlug: 'first-aid', zoneSlug: 'food-alley', locationHint: null, status: 'open', assigneeId: null,
  reporter: { kind: 'festivalgoer', quote: 'a man collapsed', language: 'en' }, handledBy: 'human',
  createdAt: NOW, assignedAt: null, etaAt: null, lastActivityAt: NOW, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null,
  resolvedAt: null, escalation: null, helpers: [], requiredCount: 1, resolution: null, requestId: null, mobilizationId: null, ...over,
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
const aid = (firstAidNeeded: boolean | null, over: Partial<Task> = {}, speakerNeeded: string | null = null) =>
  task({ reporter: { kind: 'festivalgoer', quote: 'a man collapsed', language: 'en', speakerNeeded, firstAidNeeded }, ...over });

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

  it('gives the nearest first aider a seat of their own when neither lane has one', () => {
    const vs = [
      vol('cert1', { zoneSlug: 'gate-a' }),
      vol('cert2', { zoneSlug: 'gate-a' }),
      vol('here1'),
      vol('here2'),
      vol('medic', { skills: ['first-aid-cert'], zoneSlug: 'gate-b' }),
    ];
    const got = lanes(aid(true, { category: 'security' }), vs, [], { qualified: ['cert1', 'cert2'] });
    expect(ids(got)).toEqual(['cert1', 'here1', 'cert2', 'here2', 'medic']);
    expect(got[4].rationale).toContain('first aid cert');
  });

  it('adds no first aid seat when a lane already has one, or intake said nobody needs it', () => {
    const vs = [vol('medic', { skills: ['first-aid-cert'], zoneSlug: 'gate-a' }), vol('here'), vol('far', { skills: ['first-aid-cert'], zoneSlug: 'gate-b' })];
    expect(ids(lanes(aid(true), vs, [], { qualified: ['medic'], size: 1 }))).toEqual(['medic', 'here']);
    expect(ids(lanes(aid(false), vs, [], { qualified: ['here'], size: 1 }))).toEqual(['here']);
  });

  it('goes by the category for first aid when intake didn’t say', () => {
    const vs = [vol('here'), vol('medic', { skills: ['first-aid-cert'], zoneSlug: 'gate-b' })];
    expect(ids(lanes(task(), vs, [], { qualified: ['here'], size: 1 }))).toEqual(['here', 'medic']);
    expect(ids(lanes(task({ category: 'security' }), vs, [], { qualified: ['here'], size: 1 }))).toEqual(['here']);
  });

  it('gives one seat to someone who has both a language and first aid when both are missing, else one each', () => {
    const vs = [
      vol('q1', { zoneSlug: 'gate-a' }), vol('q2', { zoneSlug: 'gate-a' }), vol('here1'), vol('here2'),
      vol('medic', { skills: ['first-aid-cert'], zoneSlug: 'gate-a' }),
      vol('speaker', { languages: ['en', 'zh'], zoneSlug: 'gate-a' }),
      vol('both', { skills: ['first-aid-cert'], languages: ['en', 'zh'], zoneSlug: 'gate-b' }),
    ];
    expect(ids(lanes(aid(true, {}, 'zh'), vs, [], { qualified: ['q1', 'q2'] }))).toEqual(['q1', 'here1', 'q2', 'here2', 'both']);
    expect(ids(lanes(aid(true, {}, 'zh'), vs.slice(0, -1), [], { qualified: ['q1', 'q2'] }))).toEqual(['q1', 'here1', 'q2', 'here2', 'speaker', 'medic']);
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

describe('withNeeded', () => {
  const speaks = (id: string) => id.startsWith('zh') || id === 'both';
  const firstAid = (id: string) => id.startsWith('fa') || id === 'both';

  it('leaves the crew alone when one of them speaks it already', () => {
    expect(withNeeded(['a', 'zh1', 'b'], 2, [speaks], 3)).toEqual({ order: ['a', 'zh1', 'b'], people: 2 });
  });

  it('adds the best-placed speaker as one more person while the priority allows', () => {
    expect(withNeeded(['a', 'b', 'zh1', 'zh2'], 1, [speaks], 2)).toEqual({ order: ['a', 'zh1', 'b', 'zh2'], people: 2 });
  });

  it('puts them in place of the last one when the crew is already as big as it can be', () => {
    expect(withNeeded(['a', 'b', 'c', 'zh1'], 2, [speaks], 2)).toEqual({ order: ['a', 'zh1', 'b', 'c'], people: 2 });
  });

  it('changes nothing when nobody listed speaks it', () => {
    expect(withNeeded(['a', 'b'], 1, [speaks], 2)).toEqual({ order: ['a', 'b'], people: 1 });
  });

  it('adds a first aider, or puts one in place of the last', () => {
    expect(withNeeded(['a', 'b', 'fa1'], 1, [firstAid], 2)).toEqual({ order: ['a', 'fa1', 'b'], people: 2 });
    expect(withNeeded(['a', 'b', 'fa1'], 2, [firstAid], 2)).toEqual({ order: ['a', 'fa1', 'b'], people: 2 });
  });

  it('keeps the speaker it added when a first aider has to come in too', () => {
    expect(withNeeded(['a', 'b', 'zh1', 'fa1'], 1, [speaks, firstAid], 3)).toEqual({ order: ['a', 'zh1', 'fa1', 'b'], people: 3 });
    expect(withNeeded(['a', 'b', 'zh1', 'fa1'], 2, [speaks, firstAid], 2)).toEqual({ order: ['zh1', 'fa1', 'a', 'b'], people: 2 });
    expect(withNeeded(['zh1', 'fa1'], 1, [speaks, firstAid], 1)).toEqual({ order: ['zh1', 'fa1'], people: 1 });
  });

  it('sends one person who meets both when both are missing', () => {
    expect(withNeeded(['a', 'zh1', 'fa1', 'both'], 1, [speaks, firstAid], 2)).toEqual({ order: ['a', 'both', 'zh1', 'fa1'], people: 2 });
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

describe('firstAidNeeded', () => {
  it('is what intake said, else whether the category wants a first aider', () => {
    expect(firstAidNeeded(aid(true, { category: 'security' }))).toBe(true);
    expect(firstAidNeeded(aid(false))).toBe(false);
    expect(firstAidNeeded(aid(null))).toBe(true);
    expect(firstAidNeeded(task())).toBe(true);
    expect(firstAidNeeded(task({ category: 'heat' }))).toBe(true);
    expect(firstAidNeeded(task({ category: 'lost_child' }))).toBe(false);
  });
});
