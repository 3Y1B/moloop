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

  /**
   * One step of a tool-using agent: the model calls one of `tools`, or replies in plain text. Arguments are checked
   * against the tool's schema; a bad call gets one repair round, with the error sent back as the tool's result.
   */
  async callTool({ system, prompt, tools, signal }: { system: string; prompt: string; tools: Tool[]; signal?: AbortSignal }): Promise<ToolCall> {
    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];
    const first = await this.completeWithTools(messages, tools, signal);
    const parsed = parseCall(first, tools);
    if (parsed.ok) return parsed.value;

    const call = first.tool_calls?.[0];
    messages.push(
      { role: 'assistant', content: first.content ?? null, tool_calls: first.tool_calls },
      call
        ? { role: 'tool', tool_call_id: call.id, content: `That call was invalid:\n${parsed.error}\nCall the tool again with corrected arguments.` }
        : { role: 'user', content: `That reply was invalid:\n${parsed.error}` },
    );
    const retry = parseCall(await this.completeWithTools(messages, tools, signal), tools);
    if (retry.ok) return retry.value;
    throw new Error(`${this.id} made an invalid tool call twice: ${retry.error}`);
  }

  private async completeWithTools(messages: Message[], tools: Tool[], signal?: AbortSignal): Promise<Reply> {
    const res = await postWithRetry(
      this.http,
      '/chat/completions',
      JSON.stringify({
        model: this.id,
        reasoning_effort: 'none',
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, strict: true, parameters: jsonSchemaOf(t.args) },
        })),
        tool_choice: 'auto',
        parallel_tool_calls: false,
        messages,
      }),
      signal,
    );
    const data = (await res.json()) as { choices: { message: Reply }[] };
    return data.choices[0].message;
  }

  private async complete(messages: Message[], schema: z.ZodTypeAny, signal?: AbortSignal): Promise<string> {
    const jsonSchema = jsonSchemaOf(schema);
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

/** A function the model may call. `args` validates what it passes. */
export type Tool<A extends z.ZodTypeAny = z.ZodTypeAny> = { name: string; description: string; args: A };

/** What the model did: called a tool with valid arguments, or replied without one. */
export type ToolCall = { tool: string; args: unknown; text?: undefined } | { tool?: undefined; text: string };

type WireCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Reply = { content?: string | null; tool_calls?: WireCall[] };

type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: WireCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const jsonSchemaOf = (schema: z.ZodTypeAny) => {
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  return jsonSchema;
};

function parseCall(reply: Reply, tools: Tool[]): { ok: true; value: ToolCall } | { ok: false; error: string } {
  const call = reply.tool_calls?.[0];
  if (!call) return reply.content?.trim() ? { ok: true, value: { text: reply.content.trim() } } : { ok: false, error: 'Empty reply: call a tool.' };
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) return { ok: false, error: `No tool named "${call.function.name}". Use one of: ${tools.map((t) => t.name).join(', ')}.` };
  const args = parse(call.function.arguments, tool.args);
  return args.ok ? { ok: true, value: { tool: tool.name, args: args.value } } : args;
}

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
