import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Task } from '@/lib/schema';
import { ModelAuditError, ModelHttpError } from './errors';
import { callTool, chatModelReadiness, generate } from './index';
import { SparkInterpreter } from './interpreter';
import { LunaLlm } from './luna';
import { chatProviders, hasOpenAi, onSpark, serverModelReady, spark } from './providers';

const keys = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_REASONING_EFFORT', 'OPENROUTER_API_KEY',
  'TYPESAFE_BASE_URL', 'TYPESAFE_API_KEY', 'OPENAI_API_KEY', 'MODEL_PROVIDER', 'SPARK_BASE_URL', 'SPARK_API_KEY'];
const Answer = z.object({ answer: z.string() });
const ask = { system: 'Test only', prompt: 'Test only', schema: Answer };
const reply = (content = '{"answer":"valid"}', extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, ...extra }] }), { status: 200 });

beforeEach(() => { for (const key of keys) vi.stubEnv(key, undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('shared structured model facade (offline HTTP only)', () => {
  it('fails before fetch when there is no configured provider', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(chatModelReadiness().ready).toBe(false);
    await expect(generate(ask)).rejects.toThrow(/configuration required/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves explicit Sol/medium settings and awaits auditable replies before returning', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.openai.com/v1');
    vi.stubEnv('LLM_API_KEY', 'test-only'); vi.stubEnv('LLM_MODEL', 'gpt-6.1-sol');
    vi.stubEnv('LLM_REASONING_EFFORT', 'medium');
    const events: string[] = []; const bodies: any[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, options: RequestInit) => {
      events.push('fetch'); bodies.push(JSON.parse(String(options.body))); return reply();
    });
    const value = await generate(ask, { maxTokens: 12_000, timeoutMs: 60_000,
      onAttempt: async (identity) => { events.push(`attempt:${identity.provider}:${identity.model}`); },
      onResponse: async (text, identity) => { await Promise.resolve(); events.push(`reply:${identity.model}:${text}`); },
    });
    expect(value).toEqual({ answer: 'valid' });
    expect(events).toEqual(['attempt:configured:gpt-6.1-sol', 'fetch', 'reply:gpt-6.1-sol:{"answer":"valid"}']);
    expect(bodies[0]).toMatchObject({ model: 'gpt-6.1-sol', reasoning_effort: 'medium', max_completion_tokens: 12_000 });
    expect(bodies[0]).not.toHaveProperty('max_tokens');
  });

  it('adds provider identity to optional diagnostics without weakening mandatory reply audits', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.openai.com/v1'); vi.stubEnv('LLM_API_KEY', 'test-only');
    vi.stubEnv('LLM_MODEL', 'gpt-6.1-sol'); vi.stubEnv('LLM_REASONING_EFFORT', 'medium');
    vi.stubGlobal('fetch', vi.fn(async () => reply()));
    const stages: string[] = [];
    await expect(generate(ask, { onDiagnostic: (event, identity) => {
      stages.push(`${identity.provider}:${identity.model}:${event.stage}`);
      throw new Error('TEST_SECRET diagnostic observer');
    } })).resolves.toEqual({ answer: 'valid' });
    expect(stages).toEqual(['request_start', 'response_headers', 'response_body', 'complete'].map((stage) => `configured:gpt-6.1-sol:${stage}`));
    await expect(generate(ask, { onDiagnostic: () => Promise.reject(new Error('TEST_SECRET diagnostic observer')),
      onResponse: () => { throw new Error('mandatory storage failed'); } })).rejects.toBeInstanceOf(ModelAuditError);
  });

  it('reads changed explicit configuration for the next call instead of caching stale env/fetch', async () => {
    vi.stubEnv('LLM_BASE_URL', 'http://127.0.0.1:9999/v1'); vi.stubEnv('LLM_MODEL', 'first');
    const models: string[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, options: RequestInit) => { models.push(JSON.parse(String(options.body)).model); return reply(); });
    await generate(ask); vi.stubEnv('LLM_MODEL', 'second'); await generate(ask);
    expect(models).toEqual(['first', 'second']);
  });

  it('defaults to canonical OpenAI Luna and keeps tool calls independent of structured Sol overrides', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    expect(chatModelReadiness()).toMatchObject({ ready: true, model: 'gpt-6-luna' });
    vi.stubEnv('LLM_BASE_URL', 'https://api.openai.com/v1'); vi.stubEnv('LLM_MODEL', 'gpt-6.1-sol');
    vi.stubEnv('LLM_REASONING_EFFORT', 'medium');
    const bodies: any[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, options: RequestInit) => { bodies.push(JSON.parse(String(options.body))); return reply('A tool-free reply'); });
    await expect(callTool({ system: 'Test', prompt: 'Test', tools: [] })).resolves.toEqual({ text: 'A tool-free reply' });
    expect(bodies[0]).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'none' });
  });

  it('uses OpenAI-only structured chat even when Spark handles typed decisions', async () => {
    vi.stubEnv('MODEL_PROVIDER', 'spark'); vi.stubEnv('SPARK_API_KEY', 'test-only');
    vi.stubEnv('SPARK_BASE_URL', 'https://spark.test/v1'); vi.stubEnv('OPENAI_API_KEY', 'test-only');
    const attempts: string[] = []; const replies: string[] = []; let sparkCalls = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('https://spark.test')) { sparkCalls++; return reply('not JSON'); }
      return reply();
    });
    await expect(generate(ask, { onAttempt: (identity) => { attempts.push(`${identity.provider}:${identity.model}`); },
      onResponse: (content, identity) => { replies.push(`${identity.provider}:${content}`); } })).resolves.toEqual({ answer: 'valid' });
    expect(onSpark()).toBe(true);
    expect(sparkCalls).toBe(0);
    expect(chatProviders()).toMatchObject([{ provider: 'openai', model: 'gpt-6-luna' }]);
    expect(attempts).toEqual(['openai:gpt-6-luna']);
    expect(replies).toEqual(['openai:{"answer":"valid"}']);
  });

  it('does not bypass a failed audit by trying another provider', async () => {
    vi.stubEnv('MODEL_PROVIDER', 'spark'); vi.stubEnv('SPARK_API_KEY', 'test-only');
    vi.stubEnv('SPARK_BASE_URL', 'https://spark.test/v1'); vi.stubEnv('OPENAI_API_KEY', 'test-only');
    const fetch = vi.fn(async () => reply()); vi.stubGlobal('fetch', fetch);
    await expect(generate(ask, { onResponse: () => { throw new Error('storage failed'); } })).rejects.toBeInstanceOf(ModelAuditError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('captures an actual late canceled reply as evidence without using it as the result', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://configured.test/v1'); vi.stubEnv('LLM_API_KEY', 'test-only');
    vi.stubEnv('LLM_MODEL', 'late-test');
    let release: (() => void) | undefined; let capturedLate: (() => void) | undefined;
    const late = new Promise<void>((resolve) => { capturedLate = resolve; });
    const captures: string[] = [];
    const fetch = vi.fn(async () => new Promise<Response>((resolve) => { release = () => resolve(reply('{"answer":"late actual reply"}')); }));
    vi.stubGlobal('fetch', fetch);
    const pending = generate(ask, { timeoutMs: 10, onResponse: (content, identity) => {
      captures.push(`${identity.provider}:${content}`); capturedLate!();
    } });
    await expect(pending).rejects.toThrow('configured:late-test timed out after 10 ms');
    release!(); await late;
    expect(captures).toEqual(['configured:{"answer":"late actual reply"}']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stores only HTTP status in provider errors, never the body or endpoint', async () => {
    const llm = new LunaLlm({ baseUrl: 'https://provider.test/v1', apiKey: 'test-only',
      fetch: async () => new Response('provider echoed TEST_SECRET', { status: 401 }) });
    await expect(llm.generate(ask)).rejects.toEqual(new ModelHttpError(401));
    await expect(llm.generate(ask)).rejects.not.toThrow(/TEST_SECRET|provider\.test/);
  });

  it.each(['refusal', 'length'] as const)('captures a %s before failing closed without fake JSON repair', async (failure) => {
    const captured: string[] = [];
    const fetch = vi.fn(async () => failure === 'length' ? reply('{"answer":', { finish_reason: 'length' })
      : new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: 'Cannot comply' } }] }), { status: 200 }));
    const llm = new LunaLlm({ baseUrl: 'https://provider.test/v1', apiKey: 'test-only', fetch });
    await expect(llm.generate({ ...ask, onResponse: (text) => { captured.push(text); } })).rejects.toThrow(/refused|token limit/);
    expect(captured).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('honors a longer per-call timeout override and the bounded whole-call signal', async () => {
    vi.stubEnv('LLM_BASE_URL', 'http://127.0.0.1:9999/v1');
    let aborted = false;
    vi.stubGlobal('fetch', async (_url: unknown, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => { aborted = true; reject(options.signal!.reason); }, { once: true });
    }));
    await expect(generate(ask, { timeoutMs: 60_000, signal: AbortSignal.timeout(10) })).rejects.toThrow();
    expect(aborted).toBe(true);
  });

  it('keeps legacy Spark endpoint/key aliases centralized and rejects embedded URL credentials', () => {
    vi.stubEnv('TYPESAFE_BASE_URL', 'https://legacy.test'); vi.stubEnv('TYPESAFE_API_KEY', 'test-only');
    expect(spark()).toMatchObject({ baseUrl: 'https://legacy.test/v1', apiKey: 'test-only' });
    expect(onSpark()).toBe(true);
    expect(chatProviders()).toEqual([]);
    vi.stubEnv('LLM_BASE_URL', 'https://name:password@provider.test/v1');
    expect(chatModelReadiness().ready).toBe(false);
  });

  it('permits a configured-chat-only server without copying its key into intake or speech', () => {
    expect(serverModelReady()).toBe(false);
    vi.stubEnv('LLM_BASE_URL', 'https://api.openai.com/v1');
    expect(serverModelReady()).toBe(false);
    vi.stubEnv('LLM_API_KEY', 'test-only'); vi.stubEnv('LLM_MODEL', 'gpt-6.1-sol');
    vi.stubEnv('LLM_REASONING_EFFORT', 'medium');
    expect(serverModelReady()).toBe(true);
    expect(chatModelReadiness()).toMatchObject({ ready: true, model: 'gpt-6.1-sol' });
    expect(hasOpenAi()).toBe(false); expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(onSpark()).toBe(false);
  });
});

describe('multi-person interpretation (offline decisions)', () => {
  const task = (helperStatus: 'notified' | 'accepted'): Task => ({
    id: 'task', title: 'Assess heat symptoms', summary: 'Known heat concern', category: 'heat', priority: 'P2', teamSlug: 'first-aid',
    zoneSlug: null, locationHint: null, status: 'accepted', assigneeId: 'owner', reporter: { kind: 'system', quote: 'Test', language: 'en' },
    handledBy: 'human', createdAt: 0, assignedAt: 0, etaAt: null, lastActivityAt: 0, nudgeCount: 0, lastNudgeAt: null,
    leadAlertedAt: null, resolvedAt: null, escalation: null, requiredCount: 2,
    helpers: [{ volunteerId: 'helper', status: helperStatus, assignedAt: 0, respondedAt: null }],
    resolution: null, requestId: null, mobilizationId: null,
  });
  it.each(['accept', 'decline'] as const)('lets a notified helper %s independently of the accepted owner', async (kind) => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ answers: [{ type: 'choice', name: 'kind', choice: kind,
      probabilities: [{ value: kind, probability: 0.99 }], confidence: 0.99 }] }), { status: 200 }));
    const result = await new SparkInterpreter().interpret({ tasks: [task('notified')], meId: 'helper', text: kind === 'accept' ? 'on my way' : "I cannot take it" });
    expect(result.intent).toEqual({ kind: 'reply', taskId: 'task', reply: kind });
  });

  it.each([
    ['notified', 'done', 'report'], ['accepted', 'accept', 'report'],
    ['accepted', 'done', 'reply'], ['accepted', 'need_help', 'report'],
  ] as const)('keeps a %s helper reply %s within their assignment permissions', async (status, kind, intentKind) => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ answers: [{ type: 'choice', name: 'kind', choice: kind,
      probabilities: [{ value: kind, probability: 0.99 }], confidence: 0.99 }] }), { status: 200 }));
    const result = await new SparkInterpreter().interpret({ tasks: [task(status)], meId: 'helper', text: kind });
    expect(result.intent.kind).toBe(intentKind);
    if (intentKind === 'reply') expect(result.intent).toEqual({ kind: 'reply', taskId: 'task', reply: kind });
  });
});
