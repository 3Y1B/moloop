import { choice, noul, type EntryType, type Questions } from '@typesafe-ai/sdk';
import type { z } from 'zod';

import type { Answers } from './decisions';
import { ModelAuditError } from './errors';
import type { ModelDiagnostic } from './http';
import { withFallback, type Attempt } from './fallback';
import { Jev } from './jev';
import { LunaLlm, type Tool, type ToolCall } from './luna';
import { MobilizationModelConfigurationError, resolveMobilizationModelConfiguration,
  type MobilizationModelReadiness } from './mobilization-configuration';
import { OpenAiDecisions } from './openai-decisions';
import { ReadToolResponses, type ReadToolGenerationArgs } from './responses';
import {
  chatModelReadiness, configuredChatProviders, hasOpenAi, onSpark, openai, spark, sparkLimiter,
  type ChatProvider, type ModelIdentity,
} from './providers';

/**
 * Shared facade: structured chat defaults to OpenAI, with explicit configured-chat overrides.
 * Intake tools remain OpenAI; typed decisions retain Spark-first/OpenAI-fallback. If those
 * providers fail, the interpreter fails closed to a person. Overrides never change intake or speech.
 */
export type CallOptions = {
  /** Cloud-only typed decisions for explicit upstream callers; structured chat has its own configured providers. */
  cloud?: boolean;
  urgent?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  onAttempt?: (identity: ModelIdentity) => void | Promise<void>;
  onResponse?: (response: string, identity: ModelIdentity) => void | Promise<void>;
  /** Best-effort safe transport metadata; unlike response/attempt audits, observer errors cannot fail generation. */
  onDiagnostic?: (diagnostic: ModelDiagnostic, identity: ModelIdentity) => void | Promise<void>;
};
const LIMITS = { chat: { primaryMs: 5_000, lastMs: 15_000 }, decide: { primaryMs: 4_000, lastMs: 10_000 }, tool: { primaryMs: 15_000, lastMs: 15_000 } };
const limits = (defaults: { primaryMs: number; lastMs: number }, options: CallOptions) => ({
  primaryMs: options.timeoutMs ?? defaults.primaryMs, lastMs: options.timeoutMs ?? defaults.lastMs, signal: options.signal,
});
const queued = <R>(id: string, urgent: boolean | undefined, call: (signal: AbortSignal) => Promise<R>): Attempt<R> | null =>
  onSpark() ? { id, call: (signal) => sparkLimiter().run(!!urgent, () => call(signal), signal) } : null;
const cloud = <R>(id: string, call: (signal: AbortSignal) => Promise<R>): Attempt<R> | null => hasOpenAi() ? { id, call } : null;

/** No cached env/fetch: configuration, readiness and each call agree, including injected offline tests. */
export const chatModelId = () => chatModelReadiness().model;
export const decideModelId = (options: Pick<CallOptions, 'cloud'> = {}) => !options.cloud && onSpark() ? 'qwen3.5:4b' : 'gpt-6-luna';
export const toolModelId = () => 'gpt-6-luna';
export { chatModelReadiness };
export { MobilizationModelConfigurationError } from './mobilization-configuration';
export type { ModelIdentity };
export type { ModelDiagnostic } from './http';

const mobilizationConfiguration = (readiness = chatModelReadiness()) => resolveMobilizationModelConfiguration({
  readiness, providers: configuredChatProviders(),
}, {
  MOBILIZATION_MODEL: process.env.MOBILIZATION_MODEL,
  MOBILIZATION_SERVICE_TIER: process.env.MOBILIZATION_SERVICE_TIER,
  MOBILIZATION_REASONING_EFFORT: process.env.MOBILIZATION_REASONING_EFFORT,
});

/** Same uncached scoped selection used by actual Mobilization requests; other chat readiness is unchanged. */
export function mobilizationModelReadiness(): MobilizationModelReadiness {
  const base = chatModelReadiness();
  try { return mobilizationConfiguration(base).readiness; }
  catch (error) {
    if (!(error instanceof MobilizationModelConfigurationError)) throw error;
    return { ready: false, model: base.model, missing: [error.message] };
  }
}
export const mobilizationModelId = () => mobilizationModelReadiness().model;

async function audited(callback: (() => void | Promise<void>) | undefined) {
  if (!callback) return;
  try { await callback(); } catch { throw new ModelAuditError(); }
}

/** JSON-schema output with one repair round per real provider; all replies are captured before parsing. */
export function generate<T extends z.ZodType>(
  args: { system: string; prompt: string; schema: T }, o: CallOptions = {},
): Promise<z.infer<T>> {
  const readiness = chatModelReadiness();
  if (!readiness.ready) return Promise.reject(new Error(`Model configuration required: ${readiness.missing.join('; ')}`));
  const providers = configuredChatProviders();
  const attemptFor = (provider: ChatProvider): Attempt<z.infer<T>> => {
    const identity: ModelIdentity = { provider: provider.provider, model: provider.model };
    const llm = new LunaLlm({ ...provider });
    const call = async (signal: AbortSignal) => {
      await audited(o.onAttempt && (() => o.onAttempt!(identity)));
      const result = await llm.generate({
        ...args, signal, maxTokens: o.maxTokens, reasoningEffort: o.reasoningEffort ?? provider.reasoningEffort,
        onResponse: o.onResponse && ((response) => audited(() => o.onResponse!(response, identity))),
        onDiagnostic: o.onDiagnostic && ((diagnostic) => o.onDiagnostic!(diagnostic, identity)),
      });
      if (signal.aborted) throw signal.reason;
      return result;
    };
    return { id: `${identity.provider}:${identity.model}`,
      call: provider.provider === 'spark' ? (signal) => sparkLimiter().run(!!o.urgent, () => call(signal), signal) : call };
  };
  const attempts = providers.map(attemptFor);
  return withFallback(attempts.length > 1 ? attempts[0] : null, attempts.at(-1)!, limits(LIMITS.chat, o));
}

/** Scoped read-only retrieval seam. Other structured chat, intake tools and speech stay unchanged. */
export function generateWithReadTool<T extends z.ZodType, A extends z.ZodType>(
  args: ReadToolGenerationArgs<T, A>, o: CallOptions & { toolMaxTokens?: number },
): Promise<z.infer<T>> {
  if (!o.onAttempt || !o.onResponse) return Promise.reject(new ModelAuditError());
  let configured: ReturnType<typeof mobilizationConfiguration>;
  try { configured = mobilizationConfiguration(); }
  catch (error) { return Promise.reject(error); }
  const { readiness, providers } = configured;
  if (!readiness.ready) return Promise.reject(new MobilizationModelConfigurationError('provider',
    `Model configuration required: ${readiness.missing.join('; ')}`));
  const attempts = providers.map((provider): Attempt<z.infer<T>> => {
    const identity: ModelIdentity = { provider: provider.provider, model: provider.model };
    const responses = new ReadToolResponses(provider);
    const call = async (signal: AbortSignal) => {
      await audited(() => o.onAttempt!(identity));
      const result = await responses.generate(args, {
        signal, maxTokens: o.maxTokens, toolMaxTokens: o.toolMaxTokens,
        reasoningEffort: o.reasoningEffort ?? provider.reasoningEffort,
        serviceTier: provider.serviceTier,
        onResponse: (response) => audited(() => o.onResponse!(response, identity)),
        onDiagnostic: o.onDiagnostic && ((diagnostic) => o.onDiagnostic!(diagnostic, identity)),
      });
      if (signal.aborted) throw signal.reason;
      return result;
    };
    return { id: `${identity.provider}:${identity.model}`,
      call: provider.provider === 'spark' ? (signal) => sparkLimiter().run(!!o.urgent, () => call(signal), signal) : call };
  });
  return withFallback(attempts.length > 1 ? attempts[0] : null, attempts.at(-1)!, limits(LIMITS.chat, o));
}

/** Intake tool calling remains OpenAI Luna, independent of explicit structured-chat model overrides. */
export function callTool(args: { system: string; prompt: string; tools: Tool[] }, o: CallOptions = {}): Promise<ToolCall> {
  const llm = new LunaLlm({ ...openai(), model: 'gpt-6-luna' });
  return withFallback(null, cloud(llm.id, (signal) => llm.callTool({ ...args, signal })), limits(LIMITS.tool, o));
}

/** Typed decisions retain the upstream Spark-first / OpenAI-fallback policy. */
export function decide<const Q extends Questions>(state: EntryType, questions: Q, o: CallOptions = {}): Promise<Answers<Q>> {
  const jev = new Jev(spark());
  const decisions = new OpenAiDecisions(openai());
  return withFallback(
    o.cloud ? null : queued(jev.id, o.urgent, (signal) => jev.decide(state, questions, signal)),
    cloud(decisions.id, (signal) => decisions.decide(state, questions, signal)),
    limits(LIMITS.decide, o),
  );
}

export { choice, noul };
export type { Tool, ToolCall };
