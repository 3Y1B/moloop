import { choice, noul, type EntryType, type Questions } from '@typesafe-ai/sdk';
import type { z } from 'zod';

import type { Answers } from './decisions';
import { withFallback, type Attempt } from './fallback';
import { Jev } from './jev';
import { LunaLlm, type Tool, type ToolCall } from './luna';
import { OpenAiDecisions } from './openai-decisions';
import { hasOpenAi, onSpark, openai, spark, sparkLimiter } from './providers';

/**
 * The seams the interpreter decides with (providers.ts):
 *
 *  - `generate`: chat completions with JSON-schema output, validated with zod, one repair round. OpenAI only.
 *  - `decide`: typed questions answered with probabilities. Narrow questions, one thing each.
 *  - `callTool`: one step of a tool-using agent. OpenAI only: the Spark's tool calling is undocumented.
 *
 * If both the Spark and OpenAI fail, the error reaches the caller, which fails closed to a person.
 */

/** `urgent` jumps the Spark's queue; `signal` bounds the whole call, fallback included. */
export type CallOptions = { urgent?: boolean; signal?: AbortSignal };

// How long the Spark gets before OpenAI takes over, and how long the last resort gets.
const LIMITS = { chat: { primaryMs: 5_000, lastMs: 15_000 }, decide: { primaryMs: 4_000, lastMs: 10_000 }, tool: { primaryMs: 15_000, lastMs: 15_000 } };

let clients: { openaiChat: LunaLlm; jev: Jev; decisions: OpenAiDecisions } | undefined;
const models = () => (clients ??= {
  openaiChat: new LunaLlm({ ...openai(), model: 'gpt-6-luna' }),
  jev: new Jev(spark()),
  decisions: new OpenAiDecisions(openai()),
});

/** A Spark call waits its turn in the shared queue; giving up while waiting frees the slot. */
const queued = <R>(id: string, urgent: boolean | undefined, call: (signal: AbortSignal) => Promise<R>): Attempt<R> | null =>
  onSpark() ? { id, call: (signal) => sparkLimiter().run(!!urgent, () => call(signal), signal) } : null;
const cloud = <R>(id: string, call: (signal: AbortSignal) => Promise<R>): Attempt<R> | null => (hasOpenAi() ? { id, call } : null);

/** The models answering first, for triage_runs. */
export const chatModelId = () => models().openaiChat.id;
export const decideModelId = () => (onSpark() ? models().jev : models().decisions).id;

/** Structured output validated against `schema`. */
export function generate<T extends z.ZodType>(
  args: { system: string; prompt: string; schema: T },
  o: CallOptions = {},
): Promise<z.infer<T>> {
  const m = models();
  return withFallback(null, cloud(m.openaiChat.id, (signal) => m.openaiChat.generate({ ...args, signal })), { ...LIMITS.chat, signal: o.signal });
}

/** The model calls one of `tools` (arguments validated), or replies in plain text. */
export function callTool(args: { system: string; prompt: string; tools: Tool[] }, o: CallOptions = {}): Promise<ToolCall> {
  const m = models();
  return withFallback(null, cloud(m.openaiChat.id, (signal) => m.openaiChat.callTool({ ...args, signal })), { ...LIMITS.tool, signal: o.signal });
}

export const toolModelId = () => models().openaiChat.id;

/** Questions about some content, answered with probabilities. */
export function decide<const Q extends Questions>(state: EntryType, questions: Q, o: CallOptions = {}): Promise<Answers<Q>> {
  const m = models();
  return withFallback(
    queued(m.jev.id, o.urgent, (signal) => m.jev.decide(state, questions, signal)),
    cloud(m.decisions.id, (signal) => m.decisions.decide(state, questions, signal)),
    { ...LIMITS.decide, signal: o.signal },
  );
}

export { choice, noul };
export type { Tool, ToolCall };
