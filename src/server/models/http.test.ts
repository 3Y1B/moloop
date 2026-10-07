import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelHttpError, ModelTransportError } from './errors';
import { postWithRetry, type HttpOptions, type ModelDiagnostic } from './http';

const ok = () => new Response('{}', { status: 200 });
const failed = (status = 429, code?: string, headers?: HeadersInit, type?: string) =>
  new Response(JSON.stringify({ error: { code, type, message: 'Echoed TEST_SECRET and https://private.test/key' } }), { status, headers });
const options = (fetch: typeof globalThis.fetch, extra: Partial<HttpOptions> = {}): HttpOptions => ({
  baseUrl: 'https://private.test/v1', apiKey: 'TEST_SECRET', fetch, retryDelayMs: 1000, ...extra,
});
const post = (http: HttpOptions, signal?: AbortSignal) => postWithRetry(http, '/chat/completions', '{}', signal);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('safe, bounded model transport (offline only)', () => {
  it('records only safe metadata at dispatch, headers and HTTP error-body stages', async () => {
    const events: ModelDiagnostic[] = [];
    const fetch = vi.fn(async () => {
      vi.setSystemTime(Date.now() + 23);
      return failed(401, 'TEST_SECRET', { 'x-request-id': 'req_0123456789abcdef0123456789abcdef', 'x-private-key': 'TEST_SECRET' });
    });
    await expect(postWithRetry(options(fetch), '/chat/completions', '{"private":"TEST_SECRET"}', undefined,
      { onDiagnostic: (event) => { events.push(event); } })).rejects.toBeInstanceOf(ModelHttpError);
    expect(events).toMatchObject([
      { stage: 'request_start', elapsedMs: 0, request: 1, attempt: 1 },
      { stage: 'response_headers', elapsedMs: 23, request: 1, attempt: 1, status: 401, requestId: 'req_0123456789abcdef0123456789abcdef' },
      { stage: 'response_body', elapsedMs: 23, status: 401, failureKind: 'http' },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/TEST_SECRET|private\.test|x-private-key|Echoed/);
  });

  it.each(['TEST_SECRET', 'req_TEST_SECRET', 'https://private.test/req_0123456789abcdef'])('omits unrecognized request ID %s', async (id) => {
    const events: ModelDiagnostic[] = [];
    const fetch = vi.fn(async () => new Response('{}', { headers: { 'x-request-id': id } }));
    await postWithRetry(options(fetch), '/chat/completions', '{}', undefined, { onDiagnostic: (event) => { events.push(event); } });
    expect(events.find((event) => event.stage === 'response_headers')?.requestId).toBeUndefined();
  });

  it('records retry timing and sequential attempt numbers without changing backoff', async () => {
    const events: ModelDiagnostic[] = [];
    const fetch = vi.fn().mockResolvedValueOnce(failed(503, 'server_is_overloaded')).mockResolvedValueOnce(ok());
    const result = postWithRetry(options(fetch), '/chat/completions', '{}', undefined, { request: 2, startedAt: Date.now() - 50,
      onDiagnostic: (event) => { events.push(event); } });
    await vi.runAllTimersAsync();
    expect((await result).ok).toBe(true);
    expect(events.filter((event) => event.stage === 'request_start')).toMatchObject([
      { request: 2, attempt: 1, elapsedMs: 50 }, { request: 2, attempt: 2, elapsedMs: 1050 },
    ]);
    expect(events.find((event) => event.stage === 'retry_wait')).toMatchObject({ status: 503, retryAfterMs: 1000, errorCode: 'server_is_overloaded' });
  });

  it('records cancelled requests and sends no retry after cancellation', async () => {
    const cancel = new AbortController(); const events: ModelDiagnostic[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const result = postWithRetry(options(fetch), '/chat/completions', '{}', cancel.signal,
      { onDiagnostic: (event) => { events.push(event); } }).catch((error) => error);
    cancel.abort();
    expect((await result).name).toBe('AbortError');
    expect(events).toMatchObject([{ stage: 'request_start', attempt: 1 }, { stage: 'cancelled', phase: 'request', attempt: 1 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores rejected or never-settling diagnostics without delaying or failing a request', async () => {
    const fetch = vi.fn(async () => ok()); let calls = 0;
    const response = await postWithRetry(options(fetch), '/chat/completions', '{}', undefined, { onDiagnostic: () => {
      calls++; return calls === 1 ? Promise.reject(new Error('TEST_SECRET observer failure')) : new Promise<void>(() => {});
    } });
    expect(response.ok).toBe(true); expect(fetch).toHaveBeenCalledTimes(1); expect(calls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'credit_balance_exhausted', 'insufficient_quota', 'organization_spend_limit_exceeded',
    'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
  ])('does not retry a %s 429', async (code) => {
    const fetch = vi.fn(async () => failed(429, code));
    const error = await post(options(fetch)).catch((error) => error);
    expect(error).toBeInstanceOf(ModelHttpError);
    expect(error).toMatchObject({ status: 429, code, kind: 'quota' });
    expect(error.message).toContain('before retrying');
    expect(error.message).not.toMatch(/TEST_SECRET|private\.test|Echoed/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recognizes legacy insufficient_quota type even when the provider code is unknown', async () => {
    const fetch = vi.fn(async () => failed(429, 'TEST_SECRET', undefined, 'insufficient_quota'));
    const error = await post(options(fetch)).catch((error) => error);
    expect(error).toMatchObject({ kind: 'quota', code: 'insufficient_quota' });
    expect(error.message).not.toContain('TEST_SECRET');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a quota type even when a provider inconsistently labels its code as rate_limit_exceeded', async () => {
    const fetch = vi.fn(async () => failed(429, 'rate_limit_exceeded', undefined, 'insufficient_quota'));
    const error = await post(options(fetch)).catch((error) => error);
    expect(error.kind).toBe('quota');
    expect(error.message).toContain('API quota exhausted');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses bounded exponential backoff with jitter and stops after three attempts', async () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    const startedAt = Date.now(); const times: number[] = [];
    const fetch = vi.fn(async () => { times.push(Date.now() - startedAt); return failed(429, 'rate_limit_exceeded'); });
    const result = post(options(fetch)).catch((error) => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 429, kind: 'rate_limit', code: 'rate_limit_exceeded' });
    expect(times).toEqual([0, 1250, 3750]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['5', 'Thu, 08 Oct 2026 00:00:05 GMT'])('respects Retry-After %s as a minimum', async (retryAfter) => {
    const fetch = vi.fn().mockResolvedValueOnce(failed(429, 'rate_limit_exceeded', { 'retry-after': retryAfter })).mockResolvedValueOnce(ok());
    const result = post(options(fetch));
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails with actionable Retry-After metadata instead of retrying before a long server delay', async () => {
    const fetch = vi.fn(async () => failed(429, 'rate_limit_exceeded', { 'retry-after': '60' }));
    const error = await post(options(fetch)).catch((error) => error);
    expect(error).toMatchObject({ retryAfterMs: 60_000 });
    expect(error.message).toContain('Retry after at least 60 seconds');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry an unrepresentably large numeric Retry-After early', async () => {
    const fetch = vi.fn(async () => failed(429, undefined, { 'retry-after': '9'.repeat(400) }));
    const error = await post(options(fetch)).catch((error) => error);
    expect(error).toMatchObject({ retryAfterMs: Number.MAX_SAFE_INTEGER });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['-1', 'tomorrow', 'TEST_SECRET'])('uses bounded backoff for invalid Retry-After %s', async (retryAfter) => {
    const fetch = vi.fn().mockResolvedValueOnce(failed(429, undefined, { 'retry-after': retryAfter })).mockResolvedValueOnce(ok());
    const result = post(options(fetch));
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).ok).toBe(true);
  });

  it('stops retrying when the next delay cannot fit the elapsed budget', async () => {
    const fetch = vi.fn(async () => failed());
    const result = post(options(fetch, { maxRetryElapsedMs: 2000 })).catch((error) => error);
    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(ModelHttpError);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Date.now()).toBe(new Date('2026-10-08T00:00:01Z').getTime());
  });

  it('includes provider execution time in the retry budget', async () => {
    const fetch = vi.fn(async () => { vi.setSystemTime(Date.now() + 30_000); return failed(); });
    expect(await post(options(fetch)).catch((error) => error)).toBeInstanceOf(ModelHttpError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not send any request when already cancelled', async () => {
    const cancel = new AbortController(); cancel.abort();
    const fetch = vi.fn(async () => ok());
    await expect(post(options(fetch), cancel.signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels a backoff timer without dispatching another request', async () => {
    const cancel = new AbortController();
    const fetch = vi.fn(async () => failed(429, undefined, { 'retry-after': '5' }));
    const result = post(options(fetch), cancel.signal).catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    cancel.abort();
    expect((await result).name).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors the caller deadline even while waiting for Retry-After', async () => {
    const cancel = new AbortController();
    const fetch = vi.fn(async () => failed(429, undefined, { 'retry-after': '5' }));
    const result = post(options(fetch), cancel.signal).catch((error) => error);
    setTimeout(() => cancel.abort(), 1500);
    await vi.advanceTimersByTimeAsync(1500);
    expect((await result).name).toBe('AbortError');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries transient 503 and connection drops without exposing transport messages', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(failed(503, 'server_is_overloaded'))
      .mockRejectedValueOnce(new TypeError('TEST_SECRET at https://private.test/key')).mockResolvedValueOnce(ok());
    const result = post(options(fetch));
    await vi.runAllTimersAsync();
    expect((await result).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps exhausted connection errors safe', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('TEST_SECRET at https://private.test/key'); });
    const result = post(options(fetch)).catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await result;
    expect(error).toBeInstanceOf(ModelTransportError);
    expect(error.message).toBe('Model provider connection failed. Try again later.');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry other HTTP errors or copy an arbitrary provider code', async () => {
    const fetch = vi.fn(async () => failed(401, 'TEST_SECRET'));
    expect(await post(options(fetch)).catch((error) => error)).toEqual(new ModelHttpError(401));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new ModelHttpError(429, { code: 'TEST_SECRET' as any }).message).not.toContain('TEST_SECRET');
  });

  it('caps error-body parsing and preserves safe status-only failure for oversized bodies', async () => {
    const fetch = vi.fn(async () => new Response('TEST_SECRET'.repeat(10_000), { status: 429 }));
    const error = await post(options(fetch, { maxRetries: 0 })).catch((error) => error);
    expect(error).toMatchObject({ status: 429, kind: 'rate_limit', code: undefined });
    expect(error.message).not.toContain('TEST_SECRET');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
