import { describe, expect, it } from 'vitest';
import { fakeHttp, type FakeReply } from './fake-http';
import { OpenAiDecisionsClassifier } from './openai-decisions';

const PRIORITY = [
  { id: 'P1', description: 'life threatening' },
  { id: 'P2', description: 'urgent, needs help within minutes' },
  { id: 'P3', description: 'routine' },
] as const;

const openai = (...replies: FakeReply[]) => {
  const http = fakeHttp(...replies);
  const classifier = new OpenAiDecisionsClassifier({ baseUrl: 'https://openai.test/v1', apiKey: 'sk-test', fetch: http.fetch, retryDelayMs: 0 });
  return { classifier, requests: http.requests };
};

// Shape copied from a real /v1/decisions response.
const decided = (choice: string) => ({
  json: {
    model: 'gpt-6-luna',
    answers: [
      {
        type: 'choice',
        name: 'label',
        choice,
        probabilities: [
          { value: 'P1', probability: 0.55 },
          { value: 'P2', probability: 0.42 },
          { value: 'P3', probability: 0.03 },
        ],
        confidence: 0.33,
      },
    ],
  },
});

const ask = { text: 'a guy collapsed by the food stalls', labels: PRIORITY };

describe('OpenAiDecisionsClassifier.classify', () => {
  it("returns the chosen label, every label's probability and the API's confidence", async () => {
    const { classifier } = openai(decided('P1'));

    await expect(classifier.classify(ask)).resolves.toEqual({
      label: 'P1',
      scores: { P1: 0.55, P2: 0.42, P3: 0.03 },
      confidence: 0.33,
    });
  });

  it('asks gpt-6-luna one choice question, with each label as a described choice', async () => {
    const { classifier, requests } = openai(decided('P1'));

    await classifier.classify(ask);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://openai.test/v1/decisions');
    expect(requests[0].headers.authorization).toBe('Bearer sk-test');
    expect(requests[0].json).toEqual({
      model: 'gpt-6-luna',
      input: 'a guy collapsed by the food stalls',
      questions: [
        {
          type: 'choice',
          name: 'label',
          instructions: expect.stringMatching(/\S/),
          choices: [
            { value: 'P1', description: 'life threatening' },
            { value: 'P2', description: 'urgent, needs help within minutes' },
            { value: 'P3', description: 'routine' },
          ],
        },
      ],
    });
  });

  it('throws when the model refuses', async () => {
    const { classifier } = openai({ json: { model: 'gpt-6-luna', answers: [{ type: 'refusal', name: 'label' }] } });

    await expect(classifier.classify(ask)).rejects.toThrow(/refus/);
  });

  it('throws on a label that was not offered', async () => {
    const { classifier } = openai(decided('P0'));

    await expect(classifier.classify(ask)).rejects.toThrow(/P0/);
  });

  it('passes the cancel signal to the request, and does not retry once cancelled', async () => {
    const cancel = new AbortController();
    const http = fakeHttp({ status: 429 }, decided('P1'));
    const classifier = new OpenAiDecisionsClassifier({ baseUrl: 'https://openai.test/v1', apiKey: 'sk-test', fetch: http.fetch, retryDelayMs: 0 });
    cancel.abort();

    await expect(classifier.classify({ ...ask, signal: cancel.signal })).rejects.toThrow();
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].signal).toBe(cancel.signal);
  });
});
