import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Task } from '@/lib/schema';
import { fakeHttp, type FakeReply } from './fake-http';
import { SparkInterpreter } from './interpreter';

const NOW = 1_800_000_000_000;

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: 'Man collapsed at the food stalls', summary: 'A man has collapsed near the food trucks.', category: 'medical',
  priority: 'P2', teamSlug: 'first-aid', zoneSlug: 'food-alley', locationHint: null, status: 'accepted', assigneeId: 'priya',
  reporter: { kind: 'volunteer', quote: 'guy collapsed by the food stalls', language: 'en' }, handledBy: 'human',
  createdAt: NOW, assignedAt: null, etaAt: null, lastActivityAt: NOW, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null,
  resolvedAt: null, escalation: null, requiredCount: 1, helpers: [], mobilizationId: null,
  resolution: null, requestId: null, ...over,
});

const collapsed = task('collapsed');
const spill = task('spill', { title: 'Drink spill at the bar', summary: 'Sticky floor by the bar.', category: 'facilities', teamSlug: 'ops', priority: 'P3' });

/** A /v1/decisions answer, in OpenAI's shape. */
const probs = (p: Record<string, number>) => Object.entries(p).map(([value, probability]) => ({ value, probability }));
const top = (p: Record<string, number>) => Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
const decided = (a: { about: Record<string, number>; priority: Record<string, number>; sorted: number }): FakeReply => ({
  json: {
    model: 'gpt-6-luna',
    answers: [
      { type: 'choice', name: 'about', choice: top(a.about), probabilities: probs(a.about), confidence: Math.max(...Object.values(a.about)) },
      { type: 'choice', name: 'priority', choice: top(a.priority), probabilities: probs(a.priority), confidence: Math.max(...Object.values(a.priority)) },
      { type: 'choice', name: 'sorted', choice: a.sorted >= 0.5 ? 'yes' : 'no', probabilities: probs({ yes: a.sorted, no: 1 - a.sorted }), confidence: 0.9 },
    ],
  },
});

let http: ReturnType<typeof fakeHttp>;
const replies: FakeReply[] = [];
beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
  vi.stubEnv('MODEL_PROVIDER', '');
  replies.length = 0;
  http = fakeHttp();
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    http = fakeHttp(...replies.splice(0, 1));
    return http.fetch(url, init);
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const heard = (text: string, candidates: Task[]) => ({ text, zoneSlug: 'food-alley', locationHint: null, candidates });

describe('Interpreter.match: is a new report about a task already open?', () => {
  it('names the task it is about, with how urgent it is now', async () => {
    replies.push(decided({ about: { task_1: 0.05, task_2: 0.9, new: 0.05 }, priority: { P1: 0.1, P2: 0.85, P3: 0.05 }, sorted: 0.02 }));

    const { value } = await new SparkInterpreter().match(heard('the bloke near the burger van is still on the ground', [spill, collapsed]));

    expect(value).toEqual({ taskId: 'collapsed', read: { priority: 'P2', resolved: false } });
  });

  describe('keeps the safety rules on the new priority', () => {
    const about = { task_1: 0.95, new: 0.05 };

    it('red-flag words make it P1, whatever the model says', async () => {
      replies.push(decided({ about, priority: { P1: 0.2, P2: 0.75, P3: 0.05 }, sorted: 0.01 }));

      const { value } = await new SparkInterpreter().match(heard("he's not breathing", [collapsed]));

      expect(value?.read.priority).toBe('P1');
    });

    it('a model that is not sure rounds up', async () => {
      replies.push(decided({ about, priority: { P1: 0.42, P2: 0.46, P3: 0.12 }, sorted: 0.01 }));

      const { value } = await new SparkInterpreter().match(heard('he looks really pale now', [collapsed]));

      expect(value?.read.priority).toBe('P1');
    });
  });

  describe('is a new incident (null)', () => {
    it('when the model says none of them', async () => {
      replies.push(decided({ about: { task_1: 0.03, task_2: 0.07, new: 0.9 }, priority: { P1: 0.1, P2: 0.85, P3: 0.05 }, sorted: 0.02 }));

      const { value } = await new SparkInterpreter().match(heard('a girl has lost her mum by the toilets', [spill, collapsed]));

      expect(value).toBeNull();
    });

    it('when the model is not sure which: a duplicate is safer than merging two incidents', async () => {
      replies.push(decided({ about: { task_1: 0.05, task_2: 0.5, new: 0.45 }, priority: { P1: 0.1, P2: 0.85, P3: 0.05 }, sorted: 0.02 }));

      const { value } = await new SparkInterpreter().match(heard('someone is lying down near the food', [spill, collapsed]));

      expect(value).toBeNull();
    });

    it('when nothing is open nearby, without asking a model', async () => {
      const { value } = await new SparkInterpreter().match(heard('someone is lying down near the food', []));

      expect(value).toBeNull();
      expect(replies).toHaveLength(0);
    });

    it('when the model fails, saying so in the run', async () => {
      replies.push({ status: 400 });

      const { value, run } = await new SparkInterpreter().match(heard('the bloke is still on the ground', [collapsed]));

      expect(value).toBeNull();
      expect(run.error).toBeTruthy();
    });
  });
});
