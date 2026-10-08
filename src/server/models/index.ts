import { choice, noul, type EntryType, type Questions } from '@typesafe-ai/sdk';
import type { z } from 'zod';

import type { Answers } from './decisions';
import { ModelAuditError } from './errors';
import type { ModelDiagnostic } from './http';
import { withFallback, type Attempt } from './fallback';
import { Jev } from './jev';
import { LunaLlm, type Tool, type ToolCall } from './luna';
import {
  MobilizationModelConfigurationError,
  resolveMobilizationModelConfiguration,
  type MobilizationModelReadiness,
} from './mobilization-configuration';
import { OpenAiDecisions } from './openai-decisions';
import { ReadToolResponses, type ReadToolGenerationArgs } from './responses';
import {
  chatModelReadiness,
  hasOpenAi,
  mobilizationProviders,
  onSpark,
  openai,
  spark,
  sparkLimiter,
  type ModelIdentity,
} from './providers';

/**
 * The seams the interpreter decides with (providers.ts):
 *
 *  - `generate`: chat completions with JSON-schema output, validated with zod, one repair round. OpenAI only.
 *  - `decide`: typed questions answered with probabilities. Narrow questions, one thing each.
 *  - `callTool`: one step of a tool-using agent. OpenAI only: the Spark's tool calling is undocumented.
 *  - `generateWithReadTool`: Mobilization's audited /responses call, OpenAI only.
 *
 * If both the Spark and OpenAI fail, the error reaches the caller, which fails closed to a person.
 */

/**
 * `urgent` jumps the Spark's queue; `signal` bounds the whole call, fallback included; `cloud` skips the Spark.
 * The rest is Mobilization's.
 */
export type CallOptions = {
  urgent?: boolean;
  signal?: AbortSignal;
  cloud?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  onAttempt?: (identity: ModelIdentity) => void | Promise<void>;
  onResponse?: (response: string, identity: ModelIdentity) => void | Promise<void>;
  /** Best-effort safe transport metadata; unlike response/attempt audits, observer errors cannot fail generation. */
  onDiagnostic?: (diagnostic: ModelDiagnostic, identity: ModelIdentity) => void | Promise<void>;
};

// How long the Spark gets before OpenAI takes over, and how long the last resort gets.
const LIMITS = {
  chat: { primaryMs: 5_000, lastMs: 15_000 },
  decide: { primaryMs: 4_000, lastMs: 10_000 },
  tool: { primaryMs: 15_000, lastMs: 15_000 },
};
const limits = (defaults: { primaryMs: number; lastMs: number }, options: CallOptions) => ({
  primaryMs: options.timeoutMs ?? defaults.primaryMs,
  lastMs: options.timeoutMs ?? defaults.lastMs,
  signal: options.signal,
});

// Built per call, not cached, so env and fetch changes (tests, scripts) take effect.
const models = () => ({
  openaiChat: new LunaLlm({ ...openai(), model: 'gpt-6-luna' }),
  jev: new Jev(spark()),
  decisions: new OpenAiDecisions(openai()),
});

/** A Spark call waits its turn in the shared queue; giving up while waiting frees the slot. */
const queued = <R>(
  id: string,
  urgent: boolean | undefined,
  call: (signal: AbortSignal) => Promise<R>,
): Attempt<R> | null =>
  onSpark() ? { id, call: (signal) => sparkLimiter().run(!!urgent, () => call(signal), signal) } : null;
const cloud = <R>(id: string, call: (signal: AbortSignal) => Promise<R>): Attempt<R> | null =>
  hasOpenAi() ? { id, call } : null;

/** The models answering first, for triage_runs. */
export const chatModelId = () => models().openaiChat.id;
export const decideModelId = (o: CallOptions = {}) => (onSpark() && !o.cloud ? models().jev : models().decisions).id;
export const toolModelId = () => models().openaiChat.id;
export { chatModelReadiness };
export { MobilizationModelConfigurationError } from './mobilization-configuration';
export type { ModelIdentity };
export type { ModelDiagnostic } from './http';

const mobilizationConfiguration = () => {
  const { providers, missing } = mobilizationProviders();
  return resolveMobilizationModelConfiguration(
    {
      readiness: { ready: providers.length > 0, model: providers[0]?.model ?? 'gpt-6-luna', missing },
      providers,
    },
    {
      MOBILIZATION_MODEL: process.env.MOBILIZATION_MODEL,
      MOBILIZATION_SERVICE_TIER: process.env.MOBILIZATION_SERVICE_TIER,
      MOBILIZATION_REASONING_EFFORT: process.env.MOBILIZATION_REASONING_EFFORT,
    },
  );
};

/** Same uncached scoped selection used by actual Mobilization requests. */
export function mobilizationModelReadiness(): MobilizationModelReadiness {
  try {
    return mobilizationConfiguration().readiness;
  } catch (error) {
    if (!(error instanceof MobilizationModelConfigurationError)) throw error;
    return { ready: false, model: 'gpt-6-luna', missing: [error.message] };
  }
}

async function audited(callback: (() => void | Promise<void>) | undefined) {
  if (!callback) return;
  try {
    await callback();
  } catch {
    throw new ModelAuditError();
  }
}

/** Structured output validated against `schema`. */
export function generate<T extends z.ZodType>(
  args: { system: string; prompt: string; schema: T },
  o: CallOptions = {},
): Promise<z.infer<T>> {
  const m = models();
  return withFallback(
    null,
    cloud(m.openaiChat.id, (signal) => m.openaiChat.generate({ ...args, signal })),
    { ...LIMITS.chat, signal: o.signal },
  );
}

/** Scoped read-only retrieval seam. Other structured chat, intake tools and speech stay unchanged. */
export function generateWithReadTool<T extends z.ZodType, A extends z.ZodType>(
  args: ReadToolGenerationArgs<T, A>,
  o: CallOptions & { toolMaxTokens?: number },
): Promise<z.infer<T>> {
  if (!o.onAttempt || !o.onResponse) return Promise.reject(new ModelAuditError());
  let configured: ReturnType<typeof mobilizationConfiguration>;
  try {
    configured = mobilizationConfiguration();
  } catch (error) {
    return Promise.reject(error);
  }
  const { readiness, providers } = configured;
  if (!readiness.ready)
    return Promise.reject(
      new MobilizationModelConfigurationError(
        'provider',
        `Model configuration required: ${readiness.missing.join('; ')}`,
      ),
    );
  const attempts = providers.map((provider): Attempt<z.infer<T>> => {
    const identity: ModelIdentity = { provider: provider.provider, model: provider.model };
    const responses = new ReadToolResponses(provider);
    const call = async (signal: AbortSignal) => {
      await audited(() => o.onAttempt!(identity));
      const result = await responses.generate(args, {
        signal,
        maxTokens: o.maxTokens,
        toolMaxTokens: o.toolMaxTokens,
        reasoningEffort: o.reasoningEffort ?? provider.reasoningEffort,
        serviceTier: provider.serviceTier,
        onResponse: (response) => audited(() => o.onResponse!(response, identity)),
        onDiagnostic: o.onDiagnostic && ((diagnostic) => o.onDiagnostic!(diagnostic, identity)),
      });
      if (signal.aborted) throw signal.reason;
      return result;
    };
    return { id: `${identity.provider}:${identity.model}`, call };
  });
  return withFallback(null, attempts[0] ?? null, limits(LIMITS.chat, o));
}

/** Mobilization's planner with its one playbook already in the prompt: one audited strict response, no tool round. */
export function generatePlan<T extends z.ZodType>(
  args: { system: string; prompt: string; schema: T },
  o: CallOptions,
): Promise<z.infer<T>> {
  if (!o.onAttempt || !o.onResponse) return Promise.reject(new ModelAuditError());
  let configured: ReturnType<typeof mobilizationConfiguration>;
  try {
    configured = mobilizationConfiguration();
  } catch (error) {
    return Promise.reject(error);
  }
  const { readiness, providers } = configured;
  if (!readiness.ready)
    return Promise.reject(
      new MobilizationModelConfigurationError('provider', `Model configuration required: ${readiness.missing.join('; ')}`),
    );
  const attempts = providers.map((provider): Attempt<z.infer<T>> => {
    const identity: ModelIdentity = { provider: provider.provider, model: provider.model };
    const responses = new ReadToolResponses(provider);
    const call = async (signal: AbortSignal) => {
      await audited(() => o.onAttempt!(identity));
      const result = await responses.generateDirect(args, {
        signal,
        maxTokens: o.maxTokens,
        reasoningEffort: o.reasoningEffort ?? provider.reasoningEffort,
        serviceTier: provider.serviceTier,
        onResponse: (response) => audited(() => o.onResponse!(response, identity)),
        onDiagnostic: o.onDiagnostic && ((diagnostic) => o.onDiagnostic!(diagnostic, identity)),
      });
      if (signal.aborted) throw signal.reason;
      return result;
    };
    return { id: `${identity.provider}:${identity.model}`, call };
  });
  return withFallback(null, attempts[0] ?? null, limits(LIMITS.chat, o));
}

/** The model calls one of `tools` (arguments validated), or replies in plain text. */
export function callTool(
  args: { system: string; prompt: string; tools: Tool[] },
  o: CallOptions = {},
): Promise<ToolCall> {
  const m = models();
  return withFallback(
    null,
    cloud(m.openaiChat.id, (signal) => m.openaiChat.callTool({ ...args, signal })),
    { ...LIMITS.tool, signal: o.signal },
  );
}

/** Questions about some content, answered with probabilities. */
export function decide<const Q extends Questions>(
  state: EntryType,
  questions: Q,
  o: CallOptions = {},
): Promise<Answers<Q>> {
  const m = models();
  return withFallback(
    o.cloud ? null : queued(m.jev.id, o.urgent, (signal) => m.jev.decide(state, questions, signal)),
    cloud(m.decisions.id, (signal) => m.decisions.decide(state, questions, signal)),
    { ...LIMITS.decide, signal: o.signal },
  );
}

export { choice, noul };
export type { Tool, ToolCall };
