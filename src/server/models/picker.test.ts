import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Task, Volunteer } from '@/lib/schema';
import { fakeHttp, type FakeReply } from './fake-http';
import { describe as describePerson, pickCrew, profile, rankQualified, type Shortlisted } from './picker';

const NOW = 1_800_000_000_000;

const task = (over: Partial<Task> = {}): Task => ({
  id: 'collapsed', title: 'Man collapsed at the food stalls', summary: 'A man has collapsed near the food trucks.', category: 'medical',
  priority: 'P1', teamSlug: 'first-aid', zoneSlug: 'food-alley', locationHint: null, status: 'open', assigneeId: null,
  reporter: { kind: 'festivalgoer', quote: 'a man collapsed by the food stalls', language: 'en' }, handledBy: 'human',
  createdAt: NOW, assignedAt: null, etaAt: null, lastActivityAt: NOW, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null,
  resolvedAt: null, escalation: null, helperIds: [], resolution: null, requestId: null, ...over,
});

const person = (id: string, over: Partial<Volunteer> = {}): Shortlisted => ({
  candidate: { volunteerId: id, rationale: 'free · 120 m', distanceM: 120 },
  volunteer: {
    id, name: `${id[0].toUpperCase()}${id.slice(1)} Smith`, role: 'volunteer', teamSlug: 'first-aid', skills: [], languages: ['en'],
    zoneSlug: 'food-alley', duty: 'on_duty', shiftEndsAt: null, phone: null, ...over,
  },
});
/** Intake said nobody there needs first aid: the crew stays as the model picked it. */
const unhurt = { reporter: { kind: 'festivalgoer' as const, quote: 'a man collapsed by the food stalls', language: 'en', firstAidNeeded: false } };
const shortlist = [person('tom'), person('priya', { skills: ['first-aid-cert'], bio: 'ED nurse.' }), person('kai')];
const teams = { 'first-aid': { name: 'First Aid & Heat' } };

/** A /v1/decisions answer, in OpenAI's shape. */
const probs = (p: Record<string, number>) => Object.entries(p).map(([value, probability]) => ({ value, probability }));
const top = (p: Record<string, number>) => Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
const answer = (name: string, p: Record<string, number>) => ({ type: 'choice', name, choice: top(p), probabilities: probs(p), confidence: Math.max(...Object.values(p)) });
const decided = (name: string, p: Record<string, number>): FakeReply => ({ json: { model: 'gpt-6-luna', answers: [answer(name, p)] } });
// Who's best and how many are asked side by side: each call gets the reply for the question it asks.
const sent: string[] = [];
const urls: string[] = [];
const replies: Record<string, FakeReply[]> = {};
/** The qualified question, asked in a shuffled order: answers by name ("Priya Smith"), per call (0, 1, 2, …). */
let qualify: ((call: number) => Record<string, number> | null) | null = null;
let qualifyCalls = 0;
const byName = (body: string, p: Record<string, number>): FakeReply => {
  const [{ choices }] = JSON.parse(body).questions as { choices: { value: string; description: string }[] }[];
  return decided('best', Object.fromEntries(choices.map((c) => [c.value, p[c.description.split(',')[0]] ?? 0])));
};
beforeEach(() => {
  qualify = null;
  qualifyCalls = 0;
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
  vi.stubEnv('MODEL_PROVIDER', '');
  sent.length = 0;
  urls.length = 0;
  for (const k of Object.keys(replies)) delete replies[k];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = String(init?.body);
    sent.push(body);
    urls.push(url);
    const asks = body.includes('How many volunteers') ? 'people'
      : body.includes('best qualified') ? 'qualified' : 'best';
    if (asks === 'qualified' && qualify) {
      const p = qualify(qualifyCalls++);
      return fakeHttp(p ? byName(body, p) : { status: 500 }).fetch(url, init);
    }
    return fakeHttp(...(replies[asks] ?? []).splice(0, 1)).fetch(url, init);
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('pickCrew', () => {
  it('ranks the shortlist by how sure it is of each, and says how many go', async () => {
    replies.best = [decided('best', { person_1: 0.15, person_2: 0.7, person_3: 0.15 })];
    replies.people = [decided('people', { one: 0.2, two: 0.7, three: 0.1 })];

    const { value, run } = await pickCrew(task(), shortlist, teams);

    // Tom and Kai tie: the rules' order stands between them.
    expect(value).toEqual({ order: ['priya', 'tom', 'kai'], people: 2 });
    expect(run).toMatchObject({ route: 'ai_resolved', confidence: 0.7, reason: 'Priya Smith first of 3; 2 needed', error: null });
  });

  it('only offers as many people as the priority allows', async () => {
    replies.best = [decided('best', { person_1: 0.6, person_2: 0.3, person_3: 0.1 })];
    replies.people = [decided('people', { one: 0.4, two: 0.6 })];

    const { value } = await pickCrew(task({ priority: 'P2' }), shortlist, teams);

    const asked = sent.find((b) => b.includes('How many volunteers'))!;
    expect(asked).toContain('Two volunteers');
    expect(asked).not.toContain('Three volunteers');
    expect(value?.people).toBe(2);
  });

  it('sends one when it can’t say how many', async () => {
    replies.best = [decided('best', { person_1: 0.6, person_2: 0.3, person_3: 0.1 })];
    replies.people = [{ status: 500 }, { status: 500 }];

    const { value } = await pickCrew(task(unhurt), shortlist, teams);

    expect(value).toEqual({ order: ['tom', 'priya', 'kai'], people: 1 });
  });

  it('asks nothing about how many for a P3', async () => {
    replies.best = [decided('best', { person_1: 0.6, person_2: 0.3, person_3: 0.1 })];

    const { value } = await pickCrew(task({ priority: 'P3' }), shortlist, teams);

    expect(sent.some((b) => b.includes('How many volunteers'))).toBe(false);
    expect(value?.people).toBe(1);
  });

  it('sends a speaker too when the task needs a language nobody it picked speaks', async () => {
    replies.best = [decided('best', { person_1: 0.5, person_2: 0.3, person_3: 0.2 })];
    replies.people = [decided('people', { one: 0.7, two: 0.2, three: 0.1 })];
    const withKai = [shortlist[0], shortlist[1], person('kai', { languages: ['en', 'zh'] })];
    const t = task({ reporter: { kind: 'festivalgoer', quote: 'his wife only speaks mandarin', language: 'en', speakerNeeded: 'zh', firstAidNeeded: false } });

    const { value, run } = await pickCrew(t, withKai, teams);

    expect(value).toEqual({ order: ['tom', 'kai', 'priya'], people: 2 });
    expect(run.reason).toBe('Tom Smith first of 3; 2 needed, with a Chinese speaker');
    expect(sent.find((b) => b.includes('Who is best'))).toContain('Chinese');
  });

  it('sends a first aider too when someone may need first aid and nobody it picked holds it', async () => {
    replies.best = [decided('best', { person_1: 0.6, person_2: 0.1, person_3: 0.3 })];
    replies.people = [decided('people', { one: 0.7, two: 0.2, three: 0.1 })];

    const { value, run } = await pickCrew(task(), shortlist, teams);

    expect(value).toEqual({ order: ['tom', 'priya', 'kai'], people: 2 });
    expect(run.reason).toBe('Tom Smith first of 3; 2 needed, with a first aider');
    expect(sent.find((b) => b.includes('Who is best'))).toContain('needs_first_aid');
  });

  it('puts the first aider in place of the last one when the crew is as big as the priority allows', async () => {
    replies.best = [decided('best', { person_1: 0.6, person_2: 0.1, person_3: 0.3 })];
    replies.people = [decided('people', { one: 0.2, two: 0.8 })];

    const { value } = await pickCrew(task({ priority: 'P2' }), shortlist, teams);

    expect(value).toEqual({ order: ['tom', 'priya', 'kai'], people: 2 });
  });

  it('keeps both the speaker and the first aider', async () => {
    replies.best = [decided('best', { person_1: 0.6, person_2: 0.1, person_3: 0.3 })];
    replies.people = [decided('people', { one: 0.7, two: 0.3 })];
    const withKai = [shortlist[0], shortlist[1], person('kai', { languages: ['en', 'zh'] })];
    const t = task({ priority: 'P2', reporter: { kind: 'festivalgoer', quote: 'old man chest pain, his wife only speaks mandarin', language: 'en', speakerNeeded: 'zh' } });

    const { value, run } = await pickCrew(t, withKai, teams);

    expect(value).toEqual({ order: ['kai', 'priya', 'tom'], people: 2 });
    expect(run.reason).toBe('Kai Smith first of 3; 2 needed, with a Chinese speaker and a first aider');
  });

  it('adds no first aider when intake said nobody needs one', async () => {
    replies.best = [decided('best', { person_1: 0.6, person_2: 0.1, person_3: 0.3 })];
    replies.people = [decided('people', { one: 0.7, two: 0.2, three: 0.1 })];

    const { value } = await pickCrew(task(unhurt), shortlist, teams);

    expect(value).toEqual({ order: ['tom', 'kai', 'priya'], people: 1 });
    expect(sent.find((b) => b.includes('Who is best'))).not.toContain('needs_first_aid');
  });

  it('asks OpenAI even when the Spark is on', async () => {
    vi.stubEnv('MODEL_PROVIDER', 'spark');
    vi.stubEnv('SPARK_API_KEY', 'spark-test');
    replies.best = [decided('best', { person_1: 0.6, person_2: 0.3, person_3: 0.1 })];
    replies.people = [decided('people', { one: 0.4, two: 0.6, three: 0 })];
    await pickCrew(task(), shortlist, teams);

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('https://api.openai.com'))).toBe(true);
  });

  it('fails to null, so the rules’ order stands', async () => {
    replies.best = [{ status: 500 }, { status: 500 }];
    replies.people = [decided('people', { one: 0.2, two: 0.7, three: 0.1 })];

    const { value, run } = await pickCrew(task(), shortlist, teams);

    expect(value).toBeNull();
    expect(run.error).toBeTruthy();
  });
});

describe('rankQualified', () => {
  const people = shortlist.map((s) => s.volunteer);

  it('orders everyone by how sure it is of each, the list breaking ties', async () => {
    qualify = () => ({ 'Tom Smith': 0.1, 'Priya Smith': 0.8, 'Kai Smith': 0.1 });

    const { value, run } = await rankQualified(task(), people, teams);

    expect(value).toEqual(['priya', 'tom', 'kai']);
    expect(run).toMatchObject({ route: 'ai_resolved', reason: 'Priya Smith most qualified of 3, 3 of 3 rounds', error: null });
    expect(run.confidence).toBeCloseTo(0.8);
    expect(urls.every((u) => /^https:\/\/api\.openai\.com/.test(u))).toBe(true);
  });

  it('asks three times and averages, so one round can’t swing it', async () => {
    const rounds = [
      { 'Tom Smith': 0.6, 'Priya Smith': 0.3, 'Kai Smith': 0.1 },
      { 'Tom Smith': 0.1, 'Priya Smith': 0.6, 'Kai Smith': 0.3 },
      { 'Tom Smith': 0.1, 'Priya Smith': 0.4, 'Kai Smith': 0.5 },
    ];
    qualify = (n) => rounds[n];

    const { value, run } = await rankQualified(task(), people, teams);

    expect(sent).toHaveLength(3);
    expect(value).toEqual(['priya', 'kai', 'tom']);
    expect(run.confidence).toBeCloseTo((0.6 + 0.6 + 0.5) / 3);
  });

  it('sends who they are, the report and its words, but not where they are', async () => {
    qualify = () => ({ 'Tom Smith': 0.4, 'Priya Smith': 0.4, 'Kai Smith': 0.2 });

    await rankQualified(task(), people, teams);

    expect(sent[0]).toContain('Priya Smith, First Aid & Heat team. Holds: first aid cert. Speaks English. ED nurse.');
    expect(sent[0]).toContain('a man collapsed by the food stalls');
    expect(sent[0]).not.toContain('Now:');
    expect(sent[0]).not.toMatch(/\d+ m\b/);
  });

  it('fails to null when no round answers', async () => {
    qualify = () => null;

    const { value, run } = await rankQualified(task(), people, teams);

    expect(value).toBeNull();
    expect(run.error).toBeTruthy();
  });
});

describe('profile', () => {
  it('reads who someone is, not where: team, what they hold, languages, bio', () => {
    expect(profile(person('priya', { skills: ['first-aid-cert', 'multilingual'], languages: ['en', 'hi'], bio: 'ED nurse. Calm under pressure.' }).volunteer, teams))
      .toBe('Priya Smith, First Aid & Heat team. Holds: first aid cert. Speaks English and Hindi. ED nurse. Calm under pressure.');
    expect(profile(person('kai', { teamSlug: null }).volunteer, teams)).toBe('Kai Smith, no team. No certificates. Speaks English.');
  });
});

describe('describe', () => {
  it('reads a person whole: team, what they hold, languages, where they are, who they are', () => {
    expect(describePerson(person('priya', { skills: ['first-aid-cert', 'multilingual'], languages: ['en', 'hi'], bio: 'ED nurse. Calm under pressure.' }), teams))
      .toBe('Priya Smith, First Aid & Heat team. Holds: first aid cert. Speaks English and Hindi. Now: free · 120 m. ED nurse. Calm under pressure.');
  });
});
