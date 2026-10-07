import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ModelAuditError, ModelTransportError } from './errors';
import { fakeHttp } from './fake-http';
import { generateWithReadTool } from './index';
import type { ModelDiagnostic } from './http';
import { ReadToolResponses } from './responses';

const Answer = z.strictObject({ answer: z.string() });
const Arguments = z.strictObject({ slugs: z.array(z.enum(['heat', 'storm'])).min(1).max(2) });
const reasoning = { id: 'rs_opaque', type: 'reasoning', summary: [], encrypted_content: 'opaque-encrypted-state', extra: { untouched: true } };
const call = { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'get_playbooks', arguments: '{"slugs":["heat"]}', status: 'completed' };
const retrieval = (output: unknown[] = [reasoning, call]) => ({ status: 'completed', output });
const final = (text = '{"answer":"valid"}') => ({ status: 'completed', output: [
  { type: 'reasoning', encrypted_content: 'final-opaque', summary: [] },
  { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] },
] });
const tool = () => ({ name: 'get_playbooks', description: 'Read this snapshot only.', args: Arguments,
  execute: vi.fn(async (_args: z.infer<typeof Arguments>, _callId: string) => '{"playbooks":[{"slug":"heat","version":1}]}') });
const ask = (read = tool()) => ({ system: 'Test safety rules', prompt: 'Test immutable snapshot', schema: Answer, tool: read });
const options = () => ({ reasoningEffort: 'medium', maxTokens: 12_000, onResponse: vi.fn(async (_raw: string) => {}) });
const agent = (...bodies: unknown[]) => {
  const fake = fakeHttp(...bodies.map((json) => ({ json })));
  return { ...fake, llm: new ReadToolResponses({ baseUrl: 'https://api.test/v1', apiKey: 'test-key',
    model: 'gpt-6-luna', fetch: fake.fetch, retryDelayMs: 0 }) };
};

describe('bounded read-tool Responses transport (offline only)', () => {
  it('resolves a selected-SOP schema once after the audited read and uses it for final validation', async () => {
    const read = tool(); const a = agent(retrieval(), final('{"selected":"heat"}')); const o = options();
    const order: string[] = [];
    o.onResponse.mockImplementation(async () => { order.push('audit'); });
    read.execute.mockImplementation(async () => { order.push('read'); return 'audited heat SOP'; });
    const resolve = vi.fn(() => { order.push('schema'); return z.strictObject({ selected: z.literal('heat') }); });
    await expect(a.llm.generate({ ...ask(read), schema: resolve }, o)).resolves.toEqual({ selected: 'heat' });
    expect(order).toEqual(['audit', 'read', 'schema', 'audit']);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(a.requests[0].json).not.toHaveProperty('text');
    expect(a.requests[1].json).toMatchObject({ text: { format: { schema: {
      properties: { selected: { const: 'heat' } }, required: ['selected'], additionalProperties: false,
    } } } });
  });

  it('audits the read round then stops if a final-schema factory fails, without leaking its error', async () => {
    const read = tool(); const a = agent(retrieval()); const o = options();
    const resolve = vi.fn((): typeof Answer => { throw new Error('TEST_SECRET factory failed'); });
    await expect(a.llm.generate({ ...ask(read), schema: resolve }, o))
      .rejects.toThrow('Responses final schema resolution failed');
    expect(o.onResponse).toHaveBeenCalledTimes(1); expect(read.execute).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1); expect(a.requests).toHaveLength(1);
  });

  it('does not resolve a final schema when the required audit or tool read fails', async () => {
    for (const failure of ['audit', 'read'] as const) {
      const a = agent(retrieval()); const o = options(); const read = tool(); const resolve = vi.fn(() => Answer);
      if (failure === 'audit') o.onResponse.mockRejectedValue(new ModelAuditError());
      else read.execute.mockRejectedValue(new ModelAuditError());
      await expect(a.llm.generate({ ...ask(read), schema: resolve }, o)).rejects.toBeInstanceOf(ModelAuditError);
      expect(resolve).not.toHaveBeenCalled(); expect(a.requests).toHaveLength(1);
    }
  });

  it('rejects invalid resolved schemas or schema conversion before making a final request', async () => {
    for (const resolve of [() => null as never, () => z.string().transform((value) => value.length)]) {
      const a = agent(retrieval());
      await expect(a.llm.generate({ ...ask(), schema: resolve }, options()))
        .rejects.toThrow('Responses final schema resolution failed');
      expect(a.requests).toHaveLength(1);
    }
  });

  it('uses the resolved schema rather than an earlier contract and cancels after resolution', async () => {
    const a = agent(retrieval(), final());
    await expect(a.llm.generate({ ...ask(), schema: () => z.strictObject({ selected: z.literal('heat') }) }, options()))
      .rejects.toThrow('Responses final output failed schema validation');
    const cancelled = agent(retrieval()); const controller = new AbortController();
    const resolve = vi.fn(() => { controller.abort(); return Answer; });
    await expect(cancelled.llm.generate({ ...ask(), schema: resolve }, { ...options(), signal: controller.signal }))
      .rejects.toThrow();
    expect(resolve).toHaveBeenCalledTimes(1); expect(cancelled.requests).toHaveLength(1);
  });

  it.each(['default', 'fast'] as const)('explicitly requests %s in both rounds without changing global defaults', async (serviceTier) => {
    const a = agent(retrieval(), final());
    await a.llm.generate(ask(), { ...options(), serviceTier });
    expect(a.requests.map((request) => request.json.service_tier)).toEqual([serviceTier, serviceTier]);
    const unconfigured = agent(retrieval(), final()); await unconfigured.llm.generate(ask(), options());
    expect(unconfigured.requests.every((request) => !('service_tier' in request.json))).toBe(true);
  });

  it('records requested fast and actual default/priority independently using only allowlisted metadata', async () => {
    const a = agent({ ...retrieval(), service_tier: 'default' }, { ...final(), service_tier: 'priority' });
    const events: ModelDiagnostic[] = [];
    await a.llm.generate(ask(), { ...options(), serviceTier: 'fast', onDiagnostic: (event) => { events.push(event); } });
    expect(events.every((event) => event.requestedServiceTier === 'fast')).toBe(true);
    expect(events.filter((event) => event.stage === 'response_body')).toMatchObject([
      { request: 1, requestedServiceTier: 'fast', actualServiceTier: 'default' },
      { request: 2, requestedServiceTier: 'fast', actualServiceTier: 'priority' },
    ]);
    const unknown = agent({ ...retrieval(), service_tier: 'TEST_SECRET tier' }, final()); const rejected: ModelDiagnostic[] = [];
    await unknown.llm.generate(ask(), { ...options(), onDiagnostic: (event) => { rejected.push(event); } });
    expect(rejected.every((event) => event.requestedServiceTier == null && event.actualServiceTier == null)).toBe(true);
    expect(JSON.stringify(rejected)).not.toContain('TEST_SECRET');
  });

  it.each(['auto', 'priority', 'flex', 'TEST_SECRET'])('rejects unsupported requested service tier %s before dispatch', async (serviceTier) => {
    const a = agent();
    await expect(a.llm.generate(ask(), { ...options(), serviceTier: serviceTier as never })).rejects.toThrow('service tier must be default or fast');
    expect(a.requests).toHaveLength(0);
  });

  it('audits both full replies, executes once and statelessly replays every ordered opaque output item', async () => {
    const read = tool(); const a = agent(retrieval(), final()); const o = options();
    const order: string[] = [];
    o.onResponse.mockImplementation(async () => { await Promise.resolve(); order.push('audit'); });
    read.execute.mockImplementation(async () => { order.push('read'); return 'snapshot result'; });
    await expect(a.llm.generate(ask(read), o)).resolves.toEqual({ answer: 'valid' });
    expect(order).toEqual(['audit', 'read', 'audit']);
    expect(read.execute).toHaveBeenCalledExactlyOnceWith({ slugs: ['heat'] }, 'call_1');
    expect(o.onResponse.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual([retrieval(), final()]);
    expect(a.requests.map((request) => request.url)).toEqual(['https://api.test/v1/responses', 'https://api.test/v1/responses']);
    const first = a.requests[0].json; const second = a.requests[1].json;
    expect(first).toMatchObject({ model: 'gpt-6-luna', reasoning: { effort: 'medium' }, store: false,
      include: ['reasoning.encrypted_content'], truncation: 'disabled', parallel_tool_calls: false,
      max_output_tokens: 2_000, tool_choice: { type: 'function', name: 'get_playbooks' },
      tools: [{ type: 'function', name: 'get_playbooks', strict: true, parameters: { additionalProperties: false } }] });
    expect(first).not.toHaveProperty('text');
    expect(second).toMatchObject({ store: false, reasoning: { effort: 'medium' }, max_output_tokens: 12_000,
      tool_choice: 'none', text: { verbosity: 'low', format: { type: 'json_schema', name: 'output', strict: true } } });
    expect(second).not.toHaveProperty('tools'); expect(second).not.toHaveProperty('previous_response_id');
    expect(second.input).toEqual([
      { role: 'system', content: 'Test safety rules' }, { role: 'user', content: 'Test immutable snapshot' },
      reasoning, call, { type: 'function_call_output', call_id: 'call_1', output: 'snapshot result' },
    ]);
  });

  it.each([
    ['zero calls', retrieval([])],
    ['multiple calls', retrieval([reasoning, call, { ...call, call_id: 'call_2' }])],
    ['wrong tool', retrieval([{ ...call, name: 'approve_mobilization' }])],
    ['missing call_id', retrieval([{ ...call, call_id: undefined }])],
    ['blank call_id', retrieval([{ ...call, call_id: ' ' }])],
    ['non-JSON arguments', retrieval([{ ...call, arguments: 'not json' }])],
    ['unknown slug', retrieval([{ ...call, arguments: '{"slugs":["invented"]}' }])],
    ['extra argument', retrieval([{ ...call, arguments: '{"slugs":["heat"],"approve":true}' }])],
    ['incomplete call', retrieval([{ ...call, status: 'in_progress' }])],
    ['unsupported action', retrieval([call, { type: 'computer_call' }])],
    ['refusal', retrieval([call, { type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }])],
    ['incomplete response', { ...retrieval(), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }],
    ['failed response', { ...retrieval(), status: 'failed', error: { message: 'untrusted' } }],
  ])('audits then rejects %s before any execution or second request', async (_name, body) => {
    const a = agent(body); const read = tool(); const o = options();
    await expect(a.llm.generate(ask(read), o)).rejects.toThrow();
    expect(read.execute).not.toHaveBeenCalled(); expect(a.requests).toHaveLength(1);
    expect(o.onResponse).toHaveBeenCalledTimes(1);
  });

  it('never executes a tool or exposes a raw observer error when the first audit fails', async () => {
    const a = agent(retrieval()); const read = tool(); const o = options();
    o.onResponse.mockRejectedValue(new Error('TEST_SECRET storage failed'));
    await expect(a.llm.generate(ask(read), o)).rejects.toEqual(new ModelAuditError());
    expect(read.execute).not.toHaveBeenCalled(); expect(a.requests).toHaveLength(1);
  });

  it('cannot return a final reply when its mandatory audit fails', async () => {
    const a = agent(retrieval(), final()); const o = options();
    o.onResponse.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('TEST_SECRET'));
    await expect(a.llm.generate(ask(), o)).rejects.toEqual(new ModelAuditError());
    expect(a.requests).toHaveLength(2);
  });

  it('does not continue after the immutable tool execution or its audit fails', async () => {
    const a = agent(retrieval()); const read = tool();
    read.execute.mockRejectedValue(new ModelAuditError());
    await expect(a.llm.generate(ask(read), options())).rejects.toBeInstanceOf(ModelAuditError);
    expect(a.requests).toHaveLength(1);
  });

  it.each([
    ['tool in final round', retrieval([call])],
    ['non-JSON final reply', final('not json')],
    ['schema-invalid final reply', final('{"answer":1}')],
    ['empty final reply', final('')],
    ['final refusal', { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No' }] }] }],
    ['incomplete final response', { ...final(), status: 'incomplete' }],
  ])('audits then rejects %s without retrying or granting another tool round', async (_name, body) => {
    const a = agent(retrieval(), body); const read = tool(); const o = options();
    await expect(a.llm.generate(ask(read), o)).rejects.toThrow();
    expect(read.execute).toHaveBeenCalledTimes(1); expect(a.requests).toHaveLength(2);
    expect(o.onResponse).toHaveBeenCalledTimes(2);
  });

  it('checks cancellation after first audit and before read execution', async () => {
    const a = agent(retrieval()); const read = tool(); const o = options(); const cancel = new AbortController();
    o.onResponse.mockImplementation(async () => { cancel.abort(); });
    await expect(a.llm.generate(ask(read), { ...o, signal: cancel.signal })).rejects.toThrow();
    expect(read.execute).not.toHaveBeenCalled(); expect(a.requests).toHaveLength(1);
  });

  it('checks cancellation after a completed read before requesting the final response', async () => {
    const a = agent(retrieval()); const read = tool(); const cancel = new AbortController();
    read.execute.mockImplementation(async () => { cancel.abort(); return 'audited result'; });
    await expect(a.llm.generate(ask(read), { ...options(), signal: cancel.signal })).rejects.toThrow();
    expect(a.requests).toHaveLength(1);
  });

  it.each([1, 2])('redacts a broken round-%s response body without partial audit, retry, schema resolution or return', async (failedRound) => {
    const requestId = 'req_0123456789abcdef';
    const partialBody = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"TEST_SECRET":"partial provider body"'));
      controller.error(new TypeError('TEST_SECRET socket closed at https://private.test/key'));
    } });
    const broken = new Response(partialBody, { status: 200, headers: { 'x-request-id': requestId } });
    const fetch = vi.fn<typeof globalThis.fetch>();
    if (failedRound === 2) fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...retrieval(), service_tier: 'fast' })));
    fetch.mockResolvedValueOnce(broken);
    const llm = new ReadToolResponses({ baseUrl: 'https://provider.test/v1', fetch, model: 'gpt-6-luna', apiKey: 'test-only' });
    const o = options(); const read = tool(); const resolve = vi.fn(() => Answer); const events: ModelDiagnostic[] = [];
    const error = await llm.generate({ ...ask(read), schema: resolve }, { ...o, serviceTier: 'fast',
      onDiagnostic: (event) => { events.push(event); } }).catch((failure) => failure);
    expect(error).toEqual(new ModelTransportError());
    expect(String(error)).not.toContain('TEST_SECRET');
    expect(o.onResponse).toHaveBeenCalledTimes(failedRound - 1);
    expect(read.execute).toHaveBeenCalledTimes(failedRound - 1);
    expect(resolve).toHaveBeenCalledTimes(failedRound - 1);
    expect(fetch).toHaveBeenCalledTimes(failedRound);
    expect(events.filter((event) => event.stage === 'transport_error')).toMatchObject([{ request: failedRound, attempt: 1,
      phase: 'response_body', status: 200, requestId, requestedServiceTier: 'fast' }]);
    expect(events.find((event) => event.stage === 'transport_error')).not.toHaveProperty('actualServiceTier');
    expect(events.filter((event) => event.stage === 'request_start')).toHaveLength(failedRound);
    expect(events.some((event) => ['retry_wait', 'repair', 'complete'].includes(event.stage))).toBe(false);
    if (failedRound === 2) expect(events.find((event) => event.stage === 'response_body')).toMatchObject({
      request: 1, actualServiceTier: 'fast',
    });
    expect(JSON.stringify(events)).not.toMatch(/TEST_SECRET|partial|socket|private\.test/);
  });

  it.each([1, 2])('preserves cancellation over a simultaneous round-%s body failure and removes its listener', async (failedRound) => {
    const cancel = new AbortController(); const reason = new DOMException('Bounded request cancelled', 'AbortError');
    const response = new Response('{}', { status: 200, headers: { 'x-request-id': 'req_abcdef0123456789' } });
    const text = vi.spyOn(response, 'text').mockImplementation(async () => {
      cancel.abort(reason); throw new TypeError('TEST_SECRET socket error during cancellation');
    });
    const fetch = vi.fn<typeof globalThis.fetch>();
    if (failedRound === 2) fetch.mockResolvedValueOnce(new Response(JSON.stringify(retrieval())));
    fetch.mockResolvedValueOnce(response);
    const remove = vi.spyOn(cancel.signal, 'removeEventListener');
    const llm = new ReadToolResponses({ baseUrl: 'https://provider.test/v1', fetch, model: 'gpt-6-luna', apiKey: 'test-only' });
    const o = options(); const read = tool(); const events: ModelDiagnostic[] = [];
    await expect(llm.generate(ask(read), { ...o, signal: cancel.signal,
      onDiagnostic: (event) => { events.push(event); } })).rejects.toBe(reason);
    expect(events.filter((event) => event.stage === 'cancelled')).toMatchObject([{ request: failedRound, attempt: 1,
      phase: 'response_body', status: 200, requestId: 'req_abcdef0123456789' }]);
    expect(events.some((event) => ['transport_error', 'retry_wait', 'repair', 'complete'].includes(event.stage))).toBe(false);
    expect(text).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(failedRound);
    expect(o.onResponse).toHaveBeenCalledTimes(failedRound - 1); expect(read.execute).toHaveBeenCalledTimes(failedRound - 1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(JSON.stringify(events)).not.toContain('TEST_SECRET');
  });

  it('does not begin reading or auditing the body if cancellation happened as headers arrived', async () => {
    const cancel = new AbortController(); const reason = new DOMException('Header-stage cancellation', 'AbortError');
    const response = new Response(JSON.stringify(retrieval())); const text = vi.spyOn(response, 'text');
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response);
    const llm = new ReadToolResponses({ baseUrl: 'https://provider.test/v1', fetch, model: 'gpt-6-luna', apiKey: 'test-only' });
    const o = options(); const read = tool(); const events: ModelDiagnostic[] = [];
    await expect(llm.generate(ask(read), { ...o, signal: cancel.signal, onDiagnostic: (event) => {
      events.push(event); if (event.stage === 'response_headers') cancel.abort(reason);
    } })).rejects.toBe(reason);
    expect(text).not.toHaveBeenCalled(); expect(o.onResponse).not.toHaveBeenCalled(); expect(read.execute).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.stage === 'cancelled' && event.phase === 'response_body'))
      .toMatchObject([{ request: 1, attempt: 1, status: 200 }]);
    expect(events.some((event) => ['transport_error', 'repair', 'retry_wait', 'complete'].includes(event.stage))).toBe(false);
  });

  it('uses numeric Responses usage without exposing arbitrary content through optional diagnostics', async () => {
    const usage = { input_tokens: 123, input_tokens_details: { cached_tokens: 100 }, output_tokens: 45,
      output_tokens_details: { reasoning_tokens: 12 }, echoed_key: 'TEST_SECRET' };
    const a = agent({ ...retrieval(), usage }, { ...final(), usage }); const events: ModelDiagnostic[] = [];
    await expect(a.llm.generate(ask(), { ...options(), onDiagnostic: (event) => {
      events.push(event); throw new Error('TEST_SECRET observer');
    } })).resolves.toEqual({ answer: 'valid' });
    expect(events.filter((event) => event.stage === 'response_body')).toMatchObject([
      { request: 1, attempt: 1, usage: { inputTokens: 123, outputTokens: 45, reasoningTokens: 12, cachedInputTokens: 100 } },
      { request: 2, attempt: 1, usage: { inputTokens: 123, outputTokens: 45, reasoningTokens: 12, cachedInputTokens: 100 } },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/TEST_SECRET|opaque|api\.test|playbooks/);
  });

  it.each([0, 31, 16_001, 12.5, NaN])('rejects invalid token budgets (%s) before fetching', async (budget) => {
    const a = agent(); await expect(a.llm.generate(ask(), { ...options(), toolMaxTokens: budget })).rejects.toThrow(/token budget/);
    expect(a.requests).toHaveLength(0);
  });
});

describe('single-round strict Responses experiment seam', () => {
  it('uses one no-tool, low-verbosity strict-schema request with an audited raw envelope', async () => {
    const a = agent({ ...final(), service_tier: 'fast' }); const o = options(); const events: ModelDiagnostic[] = [];
    await expect(a.llm.generateStrict({ system: 'Test', prompt: 'Snapshot', schema: Answer }, {
      ...o, serviceTier: 'fast', maxTokens: 2_000, onDiagnostic: (event) => { events.push(event); },
    })).resolves.toEqual({ answer: 'valid' });
    expect(a.requests).toHaveLength(1); expect(o.onResponse).toHaveBeenCalledTimes(1);
    expect(a.requests[0].json).toMatchObject({ model: 'gpt-6-luna', reasoning: { effort: 'medium' },
      service_tier: 'fast', store: false, max_output_tokens: 2_000, tool_choice: 'none', truncation: 'disabled',
      text: { verbosity: 'low', format: { type: 'json_schema', name: 'output', strict: true } } });
    expect(a.requests[0].json).not.toHaveProperty('tools');
    expect(events.find((event) => event.stage === 'response_body')).toMatchObject({
      request: 1, requestedServiceTier: 'fast', actualServiceTier: 'fast',
    });
  });

  it.each([
    ['tool call', retrieval([call])],
    ['unknown action', retrieval([{ type: 'computer_call' }])],
    ['refusal', { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] }],
    ['incomplete', { ...final(), status: 'incomplete' }],
    ['bad schema', final('{"answer":123}')],
    ['bad JSON', final('invalid')],
    ['empty reply', final('')],
    ['wrong speaker', { status: 'completed', output: [{ type: 'message', role: 'user', content: [{ type: 'output_text', text: '{"answer":"bad"}' }] }] }],
  ])('audits %s then fails closed without a repair or another model call', async (_name, reply) => {
    const a = agent(reply); const o = options();
    await expect(a.llm.generateStrict({ system: 'Test', prompt: 'Test', schema: Answer }, o)).rejects.toThrow();
    expect(o.onResponse).toHaveBeenCalledTimes(1); expect(a.requests).toHaveLength(1);
  });

  it('does not return a valid final response if raw audit fails', async () => {
    const a = agent(final()); const o = options(); o.onResponse.mockRejectedValue(new Error('TEST_SECRET'));
    await expect(a.llm.generateStrict({ system: 'Test', prompt: 'Test', schema: Answer }, o)).rejects.toEqual(new ModelAuditError());
    expect(a.requests).toHaveLength(1);
  });

  it('rejects missing raw-audit callback, invalid token budget and invalid tier before fetching', async () => {
    const a = agent(); const input = { system: 'Test', prompt: 'Test', schema: Answer };
    await expect(a.llm.generateStrict(input, { ...options(), onResponse: undefined as never })).rejects.toEqual(new ModelAuditError());
    await expect(a.llm.generateStrict(input, { ...options(), maxTokens: 1 })).rejects.toThrow(/token budget/);
    await expect(a.llm.generateStrict(input, { ...options(), serviceTier: 'priority' as never })).rejects.toThrow(/service tier/);
    expect(a.requests).toHaveLength(0);
  });

  it('does not return output after cancellation during the raw audit', async () => {
    const a = agent(final()); const o = options(); const cancel = new AbortController();
    o.onResponse.mockImplementation(async () => { cancel.abort(); });
    await expect(a.llm.generateStrict({ system: 'Test', prompt: 'Test', schema: Answer }, { ...o, signal: cancel.signal })).rejects.toThrow();
    expect(a.requests).toHaveLength(1);
  });
});

const keys = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_REASONING_EFFORT', 'OPENROUTER_API_KEY',
  'TYPESAFE_BASE_URL', 'TYPESAFE_API_KEY', 'OPENAI_API_KEY', 'MODEL_PROVIDER', 'SPARK_BASE_URL', 'SPARK_API_KEY',
  'MOBILIZATION_MODEL', 'MOBILIZATION_SERVICE_TIER', 'MOBILIZATION_REASONING_EFFORT'];
beforeEach(() => { for (const key of keys) vi.stubEnv(key, undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const auditedOptions = () => ({ maxTokens: 12_000, timeoutMs: 60_000, onAttempt: vi.fn(async () => {}), onResponse: vi.fn(async () => {}) });
const configured = () => {
  vi.stubEnv('LLM_BASE_URL', 'https://api.openai.com/v1'); vi.stubEnv('LLM_API_KEY', 'test-key');
  vi.stubEnv('LLM_MODEL', 'gpt-6-luna'); vi.stubEnv('LLM_REASONING_EFFORT', 'medium');
};

describe('scoped read-tool facade', () => {
  it('preserves configured model and medium, and records one provider attempt around both rounds', async () => {
    configured(); const fake = fakeHttp({ json: retrieval() }, { json: final() }); vi.stubGlobal('fetch', fake.fetch);
    const o = auditedOptions(); await expect(generateWithReadTool(ask(), o)).resolves.toEqual({ answer: 'valid' });
    expect(o.onAttempt).toHaveBeenCalledExactlyOnceWith({ provider: 'configured', model: 'gpt-6-luna' });
    expect(o.onResponse).toHaveBeenCalledTimes(2);
    expect(fake.requests.every((request) => request.json.model === 'gpt-6-luna' && request.json.reasoning.effort === 'medium')).toBe(true);
  });

  it('requires mandatory attempt and raw-response audit callbacks before dispatch', async () => {
    configured(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(generateWithReadTool(ask(), {})).rejects.toBeInstanceOf(ModelAuditError);
    await expect(generateWithReadTool(ask(), { onAttempt: async () => {} })).rejects.toBeInstanceOf(ModelAuditError);
    await expect(generateWithReadTool(ask(), { onResponse: async () => {} })).rejects.toBeInstanceOf(ModelAuditError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('has no Chat Completions downgrade when configured Responses is unsupported', async () => {
    configured(); const fake = fakeHttp({ status: 404 }); vi.stubGlobal('fetch', fake.fetch); const read = tool();
    await expect(generateWithReadTool(ask(read), auditedOptions())).rejects.toThrow(/HTTP 404/);
    expect(fake.requests).toHaveLength(1); expect(fake.requests[0].url).toBe('https://api.openai.com/v1/responses');
    expect(read.execute).not.toHaveBeenCalled();
  });

  it('aborts the same whole-call signal without any retrieval execution or next round', async () => {
    configured(); const read = tool(); let aborted = false;
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { aborted = true; reject(init!.signal!.reason); }, { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    await expect(generateWithReadTool(ask(read), { ...auditedOptions(), signal: AbortSignal.timeout(10) })).rejects.toThrow();
    expect(aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(1); expect(read.execute).not.toHaveBeenCalled();
  });

  it('cannot bypass a failed mandatory provider-attempt audit', async () => {
    configured(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const o = auditedOptions();
    o.onAttempt.mockRejectedValue(new Error('TEST_SECRET'));
    await expect(generateWithReadTool(ask(), o)).rejects.toEqual(new ModelAuditError());
    expect(fetch).not.toHaveBeenCalled();
  });
});
