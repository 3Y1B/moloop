import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fakeHttp, type FakeReply } from './fake-http';
import { LunaLlm } from './luna';
import type { ModelDiagnostic } from './http';

const Incident = z.object({ title: z.string(), urgent: z.boolean() });

type Reply = { status?: number; content?: string; drop?: boolean };

/** Stands in for the Spark gateway: answers each request with the next queued reply and records what it was sent. */
function fakeSpark(...replies: Reply[]) {
  const requests: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const reply = replies.shift();
    if (!reply) throw new Error('fakeSpark: no reply queued');
    if (reply.drop) throw new TypeError('fetch failed');
    const status = reply.status ?? 200;
    const body = status === 200 ? { choices: [{ message: { role: 'assistant', content: reply.content } }] } : { error: 'busy' };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const spark = (...replies: Reply[]) => {
  const fake = fakeSpark(...replies);
  const llm = new LunaLlm({ baseUrl: 'https://spark.test/v1', apiKey: 'test-key', model: 'qwen3.5:4b', fetch: fake.fetch, retryDelayMs: 0 });
  return { llm, requests: fake.requests };
};

const ask = { system: 'Classify festival reports.', prompt: 'a guy collapsed by the food stalls', schema: Incident };

describe('LunaLlm.generate', () => {
  it('records complete body timing and numeric usage without copying response content', async () => {
    const diagnostics: ModelDiagnostic[] = [];
    const llm = new LunaLlm({ baseUrl: 'https://provider.test/v1', apiKey: 'TEST_SECRET', fetch: async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"title":"TEST_SECRET response","urgent":true}' } }],
      usage: { prompt_tokens: 123, completion_tokens: 45, completion_tokens_details: { reasoning_tokens: 12 }, echoed_key: 'TEST_SECRET' },
    }), { headers: { 'x-request-id': 'req_0123456789abcdef0123456789abcdef' } }) });
    await expect(llm.generate({ ...ask, onDiagnostic: (event) => { diagnostics.push(event); } })).resolves.toMatchObject({ urgent: true });
    expect(diagnostics.map((event) => event.stage)).toEqual(['request_start', 'response_headers', 'response_body', 'complete']);
    expect(diagnostics[2]).toMatchObject({ request: 1, attempt: 1, status: 200, usage: { inputTokens: 123, outputTokens: 45, reasoningTokens: 12 } });
    expect(JSON.stringify(diagnostics)).not.toMatch(/TEST_SECRET|provider\.test|choices|echoed_key/);
  });

  it('does not coerce invalid usage fields or expose arbitrary usage data', async () => {
    const diagnostics: ModelDiagnostic[] = [];
    const llm = new LunaLlm({ baseUrl: 'https://provider.test/v1', fetch: async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"title":"x","urgent":false}' } }],
      usage: { prompt_tokens: '123', completion_tokens: -1, completion_tokens_details: { reasoning_tokens: 1.5 }, token: 'TEST_SECRET' },
    })) });
    await llm.generate({ ...ask, onDiagnostic: (event) => { diagnostics.push(event); } });
    expect(diagnostics.find((event) => event.stage === 'response_body')?.usage).toBeUndefined();
    expect(JSON.stringify(diagnostics)).not.toContain('TEST_SECRET');
  });

  it('distinguishes repair round two from transport retries', async () => {
    const { llm } = spark({ content: '{"urgent":"wrong"}' }, { content: '{"title":"valid","urgent":true}' });
    const events: ModelDiagnostic[] = [];
    await llm.generate({ ...ask, onDiagnostic: (event) => { events.push(event); } });
    expect(events.filter((event) => event.stage === 'request_start')).toMatchObject([{ request: 1, attempt: 1 }, { request: 2, attempt: 1 }]);
    expect(events.find((event) => event.stage === 'repair')).toMatchObject({ request: 1 });
    expect(events.at(-1)).toMatchObject({ stage: 'complete', request: 2, attempt: 1 });
  });

  it('records an aborted body read without starting a retry or JSON repair', async () => {
    const cancel = new AbortController(); const events: ModelDiagnostic[] = [];
    const response = new Response('{}');
    const json = vi.spyOn(response, 'json').mockImplementation(async () => new Promise((_resolve, reject) => {
      cancel.signal.addEventListener('abort', () => reject(cancel.signal.reason), { once: true });
      queueMicrotask(() => cancel.abort());
    }));
    const fetch = vi.fn(async () => response);
    const llm = new LunaLlm({ baseUrl: 'https://provider.test/v1', fetch });
    const result = llm.generate({ ...ask, signal: cancel.signal, onDiagnostic: (event) => {
      events.push(event);
    } }).catch((error) => error);
    expect((await result).name).toBe('AbortError');
    expect(events.find((event) => event.stage === 'cancelled')).toMatchObject({ phase: 'response_body', status: 200 });
    expect(fetch).toHaveBeenCalledTimes(1); expect(json).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.stage === 'repair')).toBe(false);
  });

  it('returns the parsed object when the model replies with valid JSON', async () => {
    const { llm } = spark({ content: '{"title":"Man collapsed at food stalls","urgent":true}' });

    await expect(llm.generate(ask)).resolves.toEqual({ title: 'Man collapsed at food stalls', urgent: true });
  });

  it('asks the Spark for JSON matching the schema, with thinking off', async () => {
    const { llm, requests } = spark({ content: '{"title":"x","urgent":false}' });

    await llm.generate(ask);

    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.url).toBe('https://spark.test/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer test-key');
    expect(req.body).toMatchObject({
      model: 'qwen3.5:4b',
      reasoning_effort: 'none',
      messages: [
        { role: 'system', content: 'Classify festival reports.' },
        { role: 'user', content: 'a guy collapsed by the food stalls' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          schema: {
            type: 'object',
            properties: { title: { type: 'string' }, urgent: { type: 'boolean' } },
            required: ['title', 'urgent'],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it('repairs once when the reply does not match the schema, telling the model what was wrong', async () => {
    const bad = '{"title":"Man collapsed","urgent":"yes"}';
    const { llm, requests } = spark({ content: bad }, { content: '{"title":"Man collapsed","urgent":true}' });

    await expect(llm.generate(ask)).resolves.toEqual({ title: 'Man collapsed', urgent: true });

    expect(requests).toHaveLength(2);
    const retry = requests[1].body.messages;
    expect(retry.slice(0, 3)).toEqual([
      { role: 'system', content: 'Classify festival reports.' },
      { role: 'user', content: 'a guy collapsed by the food stalls' },
      { role: 'assistant', content: bad },
    ]);
    expect(retry[3].role).toBe('user');
    expect(retry[3].content).toContain('urgent');
  });

  it('gives up after the repair also fails, so the pipeline can hand the report to a human', async () => {
    const { llm, requests } = spark({ content: 'not json' }, { content: '{"title":"Man collapsed"}' });

    await expect(llm.generate(ask)).rejects.toThrow(/invalid output/);
    expect(requests).toHaveLength(2);
  });

  it.each([
    ['the server is busy (429)', { status: 429 }],
    ['a model is restarting (502)', { status: 502 }],
    ['the relay drops the connection', { drop: true }],
  ])('retries once when %s', async (_, transient: Reply) => {
    const { llm, requests } = spark(transient, { content: '{"title":"Man collapsed","urgent":true}' });

    await expect(llm.generate(ask)).resolves.toEqual({ title: 'Man collapsed', urgent: true });
    expect(requests).toHaveLength(2);
  });
});

describe('LunaLlm.callTool', () => {
  const Escalate = z.object({ level: z.enum(['lead', 'coordinator']), reason: z.string() });
  const tools = [
    { name: 'create_task', description: 'A volunteer can handle it', args: z.object({ title: z.string() }) },
    { name: 'escalate', description: 'A lead or Mo decides', args: Escalate },
  ];
  const called = (name: string, args: unknown) => ({
    json: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] },
  });
  const said = (content: string) => ({ json: { choices: [{ message: { role: 'assistant', content } }] } });
  const agent = (...replies: FakeReply[]) => {
    const fake = fakeHttp(...replies);
    return { llm: new LunaLlm({ baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'gpt-6-luna', fetch: fake.fetch, retryDelayMs: 0 }), requests: fake.requests };
  };
  const ask = { system: 'You are the intake desk.', prompt: 'stop the set', tools };

  it('offers the tools as strict functions and returns the call', async () => {
    const { llm, requests } = agent(called('escalate', { level: 'coordinator', reason: 'Stop a performance' }));

    await expect(llm.callTool(ask)).resolves.toEqual({ tool: 'escalate', args: { level: 'coordinator', reason: 'Stop a performance' } });
    expect(requests[0].json).toMatchObject({
      tool_choice: 'auto',
      parallel_tool_calls: false,
      tools: [
        { type: 'function', function: { name: 'create_task', strict: true } },
        { type: 'function', function: { name: 'escalate', strict: true, parameters: { required: ['level', 'reason'], additionalProperties: false } } },
      ],
    });
  });

  it('returns plain text when the model answers without a tool', async () => {
    const { llm } = agent(said('Toilets are past The Grove.'));

    await expect(llm.callTool(ask)).resolves.toEqual({ text: 'Toilets are past The Grove.' });
  });

  it('sends a bad call back as the tool result once, then takes the corrected call', async () => {
    const { llm, requests } = agent(called('escalate', { level: 'boss', reason: 'x' }), called('escalate', { level: 'lead', reason: 'x' }));

    await expect(llm.callTool(ask)).resolves.toEqual({ tool: 'escalate', args: { level: 'lead', reason: 'x' } });
    const retry = requests[1].json.messages;
    expect(retry[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_1' }] });
    expect(retry[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_1', content: expect.stringContaining('level') });
  });

  it('gives up after the repair also fails, so the report goes to a person', async () => {
    const { llm } = agent(called('page_everyone', {}), called('page_everyone', {}));

    await expect(llm.callTool(ask)).rejects.toThrow(/invalid tool call/);
  });
});
