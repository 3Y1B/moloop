import { z } from 'zod';
import type { Llm } from './types';

type LunaOptions = { baseUrl?: string; apiKey?: string; model?: string; fetch?: typeof fetch; retryDelayMs?: number };

// The gateway answers 429 when busy and 502 while a model restarts; its relay also drops the odd connection.
const TRANSIENT = new Set([429, 502]);

/** Spark's OpenAI-compatible chat endpoint (docs/local-llm-api-docs.md). */
export class LunaLlm implements Llm {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetch: typeof fetch;
  private readonly retryDelayMs: number;

  constructor(opts: LunaOptions = {}) {
    this.id = opts.model ?? process.env.LLM_MODEL ?? 'qwen3.5:4b';
    this.baseUrl = opts.baseUrl ?? process.env.SPARK_BASE_URL ?? 'https://spark-2053.taild1460f.ts.net/v1';
    this.apiKey = opts.apiKey ?? process.env.SPARK_API_KEY;
    this.fetch = opts.fetch ?? fetch;
    this.retryDelayMs = opts.retryDelayMs ?? 1000;
  }

  async generate<T extends z.ZodTypeAny>({ system, prompt, schema }: { system: string; prompt: string; schema: T }): Promise<z.infer<T>> {
    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];
    const first = await this.complete(messages, schema);
    const parsed = parse(first, schema);
    if (parsed.ok) return parsed.value;

    // One repair round: show the model its own output and what was wrong with it.
    messages.push({ role: 'assistant', content: first }, { role: 'user', content: `That reply was invalid:\n${parsed.error}\nReply again with only the corrected JSON.` });
    const retry = parse(await this.complete(messages, schema), schema);
    if (retry.ok) return retry.value;
    throw new Error(`${this.id} returned invalid output twice: ${retry.error}`);
  }

  private async complete(messages: Message[], schema: z.ZodTypeAny): Promise<string> {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.id,
        reasoning_effort: 'none',
        response_format: { type: 'json_schema', json_schema: { name: 'output', strict: true, schema: z.toJSONSchema(schema) } },
        messages,
      }),
    };
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/chat/completions`, init);
      if (TRANSIENT.has(res.status)) throw new Error(`spark ${res.status}`);
    } catch {
      await new Promise((r) => setTimeout(r, this.retryDelayMs));
      res = await this.fetch(`${this.baseUrl}/chat/completions`, init);
    }
    if (!res.ok) throw new Error(`spark ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0].message.content;
  }
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

function parse<T extends z.ZodTypeAny>(content: string, schema: T): { ok: true; value: z.infer<T> } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    return { ok: false, error: `Not valid JSON (${(e as Error).message})` };
  }
  const result = schema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: z.prettifyError(result.error) };
}
