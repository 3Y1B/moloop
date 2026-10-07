// Both the Spark gateway and OpenAI answer 429 when busy; the Spark answers 502 while a model restarts,
// and its relay drops the odd connection. Those get one retry; anything else non-2xx throws.
const TRANSIENT = new Set([429, 502]);

export type HttpOptions = { baseUrl: string; apiKey: string | undefined; fetch: typeof fetch; retryDelayMs: number };

export async function postWithRetry(http: HttpOptions, path: string, body: string | FormData, signal?: AbortSignal): Promise<Response> {
  const url = `${http.baseUrl}${path}`;
  const init = (): RequestInit => ({
    method: 'POST',
    headers: {
      authorization: `Bearer ${http.apiKey}`,
      ...(typeof body === 'string' ? { 'content-type': 'application/json' } : {}),
    },
    body,
    signal,
  });
  let res: Response;
  try {
    res = await http.fetch(url, init());
    if (TRANSIENT.has(res.status)) throw new Error(`${url} ${res.status}`);
  } catch (e) {
    if (signal?.aborted) throw e;
    await new Promise((r) => setTimeout(r, http.retryDelayMs));
    res = await http.fetch(url, init());
  }
  if (!res.ok) throw new Error(`${url} ${res.status}: ${await res.text()}`);
  return res;
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
