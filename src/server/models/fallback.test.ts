import { describe, expect, it } from 'vitest';
import { withFallback, type Attempt } from './fallback';

const hangs = () => new Promise<never>(() => {});
const model = <R>(id: string, call: (signal: AbortSignal) => Promise<R>): Attempt<R> => ({ id, call });
const limits = { primaryMs: 10, lastMs: 50 };

describe('withFallback', () => {
  it('cancels the primary request when it times out, so a struggling Spark is not left doing the work', async () => {
    let seen: AbortSignal | undefined;
    const spark = model('spark', (signal) => {
      seen = signal;
      return hangs();
    });

    await withFallback(spark, model('openai', async () => 'from openai'), limits);

    expect(seen?.aborted).toBe(true);
  });

  it("returns the primary's answer when it works", async () => {
    await expect(withFallback(model('spark', async () => 'from spark'), model('openai', async () => 'from openai'), limits)).resolves.toBe('from spark');
  });

  it('uses the fallback when the primary fails', async () => {
    const spark = model('spark', async () => {
      throw new Error('spark 502');
    });

    await expect(withFallback(spark, model('openai', async () => 'from openai'), limits)).resolves.toBe('from openai');
  });

  it('uses the fallback when the primary hangs past its time limit', async () => {
    await expect(withFallback(model('spark', hangs), model('openai', async () => 'from openai'), limits)).resolves.toBe('from openai');
  });

  it('goes straight to the fallback when there is no primary (OpenAI only)', async () => {
    await expect(withFallback(null, model('openai', async () => 'from openai'), limits)).resolves.toBe('from openai');
  });

  it("throws the primary's error when there is no fallback, after the longer limit", async () => {
    const slow = model('spark', () => new Promise<string>((r) => setTimeout(() => r('late but in time'), 25)));

    await expect(withFallback(slow, null, limits)).resolves.toBe('late but in time');
    await expect(withFallback(model('spark', async () => { throw new Error('spark 502'); }), null, limits)).rejects.toThrow('spark 502');
  });

  it("tries nothing more once the caller's signal fires", async () => {
    let asked = false;
    const signal = AbortSignal.timeout(5);

    await expect(withFallback(model('spark', hangs), model('openai', async () => { asked = true; return 'x'; }), { primaryMs: 1_000, lastMs: 1_000, signal })).rejects.toThrow();
    expect(asked).toBe(false);
  });

  it('times out the last resort too', async () => {
    await expect(withFallback(model('spark', hangs), model('openai', hangs), limits)).rejects.toThrow(/openai timed out after 50 ms/);
  });
});
