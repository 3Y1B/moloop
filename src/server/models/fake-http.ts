/** Test double for a model HTTP API: answers each request with the next queued reply and records what it was sent. */
export type FakeReply = { status?: number; json?: unknown; bytes?: Uint8Array<ArrayBuffer>; drop?: boolean };

export type RecordedRequest = { url: string; headers: Record<string, string>; json?: any; form?: FormData; signal?: AbortSignal | null };

export function fakeHttp(...replies: FakeReply[]) {
  const requests: RecordedRequest[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body;
    requests.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      signal: init?.signal,
      ...(body instanceof FormData ? { form: body } : { json: body ? JSON.parse(String(body)) : undefined }),
    });
    const reply = replies.shift();
    if (!reply) throw new Error('fakeHttp: no reply queued');
    if (reply.drop) throw new TypeError('fetch failed');
    const status = reply.status ?? 200;
    if (reply.bytes) return new Response(reply.bytes, { status, headers: { 'content-type': 'audio/mpeg' } });
    return new Response(JSON.stringify(status === 200 ? reply.json : { error: 'busy' }), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}
