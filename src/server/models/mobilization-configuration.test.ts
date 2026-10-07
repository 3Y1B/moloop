import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ModelAuditError, ModelHttpError } from './errors';
import { fakeHttp } from './fake-http';
import { callTool, chatModelReadiness, generate, generateWithReadTool, mobilizationModelId, mobilizationModelReadiness } from './index';
import { MobilizationModelConfigurationError, resolveMobilizationModelConfiguration } from './mobilization-configuration';
import type { ModelDiagnostic } from './http';
import type { ChatProvider, ModelIdentity } from './providers';

const base = () => ({
  readiness: { ready: true, model: 'gpt-6-luna', missing: [] as string[] },
  providers: [{ provider: 'configured', model: 'gpt-6-luna', reasoningEffort: 'medium',
    baseUrl: 'https://api.test/v1', apiKey: 'test-only' }] as ChatProvider[],
});

describe('pure Mobilization configuration scope', () => {
  it('inherits current model and project tier policy, defaults reasoning to medium without mutation', () => {
    const input = base();
    const saved = structuredClone(input);
    const selected = resolveMobilizationModelConfiguration(input, {});
    expect(selected.readiness).toEqual({ ...input.readiness, reasoningEffort: 'medium' });
    expect(selected.providers).toEqual(input.providers);
    expect(selected.providers[0]).not.toHaveProperty('serviceTier');
    expect(selected.providers[0]).not.toBe(input.providers[0]);
    expect(input).toEqual(saved);
  });

  it('overrides only model and service tier, preserving endpoint, credentials, provider and medium', () => {
    const input = base();
    const selected = resolveMobilizationModelConfiguration(input, {
      MOBILIZATION_MODEL: ' gpt-6-sol ', MOBILIZATION_SERVICE_TIER: ' fast ',
    });
    expect(selected.providers).toEqual([{ ...input.providers[0], model: 'gpt-6-sol', serviceTier: 'fast' }]);
    expect(selected.readiness).toEqual({ ready: true, model: 'gpt-6-sol', serviceTier: 'fast', reasoningEffort: 'medium', missing: [] });
    expect(input.providers[0].model).toBe('gpt-6-luna');
    expect(input.providers[0]).not.toHaveProperty('serviceTier');
  });

  it.each(['gpt-6-sol', 'openai/gpt-6-sol', 'qwen3.5:4b', 'local_model-2026', 'a'.repeat(128)])(
    'preserves valid explicit model identifiers exactly: %s', (model) => {
      expect(resolveMobilizationModelConfiguration(base(), { MOBILIZATION_MODEL: model }).providers[0].model).toBe(model);
    });

  it.each(['', ' ', 'gpt-6 sol', 'gpt\n6-sol', '"gpt-6-sol"', 'a'.repeat(129), 'TEST_SECRET token'])(
    'rejects malformed explicit model identifiers without fallback or value echo', (model) => {
      expect(() => resolveMobilizationModelConfiguration(base(), { MOBILIZATION_MODEL: model })).toThrow(MobilizationModelConfigurationError);
      try { resolveMobilizationModelConfiguration(base(), { MOBILIZATION_MODEL: model }); }
      catch (error) {
        expect(error).toMatchObject({ field: 'MOBILIZATION_MODEL', code: 'invalid_mobilization_configuration' });
        expect(String(error)).not.toContain('TEST_SECRET');
      }
    });

  it.each(['default', 'fast'] as const)('accepts only an explicit %s tier without changing the inherited model', (serviceTier) => {
    const selected = resolveMobilizationModelConfiguration(base(), { MOBILIZATION_SERVICE_TIER: serviceTier });
    expect(selected.providers[0]).toMatchObject({ model: 'gpt-6-luna', serviceTier });
  });

  it.each(['none', 'low', 'high'])('defaults every scoped provider to medium instead of inherited %s reasoning', (globalEffort) => {
    const input = base();
    input.providers[0].reasoningEffort = globalEffort;
    input.providers.push({ ...input.providers[0], provider: 'openai', reasoningEffort: 'max' });
    const saved = structuredClone(input);
    const selected = resolveMobilizationModelConfiguration(input, {});
    expect(selected.providers.map(({ reasoningEffort }) => reasoningEffort)).toEqual(['medium', 'medium']);
    expect(selected.readiness.reasoningEffort).toBe('medium');
    expect(input).toEqual(saved);
  });

  it.each(['medium', 'low'] as const)('accepts scoped %s reasoning and exposes the same selection in readiness', (reasoningEffort) => {
    const input = base();
    const saved = structuredClone(input);
    const selected = resolveMobilizationModelConfiguration(input, { MOBILIZATION_REASONING_EFFORT: ` ${reasoningEffort} ` });
    expect(selected.providers).toEqual([{ ...input.providers[0], reasoningEffort }]);
    expect(selected.readiness).toEqual({ ...input.readiness, reasoningEffort });
    expect(input).toEqual(saved);
  });

  it.each(['', ' ', 'none', 'minimal', 'high', 'xhigh', 'max', 'LOW', 'TEST_SECRET'])('rejects invalid scoped reasoning without value echo or fallback', (reasoningEffort) => {
    try { resolveMobilizationModelConfiguration(base(), { MOBILIZATION_REASONING_EFFORT: reasoningEffort }); throw new Error('Expected rejection'); }
    catch (error) {
      expect(error).toBeInstanceOf(MobilizationModelConfigurationError);
      expect(error).toMatchObject({ field: 'MOBILIZATION_REASONING_EFFORT', code: 'invalid_mobilization_configuration' });
      expect(String(error)).not.toContain('TEST_SECRET');
    }
  });

  it.each(['', ' ', 'auto', 'priority', 'flex', 'FAST', 'TEST_SECRET'])(
    'rejects unsupported explicit service tiers without sending standard/auto instead', (serviceTier) => {
      try { resolveMobilizationModelConfiguration(base(), { MOBILIZATION_SERVICE_TIER: serviceTier }); throw new Error('Expected rejection'); }
      catch (error) {
        expect(error).toBeInstanceOf(MobilizationModelConfigurationError);
        expect(error).toMatchObject({ field: 'MOBILIZATION_SERVICE_TIER' });
        expect(String(error)).not.toContain('TEST_SECRET');
      }
    });

  it('reports the selected model even when provider credentials are missing; it never invents a provider', () => {
    const selected = resolveMobilizationModelConfiguration({ readiness: { ready: false, model: 'gpt-6-luna',
      missing: ['Server-side model API key'] }, providers: [] }, { MOBILIZATION_MODEL: 'gpt-6-sol', MOBILIZATION_SERVICE_TIER: 'fast' });
    expect(selected.readiness).toEqual({ ready: false, model: 'gpt-6-sol', serviceTier: 'fast', reasoningEffort: 'medium', missing: ['Server-side model API key'] });
    expect(selected.providers).toEqual([]);
  });

  it('reports valid scoped low reasoning with missing credentials without inventing a provider', () => {
    const selected = resolveMobilizationModelConfiguration({ readiness: { ready: false, model: 'gpt-6-luna',
      missing: ['Server-side model API key'] }, providers: [] }, { MOBILIZATION_REASONING_EFFORT: 'low' });
    expect(selected.readiness).toEqual({ ready: false, model: 'gpt-6-luna', reasoningEffort: 'low', missing: ['Server-side model API key'] });
    expect(selected.providers).toEqual([]);
  });
});

const keys = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_REASONING_EFFORT', 'OPENROUTER_API_KEY',
  'TYPESAFE_BASE_URL', 'TYPESAFE_API_KEY', 'OPENAI_API_KEY', 'MODEL_PROVIDER', 'SPARK_BASE_URL', 'SPARK_API_KEY',
  'MOBILIZATION_MODEL', 'MOBILIZATION_SERVICE_TIER', 'MOBILIZATION_REASONING_EFFORT'];
beforeEach(() => { for (const key of keys) vi.stubEnv(key, undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const Answer = z.strictObject({ answer: z.string() });
const Arguments = z.strictObject({ keys: z.array(z.string()) });
const ask = () => ({ system: 'Test only', prompt: 'Test only', schema: Answer,
  tool: { name: 'get_playbooks', description: 'Read only', args: Arguments,
    execute: vi.fn(async () => '{"playbooks":[]}') } });
const retrieval = (service_tier?: string) => ({ status: 'completed', service_tier, output: [{ type: 'function_call',
  status: 'completed', call_id: 'call-test', name: 'get_playbooks', arguments: '{"keys":[]}' }] });
const final = (service_tier?: string) => ({ status: 'completed', service_tier, output: [{ type: 'message', role: 'assistant',
  status: 'completed', content: [{ type: 'output_text', text: '{"answer":"valid"}' }] }] });
const configured = () => {
  vi.stubEnv('LLM_BASE_URL', 'https://api.openai.com/v1'); vi.stubEnv('LLM_API_KEY', 'test-only');
  vi.stubEnv('LLM_MODEL', 'gpt-6-luna'); vi.stubEnv('LLM_REASONING_EFFORT', 'medium');
};
const audits = () => ({ timeoutMs: 60_000, onAttempt: vi.fn(async (_identity: ModelIdentity) => {}),
  onResponse: vi.fn(async (_raw: string, _identity: ModelIdentity) => {}) });

describe('Mobilization-only facade configuration (offline HTTP)', () => {
  it('passes scoped Sol/fast/medium in both Responses rounds and audits the actual chosen model and served tiers', async () => {
    configured(); vi.stubEnv('MOBILIZATION_MODEL', 'gpt-6-sol'); vi.stubEnv('MOBILIZATION_SERVICE_TIER', 'fast');
    const fake = fakeHttp({ json: retrieval('default') }, { json: final('fast') }); vi.stubGlobal('fetch', fake.fetch);
    const o = audits(); const diagnostics: { event: ModelDiagnostic; identity: ModelIdentity }[] = [];
    expect(chatModelReadiness().model).toBe('gpt-6-luna');
    expect(mobilizationModelReadiness()).toEqual({ ready: true, model: 'gpt-6-sol', serviceTier: 'fast', reasoningEffort: 'medium', missing: [] });
    expect(mobilizationModelId()).toBe('gpt-6-sol');
    await expect(generateWithReadTool(ask(), { ...o, onDiagnostic: (event, identity) => { diagnostics.push({ event, identity }); } }))
      .resolves.toEqual({ answer: 'valid' });
    expect(fake.requests.map(({ json }) => ({ model: json.model, reasoning: json.reasoning, tier: json.service_tier })))
      .toEqual([{ model: 'gpt-6-sol', reasoning: { effort: 'medium' }, tier: 'fast' },
        { model: 'gpt-6-sol', reasoning: { effort: 'medium' }, tier: 'fast' }]);
    expect(o.onAttempt).toHaveBeenCalledExactlyOnceWith({ provider: 'configured', model: 'gpt-6-sol' });
    expect(o.onResponse.mock.calls.map(([, identity]) => identity)).toEqual([
      { provider: 'configured', model: 'gpt-6-sol' }, { provider: 'configured', model: 'gpt-6-sol' },
    ]);
    expect(diagnostics.every(({ identity, event }) => identity.model === 'gpt-6-sol' && event.requestedServiceTier === 'fast')).toBe(true);
    expect(diagnostics.filter(({ event }) => event.stage === 'response_body').map(({ event }) => event.actualServiceTier))
      .toEqual(['default', 'fast']);
  });

  it('does not apply Mobilization model/tier/reasoning overrides to other structured chat or intake tools', async () => {
    configured(); vi.stubEnv('OPENAI_API_KEY', 'test-only');
    vi.stubEnv('MOBILIZATION_MODEL', 'gpt-6-sol'); vi.stubEnv('MOBILIZATION_SERVICE_TIER', 'fast');
    vi.stubEnv('MOBILIZATION_REASONING_EFFORT', 'low'); vi.stubEnv('LLM_REASONING_EFFORT', 'high');
    const fake = fakeHttp({ json: { choices: [{ message: { content: '{"answer":"valid"}' } }] } },
      { json: { choices: [{ message: { content: 'A tool-free reply' } }] } }); vi.stubGlobal('fetch', fake.fetch);
    await expect(generate({ system: 'Test', prompt: 'Test', schema: Answer })).resolves.toEqual({ answer: 'valid' });
    await expect(callTool({ system: 'Test', prompt: 'Test', tools: [] })).resolves.toEqual({ text: 'A tool-free reply' });
    expect(fake.requests.map(({ json }) => json.model)).toEqual(['gpt-6-luna', 'gpt-6-luna']);
    expect(fake.requests.map(({ json }) => json.reasoning_effort)).toEqual(['high', 'none']);
    expect(fake.requests.every(({ json }) => !('service_tier' in json))).toBe(true);
    expect(chatModelReadiness()).toEqual({ ready: true, model: 'gpt-6-luna', missing: [] });
  });

  it('inherits the configured model and omits tier when neither scoped override is configured', async () => {
    configured(); const fake = fakeHttp({ json: retrieval() }, { json: final() }); vi.stubGlobal('fetch', fake.fetch);
    await expect(generateWithReadTool(ask(), audits())).resolves.toEqual({ answer: 'valid' });
    expect(mobilizationModelReadiness()).toEqual({ ...chatModelReadiness(), reasoningEffort: 'medium' });
    expect(fake.requests.every(({ json }) => json.model === 'gpt-6-luna' && !('service_tier' in json))).toBe(true);
  });

  it('works with the normal OpenAI provider and preserves an explicit per-call medium override', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only'); vi.stubEnv('MOBILIZATION_MODEL', 'gpt-6-sol');
    vi.stubEnv('MOBILIZATION_SERVICE_TIER', 'default');
    vi.stubEnv('MOBILIZATION_REASONING_EFFORT', 'low');
    const fake = fakeHttp({ json: retrieval() }, { json: final() }); vi.stubGlobal('fetch', fake.fetch);
    const o = audits(); await expect(generateWithReadTool(ask(), { ...o, reasoningEffort: 'medium' })).resolves.toEqual({ answer: 'valid' });
    expect(o.onAttempt).toHaveBeenCalledExactlyOnceWith({ provider: 'openai', model: 'gpt-6-sol' });
    expect(fake.requests.every(({ json }) => json.model === 'gpt-6-sol' && json.reasoning.effort === 'medium' && json.service_tier === 'default')).toBe(true);
    expect(mobilizationModelReadiness().reasoningEffort).toBe('low');
  });

  it.each(['MOBILIZATION_MODEL', 'MOBILIZATION_SERVICE_TIER', 'MOBILIZATION_REASONING_EFFORT'] as const)('fails invalid scoped %s configuration before fetch or audit attempts, without secret echo', async (field) => {
    configured(); vi.stubEnv(field, 'TEST_SECRET token');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const o = audits();
    expect(mobilizationModelReadiness().ready).toBe(false);
    expect(mobilizationModelReadiness().missing.join(';')).not.toContain('TEST_SECRET');
    await expect(generateWithReadTool(ask(), o)).rejects.toBeInstanceOf(MobilizationModelConfigurationError);
    await expect(generateWithReadTool(ask(), o)).rejects.not.toThrow('TEST_SECRET');
    expect(fetch).not.toHaveBeenCalled(); expect(o.onAttempt).not.toHaveBeenCalled();
  });

  it.each(['MOBILIZATION_SERVICE_TIER', 'MOBILIZATION_REASONING_EFFORT'])('keeps invalid %s from breaking unrelated structured chat', async (field) => {
    configured(); vi.stubEnv(field, 'TEST_SECRET');
    const fake = fakeHttp({ json: { choices: [{ message: { content: '{"answer":"valid"}' } }] } }); vi.stubGlobal('fetch', fake.fetch);
    expect(chatModelReadiness().ready).toBe(true); expect(mobilizationModelReadiness().ready).toBe(false);
    await expect(generate({ system: 'Test', prompt: 'Test', schema: Answer })).resolves.toEqual({ answer: 'valid' });
  });

  it.each(['none', 'low', 'high'])('uses explicit medium in both Mobilization rounds when global reasoning is %s and scoped reasoning is omitted', async (globalEffort) => {
    configured(); vi.stubEnv('LLM_REASONING_EFFORT', globalEffort);
    const fake = fakeHttp({ json: retrieval() }, { json: final() }); vi.stubGlobal('fetch', fake.fetch);
    await expect(generateWithReadTool(ask(), audits())).resolves.toEqual({ answer: 'valid' });
    expect(fake.requests.map(({ json }) => json.reasoning.effort)).toEqual(['medium', 'medium']);
    expect(mobilizationModelReadiness().reasoningEffort).toBe('medium');
    expect(chatModelReadiness()).toEqual({ ready: true, model: 'gpt-6-luna', missing: [] });
  });

  it('uses scoped low in both Mobilization rounds without a per-call override', async () => {
    configured(); vi.stubEnv('MOBILIZATION_REASONING_EFFORT', 'low');
    const fake = fakeHttp({ json: retrieval() }, { json: final() }); vi.stubGlobal('fetch', fake.fetch);
    await expect(generateWithReadTool(ask(), audits())).resolves.toEqual({ answer: 'valid' });
    expect(fake.requests.map(({ json }) => json.reasoning.effort)).toEqual(['low', 'low']);
    expect(mobilizationModelReadiness().reasoningEffort).toBe('low');
  });

  it.each(['', ' ', 'none', 'minimal', 'high', 'LOW'])('blocks invalid reasoning before any HTTP dispatch or retry', async (reasoningEffort) => {
    configured(); vi.stubEnv('MOBILIZATION_REASONING_EFFORT', reasoningEffort);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const o = audits(); const read = ask();
    await expect(generateWithReadTool(read, o)).rejects.toMatchObject({ field: 'MOBILIZATION_REASONING_EFFORT' });
    expect(mobilizationModelReadiness()).toMatchObject({ ready: false });
    expect(mobilizationModelReadiness()).not.toHaveProperty('reasoningEffort');
    expect(fetch).not.toHaveBeenCalled(); expect(o.onAttempt).not.toHaveBeenCalled();
    expect(o.onResponse).not.toHaveBeenCalled(); expect(read.tool.execute).not.toHaveBeenCalled();
  });

  it('uses a typed provider-configuration error when no provider credentials exist', async () => {
    vi.stubEnv('MOBILIZATION_MODEL', 'gpt-6-sol'); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(mobilizationModelReadiness()).toMatchObject({ ready: false, model: 'gpt-6-sol' });
    await expect(generateWithReadTool(ask(), audits())).rejects.toMatchObject({
      name: 'MobilizationModelConfigurationError', field: 'provider', code: 'invalid_mobilization_configuration',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not downgrade fast or switch back to the global model after a typed HTTP rejection', async () => {
    configured(); vi.stubEnv('MOBILIZATION_MODEL', 'gpt-6-sol'); vi.stubEnv('MOBILIZATION_SERVICE_TIER', 'fast');
    vi.stubEnv('MOBILIZATION_REASONING_EFFORT', 'low');
    const fake = fakeHttp({ status: 400, json: { error: { message: 'TEST_SECRET unsupported provider setting' } } });
    vi.stubGlobal('fetch', fake.fetch); const read = ask();
    await expect(generateWithReadTool(read, audits())).rejects.toEqual(new ModelHttpError(400));
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].json).toMatchObject({ model: 'gpt-6-sol', service_tier: 'fast', reasoning: { effort: 'low' } });
    expect(read.tool.execute).not.toHaveBeenCalled();
  });

  it('reads the next scoped configuration without caching or mutating the global provider', async () => {
    configured(); vi.stubEnv('MOBILIZATION_MODEL', 'gpt-6-sol'); vi.stubEnv('MOBILIZATION_SERVICE_TIER', 'fast');
    vi.stubEnv('MOBILIZATION_REASONING_EFFORT', 'low');
    const fake = fakeHttp({ json: retrieval() }, { json: final() }, { json: retrieval() }, { json: final() });
    vi.stubGlobal('fetch', fake.fetch);
    await generateWithReadTool(ask(), audits());
    vi.stubEnv('MOBILIZATION_MODEL', 'gpt-6-luna'); vi.stubEnv('MOBILIZATION_SERVICE_TIER', 'default');
    vi.stubEnv('MOBILIZATION_REASONING_EFFORT', 'medium');
    await generateWithReadTool(ask(), audits());
    expect(fake.requests.map(({ json }) => [json.model, json.service_tier, json.reasoning.effort])).toEqual([
      ['gpt-6-sol', 'fast', 'low'], ['gpt-6-sol', 'fast', 'low'], ['gpt-6-luna', 'default', 'medium'], ['gpt-6-luna', 'default', 'medium'],
    ]);
    expect(chatModelReadiness().model).toBe('gpt-6-luna');
  });

  it('keeps mandatory audit failure fail-closed before sending an overridden-model request', async () => {
    configured(); vi.stubEnv('MOBILIZATION_MODEL', 'gpt-6-sol'); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const o = audits(); o.onAttempt.mockRejectedValue(new Error('TEST_SECRET audit storage'));
    await expect(generateWithReadTool(ask(), o)).rejects.toEqual(new ModelAuditError());
    expect(fetch).not.toHaveBeenCalled();
  });
});
