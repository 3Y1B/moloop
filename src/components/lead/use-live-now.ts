import { useEffect, useState } from 'react';

/**
 * The clock, ticking every second. The snapshot's `now` only moves every few seconds, which is too coarse
 * for a countdown.
 */
export function useLiveNow(intervalMs = 1_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
