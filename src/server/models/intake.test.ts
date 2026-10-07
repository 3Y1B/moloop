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
      zone: 'oval-stage', place: null, language: 'en', speaker_needed: null, ...(name === 'escalate' ? { level: 'lead', reason: 'Needs a decision' } : {}), ...over,
    }),
  } }] } }] },
});
const answers = (answer: string, language: string): FakeReply => ({
  json: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: {
    name: 'answer_question', arguments: JSON.stringify({ answer, language }),
  } }] } }] },
});
/** The answer prompt's reply: JSON in the message content. */
const wrote = (answer: string | null, language: string): FakeReply => ({
  json: { choices: [{ message: { role: 'assistant', content: JSON.stringify({ answer, language }) } }] },
});

/** The classifier's cross-check, in OpenAI's /v1/decisions shape. */
const probs = (p: Record<string, number>) => Object.entries(p).map(([value, probability]) => ({ value, probability }));
const decided = (team: string, priority: 'P1' | 'P2' | 'P3', routine: number, sure: Record<string, number> | null = null): FakeReply => ({
  json: { answers: [
    { type: 'choice', name: 'team', choice: team, probabilities: probs({ [team]: 0.9 }), confidence: 0.9 },
    { type: 'choice', name: 'priority', choice: priority, probabilities: probs(sure ?? { [priority]: 0.9, P2: 0.05, P1: 0.05 }), confidence: sure ? 0.3 : 0.9 },
    { type: 'choice', name: 'routine', choice: routine >= 0.5 ? 'yes' : 'no', probabilities: probs({ yes: routine, no: 1 - routine }), confidence: 0.9 },
  ] },
});

// Replies are routed by endpoint: for a volunteer's report the agent and the classifier run in parallel.
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

  it('takes the classifier’s priority over the agent’s, unless the agent says P1', async () => {
    queue.chat.push(called('create_task', { priority: 'P2' }), called('create_task', { priority: 'P1' }));
    queue.decisions.push(decided('first-aid', 'P3', 0.1), decided('first-aid', 'P3', 0.1));

    const blister = await ai.triage(heard('can I get a plaster for a blister'));
    const agentP1 = await ai.triage(heard('my friend’s lips are swelling after eating peanuts'));

    expect(blister.value.priority).toBe('P3');
    expect(agentP1.value.priority).toBe('P1');
  });

  it('keeps the language someone there needs a speaker of, apart from the one the report is written in', async () => {
    queue.chat.push(
      called('create_task', { speaker_needed: 'ZH' }),
      called('create_task', { language: 'vi', speaker_needed: null }),
      called('create_task', { speaker_needed: 'en' }),
    );
    queue.decisions.push(decided('first-aid', 'P2', 0.1), decided('first-aid', 'P2', 0.1), decided('first-aid', 'P2', 0.1));

    const mandarin = await ai.triage(heard('old man chest pain, his wife only speaks mandarin'));
    const vietnamese = await ai.triage(heard('Bố tôi ngất rồi'));
    const english = await ai.triage(heard('man fainted near the bar'));

    expect(mandarin.value).toMatchObject({ language: 'en', speakerNeeded: 'zh' });
    // Written in Vietnamese: a speaker of it is needed whatever the agent said.
    expect(vietnamese.value).toMatchObject({ language: 'vi', speakerNeeded: 'vi' });
    expect(english.value.speakerNeeded).toBeNull();
  });

  it('sends it to a lead when the agent fails, with the classifier’s team and priority', async () => {
    queue.chat.push({ status: 500 });
    queue.decisions.push(decided('ops', 'P3', 0.1));

    const { value, run } = await ai.triage(heard('bin overflowing at food alley'));

    expect(value).toMatchObject({ team: 'ops', priority: 'P3', title: 'Bin overflowing at food alley', escalate: { level: 'lead' } });
    expect(run.error).toMatch(/500/);
  });

  it('reads it as unread when both models fail: P2 for Info, a lead decides', async () => {
    queue.chat.push({ status: 500 });
    queue.decisions.push({ status: 500 });

    const { value } = await ai.triage(heard('a guy is unconscious by the burger truck'));

    expect(value).toMatchObject({ team: 'info', priority: 'P2', escalate: { level: 'lead' } });
  });

});

describe('a festival-goer: the classifier is the gate', () => {
  it('answers a routine question straight away, without the agent', async () => {
    queue.decisions.push(decided('info', 'P3', 0.97));
    queue.chat.push(wrote('Los baños están junto a las pistas de tenis.', 'es'));

    const { value, run } = await ai.understand(heard('¿dónde están los baños?'));

    expect(value).toMatchObject({ kind: 'answer', answer: 'Los baños están junto a las pistas de tenis.', language: 'es' });
    expect(run.route).toBe('ai_resolved');
    expect(sent).toHaveLength(1);
    expect(sent[0].tools).toBeUndefined();
  });

  it('answers a greeting, every time it is said', async () => {
    queue.decisions.push(decided('info', 'P3', 0.97), decided('info', 'P3', 0.97));
    queue.chat.push(wrote('Hi! What do you need?', 'en'), wrote('Hi! What do you need?', 'en'));

    const first = await ai.understand(heard('hello? hello?'));
    const again = await ai.understand(heard('Festival-goer: hello? hello?\nYou answered: Hi! What do you need?\nFestival-goer: hellooo'));

    expect(first.value).toMatchObject({ kind: 'answer', answer: 'Hi! What do you need?' });
    expect(again.value).toMatchObject({ kind: 'answer', answer: 'Hi! What do you need?' });
  });

  it('keeps it routine when the classifier leans P3 but isn’t sure: no step up to P2', async () => {
    const unsure = () => decided('ops', 'P3', 0.97, { P3: 0.53, P2: 0.29, P1: 0.18 });
    queue.decisions.push(unsure(), unsure());
    queue.chat.push(wrote('Free refills at Water 1, in the Grove.', 'en'), called('create_task'));

    const water = await ai.understand(heard('I need water'));
    const report = await ai.triage(heard('the water station tap is leaking'));

    expect(water.value).toMatchObject({ kind: 'answer', answer: 'Free refills at Water 1, in the Grove.' });
    expect(report.value.priority).toBe('P2');
  });

  it('goes to the agent when the classifier says it isn’t routine, with no answer written first', async () => {
    queue.decisions.push(decided('welfare', 'P2', 0.2));
    queue.chat.push(called('create_task', { team: 'welfare', priority: 'P2' }));

    const { value } = await ai.understand(heard('my friend is not feeling safe near the toilets'));

    expect(value).toMatchObject({ kind: 'task', team: 'welfare', priority: 'P2' });
    expect(sent).toHaveLength(1);
    expect(sent[0].tools.map((t: any) => t.function.name)).toEqual(['answer_question', 'create_task', 'escalate']);
  });

  it('leaves anything under ROUTINE_AT to the agent, which may still answer it', async () => {
    queue.decisions.push(decided('info', 'P3', 0.9));
    queue.chat.push(answers('Toilets East are by the tennis courts.', 'en'));

    const { value } = await ai.understand(heard('where are the toilets?'));

    expect(value).toMatchObject({ kind: 'answer', answer: 'Toilets East are by the tennis courts.' });
    expect(sent[0].tools.map((t: any) => t.function.name)).toContain('answer_question');
  });

  it('lets the agent overrule the classifier and answer after all', async () => {
    queue.decisions.push(decided('info', 'P2', 0.3));
    queue.chat.push(answers('Info is just inside the Main Entrance, on the left.', 'en'));

    const { value, run } = await ai.understand(heard('hello?? is anyone there, I have a question'));

    expect(value).toMatchObject({ kind: 'answer', answer: 'Info is just inside the Main Entrance, on the left.' });
    expect(run.route).toBe('ai_resolved');
  });

  it('never lets the agent answer what the classifier reads as life-threatening', async () => {
    queue.decisions.push(decided('first-aid', 'P1', 0.0));
    queue.chat.push(answers('First Aid is on the south walk.', 'en'));

    const { value } = await ai.understand(heard('my friend collapsed and isn’t breathing'));

    expect(value).toMatchObject({ kind: 'task', priority: 'P1', escalate: { level: 'lead' } });
  });

  it('goes to the agent at P3 when the facts have nothing for a routine message', async () => {
    queue.decisions.push(decided('info', 'P3', 0.97, { P3: 0.53, P2: 0.29, P1: 0.18 }));
    queue.chat.push(wrote(null, 'en'), called('create_task', { team: 'info' }));

    const { value } = await ai.understand(heard('can someone help me find my phone charger'));

    expect(value).toMatchObject({ kind: 'task', team: 'info', priority: 'P3' });
  });

  it('goes to the agent when the classifier fails: never an answer', async () => {
    queue.decisions.push({ status: 500 });
    queue.chat.push(called('create_task'));

    const { value } = await ai.understand(heard('where are the toilets?'));

    expect(value.kind).toBe('task');
    expect(sent).toHaveLength(1);
  });

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
