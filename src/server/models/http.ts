import {
  ModelHttpError, ModelTransportError, modelProviderErrorCode,
  type ModelHttpErrorKind, type ModelProviderErrorCode,
} from './errors';

// Both the Spark gateway and OpenAI answer 429 when busy; the Spark answers 502 while a model restarts, and its
// relay drops the odd connection. Every model call gets one retry on those. Mobilization opts into `PATIENT_RETRIES`.
const TRANSIENT: readonly number[] = [429, 502];
/** Mobilization's slow /responses calls can afford two retries on any transient status. */
export const PATIENT_RETRIES = { maxRetries: 2, retryStatuses: [408, 429, 500, 502, 503, 504] } as const;
const ERROR_BODY_LIMIT = 64 * 1024;

/** Safe, optional telemetry only. Model content, credentials, URLs and arbitrary errors never belong here. */
export type ModelDiagnostic = {
  stage: 'request_start' | 'response_headers' | 'response_body' | 'retry_wait' | 'repair' | 'complete' | 'cancelled' | 'transport_error';
  elapsedMs: number;
  request: number;
  attempt: number;
  phase?: 'request' | 'response_body' | 'retry_wait';
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
  requestedServiceTier?: 'default' | 'fast';
  actualServiceTier?: 'auto' | 'default' | 'flex' | 'scale' | 'priority' | 'fast' | 'ultrafast';
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cachedInputTokens?: number };
  errorCode?: ModelProviderErrorCode;
  failureKind?: ModelHttpErrorKind;
};
export type DiagnosticCallback = (diagnostic: ModelDiagnostic) => void | Promise<void>;
export type HttpDiagnostics = { onDiagnostic?: DiagnosticCallback; startedAt?: number; request?: number };

/** Diagnostics must never bypass mandatory audits, delay a request, or expose observer failures. */
export function emitDiagnostic(callback: DiagnosticCallback | undefined, diagnostic: ModelDiagnostic): void {
  if (!callback) return;
  try { void Promise.resolve(callback(diagnostic)).catch(() => {}); } catch { /* Best effort; no raw observer error. */ }
}

/** Only retain the recognizable OpenAI request-ID form, not arbitrary provider-supplied header text. */
export function diagnosticRequestId(res: Response): string | undefined {
  const value = res.headers.get('x-request-id');
  return value && /^req_[a-fA-F0-9]{16,64}$/.test(value) ? value : undefined;
}

export type HttpOptions = {
  baseUrl: string; apiKey: string | undefined; fetch: typeof fetch; retryDelayMs: number;
  maxRetries?: number; maxRetryElapsedMs?: number; retryStatuses?: readonly number[];
};

export async function postWithRetry(
  http: HttpOptions, path: string, body: string | FormData, signal?: AbortSignal, diagnostics: HttpDiagnostics = {},
): Promise<Response> {
  const url = `${http.baseUrl}${path}`;
  const init = (): RequestInit => ({
    method: 'POST',
    headers: {
      ...(http.apiKey ? { authorization: `Bearer ${http.apiKey}` } : {}),
      ...(typeof body === 'string' ? { 'content-type': 'application/json' } : {}),
    },
    body,
    signal,
  });
  const startedAt = Date.now();
  const diagnosticStartedAt = diagnostics.startedAt ?? startedAt;
  let attempt = 0;
  let phase: NonNullable<ModelDiagnostic['phase']> = 'request';
  const report = (event: Omit<ModelDiagnostic, 'elapsedMs' | 'request' | 'attempt'>) =>
    emitDiagnostic(diagnostics.onDiagnostic, {
      ...event, elapsedMs: Math.max(0, Date.now() - diagnosticStartedAt), request: diagnostics.request ?? 1, attempt,
    });
  const aborted = () => report({ stage: 'cancelled', phase });
  if (signal?.aborted) { aborted(); signal.throwIfAborted(); }
  signal?.addEventListener('abort', aborted, { once: true });
  // The caller's signal bounds provider execution; this additional budget bounds retries/backoff.
  const maxRetries = Number.isFinite(http.maxRetries) ? Math.max(0, Math.min(2, Math.floor(http.maxRetries!))) : 1;
  const retryStatuses = new Set(http.retryStatuses ?? TRANSIENT);
  const maxRetryElapsedMs = Number.isFinite(http.maxRetryElapsedMs) ? Math.max(0, Math.min(30_000, http.maxRetryElapsedMs!)) : 30_000;
  try {
    for (let retry = 0; ; retry++) {
      signal?.throwIfAborted();
      attempt = retry + 1;
      phase = 'request';
      report({ stage: 'request_start' });
      let failure: ModelHttpError | ModelTransportError;
      try {
        const res = await http.fetch(url, init());
        report({ stage: 'response_headers', status: res.status, requestId: diagnosticRequestId(res) });
        if (res.ok) return res;
        phase = 'response_body';
        const providerFailure = await responseError(res);
        failure = providerFailure;
        report({ stage: 'response_body', status: res.status, requestId: diagnosticRequestId(res),
          errorCode: providerFailure.code, failureKind: providerFailure.kind });
      } catch {
        signal?.throwIfAborted();
        failure = new ModelTransportError();
        report({ stage: 'transport_error', phase });
      }
      signal?.throwIfAborted();
      // Billing/quota errors need human action. Retrying them only consumes more requests.
      const retryable = failure instanceof ModelTransportError ||
        (failure.kind !== 'quota' && retryStatuses.has(failure.status));
      if (!retryable || retry >= maxRetries) throw failure;
      const base = (Number.isFinite(http.retryDelayMs) ? Math.max(0, http.retryDelayMs) : 1000) * 2 ** retry;
      const backoffMs = base + Math.floor(Math.random() * base / 2);
      // Retry-After is a minimum. If it does not fit the budget, fail instead of retrying early.
      const delayMs = Math.max(backoffMs, failure instanceof ModelHttpError ? failure.retryAfterMs ?? 0 : 0);
      if (Date.now() - startedAt + delayMs >= maxRetryElapsedMs) throw failure;
      phase = 'retry_wait';
      report({ stage: 'retry_wait', retryAfterMs: delayMs,
        ...(failure instanceof ModelHttpError ? { status: failure.status, errorCode: failure.code, failureKind: failure.kind } : {}) });
      await waitForRetry(delayMs, signal);
      if (Date.now() - startedAt >= maxRetryElapsedMs) throw failure;
    }
  } finally { signal?.removeEventListener('abort', aborted); }
}

async function responseError(res: Response): Promise<ModelHttpError> {
  const error = await errorFields(res);
  const code = modelProviderErrorCode(error?.code) ??
    (error?.type === 'insufficient_quota' ? 'insufficient_quota' : undefined);
  return new ModelHttpError(res.status, { code, quota: error?.type === 'insufficient_quota',
    retryAfterMs: retryAfter(res.headers.get('retry-after')) });
}

/** Read a bounded error JSON solely to classify known codes; never retain the raw body in an error/audit. */
async function errorFields(res: Response): Promise<{ code?: unknown; type?: unknown } | undefined> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = ''; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > ERROR_BODY_LIMIT) { await reader.cancel(); return; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error && typeof parsed.error === 'object') {
      const fields = parsed.error as Record<string, unknown>;
      return { code: fields.code, type: fields.type };
    }
  } catch { /* Invalid/non-JSON provider errors still have an actionable HTTP status. */ }
  finally { reader.releaseLock(); }
}

function retryAfter(value: string | null): number | undefined {
  if (!value?.trim()) return;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Math.min(Number.MAX_SAFE_INTEGER, Number(text) * 1000);
  }
  // HTTP-date form, not arbitrary Date.parse inputs such as "-1".
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) return;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal!.reason); };
    const timer = setTimeout(finish, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function httpOptions(
  opts: { baseUrl?: string; apiKey?: string; fetch?: typeof fetch; retryDelayMs?: number },
  defaults: { baseUrl: string; apiKey: string | undefined },
): HttpOptions {
  return {
    baseUrl: opts.baseUrl ?? defaults.baseUrl,
    apiKey: opts.apiKey ?? defaults.apiKey,
    fetch: opts.fetch ?? fetch,
    retryDelayMs: opts.retryDelayMs ?? 1000,
  };
}
