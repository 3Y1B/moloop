/**
 * Summaries kept in memory, by scope ("shift", "task:<id>"), with the newest event id they were made from. Asking
 * again costs nothing until something new happens; then it's made again, but no more than once per `minGapMs` (the
 * shift summary waits a minute however busy it gets). A failed make isn't kept, so the next ask tries again.
 */
export function summaryCache<T>({ now }: { now: () => number }) {
  const kept = new Map<string, { version: string; at: number; value: T }>();
  return {
    async get(key: string, version: string, { minGapMs = 0 }: { minGapMs?: number }, make: () => Promise<T>): Promise<T> {
      const hit = kept.get(key);
      if (hit && (hit.version === version || now() - hit.at < minGapMs)) return hit.value;
      const value = await make();
      kept.set(key, { version, at: now(), value });
      return value;
    },
  };
}
