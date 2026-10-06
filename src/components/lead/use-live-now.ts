import { useEffect, useState } from 'react';

import { useRepo } from '@/data/hooks';

/**
 * The repo clock, ticking every second. The snapshot's `now` only moves with the scheduler (every few
 * seconds), which is too coarse for a countdown. Follows the dev clock offset on the mock.
 */
export function useLiveNow(intervalMs = 1_000) {
  const repo = useRepo();
  const read = () => Date.now() + (repo.dev?.clockOffsetMs() ?? 0);
  const [now, setNow] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + (repo.dev?.clockOffsetMs() ?? 0)), intervalMs);
    return () => clearInterval(id);
  }, [repo, intervalMs]);
  return now;
}
