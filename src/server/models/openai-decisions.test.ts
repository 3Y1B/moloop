import { choice, noul } from '@typesafe-ai/sdk';
import { describe, expect, it } from 'vitest';
import { fakeHttp, type FakeReply } from './fake-http';
import { OpenAiDecisions } from './openai-decisions';

const PRIORITY = { P1: 'life threatening', P2: 'urgent, needs help within minutes', P3: 'routine' };
const questions = {
  priority: choice('How urgent is this message?', PRIORITY),
  routine: noul('Is this only a routine question?'),
};

const openai = (...replies: FakeReply[]) => {
  const http = fakeHttp(...replies);
  const decisions = new OpenAiDecisions({ baseUrl: 'https://openai.test/v1', apiKey: 'sk-test', fetch: http.fetch, retryDelayMs: 0 });
  return { decisions, requests: http.requests };
};

// Shape copied from a real /v1/decisions response.
const decided = (choice: string) => ({
  json: {
    model: 'gpt-6-luna',
    answers: [
      {
        type: 'choice',
        name: 'priority',
        choice,
        probabilities: [
          { value: 'P1', probability: 0.55 },
          { value: 'P2', probability: 0.42 },
          { value: 'P3', probability: 0.03 },
        ],
        confidence: 0.33,
      },
      { type: 'choice', name: 'routine', choice: 'no', probabilities: [{ value: 'yes', probability: 0.04 }, { value: 'no', probability: 0.96 }], confidence: 0.9 },
    ],
  },
});

const state = 'a guy collapsed by the food stalls';

describe('OpenAiDecisions.decide', () => {
  it('answers in the Spark\'s shape: the chosen label with probabilities, and the chance of yes', async () => {
    const { decisions } = openai(decided('P1'));

    await expect(decisions.decide(state, questions)).resolves.toEqual({
      priority: { type: 'choice', choice: 'P1', probabilities: { P1: 0.55, P2: 0.42, P3: 0.03 }, confidence: 0.33 },
      routine: { type: 'noul', noul: 0.04 },
    });
  });

  it('asks gpt-6-luna each question as a described choice, a yes/no one as yes or no', async () => {
    const { decisions, requests } = openai(decided('P1'));

    await decisions.decide({ message: state, location: 'North Gate' }, questions);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://openai.test/v1/decisions');
    expect(requests[0].headers.authorization).toBe('Bearer sk-test');
    expect(requests[0].json).toEqual({
      model: 'gpt-6-luna',
      input: JSON.stringify({ message: state, location: 'North Gate' }),
      questions: [
        {
          type: 'choice',
          name: 'priority',
          instructions: 'How urgent is this message?',
          choices: [
            { value: 'P1', description: 'life threatening' },
            { value: 'P2', description: 'urgent, needs help within minutes' },
            { value: 'P3', description: 'routine' },
          ],
        },
        { type: 'choice', name: 'routine', instructions: 'Is this only a routine question?', choices: [{ value: 'yes' }, { value: 'no' }] },
      ],
    });
  });

  it('throws when the model refuses', async () => {
    const { decisions } = openai({ json: { model: 'gpt-6-luna', answers: [{ type: 'refusal', name: 'priority' }, { type: 'refusal', name: 'routine' }] } });

    await expect(decisions.decide(state, questions)).rejects.toThrow(/refused/);
  });

  it('throws on a label that was not offered', async () => {
    const { decisions } = openai(decided('P0'));

    await expect(decisions.decide(state, questions)).rejects.toThrow(/P0/);
  });

  it('passes the cancel signal to the request, and does not retry once cancelled', async () => {
    const cancel = new AbortController();
    const http = fakeHttp({ status: 429 }, decided('P1'));
    const decisions = new OpenAiDecisions({ baseUrl: 'https://openai.test/v1', apiKey: 'sk-test', fetch: http.fetch, retryDelayMs: 0 });
    cancel.abort();

    await expect(decisions.decide(state, questions, cancel.signal)).rejects.toThrow();
    expect(http.requests).toHaveLength(0);
  });
});
