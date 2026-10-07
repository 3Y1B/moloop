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
  resolvedAt: null, requiredCount: 1, helpers: [], resolution: null, requestId: null, mobilizationId: null,
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

  describe('is null, for the lead to tap', () => {
    it('when the model fails, saying so in the run, and never throws', async () => {
      replies.push({ status: 400 });

      const { value, run } = await new SparkInterpreter().respond(heard('send Tom'));

      expect(value).toBeNull();
      expect(run.error).toBeTruthy();
    });

    it('when the network is down', async () => {
      replies.push({ drop: true });

      const { value } = await new SparkInterpreter().respond(heard('hand it over to the medics'));

      expect(value).toBeNull();
    });

    it('when the model is not sure', async () => {
      replies.push(decided({ close: 0.4, call: 0.35, unclear: 0.25 }));

      const { value } = await new SparkInterpreter().respond(heard('give her a call'));

      expect(value).toBeNull();
    });
  });

  it('asks no model when nothing fits', async () => {
    replies.push(decided({ backup: 0.9, unclear: 0.1 }));

    const { value } = await new SparkInterpreter().respond(
      heard('send Tom', { task: { ...task, assigneeId: null }, available: [], canPass: false }),
    );

    expect(value).toBeNull();
    expect(replies).toHaveLength(1);
  });

  it('turns "tell her…" into words for the volunteer, as the lead', async () => {
    replies.push(decided({ tell_volunteer: 0.9, unclear: 0.1 }), {
      json: { choices: [{ message: { content: JSON.stringify({ message: 'Medics are two minutes out.' }) } }] },
    });

    const { value } = await new SparkInterpreter().respond(heard('tell her medics are two minutes out', { available: [], canPass: false }));

    expect(value).toEqual({ kind: 'message', to: 'crew', text: 'Medics are two minutes out.' });
  });

  it('offers the festival-goer only on their request', async () => {
    replies.push(decided({ unclear: 0.9, tell_volunteer: 0.1 }), decided({ unclear: 0.9, tell_volunteer: 0.1 }));

    await new SparkInterpreter().respond(heard('hm'));
    expect(JSON.stringify(http.requests[0].json)).not.toContain('tell_guest');
    await new SparkInterpreter().respond(heard('hm', { task: { ...task, requestId: 'asked' } }));
    expect(JSON.stringify(http.requests[0].json)).toContain('tell_guest');
  });
});

describe('Interpreter.interpret after merging guest messages and helper replies', () => {
  const chosenKind = (kind: string): FakeReply => ({
    json: { answers: [answer('kind', { [kind]: 0.99, new_report: 0.01 })] },
  });
  const withHelper = (status: 'notified' | 'accepted'): Task => ({
    ...task, status: 'accepted', requiredCount: 2,
    helpers: [{ volunteerId: 'tom', status, assignedAt: NOW, respondedAt: status === 'accepted' ? NOW : null }],
  });

  it.each(['accept', 'decline'] as const)('preserves the notified helper’s own %s despite the accepted owner', async (kind) => {
    replies.push(chosenKind(kind));

    const result = await new SparkInterpreter().interpret({ tasks: [withHelper('notified')], meId: 'tom', text: kind });

    expect(result.intent).toEqual({ kind: 'reply', taskId: task.id, reply: kind });
    expect(JSON.stringify(http.requests[0].json)).toContain('a helper (notified assignment)');
  });

  it('does not give an accepted helper the owner’s need-help reply', async () => {
    replies.push(chosenKind('need_help'));

    const result = await new SparkInterpreter().interpret({ tasks: [withHelper('accepted')], meId: 'tom', text: 'need help' });

    expect(result.intent).toEqual({ kind: 'report' });
  });

  it('can rewrite a message for the linked guest without changing its confirmed intent', async () => {
    replies.push(chosenKind('tell_guest'), {
      json: { choices: [{ message: { content: JSON.stringify({ message: 'I am two minutes away.' }) } }] },
    });

    const result = await new SparkInterpreter().interpret({
      tasks: [{ ...task, requestId: 'guest-request' }], meId: 'priya', text: "tell her I'm two minutes away",
    });

    expect(result.intent).toEqual({ kind: 'tell_guest', taskId: task.id, text: 'I am two minutes away.' });
  });

  it('does not emit a guest message for a staff-only task', async () => {
    replies.push(chosenKind('tell_guest'));

    const result = await new SparkInterpreter().interpret({ tasks: [task], meId: 'priya', text: 'tell her I am nearby' });

    expect(result.intent).toEqual({ kind: 'report' });
  });

  it('does not interpret another volunteer’s task as a guest message', async () => {
    replies.push(chosenKind('tell_guest'));

    const result = await new SparkInterpreter().interpret({ tasks: [{ ...task, requestId: 'guest-request' }], meId: 'kai', text: 'tell her I am nearby' });

    expect(result.intent).toEqual({ kind: 'report' });
    expect(replies).toHaveLength(1);
  });
});
