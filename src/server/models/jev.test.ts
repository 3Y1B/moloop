import { choice, noul } from '@typesafe-ai/sdk';
import { describe, expect, it } from 'vitest';
import { fakeHttp, type FakeReply } from './fake-http';
import { Jev } from './jev';

const PRIORITY = { P1: 'life threatening', P2: 'urgent, needs help within minutes', P3: 'routine' };
const questions = {
  priority: choice('How urgent is this message?', PRIORITY),
  routine: noul('Is this only a routine question?'),
};

const spark = (...replies: FakeReply[]) => {
  const http = fakeHttp(...replies);
  const jev = new Jev({ baseUrl: 'https://spark.test/v1', apiKey: 'test-key', fetch: http.fetch, retryDelayMs: 0 });
  return { jev, requests: http.requests };
};

const p2 = { type: 'choice', choice: 'P2', probabilities: { P1: 0.21, P2: 0.77, P3: 0.02 }, confidence: 0.65 };
const answered = (priority: object = p2) => ({ json: { model: 'qwen3.5:4b', answers: { priority, routine: { type: 'noul', noul: 0.03 } } } });

const state = 'a guy collapsed by the food stalls';

describe('Jev.decide', () => {
  it('returns each answer by name: the chosen label with probabilities, and the chance of yes', async () => {
    const { jev } = spark(answered());

    await expect(jev.decide(state, questions)).resolves.toEqual({ priority: p2, routine: { type: 'noul', noul: 0.03 } });
  });

  it('asks the Spark every question in one call', async () => {
    const { jev, requests } = spark(answered());

    await jev.decide(state, questions);

    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.url).toBe('https://spark.test/v1/systemone');
    expect(req.headers.authorization).toBe('Bearer test-key');
    expect(req.json).toEqual({ model: 'jev-latest', state, questions });
  });

  it('rejects an answer that is not one of the offered labels', async () => {
    const { jev } = spark(answered({ ...p2, choice: 'P0' }));

    await expect(jev.decide(state, questions)).rejects.toThrow(/P0/);
  });

  it.each([
    ['the server is busy (429)', { status: 429 }],
    ['a model is restarting (502)', { status: 502 }],
    ['the relay drops the connection', { drop: true }],
  ])('retries once when %s', async (_, transient: FakeReply) => {
    const { jev, requests } = spark(transient, answered());

    await expect(jev.decide(state, questions)).resolves.toMatchObject({ priority: { choice: 'P2' } });
    expect(requests).toHaveLength(2);
  });
});
