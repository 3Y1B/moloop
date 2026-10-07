import { ModelAuditError } from './errors';

export type Attempt<R> = { id: string; call: (signal: AbortSignal) => Promise<R> };

/**
 * Try the primary; if it errors or runs past `primaryMs`, abort it (so a struggling Spark isn't left working on an
 * answer nobody will use) and ask the fallback, which gets `lastMs`. Either may be missing: whichever is there alone
 * gets `lastMs`. `signal` bounds the whole call; once it fires nothing more is tried.
 */
export async function withFallback<R>(
  primary: Attempt<R> | null,
  fallback: Attempt<R> | null,
  { primaryMs, lastMs, signal }: { primaryMs: number; lastMs: number; signal?: AbortSignal },
): Promise<R> {
  if (!primary && !fallback) throw new Error('no model configured: set OPENAI_API_KEY');
  if (primary) {
    try {
      return await attempt(primary, fallback ? primaryMs : lastMs, signal);
    } catch (e) {
      if (!fallback || signal?.aborted || e instanceof ModelAuditError) throw e;
      console.warn(`model ${primary.id} failed, using ${fallback.id}:`, (e as Error).message);
    }
  }
  return attempt(fallback!, lastMs, signal);
}

async function attempt<R>(m: Attempt<R>, ms: number, outer?: AbortSignal): Promise<R> {
  if (outer?.aborted) throw outer.reason;
  const cancel = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      cancel.abort();
      reject(new Error(`${m.id} timed out after ${ms} ms`));
    }, ms);
    onAbort = () => {
      cancel.abort();
      reject(outer!.reason);
    };
    outer?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([m.call(cancel.signal), stop]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort!);
  }
}
