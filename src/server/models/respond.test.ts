import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Task } from '@/lib/schema';
import { fakeHttp, type FakeReply } from './fake-http';
import { SparkInterpreter, type RespondHeard } from './interpreter';

const NOW = 1_800_000_000_000;

const task: Task = {
  id: 'collapsed', title: 'Man collapsed at the food stalls', summary: 'A man has collapsed near the food trucks.', category: 'medical',
  priority: 'P2', teamSlug: 'first-aid', zoneSlug: 'food-alley', locationHint: null, status: 'escalated', assigneeId: 'priya',
  reporter: { kind: 'volunteer', quote: 'guy collapsed by the food stalls', language: 'en' }, handledBy: 'human',
  createdAt: NOW, assignedAt: null, etaAt: null, lastActivityAt: NOW, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null,
  resolvedAt: null, helperIds: [], resolution: null, requestId: null,
  escalation: { at: NOW, reason: null, level: 'lead', ownerId: 'lee', bumpedAt: null, response: null },
};

/** A /v1/decisions answer, in OpenAI's shape. */
const probs = (p: Record<string, number>) => Object.entries(p).map(([value, probability]) => ({ value, probability }));
const answer = (name: string, p: Record<string, number>) => {
  const [choice, confidence] = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
  return { type: 'choice', name, choice, probabilities: probs(p), confidence };
};
const decided = (action: Record<string, number>, who: Record<string, number> = { nobody: 0.9, person_1: 0.05, person_2: 0.05 }): FakeReply => ({
  json: { model: 'gpt-6-luna', answers: [answer('action', action), answer('who', who)] },
});

let http: ReturnType<typeof fakeHttp>;
const replies: FakeReply[] = [];
beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
  vi.stubEnv('MODEL_PROVIDER', '');
  replies.length = 0;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    http = fakeHttp(...replies.splice(0, 1));
    return http.fetch(url, init);
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const heard = (text: string, over: Partial<RespondHeard> = {}): RespondHeard => ({
  task, text, available: ['backup', 'handover', 'reassign', 'call', 'close'], canPass: true,
  people: [{ id: 'tom', name: 'Tom Nguyen', free: true, minutes: 2 }, { id: 'kai', name: 'Kai Smith', free: false }], ...over,
});

describe('Interpreter.respond: what a lead said on the Respond screen', () => {
  it('sends the teammate the model picked', async () => {
    replies.push(decided({ backup: 0.9, reassign: 0.05, unclear: 0.05 }, { person_1: 0.92, person_2: 0.03, nobody: 0.05 }));

    const { value } = await new SparkInterpreter().respond(heard('get tommy over there to help her'));

    expect(value).toEqual({ kind: 'backup', volunteerId: 'tom' });
    expect(http.requests[0].json).toBeTruthy();
  });

  it('offers only the responses that fit, plus pass when it can', async () => {
    replies.push(decided({ carry_on: 0.9, unclear: 0.1 }));

    await new SparkInterpreter().respond(heard('they’re fine', { available: ['call', 'reassign', 'carry_on'], canPass: false }));

    const offered = JSON.stringify(http.requests[0].json);
    expect(offered).toContain('carry_on');
    expect(offered).not.toContain('handover_medics');
    expect(offered).not.toContain('Pass it up to Mo');
  });

  it('leaves the picker to the screen when nobody is named', async () => {
    replies.push(decided({ backup: 0.85, unclear: 0.15 }));

    const { value } = await new SparkInterpreter().respond(heard('she needs a hand'));

    expect(value).toEqual({ kind: 'backup', volunteerId: undefined });
  });

  it('is null when the model is sure it is none of them', async () => {
    replies.push(decided({ unclear: 0.9, backup: 0.1 }));

    const { value } = await new SparkInterpreter().respond(heard('what is the wifi password'));

    expect(value).toBeNull();
  });

  it('words that say 000 only ever read as the 000 handover', async () => {
    replies.push(decided({ handover_medics: 0.8, handover_emergency: 0.2 }));

    const { value } = await new SparkInterpreter().respond(heard('call an ambulance, he is not breathing'));

    expect(value).toEqual({ kind: 'handover', target: 'emergency' });
  });

  describe('falls back to keywords', () => {
    it('when the model fails, saying so in the run, and never throws', async () => {
      replies.push({ status: 400 });

      const { value, run } = await new SparkInterpreter().respond(heard('send Tom'));

      expect(value).toEqual({ kind: 'backup', volunteerId: 'tom' });
      expect(run.error).toBeTruthy();
      expect(run.models.interpreter).toBe('keywords');
    });

    it('when the network is down', async () => {
      replies.push({ drop: true });

      const { value } = await new SparkInterpreter().respond(heard('hand it over to the medics'));

      expect(value).toEqual({ kind: 'handover', target: 'medics' });
    });

    it('when the model is not sure', async () => {
      replies.push(decided({ close: 0.4, call: 0.35, unclear: 0.25 }));

      const { value } = await new SparkInterpreter().respond(heard('give her a call'));

      expect(value).toEqual({ kind: 'call' });
    });

    it('and is null when neither can tell', async () => {
      replies.push({ status: 400 });

      const { value } = await new SparkInterpreter().respond(heard('hmm'));

      expect(value).toBeNull();
    });
  });

  it('asks no model when nothing fits', async () => {
    replies.push(decided({ backup: 0.9, unclear: 0.1 }));

    const { value } = await new SparkInterpreter().respond(heard('send Tom', { available: [], canPass: false }));

    expect(value).toBeNull();
    expect(replies).toHaveLength(1);
  });
});
