import { describe, expect, it } from 'vitest';
import { JevClassifier } from './jev';

const PRIORITY = [
  { id: 'P1', description: 'life threatening' },
  { id: 'P2', description: 'urgent, needs help within minutes' },
  { id: 'P3', description: 'routine' },
] as const;

type Reply = { status?: number; answer?: object; drop?: boolean };

/** Stands in for the Spark gateway's /v1/systemone: answers each request with the next queued reply and records what it was sent. */
function fakeSpark(...replies: Reply[]) {
  const requests: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const reply = replies.shift();
    if (!reply) throw new Error('fakeSpark: no reply queued');
    if (reply.drop) throw new TypeError('fetch failed');
    const status = reply.status ?? 200;
    const body = status === 200 ? { model: 'qwen3.5:4b', answers: { label: reply.answer } } : { error: 'busy' };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const spark = (...replies: Reply[]) => {
  const fake = fakeSpark(...replies);
  const jev = new JevClassifier({ baseUrl: 'https://spark.test/v1', apiKey: 'test-key', fetch: fake.fetch, retryDelayMs: 0 });
  return { jev, requests: fake.requests };
};

const p2 = {
  type: 'choice',
  choice: 'P2',
  probabilities: { P1: 0.21, P2: 0.77, P3: 0.02 },
  confidence: 0.65,
};

const ask = { text: 'a guy collapsed by the food stalls', labels: PRIORITY };

describe('JevClassifier.classify', () => {
  it("returns the chosen label, every label's probability and the gateway's confidence", async () => {
    const { jev } = spark({ answer: p2 });

    await expect(jev.classify(ask)).resolves.toEqual({
      label: 'P2',
      scores: { P1: 0.21, P2: 0.77, P3: 0.02 },
      confidence: 0.65,
    });
  });

  it('asks the Spark one choice question, with each label described as a criterion', async () => {
    const { jev, requests } = spark({ answer: p2 });

    await jev.classify(ask);

    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.url).toBe('https://spark.test/v1/systemone');
    expect(req.headers.authorization).toBe('Bearer test-key');
    expect(req.body).toEqual({
      model: 'jev-latest',
      state: 'a guy collapsed by the food stalls',
      questions: {
        label: {
          type: 'choice',
          instructions: expect.stringMatching(/\S/),
          criteria: { P1: 'life threatening', P2: 'urgent, needs help within minutes', P3: 'routine' },
        },
      },
    });
  });

  it('rejects an answer that is not one of the offered labels', async () => {
    const { jev } = spark({ answer: { ...p2, choice: 'P0' } });

    await expect(jev.classify(ask)).rejects.toThrow(/P0/);
  });

  it.each([
    ['the server is busy (429)', { status: 429 }],
    ['a model is restarting (502)', { status: 502 }],
    ['the relay drops the connection', { drop: true }],
  ])('retries once when %s', async (_, transient: Reply) => {
    const { jev, requests } = spark(transient, { answer: p2 });

    await expect(jev.classify(ask)).resolves.toMatchObject({ label: 'P2' });
    expect(requests).toHaveLength(2);
  });
});
