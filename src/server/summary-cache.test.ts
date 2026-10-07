import { describe, expect, it, vi } from 'vitest';

import { summaryCache } from './summary-cache';

const SEC = 1000;

function setup() {
  let t = 0;
  const cache = summaryCache<string>({ now: () => t });
  return { cache, tick: (ms: number) => (t += ms) };
}

describe('summaryCache', () => {
  it('answers again from the cache until something new happens', async () => {
    const { cache } = setup();
    const make = vi.fn(async () => 'Quiet shift');
    expect(await cache.get('task:faint', 'e1', {}, make)).toBe('Quiet shift');
    expect(await cache.get('task:faint', 'e1', {}, make)).toBe('Quiet shift');
    expect(make).toHaveBeenCalledTimes(1);

    const after = vi.fn(async () => 'Priya is with him');
    expect(await cache.get('task:faint', 'e2', {}, after)).toBe('Priya is with him');
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('keeps each scope apart', async () => {
    const { cache } = setup();
    await cache.get('task:faint', 'e1', {}, async () => 'faint');
    expect(await cache.get('task:spill', 'e1', {}, async () => 'spill')).toBe('spill');
  });

  it('regenerates the shift summary at most once a minute, however much happens', async () => {
    const { cache, tick } = setup();
    const make = vi.fn(async () => `summary ${make.mock.calls.length}`);
    const shift = (version: string) => cache.get('shift', version, { minGapMs: 60 * SEC }, make);
    expect(await shift('e1')).toBe('summary 1');
    tick(30 * SEC);
    expect(await shift('e2')).toBe('summary 1');
    tick(31 * SEC);
    expect(await shift('e3')).toBe('summary 2');
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("doesn't keep a failure: the next ask tries the model again", async () => {
    const { cache } = setup();
    await expect(cache.get('shift', 'e1', {}, async () => { throw new Error('model down'); })).rejects.toThrow('model down');
    expect(await cache.get('shift', 'e1', {}, async () => 'back up')).toBe('back up');
  });
});
