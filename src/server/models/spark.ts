import { choice, noul, TypeSafeClient, type EntryType, type Questions } from '@typesafe-ai/sdk';
import { z } from 'zod';

import { Limiter } from './limiter';

/**
 * The model servers. Two seams, both OpenAI/TypeSafe-shaped HTTP:
 *
 *  - `decide`: typed questions with probabilities (`/v1/systemone`, the Jev API). Spark only.
 *  - `generate`: chat completions with JSON-schema output, validated with zod, one repair retry.
 *
 * Keys live in the server's env only. Chat runs on Spark's qwen3.5:4b unless OPENROUTER_API_KEY is set, which moves
 * it to GPT-6 Luna; LLM_BASE_URL / LLM_API_KEY / LLM_MODEL override either.
 */

const trim = (s: string) => s.replace(/\/+$/, '');

type Chat = { baseUrl: string; apiKey: string; model: string; reasoning: string; limiter: Limiter };

const limiters = new Map<string, Limiter>();
const limiterFor = (key: string, max: number, perMinute: number) => {
  let l = limiters.get(key);
  if (!l) limiters.set(key, (l = new Limiter(max, perMinute)));
  return l;
};

/** One limiter per server, shared by chat and typed decisions: Spark counts both against the same key. */
export const sparkLimiter = () =>
  limiterFor(trim(process.env.TYPESAFE_BASE_URL ?? ''), Number(process.env.SPARK_CONCURRENCY ?? 3), Number(process.env.SPARK_RPM ?? 28));

function chatConfig(): Chat {
  const spark = process.env.TYPESAFE_BASE_URL ? trim(process.env.TYPESAFE_BASE_URL) : '';
  const openrouter = process.env.OPENROUTER_API_KEY;
  const baseUrl = trim(process.env.LLM_BASE_URL ?? (openrouter ? 'https://openrouter.ai/api/v1' : `${spark}/v1`));
  const onSpark = !process.env.LLM_BASE_URL && !openrouter;
  return {
    baseUrl,
    apiKey: process.env.LLM_API_KEY ?? (openrouter || process.env.TYPESAFE_API_KEY) ?? '',
    model: process.env.LLM_MODEL ?? (openrouter ? 'openai/gpt-6-luna' : 'qwen3.5:4b'),
    reasoning: process.env.LLM_REASONING_EFFORT ?? 'none',
    limiter: onSpark ? sparkLimiter() : limiterFor(baseUrl, 8, 120),
  };
}

/** The chat model's id, for triage_runs. */
export const chatModelId = () => chatConfig().model;
export const decideModelId = () => 'qwen3.5:4b';

export type CallOptions = { urgent?: boolean; timeoutMs?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRY = new Set([408, 429, 500, 502, 503, 504]);

async function chat(c: Chat, messages: { role: string; content: string }[], schema: Record<string, unknown>, o: CallOptions): Promise<string> {
  const body = JSON.stringify({
    model: c.model,
    messages,
    ...(c.reasoning ? { reasoning_effort: c.reasoning } : {}),
    max_tokens: 700,
    response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } },
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await c.limiter.run(!!o.urgent, () =>
        fetch(`${c.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${c.apiKey}` },
          body,
          signal: AbortSignal.timeout(o.timeoutMs ?? 12_000),
        }));
      if (RETRY.has(res.status) && attempt < 2) {
        await sleep(Math.min(Number(res.headers.get('retry-after') ?? 0) * 1000 || 400 * 2 ** attempt, 4_000));
        continue;
      }
      if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content;
      if (!text) throw new Error('chat: empty reply');
      return text;
    } catch (e) {
      // A dropped connection before any answer: just retry (the relay does that now and then).
      if (attempt < 2 && e instanceof TypeError) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw e;
    }
  }
}

/**
 * Structured output validated against `schema`. If the first reply doesn't parse, it's sent back once with the
 * error. After that this throws, and the caller fails closed to a person.
 */
export async function generate<T extends z.ZodType>(
  { system, prompt, schema }: { system: string; prompt: string; schema: T },
  o: CallOptions = {},
): Promise<z.infer<T>> {
  const c = chatConfig();
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
  let last = '';
  let problem = '';
  for (let tries = 0; tries < 2; tries++) {
    last = await chat(c, tries ? [...messages, { role: 'assistant', content: last }, { role: 'user', content: `That failed validation: ${problem}. Reply again with corrected JSON only.` }] : messages, jsonSchema, o);
    try {
      const parsed = schema.safeParse(JSON.parse(last));
      if (parsed.success) return parsed.data;
      problem = z.prettifyError(parsed.error);
    } catch {
      problem = 'not valid JSON';
    }
  }
  throw new Error(`chat: reply failed validation twice (${problem})`);
}

let sdk: TypeSafeClient | undefined;

/** Questions about some content, answered with probabilities. Narrow questions, one thing each. */
export async function decide<const Q extends Questions>(
  state: EntryType,
  questions: Q,
  o: CallOptions = {},
) {
  sdk ??= new TypeSafeClient({ timeout: o.timeoutMs ?? 6_000, retry: { maxRetries: 2 } });
  const { answers } = await sparkLimiter().run(!!o.urgent, () => sdk!.systemOne({ state, questions }, { timeout: o.timeoutMs ?? 6_000 }));
  return answers;
}

export { choice, noul };
