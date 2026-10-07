import { z } from 'zod';
import { httpOptions, postWithRetry, type HttpOptions } from './http';
import { spark } from './providers';

type LunaOptions = { baseUrl?: string; apiKey?: string; model?: string; fetch?: typeof fetch; retryDelayMs?: number };

/** OpenAI-compatible chat completions with JSON-schema output: the Spark's qwen3.5:4b by default, or OpenAI's gpt-6-luna. */
export class LunaLlm {
  readonly id: string;
  private readonly http: HttpOptions;

  constructor(opts: LunaOptions = {}) {
    this.id = opts.model ?? process.env.LLM_MODEL ?? 'qwen3.5:4b';
    this.http = httpOptions(opts, spark());
  }

  async generate<T extends z.ZodTypeAny>({ system, prompt, schema, signal }: { system: string; prompt: string; schema: T; signal?: AbortSignal }): Promise<z.infer<T>> {
    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];
    const first = await this.complete(messages, schema, signal);
    const parsed = parse(first, schema);
    if (parsed.ok) return parsed.value;

    // One repair round: show the model its own output and what was wrong with it.
    messages.push({ role: 'assistant', content: first }, { role: 'user', content: `That reply was invalid:\n${parsed.error}\nReply again with only the corrected JSON.` });
    const retry = parse(await this.complete(messages, schema, signal), schema);
    if (retry.ok) return retry.value;
    throw new Error(`${this.id} returned invalid output twice: ${retry.error}`);
  }

  private async complete(messages: Message[], schema: z.ZodTypeAny, signal?: AbortSignal): Promise<string> {
    const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
    const res = await postWithRetry(
      this.http,
      '/chat/completions',
      JSON.stringify({
        model: this.id,
        reasoning_effort: 'none',
        response_format: { type: 'json_schema', json_schema: { name: 'output', strict: true, schema: jsonSchema } },
        messages,
      }),
      signal,
    );
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
