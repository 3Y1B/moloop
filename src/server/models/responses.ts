import { z } from 'zod';

import { ModelAuditError, ModelTransportError } from './errors';
import {
  diagnosticRequestId, emitDiagnostic, httpOptions, PATIENT_RETRIES, postWithRetry,
  type DiagnosticCallback, type HttpOptions, type ModelDiagnostic,
} from './http';

export type ReadTool<A extends z.ZodType> = {
  name: string;
  description: string;
  args: A;
  /** Read only, from the calling run's immutable snapshot; audit the result before resolving. */
  execute: (args: z.infer<A>, callId: string) => Promise<string>;
};
export type ReadToolGenerationArgs<T extends z.ZodType, A extends z.ZodType> = {
  system: string; prompt: string; schema: T | (() => T); tool: ReadTool<A>;
};
export type ResponsesOptions = {
  signal?: AbortSignal;
  maxTokens?: number;
  toolMaxTokens?: number;
  reasoningEffort: string;
  /** Explicit per-call opt-in. Omission preserves the provider project's tier policy. */
  serviceTier?: 'default' | 'fast';
  /** Both complete successful Responses envelopes are audited before any interpretation. */
  onResponse: (response: string) => void | Promise<void>;
  onDiagnostic?: DiagnosticCallback;
};
type ResponseEnvelope = { status?: unknown; output?: unknown; usage?: unknown };
type Diagnostics = { callback?: DiagnosticCallback; startedAt: number; request: number; attempt: number;
  requestedServiceTier?: ResponsesOptions['serviceTier'] };
type Item = Record<string, unknown>;
const isItem = (value: unknown): value is Item => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedTokens = (value: number | undefined, fallback: number) => {
  if (value != null && (!Number.isSafeInteger(value) || value < 32 || value > 16_000))
    throw new Error('Responses token budget must be an integer between 32 and 16000');
  return value ?? fallback;
};
const jsonSchemaOf = (schema: z.ZodType) => {
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  return jsonSchema;
};
const validatedServiceTier = (value: ResponsesOptions['serviceTier']) => {
  if (value != null && value !== 'default' && value !== 'fast')
    throw new Error('Responses service tier must be default or fast');
  return value;
};
const actualServiceTier = (value: unknown): ModelDiagnostic['actualServiceTier'] =>
  typeof value === 'string' && ['auto', 'default', 'flex', 'scale', 'priority', 'fast', 'ultrafast'].includes(value)
    ? value as ModelDiagnostic['actualServiceTier'] : undefined;

/** Mobilization's bounded read-only seam: exactly one retrieval round, then one strict final response. */
export class ReadToolResponses {
  private readonly http: HttpOptions;

  constructor(private readonly configuration: {
    baseUrl: string; apiKey: string | undefined; model: string;
    fetch?: typeof fetch; retryDelayMs?: number;
  }) {
    this.http = { ...httpOptions(configuration, configuration), ...PATIENT_RETRIES };
  }

  async generate<T extends z.ZodType, A extends z.ZodType>(
    { system, prompt, schema, tool }: ReadToolGenerationArgs<T, A>, options: ResponsesOptions,
  ): Promise<z.infer<T>> {
    if (typeof options.onResponse !== 'function') throw new ModelAuditError();
    const toolMaxTokens = boundedTokens(options.toolMaxTokens, 2_000);
    const finalMaxTokens = boundedTokens(options.maxTokens, 12_000);
    const tier = validatedServiceTier(options.serviceTier);
    const diagnostics: Diagnostics = { callback: options.onDiagnostic, startedAt: Date.now(), request: 1, attempt: 1,
      requestedServiceTier: tier };
    const input: unknown[] = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];
    const common = {
      model: this.configuration.model,
      reasoning: { effort: options.reasoningEffort },
      store: false,
      include: ['reasoning.encrypted_content'],
      // Never silently discard safety evidence or opaque reasoning when the context is too large.
      truncation: 'disabled',
      parallel_tool_calls: false,
      ...(tier == null ? {} : { service_tier: tier }),
    };
    const first = await this.complete({
      ...common, input, max_output_tokens: toolMaxTokens,
      tools: [{ type: 'function', name: tool.name, description: tool.description,
        parameters: jsonSchemaOf(tool.args), strict: true }],
      tool_choice: { type: 'function', name: tool.name },
    }, options, diagnostics);
    const firstOutput = completedOutput(first);
    if (firstOutput.some((item) => !['message', 'reasoning', 'function_call'].includes(String(item.type))))
      throw new Error('Responses retrieval round returned an unsupported action');
    const calls = firstOutput.filter((item) => item.type === 'function_call');
    if (calls.length !== 1) throw new Error('Responses must return exactly one read-tool call');
    const call = calls[0];
    if (call.name !== tool.name) throw new Error('Responses requested an unknown read tool');
    if (typeof call.call_id !== 'string' || !call.call_id.trim() || call.call_id.length > 200)
      throw new Error('Responses read-tool call has no valid call_id');
    if (call.status != null && call.status !== 'completed') throw new Error('Responses read-tool call is incomplete');
    if (typeof call.arguments !== 'string') throw new Error('Responses read-tool arguments are not JSON');
    let argumentsJson: unknown;
    try { argumentsJson = JSON.parse(call.arguments); }
    catch { throw new Error('Responses read-tool arguments are not JSON'); }
    const argumentsResult = tool.args.safeParse(argumentsJson);
    if (!argumentsResult.success) throw new Error('Responses read-tool arguments failed schema validation');
    options.signal?.throwIfAborted();
    const result = await tool.execute(argumentsResult.data, call.call_id);
    options.signal?.throwIfAborted();
    if (typeof result !== 'string') throw new Error('Responses read-tool result must be a string');
    // A retrieval-dependent contract is resolved only after the raw reply and read result have
    // been audited. Failure stops here: no final request, repair or unvalidated output is allowed.
    let finalSchema: T;
    let finalJsonSchema: Record<string, unknown>;
    try {
      finalSchema = typeof schema === 'function' ? schema() : schema;
      if (!(finalSchema instanceof z.ZodType)) throw new Error('Invalid schema');
      finalJsonSchema = jsonSchemaOf(finalSchema);
    } catch {
      throw new Error('Responses final schema resolution failed');
    }
    options.signal?.throwIfAborted();
    // Stateless replay preserves the entire ordered output, including opaque encrypted reasoning.
    input.push(...firstOutput, { type: 'function_call_output', call_id: call.call_id, output: result });
    diagnostics.request = 2;
    const final = await this.complete({
      ...common, input, max_output_tokens: finalMaxTokens,
      tool_choice: 'none',
      text: { verbosity: 'low', format: { type: 'json_schema', name: 'output', strict: true, schema: finalJsonSchema } },
    }, options, diagnostics);
    const resultValue = parseFinal(final, finalSchema);
    options.signal?.throwIfAborted();
    report(diagnostics, { stage: 'complete' });
    return resultValue;
  }

  /**
   * One strict response, no tool: for a planner whose source material (one playbook, already read and audited by the
   * caller) is in the prompt. Half the round trips of `generate`.
   */
  async generateDirect<T extends z.ZodType>(
    { system, prompt, schema }: { system: string; prompt: string; schema: T },
    options: ResponsesOptions,
  ): Promise<z.infer<T>> {
    if (typeof options.onResponse !== 'function') throw new ModelAuditError();
    const tier = validatedServiceTier(options.serviceTier);
    const diagnostics: Diagnostics = { callback: options.onDiagnostic, startedAt: Date.now(), request: 1, attempt: 1,
      requestedServiceTier: tier };
    const final = await this.complete({
      model: this.configuration.model,
      reasoning: { effort: options.reasoningEffort },
      store: false,
      truncation: 'disabled',
      ...(tier == null ? {} : { service_tier: tier }),
      input: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_output_tokens: boundedTokens(options.maxTokens, 12_000),
      text: { verbosity: 'low', format: { type: 'json_schema', name: 'output', strict: true, schema: jsonSchemaOf(schema) } },
    }, options, diagnostics);
    const resultValue = parseFinal(final, schema);
    options.signal?.throwIfAborted();
    report(diagnostics, { stage: 'complete' });
    return resultValue;
  }

  private async complete(body: Record<string, unknown>, options: ResponsesOptions, diagnostics: Diagnostics): Promise<ResponseEnvelope> {
    options.signal?.throwIfAborted();
    const response = await postWithRetry(this.http, '/responses', JSON.stringify(body), options.signal, {
      startedAt: diagnostics.startedAt, request: diagnostics.request,
      onDiagnostic: (event) => {
        diagnostics.attempt = event.attempt;
        emitDiagnostic(diagnostics.callback, { ...event, requestedServiceTier: diagnostics.requestedServiceTier });
      },
    });
    const cancelled = () => report(diagnostics, { stage: 'cancelled', phase: 'response_body', status: response.status,
      requestId: diagnosticRequestId(response) });
    if (options.signal?.aborted) { cancelled(); options.signal.throwIfAborted(); }
    options.signal?.addEventListener('abort', cancelled, { once: true });
    let raw: string;
    try { raw = await response.text(); }
    catch {
      // A successful HTTP header is not a complete reply. Never audit/parse partial bytes,
      // expose arbitrary socket messages or regenerate a response after its body fails.
      options.signal?.throwIfAborted();
      report(diagnostics, { stage: 'transport_error', phase: 'response_body', status: response.status,
        requestId: diagnosticRequestId(response) });
      throw new ModelTransportError();
    }
    finally { options.signal?.removeEventListener('abort', cancelled); }
    const bodyElapsedMs = Math.max(0, Date.now() - diagnostics.startedAt);
    // An audit error must never be reclassified as a provider failure or bypassed by a fallback.
    try { await options.onResponse(raw); } catch { throw new ModelAuditError(); }
    options.signal?.throwIfAborted();
    let data: unknown;
    try { data = JSON.parse(raw); }
    catch { throw new Error('Responses provider returned invalid JSON'); }
    if (!isItem(data)) throw new Error('Responses provider returned an invalid envelope');
    emitDiagnostic(diagnostics.callback, { stage: 'response_body', status: response.status,
      requestId: diagnosticRequestId(response), usage: responseUsage(data.usage), elapsedMs: bodyElapsedMs,
      requestedServiceTier: diagnostics.requestedServiceTier, actualServiceTier: actualServiceTier(data.service_tier),
      request: diagnostics.request, attempt: diagnostics.attempt });
    return data;
  }
}

function parseFinal<T extends z.ZodType>(response: ResponseEnvelope, schema: T): z.infer<T> {
  const finalOutput = completedOutput(response);
  if (finalOutput.some((item) => item.type !== 'message' && item.type !== 'reasoning'))
    throw new Error('Responses final round cannot request a tool or other action');
  const text = finalOutput.filter((item) => item.type === 'message').flatMap((item) => {
    if (item.role !== 'assistant' || !Array.isArray(item.content))
      throw new Error('Responses final message is invalid');
    return item.content.map((part: unknown) => {
      if (!isItem(part) || part.type !== 'output_text' || typeof part.text !== 'string')
        throw new Error('Responses final message must contain JSON text');
      return part.text;
    });
  }).join('');
  if (!text.trim()) throw new Error('Responses returned an empty final reply');
  let json: unknown;
  try { json = JSON.parse(text); }
  catch { throw new Error('Responses returned invalid final JSON'); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error('Responses final output failed schema validation');
  return parsed.data;
}

function completedOutput(response: ResponseEnvelope): Item[] {
  if (response.status !== 'completed') throw new Error('Responses generation did not complete');
  if (!Array.isArray(response.output) || !response.output.every(isItem))
    throw new Error('Responses provider returned invalid output items');
  if (response.output.some((item) => item.status != null && item.status !== 'completed'))
    throw new Error('Responses provider returned an incomplete output item');
  if (response.output.some((item) => item.type === 'message' && Array.isArray(item.content) &&
    item.content.some((part: unknown) => isItem(part) && part.type === 'refusal')))
    throw new Error('Responses model refused the structured response');
  return response.output;
}

const report = (diagnostics: Diagnostics, event: Omit<ModelDiagnostic, 'elapsedMs' | 'request' | 'attempt'>) =>
  emitDiagnostic(diagnostics.callback, { ...event, elapsedMs: Math.max(0, Date.now() - diagnostics.startedAt),
    request: diagnostics.request, attempt: diagnostics.attempt, requestedServiceTier: diagnostics.requestedServiceTier });

function responseUsage(value: unknown): ModelDiagnostic['usage'] {
  if (!isItem(value)) return;
  const details = value.output_tokens_details;
  const inputDetails = value.input_tokens_details;
  const count = (n: unknown): number | undefined => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
  const selected = { inputTokens: count(value.input_tokens), outputTokens: count(value.output_tokens),
    reasoningTokens: count(isItem(details) ? details.reasoning_tokens : undefined),
    cachedInputTokens: count(isItem(inputDetails) ? inputDetails.cached_tokens : undefined) };
  return Object.values(selected).some((n) => n != null) ? selected : undefined;
}
