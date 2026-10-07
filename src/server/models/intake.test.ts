import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FakeReply } from './fake-http';
import { SparkInterpreter } from './interpreter';

vi.mock('./venue', () => ({
  zones: async () => [{ slug: 'food-alley', name: 'Food Alley' }, { slug: 'oval-stage', name: 'Oval Stage' }],
  venueFacts: () => '- Toilets East are by the tennis courts.',
}));

/** The agent's step, in OpenAI's chat completions shape. */
const called = (name: 'create_task' | 'escalate', over: Record<string, unknown> = {}): FakeReply => ({
  json: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: {
    name,
    arguments: JSON.stringify({
      title: 'Asks to stop the set at the Oval', summary: 'Wants the set stopped.', team: 'ops', priority: 'P3', category: 'facilities',
      zone: 'oval-stage', place: null, language: 'en', ...(name === 'escalate' ? { level: 'lead', reason: 'Needs a decision' } : {}), ...over,
    }),
  } }] } }] },
});
const answers = (answer: string, language: string): FakeReply => ({
  json: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: {
    name: 'answer_question', arguments: JSON.stringify({ answer, language }),
  } }] } }] },
});
const said = (content: string): FakeReply => ({ json: { choices: [{ message: { role: 'assistant', content } }] } });

/** The classifier's cross-check, in OpenAI's /v1/decisions shape. */
const probs = (p: Record<string, number>) => Object.entries(p).map(([value, probability]) => ({ value, probability }));
const decided = (team: string, priority: 'P1' | 'P2' | 'P3', routine: number, sure: Record<string, number> | null = null): FakeReply => ({
  json: { answers: [
    { type: 'choice', name: 'team', choice: team, probabilities: probs({ [team]: 0.9 }), confidence: 0.9 },
    { type: 'choice', name: 'priority', choice: priority, probabilities: probs(sure ?? { [priority]: 0.9, P2: 0.05, P1: 0.05 }), confidence: sure ? 0.3 : 0.9 },
    { type: 'choice', name: 'routine', choice: routine >= 0.5 ? 'yes' : 'no', probabilities: probs({ yes: routine, no: 1 - routine }), confidence: 0.9 },
  ] },
});

// The agent and the classifier run in parallel, so replies are routed by endpoint.
const queue: { chat: FakeReply[]; decisions: FakeReply[] } = { chat: [], decisions: [] };
const sent: any[] = [];
beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
  vi.stubEnv('MODEL_PROVIDER', '');
  queue.chat.length = 0;
  queue.decisions.length = 0;
  sent.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.endsWith('/chat/completions')) sent.push(JSON.parse(String(init?.body)));
    const reply = (url.endsWith('/chat/completions') ? queue.chat : queue.decisions).shift();
    if (!reply) throw new Error(`no reply queued for ${url}`);
    const status = reply.status ?? 200;
    return new Response(JSON.stringify(status === 200 ? reply.json : { error: 'down' }), { status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ai = new SparkInterpreter();
const heard = (text: string) => ({ text, zoneSlug: null, locationHint: null });

describe('intake: the agent picks create_task or escalate, code has the last word', () => {
  it('keeps an escalation, with the agent’s reason for the lead', async () => {
    queue.chat.push(called('escalate', { reason: 'Artist wants to change their set time' }));
    queue.decisions.push(decided('artist', 'P3', 0.1));

    const { value, run } = await ai.triage(heard('the headliner wants to go on an hour later'));

    expect(value).toMatchObject({ team: 'ops', priority: 'P3', zoneSlug: 'oval-stage', escalate: { level: 'lead', reason: 'Artist wants to change their set time' } });
    expect(run.team).toMatchObject({ tool: 'escalate' });
  });

  it('leaves a create_task to the allocator', async () => {
    queue.chat.push(called('create_task', { title: 'Bin overflowing at Food Alley' }));
    queue.decisions.push(decided('ops', 'P3', 0.1));

    const { value } = await ai.triage(heard('bin overflowing at food alley'));

    expect(value).toMatchObject({ title: 'Bin overflowing at Food Alley', escalate: null });
  });

  it('turns create_task into an escalation to Mo when a safety rule says so', async () => {
    queue.chat.push(called('create_task'));
    queue.decisions.push(decided('ops', 'P2', 0.1));

    const { value } = await ai.triage(heard('the PA is sparking, stop the set'));

    expect(value.escalate).toMatchObject({ level: 'coordinator', reason: expect.stringMatching(/stop the set/) });
  });

  it('never lets an escalation to Mo drop to the lead', async () => {
    queue.chat.push(called('escalate', { level: 'lead' }));
    queue.decisions.push(decided('crowd', 'P1', 0.0));

    const { value } = await ai.triage(heard('we need to evacuate the oval now'));

    expect(value.escalate?.level).toBe('coordinator');
  });

  it('takes the classifier’s priority over the agent’s, unless the agent says P1', async () => {
    queue.chat.push(called('create_task', { priority: 'P2' }), called('create_task', { priority: 'P1' }));
    queue.decisions.push(decided('first-aid', 'P3', 0.1), decided('first-aid', 'P3', 0.1));

    const blister = await ai.triage(heard('can I get a plaster for a blister'));
    const agentP1 = await ai.triage(heard('my friend’s lips are swelling after eating peanuts'));

    expect(blister.value.priority).toBe('P3');
    expect(agentP1.value.priority).toBe('P1');
  });

  it('never goes below the red-flag words', async () => {
    queue.chat.push(called('create_task', { priority: 'P3' }));
    queue.decisions.push(decided('first-aid', 'P3', 0.0));

    const { value } = await ai.triage(heard('a guy is unconscious by the burger truck'));

    expect(value.priority).toBe('P1');
  });

  it('falls back to keywords at P2 or more when the agent fails', async () => {
    queue.chat.push({ status: 500 });
    queue.decisions.push(decided('ops', 'P3', 0.1));

    const { value, run } = await ai.triage(heard('bin overflowing at food alley'));

    expect(value).toMatchObject({ team: 'ops', priority: 'P3', escalate: null });
    expect(run.error).toMatch(/500/);
    expect(run.reason).toMatch(/A model failed/);
  });

  it('answers a routine question only when the classifier agrees it is routine', async () => {
    queue.chat.push(answers('Los baños están junto a las pistas de tenis.', 'es'));
    queue.decisions.push(decided('info', 'P3', 0.9));

    await expect(ai.understand(heard('¿dónde están los baños?'))).resolves.toMatchObject({
      value: { kind: 'answer', answer: 'Los baños están junto a las pistas de tenis.', language: 'es' },
    });
  });

  it('takes a plain-text reply as the answer too', async () => {
    queue.chat.push(said('Toilets East are by the tennis courts.'));
    queue.decisions.push(decided('info', 'P3', 0.9));

    await expect(ai.understand(heard('where are the toilets?'))).resolves.toMatchObject({ value: { kind: 'answer', answer: 'Toilets East are by the tennis courts.' } });
  });

  it('never answers when a safety rule escalates it', async () => {
    queue.chat.push(answers('The next announcement is at 6pm.', 'en'));
    queue.decisions.push(decided('info', 'P3', 0.9));

    const { value } = await ai.understand(heard('can you make an announcement for my lost friend?'));

    expect(value).toMatchObject({ kind: 'task', escalate: { level: 'coordinator' } });
  });

  it('keeps an answer when the classifier leans P3 but isn’t sure: no step up to P2', async () => {
    const unsure = () => decided('ops', 'P3', 0.8, { P3: 0.53, P2: 0.29, P1: 0.18 });
    queue.chat.push(answers('Free refills at Water 1, in the Grove.', 'en'), called('create_task'));
    queue.decisions.push(unsure(), unsure());

    const water = await ai.understand(heard('I need water'));
    const report = await ai.triage(heard('the water station tap is leaking'));

    expect(water.value).toMatchObject({ kind: 'answer', answer: 'Free refills at Water 1, in the Grove.' });
    expect(report.value.priority).toBe('P2');
  });

  it('sends it to a person when the agent answers but the classifier says it isn’t routine', async () => {
    queue.chat.push(said('Someone is coming.'));
    queue.decisions.push(decided('welfare', 'P3', 0.2));

    const { value } = await ai.understand(heard('my friend is not feeling safe near the toilets'));

    expect(value.kind).toBe('task');
  });

  describe('who sent it', () => {
    const staff = (role: string, teamSlug: 'first-aid' | 'ops' | null = 'ops') => ({ kind: 'staff' as const, role, teamSlug });

    it('tells the agent who sent it and where they are', async () => {
      queue.chat.push(called('create_task'));
      queue.decisions.push(decided('ops', 'P3', 0.1));

      await ai.triage({ text: 'spill over here', zoneSlug: 'food-alley', locationHint: null, from: staff('volunteer') });

      expect(sent[0].messages[1].content).toBe('spill over here\n(From: a volunteer on the ops team. Sent from: Food Alley.)');
    });

    it('drops an escalation that would land back on Mo when Mo reported it', async () => {
      queue.chat.push(called('escalate', { level: 'coordinator' }));
      queue.decisions.push(decided('ops', 'P2', 0.1));

      const { value } = await ai.triage({ ...heard('the PA is sparking, stop the set'), from: staff('coordinator', null) });

      expect(value.escalate).toBeNull();
    });

    it('drops a lead-level escalation from that team’s own lead, but keeps one for Mo', async () => {
      queue.chat.push(called('escalate', { level: 'lead' }), called('escalate', { level: 'coordinator' }));
      queue.decisions.push(decided('ops', 'P3', 0.1), decided('ops', 'P2', 0.1));

      const own = await ai.triage({ ...heard('need a call on moving the bins'), from: staff('team_lead') });
      const up = await ai.triage({ ...heard('need a call on closing the oval'), from: staff('team_lead') });

      expect(own.value.escalate).toBeNull();
      expect(up.value.escalate?.level).toBe('coordinator');
    });
  });
});
